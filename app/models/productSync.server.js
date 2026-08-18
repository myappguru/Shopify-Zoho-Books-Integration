import db from "../db.server";
import {
  fetchZohoItemBySku,
  createZohoItem,
  updateZohoItem,
  setZohoItemActiveStatus,
  deleteZohoItem,
} from "../zoho.server";
import { getAppSettings } from "./appSettings.server";
import { getConnectionForShopDomain, getValidAccessToken } from "./zohoConnection.server";
import { recordWebhookReceived, finishWebhookLog } from "./webhookLog.server";
import { startSyncLog, finishSyncLog } from "./syncLog.server";

const ENTITY_TYPE = "product";

function describeZohoError(error) {
  return error.details ? `${error.message}: ${JSON.stringify(error.details)}` : error.message;
}

export async function getSyncedProductCount(shopId) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS count FROM sync_mappings WHERE shop_id = ? AND entity_type = ? AND status = 'synced'`,
    [shopId, ENTITY_TYPE],
  );
  return rows[0]?.count || 0;
}

export async function getProductMappings(shopId) {
  const [rows] = await db.execute(
    `SELECT shopify_id, zoho_id, status, last_synced_at, last_error FROM sync_mappings WHERE shop_id = ? AND entity_type = ?`,
    [shopId, ENTITY_TYPE],
  );
  return Object.fromEntries(rows.map((row) => [row.shopify_id, {
    zohoId: row.zoho_id,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
  }]));
}

export async function saveProductMapping(shopId, shopifyVariantId, zohoItemId, shopifyParentId) {
  await db.execute(
    `INSERT INTO sync_mappings (shop_id, entity_type, shopify_id, shopify_parent_id, zoho_id, status, last_synced_at, last_error)
     VALUES (?, ?, ?, ?, ?, 'synced', NOW(), NULL)
     ON DUPLICATE KEY UPDATE zoho_id = VALUES(zoho_id), shopify_parent_id = VALUES(shopify_parent_id), status = 'synced', last_synced_at = NOW(), last_error = NULL`,
    [shopId, ENTITY_TYPE, shopifyVariantId, shopifyParentId || null, zohoItemId],
  );
}

export async function markProductMappingError(shopId, shopifyVariantId, errorMessage) {
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

export function buildZohoItemPayload(product, variant, { inventoryAccountId } = {}) {
  const name = variant.title && variant.title !== "Default Title" ? `${product.title} - ${variant.title}` : product.title;
  return {
    name,
    sku: variant.sku,
    rate: Number(variant.price) || 0,
    description: product.description || "",
    item_type: "inventory",
    product_type: "goods",
    ...(inventoryAccountId ? { track_inventory: true, inventory_account_id: inventoryAccountId } : {}),
  };
}

const SET_VARIANT_INVENTORY_POLICY_MUTATION = `#graphql
  mutation SetVariantInventoryPolicy($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`;

async function denyOversellForVariant(admin, product, variant) {
  if (!admin || !product?.id) return;
  const response = await admin.graphql(SET_VARIANT_INVENTORY_POLICY_MUTATION, {
    variables: { productId: product.id, variants: [{ id: variant.id, inventoryPolicy: "DENY" }] },
  });
  const json = await response.json();
  const userErrors = json.data?.productVariantsBulkUpdate?.userErrors || [];
  if (userErrors.length > 0) console.error("Failed to set inventoryPolicy=DENY for variant", variant.id, userErrors);
}

export async function syncVariantToZoho({ shopId, admin, zohoAuth, product, variant, mappings, inventoryAccountId }) {
  if (!variant.sku) return { sku: variant.sku, status: "skipped" };
  const payload = buildZohoItemPayload(product, variant, { inventoryAccountId });
  const existingMapping = mappings[variant.id];
  try {
    let zohoItemId = existingMapping?.zohoId;
    if (zohoItemId) {
      await updateZohoItem(zohoAuth, zohoItemId, payload);
    } else {
      const existingItem = await fetchZohoItemBySku({ ...zohoAuth, sku: variant.sku });
      if (existingItem) {
        zohoItemId = existingItem.item_id;
        await updateZohoItem(zohoAuth, zohoItemId, payload);
      } else {
        const created = await createZohoItem(zohoAuth, payload);
        zohoItemId = created.item_id;
      }
    }
    await setZohoItemActiveStatus(zohoAuth, zohoItemId, product.status === "ACTIVE");
    await saveProductMapping(shopId, variant.id, zohoItemId, product.id);
    if (inventoryAccountId) await denyOversellForVariant(admin, product, variant);
    return { sku: variant.sku, zohoItemId, status: "success" };
  } catch (error) {
    console.error("Failed to sync product variant to Zoho", variant.sku, error);
    const description = describeZohoError(error);
    await markProductMappingError(shopId, variant.id, description);
    return { sku: variant.sku, status: "error", error: description };
  }
}

export async function syncProductToZoho({ shopId, admin, zohoAuth, product, mappings, inventoryAccountId }) {
  const results = [];
  for (const variant of product.variants) {
    results.push(await syncVariantToZoho({ shopId, admin, zohoAuth, product, variant, mappings, inventoryAccountId }));
  }
  return results;
}

export const PRODUCTS_QUERY = `#graphql
  query SyncableProducts($first: Int, $after: String, $last: Int, $before: String) {
    products(first: $first, after: $after, last: $last, before: $before) {
      edges {
        node {
          id
          title
          handle
          vendor
          productType
          status
          description
          featuredMedia { preview { image { url altText } } }
          variants(first: 50) {
            edges { node { id title sku price inventoryQuantity } }
          }
        }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const PRODUCT_BY_ID_QUERY = `#graphql
  query ProductById($id: ID!) {
    product(id: $id) {
      id title handle vendor productType status description
      featuredMedia { preview { image { url altText } } }
      variants(first: 50) { edges { node { id title sku price inventoryQuantity } } }
    }
  }
`;

export function normalizeProductNode(node) {
  return {
    ...node,
    imageUrl: node.featuredMedia?.preview?.image?.url || null,
    variants: (node.variants?.edges || []).map(({ node: variant }) => variant),
  };
}

async function fetchAllProductsForSync(admin) {
  const allProducts = [];
  let after = null;
  for (;;) {
    const response = await admin.graphql(PRODUCTS_QUERY, { variables: { first: 250, after } });
    const json = await response.json();
    const edges = json.data?.products?.edges || [];
    allProducts.push(...edges.map(({ node }) => normalizeProductNode(node)));
    const pageInfo = json.data?.products?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
  }
  return allProducts;
}

export async function runProductSync({ admin, shop, zohoAuth }) {
  const logId = await startSyncLog(shop.id, { entityType: "product", direction: "shopify_to_zoho" });
  const products = await fetchAllProductsForSync(admin);
  const mappings = await getProductMappings(shop.id);
  const appSettings = await getAppSettings(shop.id);
  const inventoryAccountId = appSettings.accountSettings?.inventoryAccountId;
  const results = [];
  for (const product of products) results.push(...(await syncProductToZoho({ shopId: shop.id, admin, zohoAuth, product, mappings, inventoryAccountId })));
  const attempted = results.filter((result) => result.status !== "skipped");
  const summary = {
    records_processed: attempted.length,
    records_success: attempted.filter((result) => result.status === "success").length,
    records_failed: attempted.filter((result) => result.status === "error").length,
  };
  await finishSyncLog(logId, summary);
  return summary;
}
