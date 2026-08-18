import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getConnectionForShopDomain,
  getValidAccessToken,
} from "../models/zohoConnection.server";
import {
  getSyncActivitySummary,
  getRecentSyncRuns,
  reconcilePayments,
} from "../models/reportingSync.server";
import { getLatestSyncLog } from "../models/syncLog.server";
import { getSyncedWebhookCount } from "../models/webhookLog.server";

// Which sync_logs.entity_type rows count toward each report card - grouping
// here (not in the SQL) keeps getSyncActivitySummary a reusable, ungrouped
// aggregate rather than baking this page's specific categories into it.
// Fulfillments and refunds deliberately aren't included here - they're
// purely webhook-driven, one order at a time, with no manual "Sync now"
// batch run to write a sync_logs row (same reason inventory's live
// Shopify→Zoho push doesn't appear in sync_logs either, only its manual
// Zoho→Shopify pull does) - their activity is surfaced separately below
// via webhook_logs instead, so they don't just silently read as "0 runs".
const REPORT_GROUPS = [
  { key: "sales", label: "Sales", entityTypes: ["order", "invoice", "payment"] },
  { key: "customers", label: "Customers", entityTypes: ["customer"] },
  { key: "inventory", label: "Inventory", entityTypes: ["inventory"] },
];

function sumGroup(summary, entityTypes) {
  return entityTypes.reduce(
    (totals, entityType) => {
      const row = summary[entityType];
      if (!row) return totals;

      return {
        runs: totals.runs + Number(row.runs || 0),
        processed: totals.processed + Number(row.processed || 0),
        success: totals.success + Number(row.success || 0),
        failed: totals.failed + Number(row.failed || 0),
        lastRunAt:
          !totals.lastRunAt || (row.last_run_at && row.last_run_at > totals.lastRunAt)
            ? row.last_run_at
            : totals.lastRunAt,
      };
    },
    { runs: 0, processed: 0, success: 0, failed: 0, lastRunAt: null },
  );
}

function parseMetadata(log) {
  if (!log?.metadata) return [];
  return typeof log.metadata === "string" ? JSON.parse(log.metadata) : log.metadata;
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { shop, connection } = await getConnectionForShopDomain(session.shop);

  const activitySummary = connection ? await getSyncActivitySummary(shop.id) : {};
  const recentRuns = connection ? await getRecentSyncRuns(shop.id, 20) : [];
  const latestReconciliationLog = connection
    ? await getLatestSyncLog(shop.id, "reconciliation")
    : null;
  const [fulfillmentCount, refundCount] = connection
    ? await Promise.all([
        getSyncedWebhookCount(shop.id, "FULFILLMENTS_CREATE"),
        getSyncedWebhookCount(shop.id, "REFUNDS_CREATE"),
      ])
    : [0, 0];

  return {
    connected: Boolean(connection),
    reportGroups: REPORT_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      ...sumGroup(activitySummary, group.entityTypes),
    })),
    fulfillmentCount,
    refundCount,
    recentRuns,
    latestReconciliationLog,
    reconciliationResults: parseMetadata(latestReconciliationLog),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("intent") !== "run-reconciliation") return null;

  const { shop, connection } = await getConnectionForShopDomain(session.shop);
  if (!connection) return null;

  const token = await getValidAccessToken(shop.id).catch((error) => {
    console.error("Failed to get a valid Zoho access token for reconciliation", error);
    return null;
  });
  if (!token) return null;

  const zohoAuth = {
    accessToken: token.accessToken,
    apiDomain: token.apiDomain,
    organizationId: connection.organization_id,
  };

  await reconcilePayments({ shopId: shop.id, admin, zohoAuth });

  return null;
};

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "Never run";
}

// eslint-disable-next-line react/prop-types -- this codebase doesn't use PropTypes anywhere else
function ReportCard({ label, runs, processed, success, failed, lastRunAt }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" minInlineSize="220px">
      <s-stack gap="small">
        <s-text type="strong">{label}</s-text>

        {runs === 0 ? (
          <s-text tone="caution">No sync runs yet</s-text>
        ) : (
          <s-stack gap="small-100">
            <s-text>
              {processed} processed, {success} succeeded, {failed} failed
            </s-text>
            <s-text color="subdued">
              {runs} run{runs === 1 ? "" : "s"} in the last 30 days · last{" "}
              {formatDateTime(lastRunAt)}
            </s-text>
          </s-stack>
        )}
      </s-stack>
    </s-box>
  );
}

const RECONCILE_STATUS_TONE = {
  match: "success",
  mismatch: "critical",
  error: "warning",
};

export default function SyncHistoryPage() {
  const {
    connected,
    reportGroups,
    fulfillmentCount,
    refundCount,
    recentRuns,
    latestReconciliationLog,
    reconciliationResults,
  } = useLoaderData();
  const navigation = useNavigation();
  const isReconciling =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "run-reconciliation";

  const mismatches = reconciliationResults.filter((result) => result.status !== "match");

  return (
    <s-page heading="Reporting">
      {!connected ? (
        <s-section>
          <s-paragraph>
            Connect your Zoho Books organization on the{" "}
            <s-link href="/app/settings">Settings</s-link> page to see sync
            reports here.
          </s-paragraph>
        </s-section>
      ) : (
        <>
          <s-section heading="Sync reports">
            <s-paragraph color="subdued">
              Activity over the last 30 days, drawn from every sync run this
              app has logged.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              {reportGroups.map((group) => (
                <ReportCard key={group.key} {...group} />
              ))}
            </s-stack>

            <s-text color="subdued">
              Also, all-time: {fulfillmentCount} fulfillment{fulfillmentCount === 1 ? "" : "s"} and{" "}
              {refundCount} refund{refundCount === 1 ? "" : "s"} synced to Zoho (via webhook, not
              counted in the 30-day totals above).
            </s-text>
          </s-section>

          <s-section heading="Payment reconciliation">
            <s-stack gap="base">
              <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                <s-paragraph color="subdued">
                  Compares each order&apos;s Shopify total against what Zoho&apos;s
                  invoice actually shows, for every order whose payment has
                  already synced - catches a sales order line item that got
                  silently dropped during sync before it becomes a real
                  accounting discrepancy.
                </s-paragraph>

                <Form method="post">
                  <input type="hidden" name="intent" value="run-reconciliation" />
                  <s-button variant="primary" type="submit" icon="refresh" loading={isReconciling}>
                    Run reconciliation
                  </s-button>
                </Form>
              </s-grid>

              {latestReconciliationLog && (
                <s-banner
                  heading="Last reconciliation run"
                  tone={mismatches.length > 0 ? "warning" : "success"}
                >
                  {formatDateTime(
                    latestReconciliationLog.completed_at || latestReconciliationLog.started_at,
                  )}{" "}
                  — {reconciliationResults.length} order
                  {reconciliationResults.length === 1 ? "" : "s"} checked,{" "}
                  {mismatches.length} mismatch{mismatches.length === 1 ? "" : "es"}
                </s-banner>
              )}

              {mismatches.length > 0 && (
                <s-stack gap="small">
                  {mismatches.map((result) => (
                    <s-box
                      key={result.orderName}
                      padding="small-300"
                      border="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <s-stack direction="inline" gap="small" alignItems="center">
                        <s-badge tone={RECONCILE_STATUS_TONE[result.status] || "info"}>
                          {result.status}
                        </s-badge>
                        <s-text type="strong">{result.orderName}</s-text>
                        {result.status === "error" ? (
                          <s-text tone="critical">{result.error}</s-text>
                        ) : (
                          <s-text>
                            Shopify: {result.shopifyTotal} · Zoho invoice total:{" "}
                            {result.zohoTotal} · balance: {result.zohoBalance}
                          </s-text>
                        )}
                      </s-stack>
                    </s-box>
                  ))}
                </s-stack>
              )}
            </s-stack>
          </s-section>

          <s-section heading="Recent sync runs">
            {recentRuns.length === 0 ? (
              <s-paragraph color="subdued">No sync runs recorded yet.</s-paragraph>
            ) : (
              <s-stack gap="small">
                {recentRuns.map((run) => (
                  <s-stack key={run.id} direction="inline" gap="small" alignItems="center">
                    <s-badge tone={run.records_failed > 0 ? "warning" : "success"}>
                      {run.entity_type}
                    </s-badge>
                    <s-text color="subdued">
                      {formatDateTime(run.completed_at || run.started_at)}
                    </s-text>
                    <s-text>
                      {run.records_processed} processed, {run.records_success} succeeded,{" "}
                      {run.records_failed} failed
                    </s-text>
                  </s-stack>
                ))}
              </s-stack>
            )}
          </s-section>
        </>
      )}
    </s-page>
  );
}
