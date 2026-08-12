import { boundary } from "@shopify/shopify-app-react-router/server";
import { Box, InlineStack, BlockStack, Text, Icon } from "@shopify/polaris";
import { ProductIcon, PersonIcon, OrderIcon, InventoryIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import OtherApps from "../components/Common/OtherApps";
import { useTranslation } from "../locales/translation";

const syncStats = [
  { key: "products", icon: ProductIcon, tone: "info", background: "bg-fill-info-secondary" },
  { key: "customers", icon: PersonIcon, tone: "magic", background: "bg-fill-magic-secondary" },
  { key: "orders", icon: OrderIcon, tone: "caution", background: "bg-fill-caution-secondary" },
  { key: "inventory", icon: InventoryIcon, tone: "success", background: "bg-fill-success-secondary" },
];

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  const t = useTranslation();

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
          wrap
        >
          {/* Shopify */}
          <s-box
            padding="base"
            borderWidth="base"
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
            borderWidth="base"
            borderRadius="base"
          >
            <s-stack gap="base">
              <s-heading>{t("dashboard.zohoBooks")}</s-heading>

              <s-badge tone="warning">
                {t("dashboard.notConnected")}
              </s-badge>

              <s-paragraph>
                {t("dashboard.zohoConnectDescription")}
              </s-paragraph>

              <s-button variant="primary">
                {t("dashboard.connectZohoButton")}
              </s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Synchronization Overview */}
      <s-section heading={t("dashboard.syncOverview")}>
        <InlineStack gap="400" wrap>
          {syncStats.map((stat) => (
            <Box
              key={stat.key}
              minWidth="200px"
              padding="400"
              borderWidth="025"
              borderColor="border"
              borderRadius="300"
              background="bg-surface"
            >
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Box
                    padding="200"
                    borderRadius="full"
                    background={stat.background}
                  >
                    <Icon source={stat.icon} tone={stat.tone} />
                  </Box>

                  <Text as="h3" variant="headingSm">
                    {t(`dashboard.${stat.key}`)}
                  </Text>
                </InlineStack>

                <Text as="p" variant="heading2xl">
                  0
                </Text>

                <Text as="p" tone="caution">
                  {t("dashboard.notSynced")}
                </Text>
              </BlockStack>
            </Box>
          ))}
        </InlineStack>
      </s-section>

      {/* Recent Activity */}
      <s-section heading={t("dashboard.recentActivity")}>
        <s-stack gap="base">
          <s-paragraph>
            {t("dashboard.noSyncYet")}
          </s-paragraph>

          <s-button variant="primary">
            {t("dashboard.syncNow")}
          </s-button>
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