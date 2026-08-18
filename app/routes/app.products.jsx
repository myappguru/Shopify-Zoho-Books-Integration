import { Fragment, useMemo, useState } from "react";
import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { useAutoDismiss } from "../hooks/useAutoDismiss";
import { getConnectionForShopDomain, getValidAccessToken } from "../models/zohoConnection.server";
import { getAppSettings } from "../models/appSettings.server";
import { getProductMappings, PRODUCTS_QUERY, PRODUCT_BY_ID_QUERY, normalizeProductNode, runProductSync, syncProductToZoho } from "../models/productSync.server";
import { getLatestSyncLog } from "../models/syncLog.server";

const PAGE_SIZE = 20;
function shopifyNumericId(gid) { return gid ? gid.split("/").pop() : null; }

async function fetchProductsPage(admin, { after, before } = {}) {
  const variables = before ? { last: PAGE_SIZE, before } : { first: PAGE_SIZE, after: after || null };
  const response = await admin.graphql(PRODUCTS_QUERY, { variables });
  const json = await response.json();
  return {
    products: (json.data?.products?.edges || []).map(({ node }) => normalizeProductNode(node)),
    pageInfo: json.data?.products?.pageInfo || { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
  };
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, connection } = await getConnectionForShopDomain(session.shop);
  const url = new URL(request.url);
  const { products, pageInfo } = await fetchProductsPage(admin, { after: url.searchParams.get("after") || undefined, before: url.searchParams.get("before") || undefined });
  const mappings = connection ? await getProductMappings(shop.id) : {};
  const latestLog = connection ? await getLatestSyncLog(shop.id, "product") : null;
  return { connected: Boolean(connection), products, pageInfo, mappings, latestLog };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (!["sync-now", "sync-product"].includes(intent)) return null;

  const { shop, connection } = await getConnectionForShopDomain(session.shop);
  if (!connection) return null;
  const token = await getValidAccessToken(shop.id).catch((error) => {
    console.error("Failed to get a valid Zoho access token for product sync", error);
    return null;
  });
  if (!token) return null;
  const zohoAuth = { accessToken: token.accessToken, apiDomain: token.apiDomain, organizationId: connection.organization_id };

  if (intent === "sync-now") {
    await runProductSync({ admin, shop, zohoAuth });
    return null;
  }

  const productId = formData.get("productId");
  if (!productId) return null;
  const response = await admin.graphql(PRODUCT_BY_ID_QUERY, { variables: { id: productId } });
  const json = await response.json();
  const product = json.data?.product ? normalizeProductNode(json.data.product) : null;
  if (!product) return null;

  const mappings = await getProductMappings(shop.id);
  const appSettings = await getAppSettings(shop.id);
  await syncProductToZoho({
    shopId: shop.id,
    admin,
    zohoAuth,
    product,
    mappings,
    inventoryAccountId: appSettings.accountSettings?.inventoryAccountId,
  });
  return null;
};

function formatCount(value) { return new Intl.NumberFormat().format(value || 0); }
function formatPrice(value) { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value || 0)); }
function formatDate(value) { return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"; }
function getVariantSummary(product) {
  const variants = product.variants || [];
  return { quantity: variants.reduce((total, variant) => total + Number(variant.inventoryQuantity || 0), 0), variants };
}

export default function ProductsPage() {
  const { connected, products, pageInfo, mappings, latestLog } = useLoaderData();
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [inventoryFilter, setInventoryFilter] = useState("all");
  const [productStatusFilter, setProductStatusFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const showLog = useAutoDismiss(latestLog?.id);
  const formIntent = navigation.formData?.get("intent");
  const syncingProductId = formIntent === "sync-product" ? navigation.formData?.get("productId") : null;
  const isSyncing = navigation.state === "submitting" && formIntent === "sync-now";

  const options = useMemo(() => ({
    vendors: [...new Set(products.map((p) => p.vendor).filter(Boolean))].sort(),
    types: [...new Set(products.map((p) => p.productType).filter(Boolean))].sort(),
  }), [products]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const variants = product.variants || [];
      const states = variants.map((variant) => mappings[variant.id]);
      const hasError = states.some((mapping) => mapping?.status === "error");
      const hasSynced = states.some((mapping) => mapping?.status === "synced");
      const hasUnsynced = variants.some((variant) => !mappings[variant.id]);
      const quantity = variants.reduce((total, variant) => total + Number(variant.inventoryQuantity || 0), 0);
      const matchesSearch = !query || [product.title, product.handle, product.vendor, product.productType, ...variants.map((v) => `${v.sku || ""} ${v.title || ""}`)].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesSync = statusFilter === "all" || (statusFilter === "synced" && hasSynced && !hasError) || (statusFilter === "unsynced" && hasUnsynced) || (statusFilter === "error" && hasError);
      const matchesInventory = inventoryFilter === "all" || (inventoryFilter === "in-stock" && quantity > 0) || (inventoryFilter === "out-of-stock" && quantity <= 0);
      return matchesSearch && matchesSync && matchesInventory && (productStatusFilter === "all" || product.status === productStatusFilter) && (vendorFilter === "all" || product.vendor === vendorFilter) && (typeFilter === "all" || product.productType === typeFilter);
    });
  }, [products, mappings, search, statusFilter, inventoryFilter, productStatusFilter, vendorFilter, typeFilter]);

  const stats = useMemo(() => {
    let synced = 0, unsynced = 0, errors = 0;
    products.forEach((product) => (product.variants || []).forEach((variant) => {
      const mapping = mappings[variant.id];
      if (mapping?.status === "error") errors += 1;
      else if (mapping?.status === "synced") synced += 1;
      else unsynced += 1;
    }));
    return { products: products.length, synced, unsynced, errors };
  }, [products, mappings]);

  const clearFilters = () => { setSearch(""); setStatusFilter("all"); setInventoryFilter("all"); setProductStatusFilter("all"); setVendorFilter("all"); setTypeFilter("all"); };

  return (
    <s-page heading="Products" inlineSize="large">
      <style>{`
        .products-page{width:80%;margin:0 auto;padding:0 0 24px;box-sizing:border-box;color:#202223;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}.products-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}.products-title{margin:0;font-size:20px;line-height:26px;font-weight:650;letter-spacing:-.01em}.products-subtitle{margin:3px 0 0;color:#616161;font-size:15px;line-height:21px}.products-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}.products-card{background:#fff;border:1px solid #dfe3e8;border-radius:10px;box-shadow:0 1px 1px rgba(0,0,0,.03);overflow:hidden}.stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:12px}.stat-card{padding:14px 16px;min-height:108px;display:flex;flex-direction:column;justify-content:space-between}.stat-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.stat-label{font-size:12px;line-height:16px;font-weight:600;color:#303030}.stat-icon{width:38px;height:38px;border-radius:9px;display:grid;place-items:center;background:#eef6ff}.stat-icon s-icon{width:20px;height:20px}.stat-card:nth-child(2) .stat-icon{background:#e8f7ed}.stat-card:nth-child(3) .stat-icon{background:#fff5e5}.stat-card:nth-child(4) .stat-icon{background:#f3ebff}.stat-number{font-size:26px;line-height:30px;font-weight:650;margin-top:4px;letter-spacing:-.02em}.stat-caption{color:#6d7175;font-size:13px;line-height:18px}.sync-banner{margin-bottom:12px}.toolbar{padding:12px 14px;display:grid;grid-template-columns:minmax(260px,1.6fr) repeat(3,minmax(130px,.65fr));gap:10px;align-items:center}.search-box{height:40px;border:1px solid #c9cdd1;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 12px;background:#fff;box-sizing:border-box}.search-box:focus-within{border-color:#005bd3;box-shadow:0 0 0 1px #005bd3}.search-box s-icon{width:17px;height:17px;flex:0 0 17px}.search-box input{border:0;outline:0;width:100%;font:inherit;color:#202223;font-size:13px;background:transparent}.filter-select{height:40px;border:1px solid #c9cdd1;border-radius:8px;padding:0 10px;background:#fff;color:#303030;font:inherit;font-size:13px;width:100%}.table-wrap{overflow-x:auto}.product-table{width:100%;min-width:850px;border-collapse:collapse;table-layout:fixed}.product-table th{text-align:left;background:#f6f7f8;color:#6d7175;padding:10px 14px;font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:.035em;font-weight:650;border-bottom:1px solid #e5e7e9}.product-table td{padding:11px 14px;border-bottom:1px solid #edf0f2;font-size:13px;line-height:18px;color:#303030;vertical-align:middle}.product-table tr:last-child td{border-bottom:0}.product-cell{display:flex;align-items:center;gap:10px;min-width:0}.product-image{width:42px;height:42px;border-radius:7px;border:1px solid #e1e4e6;object-fit:cover;background:#f6f6f7;flex:0 0 42px}.product-image-placeholder{display:grid;place-items:center;color:#8c9196}.product-info{min-width:0}.product-name{display:block;color:#202223;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none}.product-name:hover{text-decoration:underline}.product-sub{color:#6d7175;font-size:11px;line-height:16px;margin-top:1px}.sku{font-size:12px;color:#303030}.muted{color:#6d7175}.inventory-number{display:block;font-weight:600}.inventory-label{display:block;font-size:11px;line-height:16px;margin-top:1px}.inventory-good{color:#008060}.inventory-empty{color:#d72c0d}.status-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:6px;font-size:11px;line-height:15px;font-weight:650;white-space:nowrap}.status-synced{background:#e3f7ed;color:#008060}.status-unsynced{background:#fff5e5;color:#b98900}.status-error{background:#fdecea;color:#d72c0d}.status-badge s-icon{width:13px;height:13px}.action-button{width:32px;height:32px;border:1px solid #dfe3e8;border-radius:7px;background:#fff;cursor:pointer;display:grid;place-items:center;color:#303030}.action-button:hover{background:#f6f7f8}.empty-products{padding:44px 20px;text-align:center;color:#6d7175;font-size:13px}.table-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;border-top:1px solid #e5e7e9;color:#6d7175;font-size:13px;line-height:18px}.pagination{display:flex;align-items:center;gap:6px}.page-button{min-width:34px;height:34px;padding:0 9px;border:1px solid #dfe3e8;border-radius:7px;background:#fff;color:#303030;cursor:pointer;font-size:13px}.page-button.active{background:#202223;color:#fff;border-color:#202223}.page-button:disabled{opacity:.45;cursor:not-allowed}.sync-note{margin-top:12px;color:#6d7175;font-size:13px;line-height:18px}.filter-popover{padding:14px;width:290px}.filter-heading{font-size:13px;font-weight:650;margin:0 0 10px}.filter-group{margin-bottom:10px}.filter-group label{display:block;font-size:11px;color:#6d7175;margin-bottom:4px}@media(max-width:900px){.products-page{width:100%}.stats-grid{grid-template-columns:1fr 1fr}.toolbar{grid-template-columns:1fr 1fr}.products-header{flex-direction:column}}@media(max-width:620px){.stats-grid{grid-template-columns:1fr}.toolbar{grid-template-columns:1fr}.table-footer{flex-direction:column;align-items:flex-start}}
      `}</style>

      <div className="products-page">
        <div className="products-header"><div><h1 className="products-title">Products</h1><p className="products-subtitle">Manage and sync your Shopify products with Zoho Books</p></div><div className="products-actions"><Form method="get" onSubmit={() => setIsRefreshing(true)}><s-button type="submit" icon="refresh" loading={isRefreshing}>Refresh</s-button></Form><Form method="post"><input type="hidden" name="intent" value="sync-now"/><s-button variant="primary" type="submit" icon="refresh" loading={isSyncing} disabled={!connected || isRefreshing}>Sync Products</s-button></Form></div></div>

        {!connected && <div className="sync-banner"><s-banner tone="warning" heading="Zoho Books is not connected">Connect your Zoho Books organization from the <s-link href="/app/settings">Settings</s-link> page before syncing products.</s-banner></div>}
        {latestLog && showLog && <div className="sync-banner"><s-banner heading="Last product sync" tone={latestLog.records_failed > 0 ? "warning" : "success"}>{formatDate(latestLog.completed_at || latestLog.started_at)} — {formatCount(latestLog.records_processed)} processed, {formatCount(latestLog.records_success)} succeeded, {formatCount(latestLog.records_failed)} failed.</s-banner></div>}

        <div className="stats-grid">
          <div className="products-card stat-card"><div className="stat-top"><span className="stat-label">Products on page</span><span className="stat-icon"><s-icon type="product" tone="info"/></span></div><div className="stat-number">{formatCount(stats.products)}</div><div className="stat-caption">Currently loaded from Shopify</div></div>
          <div className="products-card stat-card"><div className="stat-top"><span className="stat-label">Synced to Zoho</span><span className="stat-icon"><s-icon type="check-circle" tone="success"/></span></div><div className="stat-number">{formatCount(stats.synced)}</div><div className="stat-caption">Variants successfully synced</div></div>
          <div className="products-card stat-card"><div className="stat-top"><span className="stat-label">Not Synced</span><span className="stat-icon"><s-icon type="clock" tone="caution"/></span></div><div className="stat-number">{formatCount(stats.unsynced)}</div><div className="stat-caption">Pending synchronization</div></div>
          <div className="products-card stat-card"><div className="stat-top"><span className="stat-label">Sync Errors</span><span className="stat-icon"><s-icon type="alert-circle" tone="critical"/></span></div><div className="stat-number">{formatCount(stats.errors)}</div><div className="stat-caption">Failed product variants</div></div>
        </div>

        <div className="products-card" style={{marginBottom:"12px"}}><div className="toolbar">
          <label className="search-box"><s-icon type="search"/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search products by title, SKU, or handle" aria-label="Search products"/></label>
          <select className="filter-select" value={statusFilter} onChange={(event)=>setStatusFilter(event.target.value)}><option value="all">Sync Status · All</option><option value="synced">Sync Status · Synced</option><option value="unsynced">Sync Status · Not Synced</option><option value="error">Sync Status · Errors</option></select>
          <select className="filter-select" value={inventoryFilter} onChange={(event)=>setInventoryFilter(event.target.value)}><option value="all">Inventory · All</option><option value="in-stock">Inventory · In stock</option><option value="out-of-stock">Inventory · Out of stock</option></select>
          <s-button icon="filter" commandFor="product-filters">More filters</s-button>
          <s-popover id="product-filters"><div className="filter-popover"><div className="filter-heading">More filters</div><div className="filter-group"><label>Product status</label><select className="filter-select" value={productStatusFilter} onChange={(event)=>setProductStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="ACTIVE">Active</option><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option></select></div><div className="filter-group"><label>Vendor</label><select className="filter-select" value={vendorFilter} onChange={(event)=>setVendorFilter(event.target.value)}><option value="all">All vendors</option>{options.vendors.map((vendor)=><option key={vendor} value={vendor}>{vendor}</option>)}</select></div><div className="filter-group"><label>Product type</label><select className="filter-select" value={typeFilter} onChange={(event)=>setTypeFilter(event.target.value)}><option value="all">All product types</option>{options.types.map((type)=><option key={type} value={type}>{type}</option>)}</select></div><s-button variant="secondary" onClick={clearFilters}>Clear filters</s-button></div></s-popover>
        </div></div>

        <div className="products-card">
          {visibleProducts.length === 0 ? <div className="empty-products">{products.length === 0 ? "No products found in this store." : "No products match your current search or filters."}</div> : <div className="table-wrap"><table className="product-table"><thead><tr><th style={{width:"31%"}}>Product</th><th style={{width:"15%"}}>SKU</th><th style={{width:"11%"}}>Price</th><th style={{width:"13%"}}>Inventory</th><th style={{width:"13%"}}>Sync Status</th><th style={{width:"12%"}}>Last Synced</th><th style={{width:"5%"}}>Action</th></tr></thead><tbody>
            {visibleProducts.map((product) => {
              const { quantity, variants } = getVariantSummary(product);
              const productMappings = variants.map((variant)=>mappings[variant.id]).filter(Boolean);
              const hasError = productMappings.some((mapping)=>mapping.status === "error");
              const allSynced = variants.length > 0 && variants.every((variant)=>mappings[variant.id]?.status === "synced");
              const status = hasError ? "error" : allSynced ? "synced" : "unsynced";
              const lastSynced = productMappings.map((mapping)=>mapping.lastSyncedAt).filter(Boolean).sort().pop();
              const primaryVariant = variants[0];
              const statusLabel = status === "error" ? "Sync error" : status === "synced" ? "Synced" : "Not synced";
              const menuId = `product-actions-${shopifyNumericId(product.id)}`;
              return <Fragment key={product.id}><tr>
                <td><div className="product-cell">{product.imageUrl ? <img className="product-image" src={product.imageUrl} alt=""/> : <div className="product-image product-image-placeholder"><s-icon type="image"/></div>}<div className="product-info"><a className="product-name" href={`shopify://admin/products/${shopifyNumericId(product.id)}`} target="_top">{product.title}</a><div className="product-sub">{variants.length} {variants.length===1?"variant":"variants"} · {product.status}</div></div></div></td>
                <td><span className="sku">{primaryVariant?.sku || <span className="muted">No SKU</span>}</span></td><td>{primaryVariant ? formatPrice(primaryVariant.price) : "—"}</td><td><span className="inventory-number">{formatCount(quantity)}</span><span className={`inventory-label ${quantity>0?"inventory-good":"inventory-empty"}`}>{quantity>0?"In stock":"Out of stock"}</span></td><td><span className={`status-badge status-${status}`}><s-icon type={status === "synced" ? "check-circle" : status === "error" ? "alert-circle" : "clock"}/>{statusLabel}</span></td><td className="muted">{formatDate(lastSynced)}</td>
                <td><s-button className="action-button" variant="tertiary" icon="menu-horizontal" commandFor={menuId} accessibilityLabel={`Actions for ${product.title}`}/><s-menu id={menuId} accessibilityLabel={`Actions for ${product.title}`}><s-button href={`shopify://admin/products/${shopifyNumericId(product.id)}`} target="_top">View in Shopify</s-button>{connected && <Form method="post"><input type="hidden" name="intent" value="sync-product"/><input type="hidden" name="productId" value={product.id}/><s-button type="submit" loading={syncingProductId === product.id}>Sync this product</s-button></Form>}</s-menu></td>
              </tr></Fragment>;
            })}
          </tbody></table></div>}
          <div className="table-footer"><span>Showing {visibleProducts.length} of {products.length} products on this page</span>{(pageInfo.hasPreviousPage || pageInfo.hasNextPage) && <div className="pagination"><s-button variant="secondary" disabled={!pageInfo.hasPreviousPage || isRefreshing} href={pageInfo.hasPreviousPage ? `?before=${encodeURIComponent(pageInfo.startCursor)}` : undefined}>‹</s-button><span className="page-button active">Current</span><s-button variant="secondary" disabled={!pageInfo.hasNextPage || isRefreshing} href={pageInfo.hasNextPage ? `?after=${encodeURIComponent(pageInfo.endCursor)}` : undefined}>›</s-button></div>}</div>
        </div>
        {latestLog && <div className="sync-note">Last synchronization: {formatDate(latestLog.completed_at || latestLog.started_at)}</div>}
      </div>
    </s-page>
  );
}
