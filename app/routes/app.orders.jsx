import { Fragment } from "react";
import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { useAutoDismiss } from "../hooks/useAutoDismiss";
import {
  getConnectionForShopDomain,
  getValidAccessToken,
} from "../models/zohoConnection.server";
import {
  getOrderMappings,
  ORDERS_QUERY,
  normalizeOrderNode,
  runOrderSync,
} from "../models/orderSync.server";
import { getInvoiceMappings } from "../models/invoiceSync.server";
import { getPaymentMappings } from "../models/paymentSync.server";
import { getLatestSyncLog } from "../models/syncLog.server";

const PAGE_SIZE = 20;

// Shopify admin resource URLs take the plain numeric id, not the GID.
function shopifyNumericId(gid) {
  return gid ? gid.split("/").pop() : null;
}

// One page of orders for display - cursor-based, since the Admin GraphQL
// API has no concept of numbered pages, only "the 20 after this cursor" or
// "the 20 before this cursor" (same as Shopify's own admin).
async function fetchOrdersPage(admin, { after, before } = {}) {
  const variables = before
    ? { last: PAGE_SIZE, before }
    : { first: PAGE_SIZE, after: after || null };

  const response = await admin.graphql(ORDERS_QUERY, { variables });
  const json = await response.json();

  return {
    orders: (json.data?.orders?.edges || []).map(({ node }) =>
      normalizeOrderNode(node),
    ),
    pageInfo: json.data?.orders?.pageInfo || {
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

  const { orders, pageInfo } = await fetchOrdersPage(admin, { after, before });
  const mappings = connection ? await getOrderMappings(shop.id) : {};
  const invoiceMappings = connection ? await getInvoiceMappings(shop.id) : {};
  const paymentMappings = connection ? await getPaymentMappings(shop.id) : {};
  const latestLog = connection ? await getLatestSyncLog(shop.id, "order") : null;
  const latestInvoiceLog = connection ? await getLatestSyncLog(shop.id, "invoice") : null;
  const latestPaymentLog = connection ? await getLatestSyncLog(shop.id, "payment") : null;

  return {
    connected: Boolean(connection),
    orders,
    pageInfo,
    mappings,
    invoiceMappings,
    paymentMappings,
    latestLog,
    latestInvoiceLog,
    latestPaymentLog,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("intent") !== "sync-now") return null;

  const { shop, connection } = await getConnectionForShopDomain(session.shop);
  if (!connection) return null;

  const token = await getValidAccessToken(shop.id).catch((error) => {
    console.error("Failed to get a valid Zoho access token for order sync", error);
    return null;
  });
  if (!token) return null;

  const zohoAuth = {
    accessToken: token.accessToken,
    apiDomain: token.apiDomain,
    organizationId: connection.organization_id,
  };

  await runOrderSync({ admin, shop, zohoAuth });

  return null;
};

export default function OrdersPage() {
  const {
    connected,
    orders,
    pageInfo,
    mappings,
    invoiceMappings,
    paymentMappings,
    latestLog,
    latestInvoiceLog,
    latestPaymentLog,
  } = useLoaderData();
  const navigation = useNavigation();
  const isSyncing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "sync-now";

  const showLog = useAutoDismiss(latestLog?.id);
  const showInvoiceLog = useAutoDismiss(latestInvoiceLog?.id);
  const showPaymentLog = useAutoDismiss(latestPaymentLog?.id);

  return (
    <s-page heading="Orders">
      <s-section heading="Order synchronization">
        {!connected ? (
          <s-paragraph>
            Connect your Zoho Books organization on the{" "}
            <s-link href="/app/settings">Settings</s-link> page before syncing
            orders.
          </s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
              <s-paragraph color="subdued">
                Pushes each Shopify order to Zoho Books as a sales order,
                auto-linking or creating the customer and any unsynced
                products along the way - then generates a Zoho invoice and
                records a payment against it for any already-paid order that
                doesn&apos;t have them yet.
              </s-paragraph>

              <Form method="post">
                <input type="hidden" name="intent" value="sync-now" />
                <s-button variant="primary" type="submit" icon="refresh" loading={isSyncing}>
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

            {latestInvoiceLog && showInvoiceLog && (
              <s-banner
                heading="Last invoice sync"
                tone={latestInvoiceLog.records_failed > 0 ? "warning" : "success"}
              >
                {new Date(
                  latestInvoiceLog.completed_at || latestInvoiceLog.started_at,
                ).toLocaleString()}{" "}
                — {latestInvoiceLog.records_processed} processed,{" "}
                {latestInvoiceLog.records_success} succeeded,{" "}
                {latestInvoiceLog.records_failed} failed
              </s-banner>
            )}

            {latestPaymentLog && showPaymentLog && (
              <s-banner
                heading="Last payment sync"
                tone={latestPaymentLog.records_failed > 0 ? "warning" : "success"}
              >
                {new Date(
                  latestPaymentLog.completed_at || latestPaymentLog.started_at,
                ).toLocaleString()}{" "}
                — {latestPaymentLog.records_processed} processed,{" "}
                {latestPaymentLog.records_success} succeeded,{" "}
                {latestPaymentLog.records_failed} failed
              </s-banner>
            )}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Orders">
        {orders.length === 0 ? (
          <s-paragraph>No orders found in this store.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
          <s-stack gap="none" style={{ minWidth: "640px" }}>
            <s-grid gridTemplateColumns="1fr 1.4fr 70px 100px 100px 100px" gap="small">
              <s-text type="strong" color="subdued">
                Order
              </s-text>
              <s-text type="strong" color="subdued">
                Customer
              </s-text>
              <s-text type="strong" color="subdued">
                Items
              </s-text>
              <s-text type="strong" color="subdued">
                Sync
              </s-text>
              <s-text type="strong" color="subdued">
                Invoice
              </s-text>
              <s-text type="strong" color="subdued">
                Payment
              </s-text>
            </s-grid>

            {orders.map((order, orderIndex) => {
              const mapping = mappings[order.id];
              const syncTone = !mapping
                ? "subdued"
                : mapping.status === "error"
                  ? "critical"
                  : mapping.status === "voided"
                    ? "subdued"
                    : "success";
              const syncLabel = !mapping
                ? "Not synced"
                : mapping.status === "error"
                  ? "Sync error"
                  : mapping.status === "voided"
                    ? "Voided"
                    : "Synced";
              const invoiceMapping = invoiceMappings[order.id];
              const invoiceTone =
                invoiceMapping?.status === "error" ? "critical" : invoiceMapping ? "success" : "subdued";
              const invoiceLabel = invoiceMapping?.status === "error"
                ? "Invoice error"
                : invoiceMapping
                  ? "Invoiced"
                  : "Not invoiced";
              const paymentMapping = paymentMappings[order.id];
              const paymentTone =
                paymentMapping?.status === "error" ? "critical" : paymentMapping ? "success" : "subdued";
              const paymentLabel = paymentMapping?.status === "error"
                ? "Payment error"
                : paymentMapping
                  ? "Paid"
                  : "Not recorded";
              const customerLabel = order.customer
                ? `${order.customer.firstName} ${order.customer.lastName}`.trim() ||
                  order.customer.email
                : order.email || "Guest";

              return (
                <Fragment key={order.id}>
                  {orderIndex > 0 && <s-divider></s-divider>}

                  <s-box paddingBlockStart="small">
                    <s-grid gridTemplateColumns="1fr 1.4fr 70px 100px 100px 100px" gap="small">
                      <s-stack gap="none">
                        <s-link
                          href={`shopify://admin/orders/${shopifyNumericId(order.id)}`}
                          target="_top"
                        >
                          <s-text type="strong">{order.name}</s-text>
                        </s-link>
                        <s-text color="subdued">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </s-text>
                      </s-stack>
                      {order.customer ? (
                        <s-link
                          href={`shopify://admin/customers/${shopifyNumericId(order.customer.id)}`}
                          target="_top"
                        >
                          <s-text>{customerLabel}</s-text>
                        </s-link>
                      ) : (
                        <s-text>{customerLabel}</s-text>
                      )}
                      <s-text>{order.lineItems.length}</s-text>
                      <s-badge tone={syncTone}>{syncLabel}</s-badge>
                      <s-badge tone={invoiceTone}>{invoiceLabel}</s-badge>
                      <s-badge tone={paymentTone}>{paymentLabel}</s-badge>
                    </s-grid>
                  </s-box>
                </Fragment>
              );
            })}
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
