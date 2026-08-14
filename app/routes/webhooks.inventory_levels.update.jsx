import { authenticate } from "../shopify.server";
import {
  getConnectionForShopDomain,
  getValidAccessToken,
} from "../models/zohoConnection.server";
import { getProductMappings } from "../models/productSync.server";
import { getWarehouseMappings } from "../models/warehouseMapping.server";
import { syncInventoryLevelToZoho } from "../models/inventorySync.server";
import {
  recordWebhookReceived,
  finishWebhookLog,
} from "../models/webhookLog.server";

const INVENTORY_ITEM_VARIANT_QUERY = `#graphql
  query InventoryItemVariant($id: ID!) {
    inventoryItem(id: $id) {
      id
      variants(first: 1) {
        edges {
          node {
            id
          }
        }
      }
    }
  }
`;

// Shopify's inventory_levels/update payload is just
// { inventory_item_id, location_id, available } - no SKU, variant, or
// product info at all, unlike other resource webhooks. `admin` (available
// from authenticate.webhook when there's a stored session for the shop) is
// used to resolve the inventory item back to its variant via GraphQL.
export const action = async ({ request }) => {
  const { shop, topic, webhookId, payload, admin } =
    await authenticate.webhook(request);
  const { shop: shopRecord, connection } =
    await getConnectionForShopDomain(shop);

  const inventoryItemGid = `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
  const shopifyLocationId = `gid://shopify/Location/${payload.location_id}`;

  const logId = await recordWebhookReceived(shopRecord.id, {
    webhookId,
    topic,
    shopDomain: shop,
    resourceId: inventoryItemGid,
    payload,
  });

  if (!logId) return new Response(); // Duplicate delivery of a webhook we've already processed.

  if (!connection) {
    await finishWebhookLog(logId, {
      status: "skipped",
      errorMessage: "Zoho Books is not connected for this shop",
    });
    return new Response();
  }

  if (!admin) {
    await finishWebhookLog(logId, {
      status: "skipped",
      errorMessage: "No admin session available to resolve the inventory item's variant",
    });
    return new Response();
  }

  try {
    const token = await getValidAccessToken(shopRecord.id);
    if (!token) throw new Error("No valid Zoho access token");

    const zohoAuth = {
      accessToken: token.accessToken,
      apiDomain: token.apiDomain,
      organizationId: connection.organization_id,
    };

    const response = await admin.graphql(INVENTORY_ITEM_VARIANT_QUERY, {
      variables: { id: inventoryItemGid },
    });
    const json = await response.json();
    const shopifyVariantId = json.data?.inventoryItem?.variants?.edges?.[0]?.node?.id;

    if (!shopifyVariantId) {
      await finishWebhookLog(logId, {
        status: "skipped",
        errorMessage: "Inventory item has no associated variant",
      });
      return new Response();
    }

    const [productMappings, warehouseMappings] = await Promise.all([
      getProductMappings(shopRecord.id),
      getWarehouseMappings(shopRecord.id),
    ]);

    const result = await syncInventoryLevelToZoho({
      zohoAuth,
      shopifyVariantId,
      shopifyLocationId,
      availableQuantity: payload.available,
      productMappings,
      warehouseMappings,
    });

    await finishWebhookLog(logId, {
      status: result.status === "error" ? "failed" : "processed",
      errorMessage: result.status === "error" ? result.error : null,
    });
  } catch (error) {
    console.error("Failed to process inventory level webhook", error);
    await finishWebhookLog(logId, {
      status: "failed",
      errorMessage: error.message,
    });
  }

  return new Response();
};
