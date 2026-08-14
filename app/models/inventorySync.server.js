import { fetchZohoItem, createZohoInventoryAdjustment } from "../zoho.server";

// ZohoApiError's `.message` is just a generic label - the actual reason
// Zoho gave lives in `.details`.
function describeZohoError(error) {
  return error.details ? `${error.message}: ${JSON.stringify(error.details)}` : error.message;
}

// Pushes a Shopify location's `available` quantity for one variant to Zoho
// as an inventory adjustment. Zoho's adjustment API only accepts a signed
// delta (how much to add/remove), not an absolute quantity to set, so the
// item's current stock at that warehouse is fetched first to compute the
// difference. Requires both the variant and the Shopify location to
// already be mapped (Sections B and A respectively) - if either is
// missing, this is skipped rather than guessed at.
export async function syncInventoryLevelToZoho({
  zohoAuth,
  shopifyVariantId,
  shopifyLocationId,
  availableQuantity,
  productMappings,
  warehouseMappings,
}) {
  const zohoItemId = productMappings[shopifyVariantId]?.zohoId;
  if (!zohoItemId) {
    return { status: "skipped", reason: "product not synced to Zoho yet" };
  }

  const zohoWarehouseId = warehouseMappings[shopifyLocationId];
  if (!zohoWarehouseId) {
    return { status: "skipped", reason: "Shopify location has no warehouse mapping" };
  }

  try {
    const item = await fetchZohoItem(zohoAuth, zohoItemId);

    if (!item.track_inventory) {
      return { status: "skipped", reason: "item is not inventory-tracked in Zoho" };
    }

    const warehouse = (item.warehouses || []).find(
      (entry) => String(entry.warehouse_id) === String(zohoWarehouseId),
    );
    const currentStock = warehouse ? Number(warehouse.warehouse_stock_on_hand) || 0 : 0;
    const delta = Number(availableQuantity) - currentStock;

    if (delta === 0) {
      return { status: "skipped", reason: "no change" };
    }

    await createZohoInventoryAdjustment(zohoAuth, {
      itemId: zohoItemId,
      locationId: zohoWarehouseId,
      quantityAdjusted: delta,
      reason: "Shopify inventory sync",
      date: new Date().toISOString().slice(0, 10),
    });

    return { status: "success", delta };
  } catch (error) {
    console.error("Failed to sync inventory level to Zoho", shopifyVariantId, error);
    return { status: "error", error: describeZohoError(error) };
  }
}
