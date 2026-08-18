import db from "../db.server";
import { fetchZohoInvoice } from "../zoho.server";
import { fetchAllOrdersForSync } from "./orderSync.server";
import { getInvoiceMappings } from "./invoiceSync.server";
import { getPaymentMappings } from "./paymentSync.server";
import { startSyncLog, finishSyncLog } from "./syncLog.server";

// ZohoApiError's `.message` is just a generic label - the actual reason
// Zoho gave lives in `.details`.
function describeZohoError(error) {
  return error.details ? `${error.message}: ${JSON.stringify(error.details)}` : error.message;
}

// Everything below reads from `sync_logs`/`sync_mappings`, which every other
// sync feature in this app already writes to - this is deliberately not a
// new data source, just the first thing to actually read what's already
// being recorded (see the comment in syncLog.server.js: "this is what the
// (future) sync-history page will read").

// One row per entity_type, summed over the trailing window - the Sales /
// Customers / Inventory "reports" this section covers are all just this
// query grouped differently by the page (order+invoice+payment = sales,
// customer = customers, inventory = inventory).
export async function getSyncActivitySummary(shopId, { days = 30 } = {}) {
  const [rows] = await db.execute(
    `SELECT entity_type,
            COUNT(*) AS runs,
            SUM(records_processed) AS processed,
            SUM(records_success) AS success,
            SUM(records_failed) AS failed,
            MAX(COALESCE(completed_at, started_at)) AS last_run_at
     FROM sync_logs
     WHERE shop_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY entity_type`,
    [shopId, days],
  );

  return Object.fromEntries(rows.map((row) => [row.entity_type, row]));
}

export async function getRecentSyncRuns(shopId, limit = 20) {
  // mysql2's prepared statements don't reliably accept LIMIT as a bound
  // parameter - interpolated directly instead, same as
  // webhookLog.server.js's getRecentWebhookLogs, guarded by Number.isInteger
  // so this never concatenates anything other than a real integer.
  const safeLimit = Number.isInteger(limit) ? limit : 20;
  const [rows] = await db.execute(
    `SELECT * FROM sync_logs WHERE shop_id = ? ORDER BY id DESC LIMIT ${safeLimit}`,
    [shopId],
  );

  return rows;
}

const RECONCILE_EPSILON = 0.01;

// Payment reconciliation: compares each paid order's Shopify total against
// what Zoho's invoice actually shows. This is exactly the kind of check
// that would have surfaced the real order #1001 bug (Section F) sooner -
// a line item silently dropped during sync undercounted that invoice by
// $49.95, and the only reason it was ever found was a manual, one-off
// diagnostic. This makes that check a repeatable feature instead.
// Only orders whose payment sync itself already reports "synced" are
// checked - anything still mid-flight or already flagged as an error
// elsewhere doesn't need a second, redundant flag here.
// `admin` is needed for `fetchAllOrdersForSync` - Shopify's current order
// total isn't stored anywhere in this app's own DB.
export async function reconcilePayments({ shopId, admin, zohoAuth }) {
  const logId = await startSyncLog(shopId, {
    entityType: "reconciliation",
    direction: "zoho_to_shopify",
  });

  const [invoiceMappings, paymentMappings, orders] = await Promise.all([
    getInvoiceMappings(shopId),
    getPaymentMappings(shopId),
    fetchAllOrdersForSync(admin),
  ]);

  const results = [];

  for (const order of orders) {
    const payment = paymentMappings[order.id];
    if (!payment || payment.status !== "synced") continue;

    const invoice = invoiceMappings[order.id];
    if (!invoice?.zohoId) continue;

    try {
      const zohoInvoice = await fetchZohoInvoice(zohoAuth, invoice.zohoId);
      const shopifyTotal = Number(order.totalPrice) || 0;
      const zohoTotal = Number(zohoInvoice.total) || 0;

      results.push({
        orderName: order.name,
        shopifyTotal,
        zohoTotal,
        zohoBalance: Number(zohoInvoice.balance) || 0,
        status: Math.abs(shopifyTotal - zohoTotal) > RECONCILE_EPSILON ? "mismatch" : "match",
      });
    } catch (error) {
      results.push({
        orderName: order.name,
        status: "error",
        error: describeZohoError(error),
      });
    }
  }

  await finishSyncLog(logId, {
    recordsProcessed: results.length,
    recordsSuccess: results.filter((result) => result.status === "match").length,
    recordsFailed: results.filter((result) => result.status !== "match").length,
    metadata: results,
  });

  return results;
}
