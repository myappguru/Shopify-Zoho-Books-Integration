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

// Same tile shape as the Dashboard's "Synchronization Overview" stat cards
// (app._index.jsx) - reused here so the two pages read as one product
// instead of each page inventing its own look. Built entirely from Polaris
// web components (s-*) - this app's pages don't render inside a classic
// `@shopify/polaris` React tree, and mixing in components like `Box`/`Icon`
// from the "@shopify/polaris" package renders unstyled/oversized (confirmed
// live - a plain SVG icon filled the whole page). `s-icon`'s `type` values
// were verified against the actual web-component type definitions via the
// Shopify AI Toolkit's validator, not guessed.
// eslint-disable-next-line react/prop-types -- this codebase doesn't use PropTypes anywhere else
function StatTile({ iconType, iconTone, label, value, caption }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" minInlineSize="220px">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-icon type={iconType} tone={iconTone}></s-icon>
          <s-text type="strong">{label}</s-text>
        </s-stack>

        {value}

        {caption && <s-text color="subdued">{caption}</s-text>}
      </s-stack>
    </s-box>
  );
}

const ACTIVITY_STATUS_ICON = {
  synced: { type: "check-circle", tone: "success" },
  skipped: { type: "info", tone: "neutral" },
  failed: { type: "x-circle", tone: "critical" },
};

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
    (counts, entry) => ({ ...counts, [entry.status]: (counts[entry.status] || 0) + 1 }),
    {},
  );

  return (
    <s-page heading="Inventory">
      <s-section>
        <s-stack direction="inline" gap="base">
          <StatTile
            iconType="location"
            iconTone="info"
            label="Warehouse mappings"
            value={<s-heading>{warehouseMappingCount}</s-heading>}
            caption={
              warehouseMappingCount === 0
                ? "No Shopify locations mapped yet"
                : `location${warehouseMappingCount === 1 ? "" : "s"} mapped to a Zoho warehouse`
            }
          />

          <StatTile
            iconType="refresh"
            iconTone={isLive ? "success" : "caution"}
            label="Shopify → Zoho"
            value={
              <s-badge tone={isLive ? "success" : "caution"}>
                {isLive ? "Live" : "Not active"}
              </s-badge>
            }
            caption="Automatic, via webhook"
          />

          <StatTile
            iconType="arrow-right"
            iconTone="neutral"
            label="Zoho → Shopify"
            value={
              <s-text type="strong">
                {latestPullLog
                  ? `${latestPullLog.records_success} updated`
                  : "Never run"}
              </s-text>
            }
            caption={
              latestPullLog
                ? new Date(
                    latestPullLog.completed_at || latestPullLog.started_at,
                  ).toLocaleString()
                : "Manual, via “Sync now” below"
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Inventory synchronization">
        {!connected ? (
          <s-paragraph>
            Connect your Zoho Books organization on the{" "}
            <s-link href="/app/settings">Settings</s-link> page first.
          </s-paragraph>
        ) : !inventoryAccountId ? (
          <s-banner heading="Inventory account not set" tone="warning">
            Set an &quot;Inventory account&quot; on the{" "}
            <s-link href="/app/settings">Settings</s-link> page (Default
            accounts section) to turn on inventory tracking for synced
            products. Until then, products sync without stock tracking, so
            stock changes are received but skipped rather than pushed to
            Zoho — you&apos;ll see them below as &quot;skipped&quot;, not
            &quot;synced&quot;.
          </s-banner>
        ) : warehouseMappingCount === 0 ? (
          <s-banner heading="No warehouse mapping" tone="warning">
            Map at least one Shopify location to a Zoho warehouse on the{" "}
            <s-link href="/app/settings">Settings</s-link> page (Warehouse
            mapping section) - stock changes at unmapped locations are
            skipped.
          </s-banner>
        ) : (
          <s-banner heading="Live" tone="success">
            Stock quantity changes in Shopify push to Zoho automatically as
            they happen, for products and locations that are mapped.
          </s-banner>
        )}
      </s-section>

      {isLive && (
        <s-section heading="Pull from Zoho">
          <s-stack gap="base">
            <s-grid
              gridTemplateColumns="1fr auto"
              gap="base"
              alignItems="center"
            >
              <s-paragraph color="subdued">
                Reads each mapped product&apos;s current stock at every
                mapped Zoho warehouse and updates Shopify&apos;s available
                quantity to match, for any variant/location pair that&apos;s
                out of sync.
              </s-paragraph>

              <Form method="post">
                <input type="hidden" name="intent" value="pull-from-zoho" />
                <s-button
                  variant="primary"
                  type="submit"
                  icon="refresh"
                  loading={isPulling}
                >
                  Sync now
                </s-button>
              </Form>
            </s-grid>

            {latestPullLog && showPullLog && (
              <s-banner
                heading="Last pull from Zoho"
                tone={latestPullLog.records_failed > 0 ? "warning" : "success"}
              >
                {new Date(
                  latestPullLog.completed_at || latestPullLog.started_at,
                ).toLocaleString()}{" "}
                — {latestPullLog.records_processed} processed,{" "}
                {latestPullLog.records_success} updated,{" "}
                {latestPullLog.records_failed} failed
              </s-banner>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section heading="How this works">
        <s-stack gap="base">
          <s-paragraph>
            Whenever a variant&apos;s available quantity changes at a mapped
            Shopify location, this app adjusts the matching Zoho item&apos;s
            stock at the matching Zoho warehouse to match - creating a Zoho
            inventory adjustment for the difference.
          </s-paragraph>

          <s-stack gap="small">
            {[
              {
                iconType: "check-circle",
                tone: "success",
                title: "Shopify → Zoho",
                body: "Live, via webhook.",
              },
              {
                iconType: "clock",
                tone: "neutral",
                title: "Zoho → Shopify",
                body: "Manual, via the “Pull from Zoho” button above - Zoho has no equivalent of Shopify’s webhooks for third-party apps, so this direction is on-demand rather than live.",
              },
              {
                iconType: "check-circle",
                tone: "success",
                title: "Bulk backfill",
                body: "The “Pull from Zoho” button doubles as this - it checks every mapped product/warehouse pair, not just ones that changed recently.",
              },
              {
                iconType: "alert-triangle",
                tone: "caution",
                title: "Overselling prevention",
                body: "Not built yet - this only keeps stock numbers in sync, it doesn’t hold back Shopify sales based on Zoho’s stock.",
              },
            ].map((row) => (
              <s-stack key={row.title} direction="inline" gap="small" alignItems="start">
                <s-icon type={row.iconType} tone={row.tone}></s-icon>
                <s-text>
                  <s-text type="strong">{row.title}:</s-text> {row.body}
                </s-text>
              </s-stack>
            ))}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Recent activity">
        {recentActivity.length === 0 ? (
          <s-paragraph color="subdued">
            No inventory sync events recorded yet.
          </s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-stack direction="inline" gap="small">
              {["synced", "skipped", "failed"].map((status) =>
                activityCounts[status] ? (
                  <s-badge
                    key={status}
                    tone={
                      status === "failed"
                        ? "critical"
                        : status === "synced"
                          ? "success"
                          : "info"
                    }
                  >
                    {`${activityCounts[status]} ${status}`}
                  </s-badge>
                ) : null,
              )}
            </s-stack>

            <s-stack gap="small">
              {recentActivity.map((entry, index) => {
                const statusIcon =
                  ACTIVITY_STATUS_ICON[entry.status] || ACTIVITY_STATUS_ICON.skipped;

                return (
                  <s-box
                    key={index}
                    padding="small-300"
                    border="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-stack direction="inline" gap="small" alignItems="start">
                      <s-icon type={statusIcon.type} tone={statusIcon.tone}></s-icon>
                      <s-stack gap="small-100">
                        <s-stack direction="inline" gap="small" alignItems="center">
                          <s-badge
                            tone={
                              entry.status === "failed"
                                ? "critical"
                                : entry.status === "synced"
                                  ? "success"
                                  : "info"
                            }
                          >
                            {entry.status}
                          </s-badge>
                          <s-text color="subdued">
                            {new Date(entry.received_at).toLocaleString()}
                          </s-text>
                        </s-stack>
                        <s-text>
                          {entry.resource_label ||
                            "(product/variant could not be identified)"}
                        </s-text>
                        {entry.error_message &&
                          (entry.status === "failed" ? (
                            <s-text tone="critical">{entry.error_message}</s-text>
                          ) : (
                            <s-text color="subdued">{entry.error_message}</s-text>
                          ))}
                      </s-stack>
                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
