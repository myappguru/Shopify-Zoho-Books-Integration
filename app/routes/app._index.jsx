import { boundary } from "@shopify/shopify-app-react-router/server";
import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getConnectionForShopDomain,
  getValidAccessToken,
} from "../models/zohoConnection.server";
import { getAuthorizationUrl } from "../zoho.server";
import {
  getSyncedProductCount,
  runProductSync,
} from "../models/productSync.server";
import {
  getSyncedCustomerCount,
  runCustomerSync,
} from "../models/customerSync.server";
import { getSyncedOrderCount, runOrderSync } from "../models/orderSync.server";
import { getSyncedWebhookCount } from "../models/webhookLog.server";
import { runInventoryPull } from "../models/inventorySync.server";
import { getLatestSyncLog } from "../models/syncLog.server";
import OtherApps from "../components/Common/OtherApps";
import { useTranslation } from "../locales/translation";
import { useZohoConnectionSync } from "../hooks/useZohoConnectionSync";

// `iconTone` values come from s-icon's real tone enum (no "magic" - that's a
// classic-Polaris-only tone that doesn't exist here, confirmed against the
// actual web-component type definitions via the Shopify AI Toolkit).
const syncStats = [
  { key: "products", iconType: "product", iconTone: "info" },
  { key: "customers", iconType: "person", iconTone: "neutral" },
  { key: "orders", iconType: "order", iconTone: "caution" },
  { key: "inventory", iconType: "inventory", iconTone: "success" },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { shop, connection } = await getConnectionForShopDomain(session.shop);

  // Real counts, not the hardcoded "0" this page shipped with - each stat
  // tile reads from whatever that entity type already tracks as "synced"
  // (sync_mappings for products/customers/orders; inventory has no mapping
  // table of its own, so it uses the count of successful stock-push webhook
  // events instead, see getSyncedWebhookCount).
  const [
    productCount,
    customerCount,
    orderCount,
    inventoryCount,
    productLog,
    customerLog,
    orderLog,
    inventoryLog,
  ] = connection
    ? await Promise.all([
        getSyncedProductCount(shop.id),
        getSyncedCustomerCount(shop.id),
        getSyncedOrderCount(shop.id),
        getSyncedWebhookCount(shop.id, "INVENTORY_LEVELS_UPDATE"),
        getLatestSyncLog(shop.id, "product"),
        getLatestSyncLog(shop.id, "customer"),
        getLatestSyncLog(shop.id, "order"),
        getLatestSyncLog(shop.id, "inventory"),
      ])
    : [0, 0, 0, 0, null, null, null, null];

  return {
    zohoConnected: Boolean(connection),
    zohoOrganizationName: connection?.organization_name || null,
    zohoAuthUrl: connection ? null : getAuthorizationUrl(session.shop),
    syncCounts: {
      products: productCount,
      customers: customerCount,
      orders: orderCount,
      inventory: inventoryCount,
    },
    recentLogs: {
      products: productLog,
      customers: customerLog,
      orders: orderLog,
      inventory: inventoryLog,
    },
  };
};

// The Dashboard's "Sync Now" button previously had no handler at all -
// clicking it did nothing. This runs all four entity syncs one after
// another (not in parallel): orders auto-syncs its own customer/line items
// on the fly if they aren't mapped yet, so products and customers going
// first means fewer redundant on-the-fly syncs inside the order loop, and
// running sequentially avoids hitting Zoho's org-wide API rate limit all at
// once the way four simultaneous full-catalog syncs would.
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

  const zohoAuth = {
    accessToken: token.accessToken,
    apiDomain: token.apiDomain,
    organizationId: connection.organization_id,
  };

  await runProductSync({ admin, shop, zohoAuth });
  await runCustomerSync({ admin, shop, zohoAuth });
  await runOrderSync({ admin, shop, zohoAuth });
  await runInventoryPull({ admin, shop, zohoAuth });

  return null;
};

function openZohoAuthWindow(zohoAuthUrl) {
  // No `noopener` here on purpose - useZohoConnectionSync needs
  // window.opener to survive so the popup can post back when it's done.
  window.open(zohoAuthUrl, "zoho-connect", "width=600,height=720");
}

export default function Index() {
  const { zohoConnected, zohoOrganizationName, zohoAuthUrl, syncCounts, recentLogs } =
    useLoaderData();
  const t = useTranslation();
  useZohoConnectionSync();
  const navigation = useNavigation();
  const isSyncingAll =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "sync-all";
  const hasRecentActivity = Object.values(recentLogs).some(Boolean);

  return (
    <s-page
      heading={t("app.title")}
    >
      {/* Header */}
      <s-section>
        <s-stack gap="base">
          <s-heading>{t("dashboard.mainHeading")}</s-heading>

          <s-paragraph>
            {t("dashboard.subtitle")}
          </s-paragraph>
        </s-stack>
      </s-section>

      {/* Connection Status */}
      <s-section heading={t("dashboard.connections")}>
        <s-stack
          direction="inline"
          gap="base"
        >
          {/* Shopify */}
          <s-box
            padding="base"
            border="base"
            borderRadius="base"
          >
            <s-stack gap="base">
              <s-heading>{t("dashboard.shopifyStore")}</s-heading>

              <s-badge tone="success">
                {t("dashboard.connected")}
              </s-badge>

              <s-paragraph>
                {t("dashboard.shopifyConnectedDescription")}
              </s-paragraph>
            </s-stack>
          </s-box>

          {/* Zoho */}
          <s-box
            padding="base"
            border="base"
            borderRadius="base"
          >
            <s-stack gap="base">
              <s-heading>{t("dashboard.zohoBooks")}</s-heading>

              <s-badge tone={zohoConnected ? "success" : "warning"}>
                {zohoConnected ? t("dashboard.connected") : t("dashboard.notConnected")}
              </s-badge>

              <s-paragraph>
                {zohoConnected
                  ? `${t("dashboard.zohoConnectedDescriptionPrefix")}${zohoOrganizationName}`
                  : t("dashboard.zohoConnectDescription")}
              </s-paragraph>

              {!zohoConnected && (
                <s-button variant="primary" onClick={() => openZohoAuthWindow(zohoAuthUrl)}>
                  {t("dashboard.connectZohoButton")}
                </s-button>
              )}
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Synchronization Overview */}
      <s-section heading={t("dashboard.syncOverview")}>
        <s-stack direction="inline" gap="base">
          {syncStats.map((stat) => {
            const count = syncCounts[stat.key] || 0;

            return (
              <s-box
                key={stat.key}
                minInlineSize="200px"
                padding="base"
                border="base"
                borderRadius="base"
              >
                <s-stack gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-icon type={stat.iconType} tone={stat.iconTone}></s-icon>
                    <s-text type="strong">{t(`dashboard.${stat.key}`)}</s-text>
                  </s-stack>

                  <s-heading>{count}</s-heading>

                  {count === 0 && (
                    <s-text tone="caution">{t("dashboard.notSynced")}</s-text>
                  )}
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-section>

      {/* Recent Activity */}
      <s-section heading={t("dashboard.recentActivity")}>
        <s-stack gap="base">
          {hasRecentActivity ? (
            <s-stack gap="small">
              {syncStats.map((stat) => {
                const log = recentLogs[stat.key];
                if (!log) return null;

                return (
                  <s-stack
                    key={stat.key}
                    direction="inline"
                    gap="small"
                    alignItems="center"
                  >
                    <s-badge tone={log.records_failed > 0 ? "warning" : "success"}>
                      {t(`dashboard.${stat.key}`)}
                    </s-badge>
                    <s-text color="subdued">
                      {new Date(
                        log.completed_at || log.started_at,
                      ).toLocaleString()}
                    </s-text>
                    <s-text>
                      {log.records_processed} processed,{" "}
                      {log.records_success} succeeded, {log.records_failed}{" "}
                      failed
                    </s-text>
                  </s-stack>
                );
              })}
            </s-stack>
          ) : (
            <s-paragraph>{t("dashboard.noSyncYet")}</s-paragraph>
          )}

          <Form method="post">
            <input type="hidden" name="intent" value="sync-all" />
            <s-button
              variant="primary"
              type="submit"
              icon="refresh"
              loading={isSyncingAll}
              disabled={!zohoConnected}
            >
              {t("dashboard.syncNow")}
            </s-button>
          </Form>
        </s-stack>
      </s-section>

      {/* More from MyAppGurus */}
      <OtherApps />
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};