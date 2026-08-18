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
  query InventoryLocations { locations(first: 100, includeInactive: false) { nodes { id name } }
`;
const PRODUCT_COUNT_QUERY = `#graphql
  query InventoryProductCount { productsCount { count }
`;

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, connection } = await getConnectionForShopDomain(session.shop);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const after = url.searchParams.get("after") || null;
  const before = url.searchParams.get("before") || null;
  const appSettings = connection ? await getAppSettings(shop.id) : {};
  const warehouseMappings = connection ? await getWarehouseMappings(shop.id) : {};
  const recentActivity = connection ? await getRecentWebhookLogs(shop.id, "INVENTORY_LEVELS_UPDATE", 10) : [];
  const latestPullLog = connection ? await getLatestSyncLog(shop.id, "inventory") : null;

  const productVariables = before
    ? { last: PAGE_SIZE, before }
    : { first: PAGE_SIZE, after: after || null };

  const [productsResponse, locationsResponse, countResponse] = await Promise.all([
    admin.graphql(INVENTORY_PRODUCTS_QUERY, { variables: productVariables }),
    admin.graphql(LOCATIONS_QUERY),
    admin.graphql(PRODUCT_COUNT_QUERY),
  ]);
  const [productsJson, locationsJson, countJson] = await Promise.all([
    productsResponse.json(), locationsResponse.json(), countResponse.json(),
  ]);

  const productsConnection = productsJson.data?.products || {};
  const products = (productsConnection.edges || []).map(({ node }) => normalizeProductNode(node));
  const locations = locationsJson.data?.locations?.nodes || [];
  const totalProducts = Number(countJson.data?.productsCount?.count || 0);
  const pageInfo = productsConnection.pageInfo || {};

  const inventoryRows = [];
  let totalInventory = 0;
  let lowStock = 0;
  let outOfStock = 0;
  let inventoryValue = 0;

  for (const product of products) {
    for (const variant of product.variants || []) {
      const levels = variant.inventoryItem?.inventoryLevels?.edges || [];
      const firstLevel = levels[0]?.node;
      const quantities = Object.fromEntries((firstLevel?.quantities || []).map((q) => [q.name, Number(q.quantity || 0)]));
      const available = Number(variant.inventoryQuantity || quantities.available || 0);
      const incoming = Number(quantities.incoming || 0);
      const committed = Number(quantities.committed || 0);
      const locationId = firstLevel?.location?.id || locations[0]?.id || null;
      const zohoWarehouseId = locationId ? warehouseMappings[locationId] : null;
      totalInventory += available;
      inventoryValue += available * Number(variant.price || 0);
      if (available <= 0) outOfStock += 1;
      else if (available <= 10) lowStock += 1;
      inventoryRows.push({
        id: variant.id, productId: product.id, title: product.title, imageUrl: product.imageUrl,
        sku: variant.sku || "—", locationId,
        locationName: firstLevel?.location?.name || "Main Location",
        warehouseName: zohoWarehouseId ? `Warehouse ${String(zohoWarehouseId).slice(-4)}` : "Not mapped",
        available, incoming, committed,
        updatedAt: latestPullLog?.completed_at || latestPullLog?.started_at || null,
      });
    }
  }

  return {
    connected: Boolean(connection),
    inventoryAccountId: appSettings.accountSettings?.inventoryAccountId || null,
    warehouseMappingCount: Object.keys(warehouseMappings).length,
    recentActivity, latestPullLog, products, inventoryRows, locations, totalProducts,
    stats: { totalInventory, lowStock, outOfStock, inventoryValue },
    pagination: { page, totalPages: Math.max(1, Math.ceil(totalProducts / PAGE_SIZE)), ...pageInfo },
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") !== "pull-from-zoho") return null;
  const { shop, connection } = await getConnectionForShopDomain(session.shop);
  if (!connection) return null;
  const token = await getValidAccessToken(shop.id).catch((error) => {
    console.error("Failed to get a valid Zoho access token for inventory pull", error);
    return null;
  });
  if (!token) return null;
  await runInventoryPull({ admin, shop, zohoAuth: { accessToken: token.accessToken, apiDomain: token.apiDomain, organizationId: connection.organization_id } });
  return null;
};

function formatNumber(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
function formatCurrency(value) { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0)); }
function formatDate(value) { return value ? new Date(value).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }
function formatRelative(value) { if (!value) return "Never"; const diff = Math.max(0, Date.now() - new Date(value).getTime()); const minutes = Math.floor(diff / 60000); if (minutes < 1) return "Just now"; if (minutes < 60) return `${minutes} min ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} hr ago`; return `${Math.floor(hours / 24)} days ago`; }
function getStatus(quantity) { if (quantity <= 0) return { label: "Out of Stock", className: "out" }; if (quantity <= 10) return { label: "Low Stock", className: "low" }; return { label: "In Stock", className: "in" }; }
function Icon({ type, tone }) { return <s-icon type={type} tone={tone}></s-icon>; }
// eslint-disable-next-line react/prop-types
function StatCard({ label, value, caption, icon, className }) { return <div className="inventory-stat-card"><div className="inventory-stat-top"><div className="inventory-stat-label">{label}</div><div className={`inventory-stat-icon ${className}`}><Icon type={icon} /></div></div><div className="inventory-stat-value">{value}</div><div className="inventory-stat-caption">{caption}</div></div>; }

function pageUrl(page, { after = null, before = null } = {}) {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (after) params.set("after", after);
  if (before) params.set("before", before);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export default function InventoryPage() {
  const data = useLoaderData();
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("product");
  const isPulling = navigation.state === "submitting" && navigation.formData?.get("intent") === "pull-from-zoho";
  const showPullLog = useAutoDismiss(data.latestPullLog?.id);
  const isLive = data.connected && data.inventoryAccountId && data.warehouseMappingCount > 0;
  const { page, totalPages, hasNextPage, hasPreviousPage, startCursor, endCursor } = data.pagination;

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.inventoryRows.filter((row) => {
      const matchesSearch = !query || [row.title, row.sku, row.locationName, row.warehouseName].join(" ").toLowerCase().includes(query);
      const matchesLocation = locationFilter === "all" || row.locationId === locationFilter;
      const matchesWarehouse = warehouseFilter === "all" || row.warehouseName === warehouseFilter;
      const status = getStatus(row.available).className;
      const matchesStatus = statusFilter === "all" || status === statusFilter;
      return matchesSearch && matchesLocation && matchesWarehouse && matchesStatus;
    });
  }, [data.inventoryRows, search, locationFilter, warehouseFilter, statusFilter]);

  const warehouseOptions = [...new Set(data.inventoryRows.map((row) => row.warehouseName))];
  const lastUpdated = data.latestPullLog?.completed_at || data.latestPullLog?.started_at;
  const from = data.inventoryRows.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = data.inventoryRows.length ? from + Math.min(filteredRows.length, PAGE_SIZE) - 1 : 0;
  const nextUrl = hasNextPage ? pageUrl(page + 1, { after: endCursor }) : "";
  const previousUrl = hasPreviousPage ? (page === 2 ? "" : pageUrl(page - 1, { before: startCursor })) : "";

  return <s-page heading="Inventory" inlineSize="large"><style>{`
    .inventory-shell{width:100%;max-width:1260px;margin:0 auto;padding:0 0 24px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#17233c}.inventory-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:28px}.inventory-title{margin:0;font-size:30px;line-height:36px;font-weight:700;color:#101828}.inventory-subtitle{margin:6px 0 0;font-size:15px;line-height:22px;color:#344563}.inventory-header-actions{display:flex;align-items:center;gap:12px}.connection-badge{height:42px;padding:0 14px;border-radius:9px;background:#eaf8f0;color:#0a8f55;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}.connection-dot{width:7px;height:7px;border-radius:50%;background:#0aa65c}.header-icon-button{width:46px;height:46px;border:1px solid #d8e0ed;border-radius:9px;background:#fff;display:grid;place-items:center}.store-selector{height:46px;min-width:244px;padding:0 14px;border:1px solid #d8e0ed;border-radius:9px;background:#fff;display:flex;align-items:center;justify-content:space-between;color:#17233c;font-size:13px;font-weight:600}.store-selector-left{display:flex;align-items:center;gap:10px}.inventory-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:24px}.inventory-stat-card{min-height:148px;padding:20px;border:1px solid #e3e8f0;border-radius:11px;background:#fff;box-shadow:0 1px 3px rgba(20,35,60,.04)}.inventory-stat-top{display:flex;align-items:center;justify-content:space-between}.inventory-stat-label{font-size:13px;color:#344563}.inventory-stat-icon{width:48px;height:48px;border-radius:12px;display:grid;place-items:center}.inventory-stat-icon.blue{background:#edf5ff}.inventory-stat-icon.green{background:#e9f8f0}.inventory-stat-icon.orange{background:#fff5e9}.inventory-stat-icon.red{background:#fff0f1}.inventory-stat-icon.purple{background:#f4ecff}.inventory-stat-value{margin-top:7px;font-size:26px;font-weight:700;color:#101828}.inventory-stat-caption{margin-top:8px;font-size:12px;color:#344563}.inventory-banner{margin-bottom:18px}.inventory-table-card{border:1px solid #e1e7f0;border-radius:11px;background:#fff;overflow:hidden}.inventory-toolbar{padding:18px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #e7ebf1}.inventory-search{height:42px;flex:1;border:1px solid #d4dce8;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 12px}.inventory-search input{border:0;outline:0;width:100%;font-size:13px}.inventory-select{height:42px;min-width:135px;border:1px solid #d4dce8;border-radius:8px;background:#fff;padding:0 11px}.inventory-filter-button,.inventory-export{height:42px;border:1px solid #d4dce8;border-radius:8px;background:#fff;padding:0 13px;display:flex;align-items:center;gap:7px}.inventory-export{margin-left:auto}.inventory-tabs{height:48px;display:flex;align-items:flex-end;border-bottom:1px solid #e7ebf1;padding:0 18px}.inventory-tab{height:48px;padding:0 18px;border:0;border-bottom:2px solid transparent;background:transparent;color:#344563;cursor:pointer}.inventory-tab.active{color:#1264ed;border-bottom-color:#1264ed;font-weight:600}.inventory-table-wrap{overflow-x:auto}.inventory-table{width:100%;min-width:1080px;border-collapse:collapse}.inventory-table th{padding:12px;text-align:left;background:#f8fafc;border-bottom:1px solid #e5eaf1;font-size:11px}.inventory-table td{padding:12px;border-bottom:1px solid #e9edf3;font-size:12px}.inventory-product{display:flex;align-items:center;gap:12px}.inventory-product-image{width:46px;height:46px;border:1px solid #e2e7ee;border-radius:8px;object-fit:cover;background:#f6f8fb}.inventory-product-name{font-weight:650;white-space:nowrap}.inventory-qty{font-weight:650}.inventory-qty.in{color:#08a15b}.inventory-qty.low{color:#e87d00}.inventory-qty.out{color:#e53935}.inventory-status{display:inline-flex;padding:4px 8px;border-radius:7px;font-size:10px;font-weight:600}.inventory-status.in{background:#e8f8ef;color:#0a9857}.inventory-status.low{background:#fff3e4;color:#e27b00}.inventory-status.out{background:#fff0f0;color:#df3838}.inventory-footer{min-height:58px;padding:0 18px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #e7ebf1}.inventory-pagination{display:flex;align-items:center;gap:8px}.inventory-page-button{min-width:36px;height:36px;border:1px solid #d6deea;border-radius:7px;background:#fff;display:grid;place-items:center;text-decoration:none;color:#17233c}.inventory-page-button.active{border-color:#2672ff;color:#1264ed;background:#f7faff}.inventory-page-button.disabled{opacity:.45;pointer-events:none}.inventory-empty{padding:44px;text-align:center;color:#738099}.inventory-pull-note{margin-top:5px;font-size:11px;color:#738099}@media(max-width:1100px){.inventory-stats{grid-template-columns:repeat(3,1fr)}.inventory-toolbar{flex-wrap:wrap}.inventory-search{flex-basis:100%}}@media(max-width:760px){.inventory-header{flex-direction:column}.inventory-header-actions{width:100%;flex-wrap:wrap}.inventory-stats{grid-template-columns:repeat(2,1fr)}.inventory-footer{flex-direction:column;align-items:flex-start;gap:10px;padding:12px 16px}.inventory-pagination{width:100%;overflow:auto}}@media(max-width:480px){.inventory-stats{grid-template-columns:1fr}.store-selector{min-width:0;flex:1}}
  `}</style><div className="inventory-shell">
    <div className="inventory-header"><div><h1 className="inventory-title">Inventory</h1><p className="inventory-subtitle">View and manage your inventory across Shopify locations and Zoho Books warehouses.</p></div><div className="inventory-header-actions"><div className="connection-badge"><span className="connection-dot" />{data.connected ? "Connected" : "Not connected"}</div><Form method="get"><button className="header-icon-button" type="submit" title="Refresh"><Icon type="refresh" /></button></Form><div className="store-selector"><div className="store-selector-left"><Icon type="store" /><span>My Shopify Store</span></div><Icon type="chevron-down" /></div></div></div>
    <div className="inventory-stats"><StatCard label="Total Products" value={formatNumber(data.totalProducts)} caption="All products" icon="product" className="blue" /><StatCard label="Total Inventory" value={formatNumber(data.stats.totalInventory)} caption="Across loaded locations" icon="inventory" className="green" /><StatCard label="Low Stock" value={formatNumber(data.stats.lowStock)} caption="Below threshold" icon="alert-triangle" className="orange" /><StatCard label="Out of Stock" value={formatNumber(data.stats.outOfStock)} caption="Out of stock" icon="x-circle" className="red" /><StatCard label="Inventory Value" value={formatCurrency(data.stats.inventoryValue)} caption="Estimated value" icon="money" className="purple" /></div>
    {!isLive && <div className="inventory-banner"><s-banner heading={!data.connected ? "Connect Zoho to enable inventory synchronization" : !data.inventoryAccountId ? "Inventory account setup is required" : "Warehouse mapping required"} tone="warning">Configure the Zoho connection, inventory account and warehouse mapping from Settings.</s-banner></div>}
    {showPullLog && data.latestPullLog && <div className="inventory-banner"><s-banner heading="Inventory sync completed" tone={data.latestPullLog.records_failed > 0 ? "warning" : "success"}>{data.latestPullLog.records_processed} processed, {data.latestPullLog.records_success} updated, {data.latestPullLog.records_failed} failed.</s-banner></div>}
    <div className="inventory-table-card"><div className="inventory-toolbar"><label className="inventory-search"><Icon type="search" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by product name, SKU or handle..." /></label><select className="inventory-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}><option value="all">All Locations</option>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select><select className="inventory-select" value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}><option value="all">All Warehouses</option>{warehouseOptions.map((warehouse) => <option key={warehouse} value={warehouse}>{warehouse}</option>)}</select><button className="inventory-filter-button" type="button" onClick={() => setStatusFilter(statusFilter === "all" ? "in" : "all")}><Icon type="filter" />Filters{statusFilter !== "all" ? " · 1" : ""}</button><Form method="post" className="inventory-export"><input type="hidden" name="intent" value="pull-from-zoho" /><button type="submit" disabled={!isLive || isPulling} style={{border:0,background:"transparent",display:"flex",alignItems:"center",gap:7,color:"inherit",font:"inherit"}}><Icon type="download" />{isPulling ? "Syncing" : "Export"}</button></Form></div>
      <div className="inventory-tabs"><button className={`inventory-tab ${activeTab === "product" ? "active" : ""}`} onClick={() => setActiveTab("product")} type="button">Inventory by Product</button><button className={`inventory-tab ${activeTab === "location" ? "active" : ""}`} onClick={() => setActiveTab("location")} type="button">Inventory by Location</button><button className={`inventory-tab ${activeTab === "warehouse" ? "active" : ""}`} onClick={() => setActiveTab("warehouse")} type="button">Inventory by Warehouse</button></div>
      {activeTab === "product" ? <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Product</th><th>SKU</th><th>Shopify Location</th><th>Zoho Warehouse</th><th>Available Qty</th><th>Incoming Qty</th><th>Committed Qty</th><th>Status</th><th>Last Updated</th><th></th></tr></thead><tbody>{filteredRows.map((row) => { const status = getStatus(row.available); return <tr key={row.id}><td><div className="inventory-product">{row.imageUrl ? <img className="inventory-product-image" src={row.imageUrl} alt="" /> : <div className="inventory-product-image" />}<div><div className="inventory-product-name">{row.title}</div></div></div></td><td>{row.sku}</td><td>{row.locationName}</td><td>{row.warehouseName}</td><td><span className={`inventory-qty ${status.className}`}>{formatNumber(row.available)}</span></td><td>{formatNumber(row.incoming)}</td><td>{formatNumber(row.committed)}</td><td><span className={`inventory-status ${status.className}`}>{status.label}</span></td><td>{formatDate(row.updatedAt)}</td><td>⋮</td></tr>; })}</tbody></table>{filteredRows.length === 0 && <div className="inventory-empty">No inventory items match your current filters.</div>}</div> : <div className="inventory-empty">{activeTab === "location" ? "Location-level inventory view is ready for the next data layer." : "Warehouse-level inventory view is ready for the next data layer."}</div>}
      <div className="inventory-footer"><div>Showing {from} to {to} of {formatNumber(data.totalProducts)} products{lastUpdated && <div className="inventory-pull-note">Last Zoho sync: {formatRelative(lastUpdated)}</div>}</div><div className="inventory-pagination"><a className={`inventory-page-button ${!hasPreviousPage ? "disabled" : ""}`} href={previousUrl}>‹</a><a className="inventory-page-button active" href={page === 1 ? "" : pageUrl(page, { after: page > 1 ? null : null })}>{page}</a>{hasNextPage && <a className="inventory-page-button" href={nextUrl}>{page + 1}</a>}{page < totalPages - 1 && <span>…</span>}{totalPages > 1 && <span className="inventory-page-button disabled">{totalPages}</span>}<a className={`inventory-page-button ${!hasNextPage ? "disabled" : ""}`} href={nextUrl}>›</a></div></div>
    </div>
  </div></s-page>;
}
