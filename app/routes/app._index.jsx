import { boundary } from "@shopify/shopify-app-react-router/server";
import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { getConnectionForShopDomain, getValidAccessToken } from "../models/zohoConnection.server";
import { getAuthorizationUrl } from "../zoho.server";
import { getSyncedProductCount, runProductSync } from "../models/productSync.server";
import { getSyncedCustomerCount, runCustomerSync } from "../models/customerSync.server";
import { getSyncedOrderCount, runOrderSync } from "../models/orderSync.server";
import { getSyncedWebhookCount } from "../models/webhookLog.server";
import { runInventoryPull } from "../models/inventorySync.server";
import { getLatestSyncLog } from "../models/syncLog.server";
import OtherApps from "../components/Common/OtherApps";
import { useZohoConnectionSync } from "../hooks/useZohoConnectionSync";

const syncStats = [
  { key: "products", iconType: "product", iconTone: "info", adminPath: "products" },
  { key: "customers", iconType: "person", iconTone: "neutral", adminPath: "customers" },
  { key: "orders", iconType: "order", iconTone: "caution", adminPath: "orders" },
  { key: "inventory", iconType: "inventory", iconTone: "success", adminPath: "products/inventory" },
];

const labels = { products: "Products", customers: "Customers", orders: "Orders", inventory: "Inventory" };

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { shop, connection } = await getConnectionForShopDomain(session.shop);
  const [productCount, customerCount, orderCount, inventoryCount, productLog, customerLog, orderLog, inventoryLog] = connection
    ? await Promise.all([
        getSyncedProductCount(shop.id), getSyncedCustomerCount(shop.id), getSyncedOrderCount(shop.id),
        getSyncedWebhookCount(shop.id, "INVENTORY_LEVELS_UPDATE"), getLatestSyncLog(shop.id, "product"),
        getLatestSyncLog(shop.id, "customer"), getLatestSyncLog(shop.id, "order"), getLatestSyncLog(shop.id, "inventory"),
      ])
    : [0, 0, 0, 0, null, null, null, null];

  return {
    shopDomain: session.shop,
    zohoConnected: Boolean(connection),
    zohoOrganizationName: connection?.organization_name || null,
    zohoAuthUrl: connection ? null : getAuthorizationUrl(session.shop),
    syncCounts: { products: productCount, customers: customerCount, orders: orderCount, inventory: inventoryCount },
    recentLogs: { products: productLog, customers: customerLog, orders: orderLog, inventory: inventoryLog },
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") !== "sync-all") return null;
  const { shop, connection } = await getConnectionForShopDomain(session.shop);
  if (!connection) return null;
  const token = await getValidAccessToken(shop.id).catch((error) => {
    console.error("Failed to get a valid Zoho access token for sync-all", error);
    return null;
  });
  if (!token) return null;
  const zohoAuth = { accessToken: token.accessToken, apiDomain: token.apiDomain, organizationId: connection.organization_id };
  await runProductSync({ admin, shop, zohoAuth });
  await runCustomerSync({ admin, shop, zohoAuth });
  await runOrderSync({ admin, shop, zohoAuth });
  await runInventoryPull({ admin, shop, zohoAuth });
  return null;
};

function openZohoAuthWindow(zohoAuthUrl) {
  window.open(zohoAuthUrl, "zoho-connect", "width=600,height=720");
}
function formatCount(value) { return new Intl.NumberFormat().format(value || 0); }
function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
function getSuccessRate(log) {
  if (!log?.records_processed) return null;
  return Math.round(((log.records_success || 0) / log.records_processed) * 100);
}
function getRelativeTime(value) {
  if (!value) return "No sync yet";
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export default function Index() {
  const { shopDomain, zohoConnected, zohoOrganizationName, zohoAuthUrl, syncCounts, recentLogs } = useLoaderData();
  useZohoConnectionSync();
  const navigation = useNavigation();
  const isSyncingAll = navigation.state === "submitting" && navigation.formData?.get("intent") === "sync-all";
  const logs = syncStats.map((stat) => ({ ...stat, log: recentLogs[stat.key], count: syncCounts[stat.key] || 0 }));
  const lastSync = logs.filter((item) => item.log).sort((a, b) => new Date(b.log.completed_at || b.log.started_at) - new Date(a.log.completed_at || a.log.started_at))[0]?.log;
  const hasActivity = logs.some((item) => item.log);

  return (
    <s-page heading="Dashboard">
      <style>{`
        .dashboard { display:flex; flex-direction:column; gap:16px; padding:2px 0 24px; }
        .dashboard-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
        .dashboard-title { font-size:28px; line-height:34px; font-weight:700; margin:0; letter-spacing:-.02em; }
        .dashboard-subtitle { margin:5px 0 0; color:#6b7280; font-size:14px; }
        .dashboard-actions { display:flex; gap:8px; flex-shrink:0; }
        .kpi-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
        .kpi-card,.panel,.connection-card { background:#fff; border:1px solid #e1e3e5; border-radius:12px; box-shadow:0 1px 2px rgba(0,0,0,.025); }
        .kpi-card { padding:16px; min-height:136px; display:flex; flex-direction:column; justify-content:space-between; }
        .kpi-top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .kpi-label { font-size:13px; font-weight:600; color:#4b5563; }
        .kpi-icon { width:38px; height:38px; border-radius:10px; display:grid; place-items:center; background:#f1f5f9; }
        .kpi-number { font-size:29px; line-height:34px; font-weight:700; margin-top:7px; color:#111827; }
        .kpi-meta { display:flex; align-items:center; gap:7px; color:#6b7280; font-size:11px; }
        .success-text { color:#16a34a; font-weight:600; }
        .connection-card { padding:15px 16px; display:grid; grid-template-columns:1fr 190px 1fr; align-items:center; gap:16px; }
        .connection-side { display:flex; align-items:center; gap:11px; min-width:0; }
        .connection-logo { width:40px; height:40px; border-radius:10px; display:grid; place-items:center; background:#f8fafc; border:1px solid #e5e7eb; flex:0 0 auto; }
        .connection-name { font-weight:700; font-size:14px; }
        .connection-caption { color:#6b7280; font-size:11px; margin-top:2px; }
        .connection-center { text-align:center; min-width:0; }
        .connected-pill { display:inline-flex; align-items:center; gap:6px; background:#ecfdf3; color:#15803d; border-radius:999px; padding:5px 10px; font-size:11px; font-weight:700; }
        .connected-dot { width:6px; height:6px; border-radius:50%; background:#22c55e; }
        .connection-line { border-top:2px dashed #d1d5db; margin:8px 0 0; }
        .connection-right { text-align:right; }
        .connection-right strong { display:block; font-size:14px; }
        .connection-right span { color:#6b7280; font-size:11px; }
        .two-column { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }
        .panel { overflow:hidden; }
        .panel-header { padding:15px 16px 9px; }
        .panel-title { margin:0; font-size:15px; font-weight:700; color:#111827; }
        .panel-subtitle { margin:3px 0 0; color:#6b7280; font-size:11px; }
        .sync-row { display:grid; grid-template-columns:105px minmax(80px,1fr) 42px 72px; align-items:center; gap:10px; padding:9px 16px; }
        .sync-label { display:flex; align-items:center; gap:7px; font-size:12px; font-weight:600; }
        .sync-dot { width:7px; height:7px; border-radius:50%; background:#22c55e; }
        .progress-track { height:6px; background:#eef2f7; border-radius:999px; overflow:hidden; }
        .progress-fill { height:100%; background:#4f46e5; border-radius:999px; }
        .progress-value { font-size:11px; font-weight:700; text-align:right; }
        .progress-count { font-size:10px; color:#6b7280; text-align:right; }
        .activity-list { display:flex; flex-direction:column; }
        .activity-row { display:grid; grid-template-columns:22px minmax(0,1fr) auto auto; gap:9px; align-items:center; padding:9px 16px; border-top:1px solid #f0f1f3; }
        .activity-icon { width:22px; height:22px; border-radius:50%; display:grid; place-items:center; background:#ecfdf3; color:#16a34a; font-size:11px; font-weight:700; }
        .activity-title { font-size:12px; font-weight:600; color:#111827; }
        .activity-meta { font-size:10px; color:#6b7280; margin-top:2px; }
        .status-pill { padding:4px 8px; border-radius:999px; background:#ecfdf3; color:#15803d; font-size:10px; font-weight:700; white-space:nowrap; }
        .status-partial { background:#fff7ed; color:#c2410c; }
        .activity-time { font-size:10px; color:#6b7280; white-space:nowrap; }
        .history-table { width:100%; border-collapse:collapse; }
        .history-table th { text-align:left; padding:9px 16px; background:#f8fafc; color:#6b7280; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
        .history-table td { padding:10px 16px; border-top:1px solid #f0f1f3; font-size:11px; color:#374151; }
        .history-type { display:flex; align-items:center; gap:7px; font-weight:600; color:#111827; }
        .history-footer { padding:11px 16px; border-top:1px solid #f0f1f3; text-align:center; }
        .history-footer a { color:#4338ca; font-size:11px; font-weight:600; text-decoration:none; }
        .empty-state { padding:24px 16px; color:#6b7280; font-size:12px; text-align:center; }
        .last-sync { color:#6b7280; font-size:11px; }
        @media (max-width: 900px) { .kpi-grid,.two-column { grid-template-columns:1fr 1fr; } .connection-card { grid-template-columns:1fr; text-align:left; } .connection-center,.connection-right { text-align:left; } }
        @media (max-width: 620px) { .kpi-grid,.two-column { grid-template-columns:1fr; } .dashboard-header { flex-direction:column; } .sync-row { grid-template-columns:100px 1fr 42px; } .progress-count { display:none; } .activity-row { grid-template-columns:22px 1fr auto; } .activity-time { display:none; } }
      `}</style>

      <div className="dashboard">
        <div className="dashboard-header">
          <div>
            <h1 className="dashboard-title">Dashboard</h1>
            <p className="dashboard-subtitle">Overview of your Shopify &amp; Zoho Books synchronization</p>
          </div>
          <div className="dashboard-actions">
            <s-button icon="refresh" onClick={() => window.location.reload()}>Refresh</s-button>
            <Form method="post"><input type="hidden" name="intent" value="sync-all" /><s-button variant="primary" icon="refresh" type="submit" loading={isSyncingAll} disabled={!zohoConnected}>Sync Now</s-button></Form>
          </div>
        </div>

        <div className="kpi-grid">
          {logs.map((item) => <div className="kpi-card" key={item.key}>
            <div className="kpi-top"><span className="kpi-label">{labels[item.key]}{item.key === "inventory" ? " Items" : ""}</span><span className="kpi-icon"><s-icon type={item.iconType} tone={item.iconTone}></s-icon></span></div>
            <div className="kpi-number">{formatCount(item.count)}</div>
            <div className="kpi-meta">{item.log ? <span className="success-text">Synced</span> : <span>Not synced yet</span>}<span>•</span><span>{getRelativeTime(item.log?.completed_at || item.log?.started_at)}</span></div>
          </div>)}
        </div>

        <div className="connection-card">
          <div className="connection-side"><div className="connection-logo"><s-icon type="store" tone="success"></s-icon></div><div><div className="connection-name">Shopify</div><div className="connection-caption">Store connected and ready to sync</div></div></div>
          <div className="connection-center"><span className="connected-pill"><span className="connected-dot"></span>{zohoConnected ? "Connected" : "Zoho not connected"}</span><div className="connection-line"></div></div>
          <div className="connection-side" style={{ justifyContent: "flex-end" }}><div className="connection-right"><strong>{zohoConnected ? "Zoho Books" : "Connect Zoho Books"}</strong><span>{zohoConnected ? (zohoOrganizationName || "Organization connected") : "Authorize your Zoho organization to enable sync"}</span>{!zohoConnected && <div style={{ marginTop: 7 }}><s-button variant="primary" onClick={() => openZohoAuthWindow(zohoAuthUrl)}>Connect</s-button></div>}</div><div className="connection-logo"><s-icon type="link" tone={zohoConnected ? "success" : "caution"}></s-icon></div></div>
        </div>

        <div className="two-column">
          <div className="panel"><div className="panel-header"><h2 className="panel-title">Sync Overview</h2><p className="panel-subtitle">Latest synchronization success by data type</p></div>
            {logs.map((item) => { const rate = getSuccessRate(item.log) ?? (item.count > 0 ? 100 : 0); return <div className="sync-row" key={item.key}><div className="sync-label"><span className="sync-dot"></span>{labels[item.key]}</div><div className="progress-track"><div className="progress-fill" style={{ width: `${rate}%` }}></div></div><div className="progress-value">{rate}%</div><div className="progress-count">{formatCount(item.count)} synced</div></div>; })}
            <div className="history-footer"><a href="/app/sync-history">View detailed sync history →</a></div>
          </div>

          <div className="panel"><div className="panel-header"><h2 className="panel-title">Recent Activity</h2><p className="panel-subtitle">Latest synchronization activities</p></div>
            <div className="activity-list">{hasActivity ? logs.filter((item) => item.log).map((item) => { const failed = Number(item.log.records_failed || 0) > 0; return <div className="activity-row" key={item.key}><span className="activity-icon">{failed ? "!" : "✓"}</span><div><div className="activity-title">{labels[item.key]} sync {failed ? "partially completed" : "completed"}</div><div className="activity-meta">{formatCount(item.log.records_processed)} records processed · {formatCount(item.log.records_success)} succeeded</div></div><span className={`status-pill ${failed ? "status-partial" : ""}`}>{failed ? "Partial" : "Success"}</span><span className="activity-time">{formatDate(item.log.completed_at || item.log.started_at)}</span></div>; }) : <div className="empty-state">No synchronization activity yet.</div>}</div>
            <div className="history-footer"><a href="/app/sync-history">View all activities →</a></div>
          </div>
        </div>

        <div className="panel"><div className="panel-header"><h2 className="panel-title">Recent Sync History</h2><p className="panel-subtitle">Summary of recent synchronization operations</p></div>
          {hasActivity ? <table className="history-table"><thead><tr><th>Type</th><th>Records</th><th>Status</th><th>Date &amp; Time</th><th>Duration</th></tr></thead><tbody>{logs.filter((item) => item.log).map((item) => { const failed = Number(item.log.records_failed || 0) > 0; const started = item.log.started_at ? new Date(item.log.started_at) : null; const completed = item.log.completed_at ? new Date(item.log.completed_at) : null; const duration = started && completed ? Math.max(0, Math.round((completed - started) / 1000)) : null; return <tr key={item.key}><td><span className="history-type"><s-icon type={item.iconType} tone={item.iconTone}></s-icon>{labels[item.key]}</span></td><td>{formatCount(item.log.records_processed)}</td><td><span className={`status-pill ${failed ? "status-partial" : ""}`}>{failed ? "Partial" : "Success"}</span></td><td>{formatDate(item.log.completed_at || item.log.started_at)}</td><td>{duration == null ? "—" : `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")`}</td></tr>; })}</tbody></table> : <div className="empty-state">Your recent sync operations will appear here.</div>}
          <div className="history-footer"><a href="/app/sync-history">View full sync history →</a></div>
        </div>

        <OtherApps />

        {lastSync && <div className="last-sync">Last synchronization: {formatDate(lastSync.completed_at || lastSync.started_at)}</div>}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
