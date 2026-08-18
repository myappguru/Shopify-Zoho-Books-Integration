import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getConnectionForShopDomain,
  getValidAccessToken,
} from "../models/zohoConnection.server";
import { getAppSettings } from "../models/appSettings.server";
import { getWarehouseMappings } from "../models/warehouseMapping.server";
import { getRecentWebhookLogs } from "../models/webhookLog.server";
import { runInventoryPull } from "../models/inventorySync.server";
import { getLatestSyncLog } from "../models/syncLog.server";
import { useAutoDismiss } from "../hooks/useAutoDismiss";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { shop, connection } = await getConnectionForShopDomain(session.shop);

  const appSettings = connection ? await getAppSettings(shop.id) : {};
  const warehouseMappings = connection ? await getWarehouseMappings(shop.id) : {};
  const recentActivity = connection
    ? await getRecentWebhookLogs(shop.id, "INVENTORY_LEVELS_UPDATE", 10)
    : [];
  const latestPullLog = connection
    ? await getLatestSyncLog(shop.id, "inventory")
    : null;

  return {
    connected: Boolean(connection),
    inventoryAccountId: appSettings.accountSettings?.inventoryAccountId || null,
    warehouseMappingCount: Object.keys(warehouseMappings).length,
    recentActivity,
    latestPullLog,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("intent") !== "pull-from-zoho") return null;

  const { shop, connection } = await getConnectionForShopDomain(session.shop);
  if (!connection) return null;

  const token = await getValidAccessToken(shop.id).catch((error) => {
    console.error(
      "Failed to get a valid Zoho access token for inventory pull",
      error,
    );
    return null;
  });
  if (!token) return null;

  const zohoAuth = {
    accessToken: token.accessToken,
    apiDomain: token.apiDomain,
    organizationId: connection.organization_id,
  };

  await runInventoryPull({ admin, shop, zohoAuth });

  return null;
};

const ACTIVITY_STATUS = {
  synced: { tone: "success", icon: "check-circle" },
  skipped: { tone: "info", icon: "info" },
  failed: { tone: "critical", icon: "x-circle" },
};

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatRelative(value) {
  if (!value) return "No sync yet";
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function formatDuration(log) {
  if (!log?.started_at || !log?.completed_at) return "—";
  const seconds = Math.max(
    0,
    Math.round(
      (new Date(log.completed_at) - new Date(log.started_at)) / 1000,
    ),
  );
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}

// eslint-disable-next-line react/prop-types
function MetricCard({ icon, label, value, caption, tone = "blue" }) {
  return (
    <div className="inventory-metric">
      <div className={`inventory-metric-icon ${tone}`}>
        <s-icon type={icon}></s-icon>
      </div>
      <div className="inventory-metric-copy">
        <div className="inventory-metric-label">{label}</div>
        <div className="inventory-metric-value">{value}</div>
        <div className="inventory-metric-caption">{caption}</div>
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const {
    connected,
    inventoryAccountId,
    warehouseMappingCount,
    recentActivity,
    latestPullLog,
  } = useLoaderData();
  const navigation = useNavigation();
  const isPulling =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "pull-from-zoho";
  const showPullLog = useAutoDismiss(latestPullLog?.id);

  const isLive = connected && inventoryAccountId && warehouseMappingCount > 0;
  const activityCounts = recentActivity.reduce(
    (counts, entry) => {
      counts[entry.status] = (counts[entry.status] || 0) + 1;
      return counts;
    },
    {},
  );
  const latestActivityDate = recentActivity[0]?.received_at;
  const lastPullDate = latestPullLog?.completed_at || latestPullLog?.started_at;
  const processed = latestPullLog?.records_processed || 0;
  const successful = latestPullLog?.records_success || 0;
  const successRate = processed
    ? Math.round((successful / processed) * 100)
    : null;

  return (
    <s-page heading="Inventory" inlineSize="large">
      <style>{`
        .inventory-page { width:80%; max-width:none; margin:0 auto; display:flex; flex-direction:column; gap:12px; padding:0 0 20px; box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:#202223; }
        .inventory-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:2px 0; }
        .inventory-title { font-size:20px; line-height:26px; font-weight:650; margin:0; letter-spacing:-.01em; }
        .inventory-subtitle { margin:2px 0 0; color:#616161; font-size:15px; line-height:21px; }
        .inventory-actions { display:flex; align-items:center; gap:8px; }
        .inventory-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
        .inventory-metric,.inventory-panel,.inventory-status { background:#fff; border:1px solid #dfe3e8; border-radius:10px; box-shadow:0 1px 1px rgba(0,0,0,.03); }
        .inventory-metric { min-height:112px; padding:14px 16px; display:flex; align-items:flex-start; gap:12px; box-sizing:border-box; }
        .inventory-metric-icon { width:38px; height:38px; border-radius:9px; display:grid; place-items:center; flex:0 0 38px; }
        .inventory-metric-icon s-icon { width:20px; height:20px; }
        .inventory-metric-icon.blue { background:#eef6ff; }
        .inventory-metric-icon.green { background:#e8f8f6; }
        .inventory-metric-icon.purple { background:#f4ecff; }
        .inventory-metric-copy { min-width:0; }
        .inventory-metric-label { font-size:12px; line-height:16px; font-weight:600; color:#303030; }
        .inventory-metric-value { font-size:25px; line-height:30px; font-weight:650; margin-top:3px; letter-spacing:-.02em; }
        .inventory-metric-caption { color:#6d7175; font-size:11px; line-height:16px; margin-top:1px; }
        .inventory-status { padding:13px 16px; display:grid; grid-template-columns:38px minmax(0,1fr) auto; gap:12px; align-items:center; }
        .inventory-status-icon { width:38px; height:38px; border-radius:50%; display:grid; place-items:center; background:#e3f7ed; }
        .inventory-status-icon.warning { background:#fff1e6; }
        .inventory-status-icon.neutral { background:#f1f2f3; }
        .inventory-status-icon s-icon { width:19px; height:19px; }
        .inventory-status-title { font-size:13px; line-height:17px; font-weight:650; }
        .inventory-status-copy { color:#6d7175; font-size:12px; line-height:17px; margin-top:1px; }
        .inventory-status-action { white-space:nowrap; }
        .inventory-grid { display:grid; grid-template-columns:1.05fr .95fr; gap:12px; }
        .inventory-panel { overflow:hidden; min-width:0; }
        .inventory-panel-header { padding:13px 16px 9px; }
        .inventory-panel-title { margin:0; font-size:14px; line-height:19px; font-weight:650; }
        .inventory-panel-subtitle { margin:1px 0 0; color:#6d7175; font-size:13px; line-height:18px; }
        .direction-row { display:grid; grid-template-columns:30px minmax(0,1fr) auto; gap:10px; align-items:center; padding:11px 16px; border-top:1px solid #edf0f2; }
        .direction-icon { width:28px; height:28px; border-radius:7px; display:grid; place-items:center; background:#f1f2f3; }
        .direction-icon s-icon { width:15px; height:15px; }
        .direction-title { font-size:12px; line-height:16px; font-weight:650; }
        .direction-copy { color:#6d7175; font-size:11px; line-height:15px; margin-top:1px; }
        .inventory-pill { display:inline-flex; align-items:center; gap:5px; padding:4px 8px; border-radius:999px; font-size:10px; line-height:13px; font-weight:650; white-space:nowrap; }
        .inventory-pill.success { background:#e3f7ed; color:#008060; }
        .inventory-pill.warning { background:#fff1e6; color:#b98900; }
        .inventory-pill.neutral { background:#f1f2f3; color:#616161; }
        .pull-card { padding:14px 16px; display:flex; flex-direction:column; gap:12px; }
        .pull-copy { color:#6d7175; font-size:12px; line-height:18px; margin:0; }
        .pull-meta { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
        .pull-stat { background:#f6f7f8; border-radius:7px; padding:8px 10px; }
        .pull-stat-label { color:#6d7175; font-size:9px; line-height:13px; text-transform:uppercase; letter-spacing:.035em; font-weight:650; }
        .pull-stat-value { font-size:13px; line-height:17px; font-weight:650; margin-top:2px; }
        .pull-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .pull-last { color:#6d7175; font-size:10px; line-height:15px; }
        .inventory-alert { margin:0 16px 13px; }
        .activity-summary { display:flex; align-items:center; gap:6px; padding:0 16px 10px; }
        .activity-list { display:flex; flex-direction:column; }
        .activity-row { display:grid; grid-template-columns:22px minmax(0,1fr) auto auto; gap:8px; align-items:center; padding:9px 16px; border-top:1px solid #edf0f2; }
        .activity-icon { width:20px; height:20px; border-radius:50%; display:grid; place-items:center; background:#e3f7ed; }
        .activity-icon.skipped { background:#eef6ff; }
        .activity-icon.failed { background:#fff0f0; }
        .activity-icon s-icon { width:12px; height:12px; }
        .activity-title { font-size:11px; line-height:15px; font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .activity-meta { color:#6d7175; font-size:9px; line-height:13px; margin-top:1px; }
        .activity-time { color:#6d7175; font-size:9px; line-height:14px; white-space:nowrap; }
        .empty-state { padding:22px 16px; text-align:center; color:#6d7175; font-size:12px; line-height:18px; }
        .how-list { display:flex; flex-direction:column; }
        .how-row { display:grid; grid-template-columns:24px minmax(0,1fr); gap:9px; align-items:start; padding:10px 16px; border-top:1px solid #edf0f2; }
        .how-icon { width:22px; height:22px; border-radius:6px; display:grid; place-items:center; background:#f1f2f3; }
        .how-icon s-icon { width:13px; height:13px; }
        .how-title { font-size:11px; line-height:15px; font-weight:650; }
        .how-copy { color:#6d7175; font-size:10px; line-height:15px; margin-top:1px; }
        @media (max-width:900px) { .inventory-page { width:100%; } .inventory-metrics,.inventory-grid { grid-template-columns:1fr; } .inventory-status { grid-template-columns:38px 1fr; } .inventory-status-action { grid-column:2; justify-self:start; } }
        @media (max-width:620px) { .inventory-header { flex-direction:column; } .inventory-actions { width:100%; } .pull-meta { grid-template-columns:1fr; } .activity-row { grid-template-columns:22px 1fr auto; } .activity-time { display:none; } }
      `}</style>

      <div className="inventory-page">
        <div className="inventory-header">
          <div>
            <h1 className="inventory-title">Inventory</h1>
            <p className="inventory-subtitle">
              Monitor and synchronize inventory between Shopify and Zoho Books
            </p>
          </div>
          <div className="inventory-actions">
            {isLive && (
              <Form method="post">
                <input type="hidden" name="intent" value="pull-from-zoho" />
                <s-button
                  variant="primary"
                  icon="refresh"
                  type="submit"
                  loading={isPulling}
                >
                  Sync now
                </s-button>
              </Form>
            )}
          </div>
        </div>

        <div className="inventory-metrics">
          <MetricCard
            icon="location"
            label="Warehouse mappings"
            value={warehouseMappingCount}
            caption={
              warehouseMappingCount === 1
                ? "Shopify location mapped"
                : "Shopify locations mapped"
            }
            tone="blue"
          />
          <MetricCard
            icon="refresh"
            label="Shopify → Zoho"
            value={isLive ? "Live" : "Inactive"}
            caption="Automatic inventory updates via webhook"
            tone="green"
          />
          <MetricCard
            icon="arrow-right"
            label="Last Zoho pull"
            value={lastPullDate ? formatRelative(lastPullDate) : "Never"}
            caption={
              lastPullDate
                ? `${successful} of ${processed} records updated`
                : "Run a manual sync to refresh stock"
            }
            tone="purple"
          />
        </div>

        <div className="inventory-status">
          <div
            className={`inventory-status-icon ${
              !connected || !inventoryAccountId || warehouseMappingCount === 0
                ? "warning"
                : ""
            }`}
          >
            <s-icon
              type={isLive ? "check-circle" : "alert-triangle"}
              tone={isLive ? "success" : "caution"}
            ></s-icon>
          </div>
          <div>
            <div className="inventory-status-title">
              {isLive
                ? "Inventory synchronization is active"
                : !connected
                  ? "Connect Zoho to activate inventory sync"
                  : !inventoryAccountId
                    ? "Inventory account setup is required"
                    : "Map a Shopify location to a Zoho warehouse"}
            </div>
            <div className="inventory-status-copy">
              {isLive
                ? "Shopify stock changes are pushed to mapped Zoho warehouses automatically."
                : !connected
                  ? "Connect your Zoho Books organization from Settings before inventory can be synchronized."
                  : !inventoryAccountId
                    ? "Choose an Inventory account in Settings → Default accounts to enable stock tracking."
                    : "Only locations paired with a Zoho warehouse can participate in inventory synchronization."}
            </div>
          </div>
          <div className="inventory-status-action">
            <s-link href="/app/settings">Open Settings</s-link>
          </div>
        </div>

        <div className="inventory-grid">
          <section className="inventory-panel">
            <div className="inventory-panel-header">
              <h2 className="inventory-panel-title">Synchronization flow</h2>
              <p className="inventory-panel-subtitle">
                How stock moves between both systems
              </p>
            </div>
            <div className="direction-row">
              <div className="direction-icon">
                <s-icon type="refresh" tone="success"></s-icon>
              </div>
              <div>
                <div className="direction-title">Shopify → Zoho Books</div>
                <div className="direction-copy">
                  Inventory level webhooks update the matching Zoho warehouse automatically.
                </div>
              </div>
              <span className={`inventory-pill ${isLive ? "success" : "warning"}`}>
                {isLive ? "Live" : "Inactive"}
              </span>
            </div>
            <div className="direction-row">
              <div className="direction-icon">
                <s-icon type="arrow-right" tone="neutral"></s-icon>
              </div>
              <div>
                <div className="direction-title">Zoho Books → Shopify</div>
                <div className="direction-copy">
                  Reads mapped Zoho warehouse stock and updates Shopify when you run a manual pull.
                </div>
              </div>
              <span className="inventory-pill neutral">Manual</span>
            </div>
            <div className="direction-row">
              <div className="direction-icon">
                <s-icon type="check-circle" tone="success"></s-icon>
              </div>
              <div>
                <div className="direction-title">Bulk inventory backfill</div>
                <div className="direction-copy">
                  A pull checks every mapped product and warehouse pair, not only recently changed stock.
                </div>
              </div>
              <span className="inventory-pill neutral">Included</span>
            </div>
            <div className="direction-row">
              <div className="direction-icon">
                <s-icon type="alert-triangle" tone="caution"></s-icon>
              </div>
              <div>
                <div className="direction-title">Overselling prevention</div>
                <div className="direction-copy">
                  Inventory sync keeps quantities aligned but does not currently reserve stock against sales.
                </div>
              </div>
              <span className="inventory-pill warning">Not built</span>
            </div>
          </section>

          <section className="inventory-panel">
            <div className="inventory-panel-header">
              <h2 className="inventory-panel-title">Pull inventory from Zoho</h2>
              <p className="inventory-panel-subtitle">
                Refresh Shopify quantities from your mapped warehouses
              </p>
            </div>
            <div className="pull-card">
              <p className="pull-copy">
                The pull compares current Zoho stock against each mapped Shopify variant/location pair and updates Shopify where quantities differ.
              </p>
              <div className="pull-meta">
                <div className="pull-stat">
                  <div className="pull-stat-label">Processed</div>
                  <div className="pull-stat-value">{processed || "—"}</div>
                </div>
                <div className="pull-stat">
                  <div className="pull-stat-label">Updated</div>
                  <div className="pull-stat-value">{successful || "—"}</div>
                </div>
                <div className="pull-stat">
                  <div className="pull-stat-label">Success rate</div>
                  <div className="pull-stat-value">
                    {successRate === null ? "—" : `${successRate}%`}
                  </div>
                </div>
              </div>
              <div className="pull-footer">
                <span className="pull-last">
                  {lastPullDate
                    ? `Last run ${formatDate(lastPullDate)}`
                    : "No Zoho pull has been run yet"}
                </span>
                <Form method="post">
                  <input type="hidden" name="intent" value="pull-from-zoho" />
                  <s-button
                    type="submit"
                    variant="primary"
                    icon="refresh"
                    loading={isPulling}
                    disabled={!isLive || isPulling}
                  >
                    Sync now
                  </s-button>
                </Form>
              </div>
              {latestPullLog && showPullLog && (
                <s-banner
                  heading="Last pull completed"
                  tone={latestPullLog.records_failed > 0 ? "warning" : "success"}
                  className="inventory-alert"
                >
                  {latestPullLog.records_processed} processed, {latestPullLog.records_success} updated, {latestPullLog.records_failed} failed in {formatDuration(latestPullLog)}.
                </s-banner>
              )}
            </div>
          </section>
        </div>

        <section className="inventory-panel">
          <div className="inventory-panel-header">
            <h2 className="inventory-panel-title">Recent inventory activity</h2>
            <p className="inventory-panel-subtitle">
              Latest Shopify inventory webhook events
              {latestActivityDate ? ` · ${formatRelative(latestActivityDate)}` : ""}
            </p>
          </div>
          {recentActivity.length === 0 ? (
            <div className="empty-state">
              No inventory sync events have been recorded yet.
            </div>
          ) : (
            <>
              <div className="activity-summary">
                {["synced", "skipped", "failed"].map((status) =>
                  activityCounts[status] ? (
                    <span
                      key={status}
                      className={`inventory-pill ${
                        status === "failed"
                          ? "warning"
                          : status === "synced"
                            ? "success"
                            : "neutral"
                      }`}
                    >
                      {activityCounts[status]} {status}
                    </span>
                  ) : null,
                )}
              </div>
              <div className="activity-list">
                {recentActivity.map((entry, index) => {
                  const config = ACTIVITY_STATUS[entry.status] || ACTIVITY_STATUS.skipped;
                  return (
                    <div className="activity-row" key={`${entry.id || "activity"}-${index}`}>
                      <div className={`activity-icon ${entry.status}`}>
                        <s-icon type={config.icon} tone={config.tone}></s-icon>
                      </div>
                      <div>
                        <div className="activity-title">
                          {entry.resource_label || "Product / variant"}
                        </div>
                        <div className="activity-meta">
                          {entry.error_message || "Inventory event processed successfully."}
                        </div>
                      </div>
                      <span className={`inventory-pill ${
                        entry.status === "failed"
                          ? "warning"
                          : entry.status === "synced"
                            ? "success"
                            : "neutral"
                      }`}>
                        {entry.status}
                      </span>
                      <span className="activity-time">
                        {formatRelative(entry.received_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </s-page>
  );
}
