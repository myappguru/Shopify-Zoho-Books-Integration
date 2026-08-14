import { Fragment } from "react";
import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { useAutoDismiss } from "../hooks/useAutoDismiss";
import {
  getConnectionForShopDomain,
  getValidAccessToken,
} from "../models/zohoConnection.server";
import { getAppSettings } from "../models/appSettings.server";
import { getProductMappings } from "../models/productSync.server";
import { getCustomerMappings } from "../models/customerSync.server";
import {
  getOrderMappings,
  syncOrderToZoho,
} from "../models/orderSync.server";
import { getInvoiceMappings } from "../models/invoiceSync.server";
import {
  getPaymentMappings,
  syncInvoiceAndPaymentForOrder,
} from "../models/paymentSync.server";
import {
  startSyncLog,
  finishSyncLog,
  getLatestSyncLog,
} from "../models/syncLog.server";

const PAGE_SIZE = 20;

// Shopify admin resource URLs take the plain numeric id, not the GID.
function shopifyNumericId(gid) {
  return gid ? gid.split("/").pop() : null;
}

const ORDERS_QUERY = `#graphql
  query SyncableOrders($first: Int, $after: String, $last: Int, $before: String) {
    orders(first: $first, after: $after, last: $last, before: $before, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          updatedAt
          email
          phone
          displayFinancialStatus
          totalPriceSet {
            shopMoney {
              amount
            }
          }
          paymentGatewayNames
          customer {
            id
            firstName
            lastName
            email
            phone
            defaultAddress {
              address1
              address2
              city
              province
              zip
              country
              phone
            }
          }
          billingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            zip
            country
            phone
          }
          lineItems(first: 50) {
            edges {
              node {
                title
                sku
                quantity
                variant {
                  id
                  product {
                    id
                  }
                }
                originalUnitPriceSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
          totalDiscountsSet {
            shopMoney {
              amount
            }
          }
          totalShippingPriceSet {
            shopMoney {
              amount
            }
          }
          totalTaxSet {
            shopMoney {
              amount
            }
          }
          note
          discountCodes
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

function normalizeOrderNode(node) {
  const address = node.customer?.defaultAddress || {};

  return {
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    email: node.email || null,
    phone: node.phone || null,
    financialStatus: node.displayFinancialStatus || null,
    totalPrice: node.totalPriceSet?.shopMoney?.amount,
    paymentGatewayNames: node.paymentGatewayNames || [],
    customer: node.customer
      ? {
          id: node.customer.id,
          firstName: node.customer.firstName || "",
          lastName: node.customer.lastName || "",
          email: node.customer.email || node.email || "",
          phone: node.customer.phone || node.phone || "",
          address: {
            address1: address.address1 || "",
            address2: address.address2 || "",
            city: address.city || "",
            province: address.province || "",
            zip: address.zip || "",
            country: address.country || "",
            phone: address.phone || "",
          },
        }
      : null,
    billingAddress: {
      firstName: node.billingAddress?.firstName || "",
      lastName: node.billingAddress?.lastName || "",
      address1: node.billingAddress?.address1 || "",
      address2: node.billingAddress?.address2 || "",
      city: node.billingAddress?.city || "",
      province: node.billingAddress?.province || "",
      zip: node.billingAddress?.zip || "",
      country: node.billingAddress?.country || "",
      phone: node.billingAddress?.phone || "",
    },
    lineItems: (node.lineItems?.edges || []).map(({ node: lineItem }) => ({
      variantId: lineItem.variant?.id || null,
      productId: lineItem.variant?.product?.id || null,
      sku: lineItem.sku,
      title: lineItem.title,
      quantity: lineItem.quantity,
      price: lineItem.originalUnitPriceSet?.shopMoney?.amount,
    })),
    totalDiscount: node.totalDiscountsSet?.shopMoney?.amount,
    totalShipping: node.totalShippingPriceSet?.shopMoney?.amount,
    totalTax: node.totalTaxSet?.shopMoney?.amount,
    note: node.note || "",
    discountCodes: node.discountCodes || [],
  };
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

// The "Sync now" action has to cover the whole order list regardless of how
// many orders the page happens to be displaying - so it pages through
// everything itself (250 at a time, the API max) rather than reusing
// fetchOrdersPage.
async function fetchAllOrdersForSync(admin) {
  const allOrders = [];
  let after = null;

  for (;;) {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { first: 250, after },
    });
    const json = await response.json();
    const edges = json.data?.orders?.edges || [];

    allOrders.push(...edges.map(({ node }) => normalizeOrderNode(node)));

    const pageInfo = json.data?.orders?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  return allOrders;
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

  const logId = await startSyncLog(shop.id, {
    entityType: "order",
    direction: "shopify_to_zoho",
  });

  const appSettings = await getAppSettings(shop.id);
  const orders = await fetchAllOrdersForSync(admin);
  const [productMappings, customerMappings, orderMappings] = await Promise.all([
    getProductMappings(shop.id),
    getCustomerMappings(shop.id),
    getOrderMappings(shop.id),
  ]);

  const inventoryAccountId = appSettings.accountSettings?.inventoryAccountId;

  const results = [];
  for (const order of orders) {
    results.push(
      await syncOrderToZoho({
        shopId: shop.id,
        zohoAuth,
        order,
        taxSettings: appSettings.taxSettings || {},
        productMappings,
        customerMappings,
        orderMappings,
        inventoryAccountId,
      }),
    );
  }

  const attempted = results.filter((result) => result.status !== "skipped");

  await finishSyncLog(logId, {
    recordsProcessed: attempted.length,
    recordsSuccess: attempted.filter((result) => result.status === "success").length,
    recordsFailed: attempted.filter((result) => result.status === "error").length,
    metadata: attempted,
  });

  // Backfill invoices + payments for already-paid orders that don't have
  // them yet - covers orders paid before Zoho was connected, or before the
  // orders/paid webhook existed, since Shopify never replays past webhook
  // events for a new subscription. Re-fetch order mappings fresh (rather
  // than reusing the snapshot above) since the sales-order loop just above
  // may have just created brand new ones - reusing the stale snapshot
  // would make syncInvoiceForOrder think those orders still need a sales
  // order and create a duplicate one.
  const invoiceLogId = await startSyncLog(shop.id, {
    entityType: "invoice",
    direction: "shopify_to_zoho",
  });
  const paymentLogId = await startSyncLog(shop.id, {
    entityType: "payment",
    direction: "shopify_to_zoho",
  });

  const freshOrderMappings = await getOrderMappings(shop.id);
  const paidOrders = orders.filter((order) => order.financialStatus === "PAID");

  const invoiceResults = [];
  const paymentResults = [];
  for (const order of paidOrders) {
    const { invoice, payment } = await syncInvoiceAndPaymentForOrder({
      shopId: shop.id,
      zohoAuth,
      order,
      taxSettings: appSettings.taxSettings || {},
      accountSettings: appSettings.accountSettings || {},
      productMappings,
      customerMappings,
      orderMappings: freshOrderMappings,
    });
    invoiceResults.push(invoice);
    if (payment) paymentResults.push(payment);
  }

  const invoiceAttempted = invoiceResults.filter((result) => result.status !== "skipped");
  const paymentAttempted = paymentResults.filter((result) => result.status !== "skipped");

  await finishSyncLog(invoiceLogId, {
    recordsProcessed: invoiceAttempted.length,
    recordsSuccess: invoiceAttempted.filter((result) => result.status === "success").length,
    recordsFailed: invoiceAttempted.filter((result) => result.status === "error").length,
    metadata: invoiceAttempted,
  });
  await finishSyncLog(paymentLogId, {
    recordsProcessed: paymentAttempted.length,
    recordsSuccess: paymentAttempted.filter((result) => result.status === "success").length,
    recordsFailed: paymentAttempted.filter((result) => result.status === "error").length,
    metadata: paymentAttempted,
  });

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
