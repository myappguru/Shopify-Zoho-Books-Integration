import { useMemo, useState } from "react";
import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { getConnectionForShopDomain, getValidAccessToken } from "../models/zohoConnection.server";
import { getAppSettings } from "../models/appSettings.server";
import { getWarehouseMappings } from "../models/warehouseMapping.server";
import { getRecentWebhookLogs } from "../models/webhookLog.server";
import { runInventoryPull } from "../models/inventorySync.server";
import { getLatestSyncLog } from "../models/syncLog.server";
import { normalizeProductNode } from "../models/productSync.server";
import { useAutoDismiss } from "../hooks/useAutoDismiss";

const PAGE_SIZE = 6;
const INVENTORY_PRODUCTS_QUERY = `#graphql
  query InventoryProducts($first: Int, $after: String, $last: Int, $before: String) {
    products(first: $first, after: $after, last: $last, before: $before) {
      edges { node {
        id title handle
        featuredMedia { preview { image { url altText } } }
        variants(first: 50) { edges { node {
          id title sku price inventoryQuantity
          inventoryItem { id inventoryLevels(first: 50) { edges { node {
            location { id name }
            quantities(names: ["available", "incoming", "committed"]) { name quantity }
          } } } }
        } } }
      } }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;
const LOCATIONS_QUERY = `#graphql
  query InventoryLocations {
    locations(first: 100, includeInactive: false) { nodes { id name } }
  }
`;
const PRODUCT_COUNT_QUERY = `#graphql
  query InventoryProductCount { productsCount { count } }
`;

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
  const recentActivity = connection ? await getRecentWebhookLogs(shop.id, "INVENTORY_LEVELS_UPDATE", 10) : [];
  const latestPullLog = connection ? await getLatestSyncLog(shop.id, "inventory") : null;

  const productVariables = lastPage || before
    ? { last: PAGE_SIZE, before: before || null }
    : { first: PAGE_SIZE, after };

  const [productsResponse, locationsResponse, countResponse] = await Promise.all([
    admin.graphql(INVENTORY_PRODUCTS_QUERY, { variables: productVariables }),
    admin.graphql(LOCATIONS_QUERY),
    admin.graphql(PRODUCT_COUNT_QUERY),
  ]);
  const [productsJson, locationsJson, countJson] = await Promise.all([
    productsResponse.json(), locationsResponse.json(), countResponse.json(),
  ]);

  const connectionData = productsJson.data?.products || {};
  const products = (connectionData.edges || []).map(({ node }) => normalizeProductNode(node));
  const locations = locationsJson.data?.locations?.nodes || [];
  const totalProducts = Number(countJson.data?.productsCount?.count || 0);
  const pageInfo = connectionData.pageInfo || {};
  const inventoryRows = [];
  let totalInventory = 0, lowStock = 0, outOfStock = 0, inventoryValue = 0;

  for (const product of products) {
    for (const variant of product.variants || []) {
      const level = variant.inventoryItem?.inventoryLevels?.edges?.[0]?.node;
      const quantities = Object.fromEntries((level?.quantities || []).map((q) => [q.name, Number(q.quantity || 0)]));
      const available = Number(variant.inventoryQuantity ?? quantities.available ?? 0);
      const incoming = Number(quantities.incoming || 0);
      const committed = Number(quantities.committed || 0);
      const locationId = level?.location?.id || locations[0]?.id || null;
      const warehouseId = locationId ? warehouseMappings[locationId] : null;
      totalInventory += available;
      inventoryValue += available * Number(variant.price || 0);
      if (available <= 0) outOfStock += 1; else if (available <= 10) lowStock += 1;
      inventoryRows.push({ id: variant.id, title: product.title, imageUrl: product.imageUrl, sku: variant.sku || "—", locationId, locationName: level?.location?.name || "Main Location", warehouseName: warehouseId ? `Warehouse ${String(warehouseId).slice(-4)}` : "Not mapped", available, incoming, committed, updatedAt: latestPullLog?.completed_at || latestPullLog?.started_at || null });
    }
  }

  return { connected: Boolean(connection), inventoryAccountId: appSettings.accountSettings?.inventoryAccountId || null, warehouseMappingCount: Object.keys(warehouseMappings).length, recentActivity, latestPullLog, inventoryRows, locations, totalProducts, stats: { totalInventory, lowStock, outOfStock, inventoryValue }, pagination: { page, totalPages: Math.max(1, Math.ceil(totalProducts / PAGE_SIZE)), ...pageInfo } };
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
function currency(value) { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(value || 0)); }
function date(value) { return value ? new Date(value).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }
function status(value) { return value <= 0 ? { label: "Out of Stock", key: "out" } : value <= 10 ? { label: "Low Stock", key: "low" } : { label: "In Stock", key: "in" }; }
function Icon({ type, tone }) { return <s-icon type={type} tone={tone}></s-icon>; }
function href(page, options = {}) { const p = new URLSearchParams(); if (page > 1) p.set("page", String(page)); if (options.after) p.set("after", options.after); if (options.before) p.set("before", options.before); if (options.last) p.set("last", "1"); return p.toString() ? `?${p.toString()}` : ""; }

// eslint-disable-next-line react/prop-types
function Stat({ label, value, caption, icon, tone }) { return <div className="inv-stat"><div className="inv-stat-head"><span>{label}</span><span className={`inv-stat-icon ${tone}`}><Icon type={icon} /></span></div><strong>{value}</strong><small>{caption}</small></div>; }

export default function InventoryPage() {
  const data = useLoaderData();
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("all");
  const [warehouse, setWarehouse] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("product");
  const showLog = useAutoDismiss(data.latestPullLog?.id);
  const isPulling = navigation.state === "submitting" && navigation.formData?.get("intent") === "pull-from-zoho";
  const isLive = data.connected && data.inventoryAccountId && data.warehouseMappingCount > 0;
  const { page, totalPages, hasNextPage, hasPreviousPage, startCursor, endCursor } = data.pagination;
  const rows = useMemo(() => data.inventoryRows.filter((row) => {
    const q = search.trim().toLowerCase();
    const s = status(row.available).key;
    return (!q || `${row.title} ${row.sku} ${row.locationName} ${row.warehouseName}`.toLowerCase().includes(q)) && (location === "all" || row.locationId === location) && (warehouse === "all" || row.warehouseName === warehouse) && (statusFilter === "all" || s === statusFilter);
  }), [data.inventoryRows, search, location, warehouse, statusFilter]);
  const warehouses = [...new Set(data.inventoryRows.map((r) => r.warehouseName))];
  const prevHref = hasPreviousPage ? (page === 2 ? href(1) : href(page - 1, { before: startCursor })) : "";
  const nextHref = hasNextPage ? href(page + 1, { after: endCursor }) : "";
  const lastHref = totalPages > 1 && page !== totalPages ? href(totalPages, { last: true }) : "";
  const from = rows.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = rows.length ? from + rows.length - 1 : 0;

  return <s-page heading="Inventory" inlineSize="large"><style>{`
    .inventory{max-width:1260px;margin:auto;padding-bottom:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17233c}.head{display:flex;justify-content:space-between;gap:18px;margin-bottom:28px}.title{margin:0;font-size:30px;line-height:36px;font-weight:700;color:#101828}.sub{margin:6px 0 0;font-size:15px;color:#344563}.actions{display:flex;gap:12px;align-items:center}.connected{padding:12px 14px;border-radius:9px;background:#eaf8f0;color:#0a8f55;font-size:13px;font-weight:600}.refresh,.store{height:46px;border:1px solid #d8e0ed;border-radius:9px;background:#fff}.refresh{width:46px}.store{min-width:244px;padding:0 14px}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:24px}.inv-stat{min-height:148px;padding:20px;border:1px solid #e3e8f0;border-radius:11px;background:#fff}.inv-stat-head{display:flex;justify-content:space-between;align-items:center;color:#344563;font-size:13px}.inv-stat-icon{width:48px;height:48px;border-radius:12px;display:grid;place-items:center}.blue{background:#edf5ff}.green{background:#e9f8f0}.orange{background:#fff5e9}.red{background:#fff0f1}.purple{background:#f4ecff}.inv-stat strong{display:block;margin-top:7px;font-size:26px;color:#101828}.inv-stat small{display:block;margin-top:8px;color:#344563}.card{border:1px solid #e1e7f0;border-radius:11px;background:#fff;overflow:hidden}.toolbar{padding:18px;display:flex;gap:12px;border-bottom:1px solid #e7ebf1}.search{flex:1;height:42px;border:1px solid #d4dce8;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 12px}.search input{border:0;outline:0;width:100%}.select,.filter,.export{height:42px;border:1px solid #d4dce8;border-radius:8px;background:#fff;padding:0 12px}.export{margin-left:auto}.tabs{display:flex;height:48px;border-bottom:1px solid #e7ebf1}.tab{padding:0 18px;border:0;background:#fff;border-bottom:2px solid transparent}.tab.active{color:#1264ed;border-bottom-color:#1264ed;font-weight:600}.table-wrap{overflow:auto}.table{width:100%;min-width:1080px;border-collapse:collapse}.table th,.table td{padding:12px;border-bottom:1px solid #e9edf3;text-align:left;font-size:12px}.table th{background:#f8fafc;font-size:11px}.product{display:flex;gap:12px;align-items:center}.image{width:46px;height:46px;border:1px solid #e2e7ee;border-radius:8px;object-fit:cover}.qty{font-weight:650}.qty.in{color:#08a15b}.qty.low{color:#e87d00}.qty.out{color:#e53935}.badge{padding:4px 8px;border-radius:7px;font-size:10px;font-weight:600}.badge.in{background:#e8f8ef;color:#0a9857}.badge.low{background:#fff3e4;color:#e27b00}.badge.out{background:#fff0f0;color:#df3838}.footer{min-height:58px;padding:0 18px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e7ebf1}.pagination{display:flex;gap:8px;align-items:center}.page-btn{min-width:36px;height:36px;border:1px solid #d6deea;border-radius:7px;background:#fff;display:grid;place-items:center;text-decoration:none;color:#17233c}.page-btn.active{border-color:#2672ff;color:#1264ed;background:#f7faff}.page-btn.disabled{opacity:.4;pointer-events:none}.empty{padding:40px;text-align:center;color:#738099}@media(max-width:1100px){.stats{grid-template-columns:repeat(3,1fr)}.toolbar{flex-wrap:wrap}.search{flex-basis:100%}}@media(max-width:760px){.head{flex-direction:column}.actions{flex-wrap:wrap}.stats{grid-template-columns:repeat(2,1fr)}.footer{flex-direction:column;align-items:flex-start;gap:10px;padding:12px}.pagination{overflow:auto;width:100%}}@media(max-width:480px){.stats{grid-template-columns:1fr}}
  `}</style><div className="inventory"><div className="head"><div><h1 className="title">Inventory</h1><p className="sub">View and manage your inventory across Shopify locations and Zoho Books warehouses.</p></div><div className="actions"><span className="connected">● {data.connected ? "Connected" : "Not connected"}</span><Form method="get"><button className="refresh" title="Refresh"><Icon type="refresh" /></button></Form><button className="store">My Shopify Store⌄</button></div></div>
  <div className="stats"><Stat label="Total Products" value={number(data.totalProducts)} caption="All products" icon="product" tone="blue" /><Stat label="Total Inventory" value={number(data.stats.totalInventory)} caption="Across loaded locations" icon="inventory" tone="green" /><Stat label="Low Stock" value={number(data.stats.lowStock)} caption="Below threshold" icon="alert-triangle" tone="orange" /><Stat label="Out of Stock" value={number(data.stats.outOfStock)} caption="Out of stock" icon="x-circle" tone="red" /><Stat label="Inventory Value" value={currency(data.stats.inventoryValue)} caption="Estimated value" icon="money" tone="purple" /></div>
  {!isLive && <s-banner tone="warning">Configure the Zoho connection, inventory account and warehouse mapping from Settings.</s-banner>}
  {showLog && data.latestPullLog && <s-banner tone="success">{data.latestPullLog.records_processed} processed, {data.latestPullLog.records_success} updated, {data.latestPullLog.records_failed} failed.</s-banner>}
  <div className="card"><div className="toolbar"><label className="search"><Icon type="search" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by product name, SKU or handle..." /></label><select className="select" value={location} onChange={(e) => setLocation(e.target.value)}><option value="all">All Locations</option>{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select><select className="select" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}><option value="all">All Warehouses</option>{warehouses.map((w) => <option key={w}>{w}</option>)}</select><button className="filter" onClick={() => setStatusFilter(statusFilter === "all" ? "in" : "all")}><Icon type="filter" /> Filters</button><Form method="post" className="export"><input type="hidden" name="intent" value="pull-from-zoho" /><button disabled={!isLive || isPulling}><Icon type="download" /> {isPulling ? "Syncing" : "Export"}</button></Form></div>
  <div className="tabs"><button className={`tab ${tab === "product" ? "active" : ""}`} onClick={() => setTab("product")}>Inventory by Product</button><button className={`tab ${tab === "location" ? "active" : ""}`} onClick={() => setTab("location")}>Inventory by Location</button><button className={`tab ${tab === "warehouse" ? "active" : ""}`} onClick={() => setTab("warehouse")}>Inventory by Warehouse</button></div>
  {tab === "product" ? <div className="table-wrap"><table className="table"><thead><tr><th>Product</th><th>SKU</th><th>Shopify Location</th><th>Zoho Warehouse</th><th>Available Qty</th><th>Incoming Qty</th><th>Committed Qty</th><th>Status</th><th>Last Updated</th><th></th></tr></thead><tbody>{rows.map((row) => { const s = status(row.available); return <tr key={row.id}><td><div className="product">{row.imageUrl ? <img className="image" src={row.imageUrl} alt="" /> : <div className="image" />}<strong>{row.title}</strong></div></td><td>{row.sku}</td><td>{row.locationName}</td><td>{row.warehouseName}</td><td><span className={`qty ${s.key}`}>{number(row.available)}</span></td><td>{number(row.incoming)}</td><td>{number(row.committed)}</td><td><span className={`badge ${s.key}`}>{s.label}</span></td><td>{date(row.updatedAt)}</td><td>⋮</td></tr>; })}</tbody></table>{rows.length === 0 && <div className="empty">No inventory items match your current filters.</div>}</div> : <div className="empty">{tab === "location" ? "Location-level inventory view is ready for the next data layer." : "Warehouse-level inventory view is ready for the next data layer."}</div>}
  <div className="footer"><div>Showing {from} to {to} of {number(data.totalProducts)} products</div><div className="pagination"><a className={`page-btn ${!hasPreviousPage ? "disabled" : ""}`} href={prevHref}>‹</a><a className="page-btn active" href={page === 1 ? "" : (before ? `?page=${page}` : "")}>{page}</a>{hasNextPage && <a className="page-btn" href={nextHref}>{page + 1}</a>}{page < totalPages - 1 && <span>…</span>}{totalPages > 1 && <a className="page-btn" href={lastHref}>{totalPages}</a>}<a className={`page-btn ${!hasNextPage ? "disabled" : ""}`} href={nextHref}>›</a></div></div></div></div></s-page>;
}
