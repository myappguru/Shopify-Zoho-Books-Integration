import db from "../db.server";
import {
  createZohoSalesOrder,
  updateZohoSalesOrder,
  voidZohoSalesOrder,
} from "../zoho.server";
import {
  getConnectionForShopDomain,
  getValidAccessToken,
} from "./zohoConnection.server";
import { getAppSettings } from "./appSettings.server";
import { syncVariantToZoho, getProductMappings } from "./productSync.server";
import { syncCustomerToZoho, getCustomerMappings } from "./customerSync.server";
import { recordWebhookReceived, finishWebhookLog } from "./webhookLog.server";

const ENTITY_TYPE = "order";

// ZohoApiError's `.message` is just a generic label ("Failed to update Zoho
// sales order") - the actual reason Zoho gave lives in `.details`. Folding
// it into the stored string means the real cause shows up in sync_mappings
// / sync_logs directly, instead of only being visible in server console logs.
function describeZohoError(error) {
  return error.details ? `${error.message}: ${JSON.stringify(error.details)}` : error.message;
}

export async function getOrderMappings(shopId) {
  const [rows] = await db.execute(
    `SELECT shopify_id, zoho_id, status, last_synced_at, last_error FROM sync_mappings WHERE shop_id = ? AND entity_type = ?`,
    [shopId, ENTITY_TYPE],
  );

  return Object.fromEntries(
    rows.map((row) => [
      row.shopify_id,
      {
        zohoId: row.zoho_id,
        status: row.status,
        lastSyncedAt: row.last_synced_at,
        lastError: row.last_error,
      },
    ]),
  );
}

export async function getOrderMapping(shopId, shopifyOrderId) {
  const [rows] = await db.execute(
    `SELECT shopify_id, zoho_id FROM sync_mappings WHERE shop_id = ? AND entity_type = ? AND shopify_id = ?`,
    [shopId, ENTITY_TYPE, shopifyOrderId],
  );

  return rows[0] || null;
}

export async function saveOrderMapping(shopId, shopifyOrderId, zohoSalesOrderId) {
  await db.execute(
    `INSERT INTO sync_mappings (shop_id, entity_type, shopify_id, zoho_id, status, last_synced_at, last_error)
     VALUES (?, ?, ?, ?, 'synced', NOW(), NULL)
     ON DUPLICATE KEY UPDATE zoho_id = VALUES(zoho_id), status = 'synced', last_synced_at = NOW(), last_error = NULL`,
    [shopId, ENTITY_TYPE, shopifyOrderId, zohoSalesOrderId],
  );
}

export async function markOrderMappingError(shopId, shopifyOrderId, errorMessage) {
  await db.execute(
    `UPDATE sync_mappings SET status = 'error', last_error = ? WHERE shop_id = ? AND entity_type = ? AND shopify_id = ?`,
    [errorMessage, shopId, ENTITY_TYPE, shopifyOrderId],
  );
}

export async function markOrderMappingVoided(shopId, shopifyOrderId) {
  await db.execute(
    `UPDATE sync_mappings SET status = 'voided', last_error = NULL WHERE shop_id = ? AND entity_type = ? AND shopify_id = ?`,
    [shopId, ENTITY_TYPE, shopifyOrderId],
  );
}

// An order's contact is its Shopify customer record when one exists: same
// shape customerSync.server.js expects. Guest checkouts (no linked customer
// account) still carry an email/billing address on the order itself, so a
// synthetic id ("guest:<email>") is used as the sync_mappings key - this
// keeps repeat orders from the same guest email linking to the one Zoho
// contact instead of creating a duplicate every time.
export function buildOrderCustomer(order) {
  if (order.customer) return order.customer;

  const billing = order.billingAddress || {};
  if (!order.email) return { id: null, email: null };

  return {
    id: `guest:${order.email}`,
    firstName: billing.firstName || "",
    lastName: billing.lastName || "",
    email: order.email,
    phone: order.phone || billing.phone || "",
    address: {
      address1: billing.address1 || "",
      address2: billing.address2 || "",
      city: billing.city || "",
      province: billing.province || "",
      zip: billing.zip || "",
      country: billing.country || "",
      phone: billing.phone || "",
    },
  };
}

function formatZohoDate(isoDate) {
  return (isoDate || "").slice(0, 10) || undefined;
}

function buildOrderNotes(order) {
  const parts = [];
  if (order.note) parts.push(order.note);
  if (order.discountCodes?.length) {
    parts.push(`Coupon code(s): ${order.discountCodes.join(", ")}`);
  }
  return parts.join("\n") || undefined;
}

// `lineItems` here are already-resolved { zohoItemId, quantity, price } -
// see resolveOrderLineItems. `taxSettings` is the shop's saved
// { defaultTaxId, pricesIncludeTax } from the Settings page.
export function buildZohoSalesOrderPayload(order, { customerId, lineItems, taxSettings }) {
  return {
    customer_id: customerId,
    date: formatZohoDate(order.createdAt),
    reference_number: order.name,
    is_inclusive_tax: Boolean(taxSettings?.pricesIncludeTax),
    discount: Number(order.totalDiscount) || 0,
    shipping_charge: Number(order.totalShipping) || 0,
    notes: buildOrderNotes(order),
    line_items: lineItems.map((lineItem) => ({
      item_id: lineItem.zohoItemId,
      quantity: lineItem.quantity,
      rate: Number(lineItem.price) || 0,
      ...(taxSettings?.defaultTaxId ? { tax_id: taxSettings.defaultTaxId } : {}),
    })),
  };
}

// Resolves each order line item to a Zoho item_id, auto-syncing the
// variant on the spot (via the exact same syncVariantToZoho used by
// product sync) if it hasn't been synced yet - an order shouldn't have to
// wait on someone visiting the Products page first. Line items without a
// SKU or a real variant (custom/manual line items) are skipped, same as
// product sync skips variants without a SKU.
async function resolveOrderLineItems({ shopId, zohoAuth, order, productMappings, inventoryAccountId }) {
  const resolved = [];

  for (const lineItem of order.lineItems) {
    if (!lineItem.sku || !lineItem.variantId) continue;

    const variant = {
      id: lineItem.variantId,
      title: lineItem.title,
      sku: lineItem.sku,
      price: lineItem.price,
    };
    const product = {
      id: lineItem.productId || null,
      title: lineItem.title,
      status: "ACTIVE",
      description: "",
    };

    const result = await syncVariantToZoho({
      shopId,
      zohoAuth,
      product,
      variant,
      mappings: productMappings,
      inventoryAccountId,
    });

    if (result.status === "success") {
      resolved.push({
        zohoItemId: result.zohoItemId,
        quantity: lineItem.quantity,
        price: lineItem.price,
      });
    }
  }

  return resolved;
}

// `order` is { id, name, createdAt, email, phone, customer, billingAddress,
// lineItems: [{ variantId, productId, sku, title, quantity, price }],
// totalDiscount, totalShipping, totalTax, note, discountCodes } - the same
// shape whether it came from the Admin GraphQL orders query or was
// normalized from a REST webhook payload.
export async function syncOrderToZoho({
  shopId,
  zohoAuth,
  order,
  taxSettings,
  productMappings,
  customerMappings,
  orderMappings,
  inventoryAccountId,
}) {
  const customer = buildOrderCustomer(order);
  if (!customer.email) {
    return { orderName: order.name, status: "skipped" };
  }

  const customerResult = await syncCustomerToZoho({
    shopId,
    zohoAuth,
    customer,
    mappings: customerMappings,
  });
  if (customerResult.status === "error") {
    await markOrderMappingError(shopId, order.id, `Customer sync failed: ${customerResult.error}`);
    return { orderName: order.name, status: "error", error: `customer: ${customerResult.error}` };
  }

  const lineItems = await resolveOrderLineItems({
    shopId,
    zohoAuth,
    order,
    productMappings,
    inventoryAccountId,
  });
  if (lineItems.length === 0) {
    return { orderName: order.name, status: "skipped" };
  }

  const payload = buildZohoSalesOrderPayload(order, {
    customerId: customerResult.zohoContactId,
    lineItems,
    taxSettings,
  });
  const existingMapping = orderMappings[order.id];

  try {
    let zohoSalesOrderId = existingMapping?.zohoId;

    if (zohoSalesOrderId) {
      await updateZohoSalesOrder(zohoAuth, zohoSalesOrderId, payload);
    } else {
      const created = await createZohoSalesOrder(zohoAuth, payload);
      zohoSalesOrderId = created.salesorder_id;
    }

    await saveOrderMapping(shopId, order.id, zohoSalesOrderId);

    return { orderName: order.name, zohoSalesOrderId, status: "success" };
  } catch (error) {
    // Zoho locks a sales order's line items from further edits once it's
    // been invoiced (error 36023) - that's an expected terminal state once
    // Section E has run, not a real sync failure, so the existing mapping
    // is left as-is (still "synced") rather than overwritten with "error".
    if (existingMapping?.zohoId && error.details?.code === 36023) {
      await saveOrderMapping(shopId, order.id, existingMapping.zohoId);
      return { orderName: order.name, zohoSalesOrderId: existingMapping.zohoId, status: "success" };
    }

    console.error("Failed to sync order to Zoho", order.name, error);
    const description = describeZohoError(error);
    await markOrderMappingError(shopId, order.id, description);

    return { orderName: order.name, status: "error", error: description };
  }
}

// Shopify's orders/create and orders/updated webhooks deliver the classic
// REST-shaped order resource - normalize it to the same shape the
// GraphQL-based bulk sync uses. Variant/product GIDs aren't present on REST
// line items (only their numeric ids), but Shopify's GID format is
// deterministic, so they're rebuilt the same way products/delete's webhook
// rebuilds a product GID from a bare numeric id.
export function normalizeRestOrder(payload) {
  const billing = payload.billing_address || {};

  return {
    id: payload.admin_graphql_api_id,
    name: payload.name,
    createdAt: payload.created_at,
    updatedAt: payload.updated_at || payload.created_at,
    email: payload.email || payload.contact_email || null,
    phone: payload.phone || null,
    totalPrice: payload.total_price,
    paymentGatewayNames: payload.payment_gateway_names || [],
    customer: payload.customer
      ? {
          id: payload.customer.admin_graphql_api_id,
          firstName: payload.customer.first_name || "",
          lastName: payload.customer.last_name || "",
          email: payload.customer.email || payload.email || "",
          phone: payload.customer.phone || payload.phone || "",
          address: {
            address1: billing.address1 || "",
            address2: billing.address2 || "",
            city: billing.city || "",
            province: billing.province || "",
            zip: billing.zip || "",
            country: billing.country || "",
            phone: billing.phone || "",
          },
        }
      : null,
    billingAddress: {
      firstName: billing.first_name || "",
      lastName: billing.last_name || "",
      address1: billing.address1 || "",
      address2: billing.address2 || "",
      city: billing.city || "",
      province: billing.province || "",
      zip: billing.zip || "",
      country: billing.country || "",
      phone: billing.phone || "",
    },
    lineItems: (payload.line_items || []).map((lineItem) => ({
      variantId: lineItem.variant_id
        ? `gid://shopify/ProductVariant/${lineItem.variant_id}`
        : null,
      productId: lineItem.product_id
        ? `gid://shopify/Product/${lineItem.product_id}`
        : null,
      sku: lineItem.sku,
      title: lineItem.title,
      quantity: lineItem.quantity,
      price: lineItem.price,
    })),
    totalDiscount: payload.total_discounts,
    totalShipping:
      payload.total_shipping_price_set?.shop_money?.amount ||
      (payload.shipping_lines || []).reduce(
        (sum, line) => sum + Number(line.price || 0),
        0,
      ),
    totalTax: payload.total_tax,
    note: payload.note || "",
    discountCodes: (payload.discount_codes || []).map((entry) => entry.code),
  };
}

// Shared body for the orders/create and orders/updated webhook routes -
// always resolves (never throws) so the route can respond 200 to Shopify
// regardless of what happened internally; failures are recorded in
// webhook_logs instead of surfacing as a delivery failure.
export async function processOrderUpsertWebhook({
  shop: shopDomain,
  topic,
  webhookId,
  payload,
}) {
  const { shop, connection } = await getConnectionForShopDomain(shopDomain);

  const logId = await recordWebhookReceived(shop.id, {
    webhookId,
    topic,
    shopDomain,
    resourceId: payload.admin_graphql_api_id,
    payload,
  });

  if (!logId) return; // Duplicate delivery of a webhook we've already processed.

  if (!connection) {
    await finishWebhookLog(logId, {
      status: "skipped",
      errorMessage: "Zoho Books is not connected for this shop",
    });
    return;
  }

  try {
    const token = await getValidAccessToken(shop.id);
    if (!token) throw new Error("No valid Zoho access token");

    const zohoAuth = {
      accessToken: token.accessToken,
      apiDomain: token.apiDomain,
      organizationId: connection.organization_id,
    };
    const order = normalizeRestOrder(payload);
    const appSettings = await getAppSettings(shop.id);
    const [productMappings, customerMappings, orderMappings] = await Promise.all([
      getProductMappings(shop.id),
      getCustomerMappings(shop.id),
      getOrderMappings(shop.id),
    ]);

    const result = await syncOrderToZoho({
      shopId: shop.id,
      zohoAuth,
      order,
      taxSettings: appSettings.taxSettings || {},
      productMappings,
      customerMappings,
      orderMappings,
      inventoryAccountId: appSettings.accountSettings?.inventoryAccountId,
    });

    await finishWebhookLog(logId, {
      status: result.status === "error" ? "failed" : "processed",
      errorMessage: result.status === "error" ? result.error : null,
    });
  } catch (error) {
    console.error("Failed to process order webhook", topic, error);
    await finishWebhookLog(logId, {
      status: "failed",
      errorMessage: error.message,
    });
  }
}

// Cancelling a Shopify order doesn't delete it, so the matching Zoho sales
// order is voided (not deleted) - this keeps the record for accounting
// purposes while marking it inactive. The mapping row is kept (status
// "voided") rather than removed, unlike product/customer deletion, since
// the Shopify order itself still exists.
export async function syncOrderCancellationToZoho({ shopId, zohoAuth, shopifyOrderId }) {
  const mapping = await getOrderMapping(shopId, shopifyOrderId);
  if (!mapping) return { status: "skipped" };

  try {
    await voidZohoSalesOrder(zohoAuth, mapping.zoho_id);
    await markOrderMappingVoided(shopId, shopifyOrderId);
    return { zohoSalesOrderId: mapping.zoho_id, status: "voided" };
  } catch (error) {
    console.error("Failed to void Zoho sales order for cancelled order", mapping.zoho_id, error);
    const description = describeZohoError(error);
    await markOrderMappingError(shopId, shopifyOrderId, description);
    return { zohoSalesOrderId: mapping.zoho_id, status: "error", error: description };
  }
}
