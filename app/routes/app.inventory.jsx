import { useMemo, useState } from "react";
import { Form, Link, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { getConnectionForShopDomain, getValidAccessToken } from "../models/zohoConnection.server";
import { getAppSettings } from "../models/appSettings.server";
import { getWarehouseMappings } from "../models/warehouseMapping.server";
import { runInventoryPull } from "../models/inventorySync.server";
import { getLatestSyncLog } from "../models/syncLog.server";
import { useAutoDismiss } from "../hooks/useAutoDismiss";

const PAGE_SIZE = 6;
const CURSOR_PAGE_SIZE = 250;
const PRODUCT_FIELDS = `#graphql
  fragment InventoryProductFields on Product {
    id title handle
    featuredMedia { preview { image { url altText } } }
    variants(first: 50) { edges { node {
      id sku price inventoryQuantity
      inventoryItem { id inventoryLevels(first: 50) { edges { node {
        location { id name }
        quantities(names: ["available", "incoming", "committed"]) { name quantity }
      } } } }
    } } }
  }
`;
const PRODUCTS_FORWARD_QUERY = `#graphql
  query InventoryProductsForward($first: Int!, $after: String) {
    products(first: $first, after: $after) { edges { node { ...InventoryProductFields } } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } }
  }
  ${PRODUCT_FIELDS}
`;
const PRODUCTS_BACKWARD_QUERY = `#graphql
  query InventoryProductsBackward($last: Int!, $before: String!) {
    products(last: $last, before: $before) { edges { node { ...InventoryProductFields } } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } }
  }
  ${PRODUCT_FIELDS}
`;
const LOCATIONS_QUERY = `#graphql
  query InventoryLocations { locations(first: 100, includeInactive: false) { nodes { id name } } }
`;
const COUNT_QUERY = `#graphql
  query InventoryProductCount { productsCount { count } }
`;

async function fetchLastInventoryPage(admin) {
  let after = null;
  let finalConnection = null;
  while (true) {
    const response = await admin.graphql(PRODUCTS_FORWARD_QUERY, { variables: { first: CURSOR_PAGE_SIZE, after } });
    const json = await response.json();
    if (json.errors?.length) throw new Error(json.errors.map((error) => error.message).join(" "));
    const connection = json.data?.products;
    if (!connection) throw new Error("Shopify did not return inventory products.");
    finalConnection = connection;
    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor;
    if (!after) throw new Error("Shopify returned no cursor for the next inventory page.");
  }
  if (!finalConnection) return null;
  const edges = finalConnection.edges || [];
  const lastEdges = edges.slice(-PAGE_SIZE);
  const pageInfo = {
    hasNextPage: false,
    hasPreviousPage: Boolean(finalConnection.pageInfo?.hasPreviousPage || edges.length > PAGE_SIZE),
    startCursor: lastEdges[0]?.cursor || finalConnection.pageInfo?.startCursor || null,
    endCursor: lastEdges[lastEdges.length - 1]?.cursor || finalConnection.pageInfo?.endCursor || null,
  };
  return { ...finalConnection, edges: lastEdges, pageInfo };
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, connection } = await getConnectionForShopDomain(session.shop);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const after = url.searchParams.get("after") || null;
  const before = url.searchParams.get("before") || null;
  const lastPage = url.searchParams.get("last") === "1";
  const appSettings = connection ? await getAppSettings(shop.id) : {};
  const warehouseMappings = connection ? await getWarehouseMappings(shop.id) : {};
  const latestPullLog = connection ? await getLatestSyncLog(shop.id, "inventory") : null;

  let productsJson;
  try {
    let productsResponse;
    if (lastPage) {
      const lastConnection = await fetchLastInventoryPage(admin);
      productsJson = { data: { products: lastConnection || { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } } } };
    } else if (before) {
      productsResponse = await admin.graphql(PRODUCTS_BACKWARD_QUERY, { variables: { last: PAGE_SIZE, before } });
      productsJson = await productsResponse.json();
    } else {
      productsResponse = await admin.graphql(PRODUCTS_FORWARD_QUERY, { variables: { first: PAGE_SIZE, after } });
      productsJson = await productsResponse.json();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load inventory from Shopify.";
    const countResponse = await admin.graphql(COUNT_QUERY);
    const countJson = await countResponse.json();
    const totalProducts = Number(countJson.data?.productsCount?.count || 0);
    return { connected: Boolean(connection), inventoryAccountId: appSettings.accountSettings?.inventoryAccountId || null, warehouseMappingCount: Object.keys(warehouseMappings).length, latestPullLog, locations: [], totalProducts, totalPages: Math.max(1, Math.ceil(totalProducts / PAGE_SIZE)), inventoryRows: [], stats: { totalInventory: 0, lowStock: 0, outOfStock: 0, inventoryValue: 0 }, pagination: { page, totalPages: Math.max(1, Math.ceil(totalProducts / PAGE_SIZE)), hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null }, loadError: message };
  }

  const [locationsResponse, countResponse] = await Promise.all([admin.graphql(LOCATIONS_QUERY), admin.graphql(COUNT_QUERY)]);
  const [locationsJson, countJson] = await Promise.all([locationsResponse.json(), countResponse.json()]);
  const locations = locationsJson.data?.locations?.nodes || [];
  const totalProducts = Number(countJson.data?.productsCount?.count || 0);
  const totalPages = Math.max(1, Math.ceil(totalProducts / PAGE_SIZE));
  const base = { connected: Boolean(connection), inventoryAccountId: appSettings.accountSettings?.inventoryAccountId || null, warehouseMappingCount: Object.keys(warehouseMappings).length, latestPullLog, locations, totalProducts, totalPages };
  if (productsJson.errors?.length) return { ...base, inventoryRows: [], stats: { totalInventory: 0, lowStock: 0, outOfStock: 0, inventoryValue: 0 }, pagination: { page, totalPages, hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null }, loadError: productsJson.errors.map((error) => error.message).join(" ") };

  const productsConnection = productsJson.data?.products || {};
  const inventoryRows = [];
  let totalInventory = 0, lowStock = 0, outOfStock = 0, inventoryValue = 0;
  for (const edge of productsConnection.edges || []) {
    const product = edge.node;
    if (!product) continue;
    const imageUrl = product.featuredMedia?.preview?.image?.url || null;
    for (const variantEdge of product.variants?.edges || []) {
      const variant = variantEdge.node;
      if (!variant) continue;
      const levels = variant.inventoryItem?.inventoryLevels?.edges?.map((item) => item.node).filter(Boolean) || [];
      const level = levels[0];
      const quantityMap = Object.fromEntries((level?.quantities || []).map((item) => [item.name, Number(item.quantity || 0)]));
      const available = Number(variant.inventoryQuantity ?? quantityMap.available ?? 0);
      const incoming = Number(quantityMap.incoming || 0);
      const committed = Number(quantityMap.committed || 0);
      const locationId = level?.location?.id || locations[0]?.id || null;
      const mappedWarehouse = locationId ? warehouseMappings[locationId] : null;
      totalInventory += available;
      inventoryValue += available * Number(variant.price || 0);
      if (available <= 0) outOfStock += 1; else if (available <= 10) lowStock += 1;
      inventoryRows.push({ id: variant.id, title: product.title, imageUrl, sku: variant.sku || "—", locationId, locationName: level?.location?.name || "Main Location", warehouseName: mappedWarehouse ? `Warehouse ${String(mappedWarehouse).slice(-4)}` : "Not mapped", available, incoming, committed, updatedAt: latestPullLog?.completed_at || latestPullLog?.started_at || null });
    }
  }
  return { ...base, inventoryRows, stats: { totalInventory, lowStock, outOfStock, inventoryValue }, pagination: { page, totalPages, hasNextPage: Boolean(productsConnection.pageInfo?.hasNextPage), hasPreviousPage: Boolean(productsConnection.pageInfo?.hasPreviousPage), startCursor: productsConnection.pageInfo?.startCursor || null, endCursor: productsConnection.pageInfo?.endCursor || null }, loadError: null };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") !== "pull-from-zoho") return null;
  const { shop, connection } = await getConnectionForShopDomain(session.shop);
  if (!connection) return null;
  const token = await getValidAccessToken(shop.id).catch((error) => { console.error("Failed to get a valid Zoho access token for inventory pull", error); return null; });
  if (!token) return null;
  await runInventoryPull({ admin, shop, zohoAuth: { accessToken: token.accessToken, apiDomain: token.apiDomain, organizationId: connection.organization_id } });
  return null;
};

function number(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
function currency(value) { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0)); }
function date(value) { return value ? new Date(value).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }
function status(value) { return value <= 0 ? { label: "Out of Stock", key: "out" } : value <= 10 ? { label: "Low Stock", key: "low" } : { label: "In Stock", key: "in" }; }
function Icon({ type, tone }) { return <s-icon type={type} tone={tone}></s-icon>; }
function pageHref(page, options = {}) { const params = new URLSearchParams(); if (page > 1) params.set("page", String(page)); if (options.after) params.set("after", options.after); if (options.before) params.set("before", options.before); if (options.last) params.set("last", "1"); const query = params.toString(); return query ? `?${query}` : ""; }
function escapeCsv(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function downloadCsv(rows) { const header = ["Product", "SKU", "Shopify Location", "Zoho Warehouse", "Available Qty", "Incoming Qty", "Committed Qty", "Status", "Last Updated"]; const body = rows.map((row) => [row.title, row.sku, row.locationName, row.warehouseName, row.available, row.incoming, row.committed, status(row.available).label, date(row.updatedAt)].map(escapeCsv).join(",")); const blob = new Blob([[header.map(escapeCsv).join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" }); const objectUrl = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = `inventory-page-${Date.now()}.csv`; anchor.click(); URL.revokeObjectURL(objectUrl); }

// eslint-disable-next-line react/prop-types
function Stat({ label, value, caption, icon, tone }) { return <div className="inv-stat"><div className="stat-head"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon type={icon} /></span></div><strong>{value}</strong><small>{caption}</small></div>; }

export default function InventoryPage() {
  const data = useLoaderData(); const navigation = useNavigation();
  const [search, setSearch] = useState(""); const [location, setLocation] = useState("all"); const [warehouse, setWarehouse] = useState("all"); const [statusFilter, setStatusFilter] = useState("all"); const [tab, setTab] = useState("product"); const [storeOpen, setStoreOpen] = useState(false); const [exportOpen, setExportOpen] = useState(false);
  const showLog = useAutoDismiss(data.latestPullLog?.id); const { page, totalPages, hasNextPage, hasPreviousPage, startCursor, endCursor } = data.pagination;
  const rows = useMemo(() => data.inventoryRows.filter((row) => { const query = search.trim().toLowerCase(); const rowStatus = status(row.available).key; return (!query || `${row.title} ${row.sku} ${row.locationName} ${row.warehouseName}`.toLowerCase().includes(query)) && (location === "all" || row.locationId === location) && (warehouse === "all" || row.warehouseName === warehouse) && (statusFilter === "all" || rowStatus === statusFilter); }), [data.inventoryRows, search, location, warehouse, statusFilter]);
  const warehouses = [...new Set(data.inventoryRows.map((row) => row.warehouseName))];
  const previousHref = hasPreviousPage ? (page === 2 ? pageHref(1) : pageHref(page - 1, { before: startCursor })) : "";
  const nextHref = hasNextPage ? pageHref(page + 1, { after: endCursor }) : "";
  const lastHref = totalPages > 1 && page !== totalPages ? pageHref(totalPages, { last: true }) : "";
  const from = rows.length ? (page - 1) * PAGE_SIZE + 1 : 0; const to = rows.length ? from + rows.length - 1 : 0;
  const loadingPage = navigation.state === "loading";
  const PageLink = ({ href, children, className = "page-btn", ...props }) => href ? <Link to={href} className={className} {...props}>{children}</Link> : <span className={`${className} disabled`} {...props}>{children}</span>;
  const isLive = data.connected && data.inventoryAccountId && data.warehouseMappingCount > 0;

  return <s-page heading="Inventory" inlineSize="large"><style>{`.inventory{max-width:1260px;margin:0 auto;padding-bottom:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#17233c}.head{display:flex;justify-content:space-between;gap:20px;margin-bottom:28px}.title{margin:0;font-size:30px;line-height:36px;font-weight:700;color:#101828}.sub{margin:5px 0 0;font-size:15px;line-height:22px;color:#344563}.actions{display:flex;gap:12px;align-items:center}.connected{height:46px;padding:0 14px;border-radius:9px;background:#eaf8f0;color:#0a8f55;display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600}.connected-dot{width:7px;height:7px;border-radius:50%;background:#08a15b}.refresh{width:46px;height:46px;border:1px solid #d8e0ed;border-radius:9px;background:#fff;display:grid;place-items:center;cursor:pointer}.store-wrap,.export-wrap{position:relative}.store{height:46px;min-width:244px;padding:0 14px;border:1px solid #d8e0ed;border-radius:9px;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:18px;color:#17233c;font-size:13px;font-weight:600;cursor:pointer}.store-left{display:flex;align-items:center;gap:10px}.store-chevron{transition:transform .15s}.store-chevron.open{transform:rotate(180deg)}.dropdown{position:absolute;right:0;top:52px;z-index:30;min-width:244px;padding:6px;background:#fff;border:1px solid #d8e0ed;border-radius:10px;box-shadow:0 10px 30px rgba(20,35,60,.12)}.dropdown-item{width:100%;padding:10px 11px;border:0;border-radius:7px;background:#fff;text-align:left;color:#17233c;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:9px}.dropdown-item:hover{background:#f4f7fb}.dropdown-item.active{background:#edf5ff;color:#1264ed;font-weight:600}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:24px}.inv-stat{min-height:148px;padding:20px;border:1px solid #e3e8f0;border-radius:11px;background:#fff;box-shadow:0 1px 3px rgba(20,35,60,.03)}.stat-head{display:flex;justify-content:space-between;align-items:center;color:#344563;font-size:13px}.stat-icon{width:48px;height:48px;border-radius:12px;display:grid;place-items:center}.blue{background:#edf5ff}.green{background:#e9f8f0}.orange{background:#fff5e9}.red{background:#fff0f1}.purple{background:#f4ecff}.inv-stat strong{display:block;margin-top:7px;font-size:26px;line-height:32px;color:#101828}.inv-stat small{display:block;margin-top:8px;color:#344563;font-size:12px}.banner{margin-bottom:18px}.card{margin-top:18px;border:1px solid #e1e7f0;border-radius:11px;background:#fff;overflow:visible}.toolbar{padding:18px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #e7ebf1}.search{flex:1;height:42px;border:1px solid #d4dce8;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 12px;background:#fff}.search input{border:0;outline:0;width:100%;font-size:13px;color:#17233c}.select,.filter,.export{height:42px;border:1px solid #d4dce8;border-radius:8px;background:#fff;padding:0 12px;color:#17233c;font-size:12px}.select{min-width:135px}.filter,.export-button{display:flex;align-items:center;gap:7px;cursor:pointer}.export-wrap{margin-left:auto}.export-button{min-width:100px;justify-content:center}.export-chevron{margin-left:auto}.tabs{display:flex;height:48px;border-bottom:1px solid #e7ebf1;padding:0 8px}.tab{height:48px;padding:0 18px;border:0;background:#fff;border-bottom:2px solid transparent;color:#344563;cursor:pointer;font-size:12px}.tab.active{color:#1264ed;border-bottom-color:#1264ed;font-weight:600}.table-wrap{overflow:auto}.table{width:100%;min-width:1080px;border-collapse:collapse}.table th,.table td{padding:12px;border-bottom:1px solid #e9edf3;text-align:left;font-size:12px;white-space:nowrap}.table th{background:#f8fafc;color:#17233c;font-size:11px;font-weight:650}.product{display:flex;gap:12px;align-items:center}.image{width:46px;height:46px;border:1px solid #e2e7ee;border-radius:8px;object-fit:cover;background:#f7f9fb}.qty{font-weight:650}.qty.in{color:#08a15b}.qty.low{color:#e87d00}.qty.out{color:#e53935}.badge{display:inline-flex;padding:4px 8px;border-radius:7px;font-size:10px;font-weight:600}.badge.in{background:#e8f8ef;color:#0a9857}.badge.low{background:#fff3e4;color:#e27d00}.badge.out{background:#fff0f0;color:#df3838}.row-menu{border:0;background:transparent;color:#17233c;font-size:18px;cursor:pointer}.footer{min-height:58px;padding:0 18px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e7ebf1;color:#344563;font-size:12px}.pagination{display:flex;gap:8px;align-items:center}.page-btn{min-width:36px;height:36px;border:1px solid #d6deea;border-radius:7px;background:#fff;display:grid;place-items:center;text-decoration:none;color:#17233c}.page-btn.active{border-color:#2672ff;color:#1264ed;background:#f7faff;font-weight:600}.page-btn.disabled{opacity:.4;pointer-events:none}.empty{padding:40px;text-align:center;color:#738099}.page-loading{opacity:.55;pointer-events:none}@media(max-width:1100px){.stats{grid-template-columns:repeat(3,1fr)}.toolbar{flex-wrap:wrap}.search{flex-basis:100%}.export-wrap{margin-left:0}}@media(max-width:760px){.head{flex-direction:column}.actions{flex-wrap:wrap}.stats{grid-template-columns:repeat(2,1fr)}.footer{flex-direction:column;align-items:flex-start;gap:10px;padding:12px}.pagination{overflow:auto;width:100%}}@media(max-width:480px){.stats{grid-template-columns:1fr}.store{min-width:190px}.actions{gap:8px}}</style><div className="inventory"><div className="head"><div><h1 className="title">Inventory</h1><p className="sub">View and manage your inventory across Shopify locations and Zoho Books warehouses.</p></div><div className="actions"><span className="connected"><span className="connected-dot" />{data.connected ? "Connected" : "Not connected"}</span><Form method="get"><button className="refresh" type="submit" title="Refresh"><Icon type="refresh" /></button></Form><div className="store-wrap"><button className="store" type="button" onClick={() => setStoreOpen((open) => !open)} aria-expanded={storeOpen}><span className="store-left"><Icon type="store" /><span>My Shopify Store</span></span><span className={`store-chevron ${storeOpen ? "open" : ""}`}><Icon type="chevron-down" /></span></button>{storeOpen && <div className="dropdown"><button className="dropdown-item active" type="button"><Icon type="store" />My Shopify Store</button></div>}</div></div></div><div className="stats"><Stat label="Total Products" value={number(data.totalProducts)} caption="All products" icon="product" tone="blue" /><Stat label="Total Inventory" value={number(data.stats.totalInventory)} caption="Across loaded locations" icon="inventory" tone="green" /><Stat label="Low Stock" value={number(data.stats.lowStock)} caption="Below threshold" icon="alert-triangle" tone="orange" /><Stat label="Out of Stock" value={number(data.stats.outOfStock)} caption="Out of stock" icon="x-circle" tone="red" /><Stat label="Inventory Value" value={currency(data.stats.inventoryValue)} caption="Estimated value" icon="money" tone="purple" /></div>{data.loadError && <div className="banner"><s-banner heading="Unable to load this inventory page" tone="critical">{data.loadError}. Please refresh the page and try again.</s-banner></div>}{!isLive && <div className="banner"><s-banner tone="warning">Configure the Zoho connection, inventory account and warehouse mapping from Settings.</s-banner></div>}{showLog && data.latestPullLog && <div className="banner"><s-banner tone="success">{data.latestPullLog.records_processed} processed, {data.latestPullLog.records_success} updated, {data.latestPullLog.records_failed} failed.</s-banner></div>}<div className={`card ${loadingPage ? "page-loading" : ""}`}><div className="toolbar"><label className="search"><Icon type="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by product name, SKU or handle..." /></label><select className="select" value={location} onChange={(event) => setLocation(event.target.value)}><option value="all">All Locations</option>{data.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className="select" value={warehouse} onChange={(event) => setWarehouse(event.target.value)}><option value="all">All Warehouses</option>{warehouses.map((item) => <option key={item}>{item}</option>)}</select><button className="filter" type="button" onClick={() => setStatusFilter(statusFilter === "all" ? "in" : "all")}><Icon type="filter" />Filters{statusFilter !== "all" ? " · 1" : ""}</button><div className="export-wrap"><button className="export export-button" type="button" onClick={() => setExportOpen((open) => !open)} aria-expanded={exportOpen}><Icon type="download" />Export<span className="export-chevron"><Icon type="chevron-down" /></span></button>{exportOpen && <div className="dropdown" style={{ minWidth: 190 }}><button className="dropdown-item" type="button" onClick={() => { downloadCsv(rows); setExportOpen(false); }}><Icon type="document" />Export as CSV</button><button className="dropdown-item" type="button" onClick={() => { downloadCsv(rows); setExportOpen(false); }}><Icon type="file" />Export current page</button></div>}</div></div><div className="tabs"><button className={`tab ${tab === "product" ? "active" : ""}`} type="button" onClick={() => setTab("product")}>Inventory by Product</button><button className={`tab ${tab === "location" ? "active" : ""}`} type="button" onClick={() => setTab("location")}>Inventory by Location</button><button className={`tab ${tab === "warehouse" ? "active" : ""}`} type="button" onClick={() => setTab("warehouse")}>Inventory by Warehouse</button></div>{tab === "product" ? <div className="table-wrap"><table className="table"><thead><tr><th>Product</th><th>SKU</th><th>Shopify Location</th><th>Zoho Warehouse</th><th>Available Qty</th><th>Incoming Qty</th><th>Committed Qty</th><th>Status</th><th>Last Updated</th><th></th></tr></thead><tbody>{rows.map((row) => { const currentStatus = status(row.available); return <tr key={row.id}><td><div className="product">{row.imageUrl ? <img className="image" src={row.imageUrl} alt="" /> : <div className="image" />}<strong>{row.title}</strong></div></td><td>{row.sku}</td><td>{row.locationName}</td><td>{row.warehouseName}</td><td><span className={`qty ${currentStatus.key}`}>{number(row.available)}</span></td><td>{number(row.incoming)}</td><td>{number(row.committed)}</td><td><span className={`badge ${currentStatus.key}`}>{currentStatus.label}</span></td><td>{date(row.updatedAt)}</td><td><button className="row-menu" type="button" aria-label={`Actions for ${row.title}`}>⋮</button></td></tr>; })}</tbody></table>{rows.length === 0 && <div className="empty">No inventory items match your current filters.</div>}</div> : <div className="empty">{tab === "location" ? "Location-level inventory view is ready for the next data layer." : "Warehouse-level inventory view is ready for the next data layer."}</div>}<div className="footer"><div>Showing {from} to {to} of {number(data.totalProducts)} products</div><div className="pagination"><PageLink href={previousHref} aria-label="Previous page">‹</PageLink>{page > 1 && <PageLink href={pageHref(1)}>1</PageLink>}{page > 3 && <span>…</span>}{page > 1 && <span className="page-btn active">{page}</span>}{hasNextPage && <PageLink href={nextHref}>{page + 1}</PageLink>}{hasNextPage && totalPages > page + 1 && <span>…</span>}{totalPages > 1 && page !== totalPages && <PageLink href={lastHref}>{totalPages}</PageLink>}<PageLink href={nextHref} aria-label="Next page">›</PageLink></div></div></div></div></s-page>;
}
