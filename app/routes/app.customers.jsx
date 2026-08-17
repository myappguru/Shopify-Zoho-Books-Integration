import { Fragment } from "react";
import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { useAutoDismiss } from "../hooks/useAutoDismiss";
import {
  getConnectionForShopDomain,
  getValidAccessToken,
} from "../models/zohoConnection.server";
import {
  getCustomerMappings,
  CUSTOMERS_QUERY,
  normalizeCustomerNode,
  runCustomerSync,
} from "../models/customerSync.server";
import { getLatestSyncLog } from "../models/syncLog.server";

const PAGE_SIZE = 20;

// Shopify admin resource URLs take the plain numeric id, not the GID.
function shopifyNumericId(gid) {
  return gid ? gid.split("/").pop() : null;
}

// One page of customers for display - cursor-based, since the Admin
// GraphQL API has no concept of numbered pages, only "the 20 after this
// cursor" or "the 20 before this cursor" (same as Shopify's own admin).
async function fetchCustomersPage(admin, { after, before } = {}) {
  const variables = before
    ? { last: PAGE_SIZE, before }
    : { first: PAGE_SIZE, after: after || null };

  const response = await admin.graphql(CUSTOMERS_QUERY, { variables });
  const json = await response.json();

  return {
    customers: (json.data?.customers?.edges || []).map(({ node }) =>
      normalizeCustomerNode(node),
    ),
    pageInfo: json.data?.customers?.pageInfo || {
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

  const { customers, pageInfo } = await fetchCustomersPage(admin, {
    after,
    before,
  });
  const mappings = connection ? await getCustomerMappings(shop.id) : {};
  const latestLog = connection
    ? await getLatestSyncLog(shop.id, "customer")
    : null;

  return {
    connected: Boolean(connection),
    customers,
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
      "Failed to get a valid Zoho access token for customer sync",
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

  await runCustomerSync({ admin, shop, zohoAuth });

  return null;
};

export default function CustomersPage() {
  const { connected, customers, pageInfo, mappings, latestLog } =
    useLoaderData();
  const navigation = useNavigation();
  const isSyncing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "sync-now";
  const showLog = useAutoDismiss(latestLog?.id);

  return (
    <s-page heading="Customers">
      <s-section heading="Customer synchronization">
        {!connected ? (
          <s-paragraph>
            Connect your Zoho Books organization on the{" "}
            <s-link href="/app/settings">Settings</s-link> page before syncing
            customers.
          </s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-grid
              gridTemplateColumns="1fr auto"
              gap="base"
              alignItems="center"
            >
              <s-paragraph color="subdued">
                Pushes each Shopify customer with an email address to Zoho
                Books as a contact - creating it if it doesn&apos;t exist yet,
                or updating it (and linking to an existing Zoho contact with
                the same email) if it does.
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

      <s-section heading="Customers">
        {customers.length === 0 ? (
          <s-paragraph>No customers found in this store.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
          <s-stack gap="none" style={{ minWidth: "450px" }}>
            <s-grid gridTemplateColumns="1.6fr 1fr 130px" gap="small">
              <s-text type="strong" color="subdued">
                Name / email
              </s-text>
              <s-text type="strong" color="subdued">
                Phone
              </s-text>
              <s-text type="strong" color="subdued">
                Sync
              </s-text>
            </s-grid>

            {customers.map((customer, customerIndex) => {
              const mapping = mappings[customer.id];
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
              const fullName =
                `${customer.firstName} ${customer.lastName}`.trim() ||
                "(No name)";

              return (
                <Fragment key={customer.id}>
                  {customerIndex > 0 && <s-divider></s-divider>}

                  <s-box paddingBlockStart="small">
                    <s-grid gridTemplateColumns="1.6fr 1fr 130px" gap="small">
                      <s-stack gap="none">
                        <s-link
                          href={`shopify://admin/customers/${shopifyNumericId(customer.id)}`}
                          target="_top"
                        >
                          <s-text type="strong">{fullName}</s-text>
                        </s-link>
                        <s-text color="subdued">
                          {customer.email || "No email"}
                        </s-text>
                      </s-stack>
                      <s-text>{customer.phone || "—"}</s-text>
                      <s-badge tone={syncTone}>{syncLabel}</s-badge>
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
