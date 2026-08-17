import { Fragment } from "react";
import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { useAutoDismiss } from "../hooks/useAutoDismiss";
import {
  getConnectionForShopDomain,
  getValidAccessToken,
} from "../models/zohoConnection.server";
import {
  getProductMappings,
  PRODUCTS_QUERY,
  normalizeProductNode,
  runProductSync,
} from "../models/productSync.server";
import { getLatestSyncLog } from "../models/syncLog.server";

const PAGE_SIZE = 20;

// Shopify admin resource URLs take the plain numeric id, not the GID.
function shopifyNumericId(gid) {
  return gid ? gid.split("/").pop() : null;
}

// One page of products for display - cursor-based, since the Admin
// GraphQL API has no concept of numbered pages, only "the 20 after this
// cursor" or "the 20 before this cursor" (same as Shopify's own admin).
async function fetchProductsPage(admin, { after, before } = {}) {
  const variables = before
    ? { last: PAGE_SIZE, before }
    : { first: PAGE_SIZE, after: after || null };

  const response = await admin.graphql(PRODUCTS_QUERY, { variables });
  const json = await response.json();

  return {
    products: (json.data?.products?.edges || []).map(({ node }) =>
      normalizeProductNode(node),
    ),
    pageInfo: json.data?.products?.pageInfo || {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
  };
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, connection } = await getConnectionForShopDomain(session.shop);

  const url = new URL(request.url);
  const after = url.searchParams.get("after") || undefined;
  const before = url.searchParams.get("before") || undefined;

  const { products, pageInfo } = await fetchProductsPage(admin, {
    after,
    before,
  });
  const mappings = connection ? await getProductMappings(shop.id) : {};
  const latestLog = connection
    ? await getLatestSyncLog(shop.id, "product")
    : null;

  return {
    connected: Boolean(connection),
    products,
    pageInfo,
    mappings,
    latestLog,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("intent") !== "sync-now") return null;

  const { shop, connection } = await getConnectionForShopDomain(session.shop);
  if (!connection) return null;

  const token = await getValidAccessToken(shop.id).catch((error) => {
    console.error(
      "Failed to get a valid Zoho access token for product sync",
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

  await runProductSync({ admin, shop, zohoAuth });

  return null;
};

export default function ProductsPage() {
  const { connected, products, pageInfo, mappings, latestLog } =
    useLoaderData();
  const navigation = useNavigation();
  const isSyncing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "sync-now";
  const showLog = useAutoDismiss(latestLog?.id);

  return (
    <s-page heading="Products">
      <s-section heading="Product synchronization">
        {!connected ? (
          <s-paragraph>
            Connect your Zoho Books organization on the{" "}
            <s-link href="/app/settings">Settings</s-link> page before syncing
            products.
          </s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-grid
              gridTemplateColumns="1fr auto"
              gap="base"
              alignItems="center"
            >
              <s-paragraph color="subdued">
                Pushes each Shopify product variant with a SKU to Zoho Inventory
                as an item - creating it if it doesn&apos;t exist yet, or
                updating it (and linking to an existing Zoho item with the same
                SKU) if it does.
              </s-paragraph>

              <Form method="post">
                <input type="hidden" name="intent" value="sync-now" />
                <s-button
                  variant="primary"
                  type="submit"
                  icon="refresh"
                  loading={isSyncing}
                >
                  Sync now
                </s-button>
              </Form>
            </s-grid>

            {latestLog && showLog && (
              <s-banner
                heading="Last sync"
                tone={latestLog.records_failed > 0 ? "warning" : "success"}
              >
                {new Date(
                  latestLog.completed_at || latestLog.started_at,
                ).toLocaleString()}{" "}
                — {latestLog.records_processed} processed,{" "}
                {latestLog.records_success} succeeded,{" "}
                {latestLog.records_failed} failed
              </s-banner>
            )}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Products">
        {products.length === 0 ? (
          <s-paragraph>No products found in this store.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
          <s-stack gap="none" style={{ minWidth: "500px" }}>
            <s-grid gridTemplateColumns="1.6fr 90px 70px 110px" gap="small">
              <s-text type="strong" color="subdued">
                Product / SKU
              </s-text>
              <s-text type="strong" color="subdued">
                Price
              </s-text>
              <s-text type="strong" color="subdued">
                Qty
              </s-text>
              <s-text type="strong" color="subdued">
                Sync
              </s-text>
            </s-grid>

            {products.map((product, productIndex) => (
              <Fragment key={product.id}>
                {productIndex > 0 && <s-divider></s-divider>}

                <s-box paddingBlockStart="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-thumbnail
                      src={product.imageUrl || undefined}
                      alt={product.title}
                      size="small"
                    ></s-thumbnail>
                    <s-link
                      href={`shopify://admin/products/${shopifyNumericId(product.id)}`}
                      target="_top"
                    >
                      <s-text type="strong">{product.title}</s-text>
                    </s-link>
                    <s-badge
                      tone={product.status === "ACTIVE" ? "success" : "subdued"}
                    >
                      {product.status}
                    </s-badge>
                  </s-stack>
                </s-box>

                {product.variants.map((variant) => {
                  const mapping = mappings[variant.id];
                  const syncTone = !mapping
                    ? "subdued"
                    : mapping.status === "error"
                      ? "critical"
                      : "success";
                  const syncLabel = !mapping
                    ? "Not synced"
                    : mapping.status === "error"
                      ? "Sync error"
                      : "Synced";

                  return (
                    <s-grid
                      key={variant.id}
                      gridTemplateColumns="1.6fr 90px 70px 110px"
                      gap="small"
                    >
                      <s-text color="subdued">
                        {variant.sku || "No SKU"}
                        {variant.title && variant.title !== "Default Title"
                          ? ` · ${variant.title}`
                          : ""}
                      </s-text>
                      <s-text>{variant.price}</s-text>
                      <s-text>{variant.inventoryQuantity}</s-text>
                      <s-badge tone={syncTone}>{syncLabel}</s-badge>
                    </s-grid>
                  );
                })}
              </Fragment>
            ))}
          </s-stack>
          </div>
        )}

        {(pageInfo.hasPreviousPage || pageInfo.hasNextPage) && (
          <s-box paddingBlockStart="base">
            <s-stack direction="inline" gap="small" justifyContent="end">
              <s-button
                variant="secondary"
                disabled={!pageInfo.hasPreviousPage}
                href={
                  pageInfo.hasPreviousPage
                    ? `?before=${encodeURIComponent(pageInfo.startCursor)}`
                    : undefined
                }
              >
                Previous
              </s-button>
              <s-button
                variant="secondary"
                disabled={!pageInfo.hasNextPage}
                href={
                  pageInfo.hasNextPage
                    ? `?after=${encodeURIComponent(pageInfo.endCursor)}`
                    : undefined
                }
              >
                Next
              </s-button>
            </s-stack>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}
