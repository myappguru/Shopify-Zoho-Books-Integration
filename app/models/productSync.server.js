import db from "../db.server";
import {
  fetchZohoItemBySku,
  createZohoItem,
  updateZohoItem,
  setZohoItemActiveStatus,
  deleteZohoItem,
} from "../zoho.server";
import {
  getConnectionForShopDomain,
  getValidAccessToken,
} from "./zohoConnection.server";
import { recordWebhookReceived, finishWebhookLog } from "./webhookLog.server";
import { getAppSettings } from "./appSettings.server";

const ENTITY_TYPE = "product";

export async function getProductMappings(shopId) {
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

// Called after a successful create/update/link against Zoho - a mapping
// row can only exist once we actually have a zoho_id (the column is
// NOT NULL), so a variant that has never synced successfully has no row
// here at all until its first success. `shopifyParentId` (the product's
// GID) is stored so a later products/delete webhook - which only gives us
// the product's id, none of its variants' - can still find every mapping
// row that belongs to it.
export async function saveProductMapping(
  shopId,
  shopifyVariantId,
  zohoItemId,
  shopifyParentId,
) {
  await db.execute(
    `INSERT INTO sync_mappings (shop_id, entity_type, shopify_id, shopify_parent_id, zoho_id, status, last_synced_at, last_error)
     VALUES (?, ?, ?, ?, ?, 'synced', NOW(), NULL)
     ON DUPLICATE KEY UPDATE zoho_id = VALUES(zoho_id), shopify_parent_id = VALUES(shopify_parent_id), status = 'synced', last_synced_at = NOW(), last_error = NULL`,
    [
      shopId,
      ENTITY_TYPE,
      shopifyVariantId,
      shopifyParentId || null,
      zohoItemId,
    ],
  );
}

// Records a failure against an already-mapped variant (re-sync of an
// existing item failed). A no-op if the variant never mapped successfully
// in the first place - that failure lives only in the sync_logs run entry.
export async function markProductMappingError(
  shopId,
  shopifyVariantId,
  errorMessage,
) {
  await db.execute(
    `UPDATE sync_mappings SET status = 'error', last_error = ? WHERE shop_id = ? AND entity_type = ? AND shopify_id = ?`,
    [errorMessage, shopId, ENTITY_TYPE, shopifyVariantId],
  );
}

export async function getProductMappingsByParentId(shopId, shopifyParentId) {
  const [rows] = await db.execute(
    `SELECT shopify_id, zoho_id FROM sync_mappings WHERE shop_id = ? AND entity_type = ? AND shopify_parent_id = ?`,
    [shopId, ENTITY_TYPE, shopifyParentId],
  );

  return rows;
}

export async function deleteProductMapping(shopId, shopifyVariantId) {
  await db.execute(
    `DELETE FROM sync_mappings WHERE shop_id = ? AND entity_type = ? AND shopify_id = ?`,
    [shopId, ENTITY_TYPE, shopifyVariantId],
  );
}

// Shared by the manual "Sync now" bulk action and the products webhooks -
// one source of truth for "how do we turn a Shopify product+variant into a
// Zoho Inventory item" so the two call sites can't drift out of sync.
//
// `inventoryAccountId` is optional - it's the Settings page's "Inventory
// account" (Section G, Inventory Synchronization). Without it, items are
// left untracked, same as before Section G existed: explicitly passing
// `track_inventory: false` (or `true` with no `inventory_account_id`)
// trips up Zoho's validation with a misleading "invalid Product Type"
// error (code 700029) - confirmed by testing directly against the API -
// so the field is omitted entirely unless a real account id is available.
export function buildZohoItemPayload(product, variant, { inventoryAccountId } = {}) {
  const name =
    variant.title && variant.title !== "Default Title"
      ? `${product.title} - ${variant.title}`
      : product.title;

  return {
    name,
    sku: variant.sku,
    rate: Number(variant.price) || 0,
    description: product.description || "",
    item_type: "inventory",
    product_type: "goods",
    ...(inventoryAccountId
      ? { track_inventory: true, inventory_account_id: inventoryAccountId }
      : {}),
  };
}

// `product` is { id, title, status, description, variants: [...] } and
// `variant` is { id, title, sku, price } - the same shape whether it came
// from the Admin GraphQL products query or was normalized from a REST
// webhook payload (see the products.create/update webhook routes).
export async function syncVariantToZoho({
  shopId,
  zohoAuth,
  product,
  variant,
  mappings,
  inventoryAccountId,
}) {
  if (!variant.sku) {
    return { sku: variant.sku, status: "skipped" };
  }

  const payload = buildZohoItemPayload(product, variant, { inventoryAccountId });
  const existingMapping = mappings[variant.id];

  try {
    let zohoItemId = existingMapping?.zohoId;

    if (zohoItemId) {
      await updateZohoItem(zohoAuth, zohoItemId, payload);
    } else {
      const existingItem = await fetchZohoItemBySku({
        ...zohoAuth,
        sku: variant.sku,
      });
      if (existingItem) {
        zohoItemId = existingItem.item_id;
        await updateZohoItem(zohoAuth, zohoItemId, payload);
      } else {
        const created = await createZohoItem(zohoAuth, payload);
        zohoItemId = created.item_id;
      }
    }

    await setZohoItemActiveStatus(
      zohoAuth,
      zohoItemId,
      product.status === "ACTIVE",
    );
    await saveProductMapping(shopId, variant.id, zohoItemId, product.id);

    return { sku: variant.sku, zohoItemId, status: "success" };
  } catch (error) {
    console.error("Failed to sync product variant to Zoho", variant.sku, error);
    await markProductMappingError(shopId, variant.id, error.message);

    return { sku: variant.sku, status: "error", error: error.message };
  }
}

export async function syncProductToZoho({
  shopId,
  zohoAuth,
  product,
  mappings,
  inventoryAccountId,
}) {
  const results = [];

  for (const variant of product.variants) {
    results.push(
      await syncVariantToZoho({
        shopId,
        zohoAuth,
        product,
        variant,
        mappings,
        inventoryAccountId,
      }),
    );
  }

  return results;
}

// Shopify's products/create and products/update webhooks deliver the
// classic REST-shaped product resource, not the GraphQL shape the Admin
// GraphQL products query returns - normalize it to the same
// { id, title, status, description, variants: [...] } shape so both
// call sites can share syncProductToZoho/syncVariantToZoho unchanged.
// `admin_graphql_api_id` is what lines up with the GIDs already stored in
// sync_mappings from GraphQL-based syncs.
export function normalizeRestProduct(payload) {
  return {
    id: payload.admin_graphql_api_id,
    title: payload.title,
    status: (payload.status || "").toUpperCase(),
    description: (payload.body_html || "").replace(/<[^>]*>/g, "").trim(),
    variants: (payload.variants || []).map((variant) => ({
      id: variant.admin_graphql_api_id,
      title: variant.title,
      sku: variant.sku,
      price: variant.price,
    })),
  };
}

// Shared body for the products/create and products/update webhook routes -
// they only differ in which Shopify topic triggered them. Always resolves
// (never throws) so the route can respond 200 to Shopify regardless of
// what happened internally; failures are recorded in webhook_logs instead
// of surfacing as a webhook delivery failure (which would make Shopify
// retry and eventually disable the subscription).
export async function processProductUpsertWebhook({
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
    const product = normalizeRestProduct(payload);
    const mappings = await getProductMappings(shop.id);
    const appSettings = await getAppSettings(shop.id);

    const results = await syncProductToZoho({
      shopId: shop.id,
      zohoAuth,
      product,
      mappings,
      inventoryAccountId: appSettings.accountSettings?.inventoryAccountId,
    });
    const failed = results.filter((result) => result.status === "error");

    await finishWebhookLog(logId, {
      status: failed.length > 0 ? "failed" : "processed",
      errorMessage:
        failed.length > 0
          ? failed.map((result) => `${result.sku}: ${result.error}`).join("; ")
          : null,
    });
  } catch (error) {
    console.error("Failed to process product webhook", topic, error);
    await finishWebhookLog(logId, {
      status: "failed",
      errorMessage: error.message,
    });
  }
}

// For each Zoho item mapped to this (now-deleted) Shopify product: try a
// hard delete first, but Zoho refuses to delete an item that's been used
// in any transaction (invoice, bill, etc.) - so fall back to deactivating
// it instead, which preserves that transaction history. The mapping row
// is removed either way (the Shopify side is gone regardless); if BOTH
// the delete and the deactivate attempt fail, the row is kept with
// status "error" instead, so the failure stays visible rather than
// silently vanishing.
export async function syncProductDeletionToZoho({
  shopId,
  zohoAuth,
  shopifyProductId,
}) {
  const mappings = await getProductMappingsByParentId(shopId, shopifyProductId);
  const results = [];

  for (const mapping of mappings) {
    try {
      await deleteZohoItem(zohoAuth, mapping.zoho_id);
      await deleteProductMapping(shopId, mapping.shopify_id);
      results.push({ zohoItemId: mapping.zoho_id, status: "deleted" });
    } catch (deleteError) {
      try {
        await setZohoItemActiveStatus(zohoAuth, mapping.zoho_id, false);
        await deleteProductMapping(shopId, mapping.shopify_id);
        results.push({ zohoItemId: mapping.zoho_id, status: "deactivated" });
      } catch (deactivateError) {
        console.error(
          "Failed to delete or deactivate Zoho item for deleted product",
          mapping.zoho_id,
          deactivateError,
        );
        await markProductMappingError(
          shopId,
          mapping.shopify_id,
          deactivateError.message,
        );
        results.push({
          zohoItemId: mapping.zoho_id,
          status: "error",
          error: deactivateError.message,
        });
      }
    }
  }

  return results;
}
