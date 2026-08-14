import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getConnectionForShopDomain } from "../models/zohoConnection.server";
import { getAppSettings } from "../models/appSettings.server";
import { getWarehouseMappings } from "../models/warehouseMapping.server";
import { getRecentWebhookLogs } from "../models/webhookLog.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { shop, connection } = await getConnectionForShopDomain(session.shop);

  const appSettings = connection ? await getAppSettings(shop.id) : {};
  const warehouseMappings = connection ? await getWarehouseMappings(shop.id) : {};
  const recentActivity = connection
    ? await getRecentWebhookLogs(shop.id, "INVENTORY_LEVELS_UPDATE", 10)
    : [];

  return {
    connected: Boolean(connection),
    inventoryAccountId: appSettings.accountSettings?.inventoryAccountId || null,
    warehouseMappingCount: Object.keys(warehouseMappings).length,
    recentActivity,
  };
};

export default function InventoryPage() {
  const { connected, inventoryAccountId, warehouseMappingCount, recentActivity } =
    useLoaderData();

  return (
    <s-page heading="Inventory">
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
            products. Until then, products sync without stock tracking and
            this page will show no activity.
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

      <s-section heading="How this works">
        <s-stack gap="base">
          <s-paragraph>
            Whenever a variant&apos;s available quantity changes at a mapped
            Shopify location, this app adjusts the matching Zoho item&apos;s
            stock at the matching Zoho warehouse to match - creating a Zoho
            inventory adjustment for the difference.
          </s-paragraph>
          <s-unordered-list>
            <s-list-item>
              <s-text type="strong">Shopify → Zoho:</s-text> live, via
              webhook.
            </s-list-item>
            <s-list-item>
              <s-text type="strong">Zoho → Shopify:</s-text> not built yet -
              stock changes made directly in Zoho don&apos;t flow back to
              Shopify.
            </s-list-item>
            <s-list-item>
              <s-text type="strong">Bulk backfill:</s-text> not built yet -
              only live changes going forward are synced; existing stock
              levels aren&apos;t pushed retroactively.
            </s-list-item>
            <s-list-item>
              <s-text type="strong">Overselling prevention:</s-text> not
              built yet - this only keeps stock numbers in sync, it
              doesn&apos;t hold back Shopify sales based on Zoho&apos;s
              stock.
            </s-list-item>
          </s-unordered-list>
        </s-stack>
      </s-section>

      <s-section heading="Recent activity">
        {recentActivity.length === 0 ? (
          <s-paragraph color="subdued">
            No inventory sync events recorded yet.
          </s-paragraph>
        ) : (
          <s-stack gap="none">
            {recentActivity.map((entry, index) => (
              <s-box key={index} paddingBlockStart={index > 0 ? "small" : "none"}>
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-badge tone={entry.status === "failed" ? "critical" : "success"}>
                    {entry.status}
                  </s-badge>
                  <s-text color="subdued">
                    {new Date(entry.received_at).toLocaleString()}
                  </s-text>
                  {entry.error_message && (
                    <s-text color="critical">{entry.error_message}</s-text>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
