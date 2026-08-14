import db from "../db.server";
import {
  fetchZohoContactByEmail,
  createZohoContact,
  updateZohoContact,
  setZohoContactActiveStatus,
  deleteZohoContact,
} from "../zoho.server";
import {
  getConnectionForShopDomain,
  getValidAccessToken,
} from "./zohoConnection.server";
import { recordWebhookReceived, finishWebhookLog } from "./webhookLog.server";

const ENTITY_TYPE = "customer";

export async function getCustomerMappings(shopId) {
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

export async function getCustomerMapping(shopId, shopifyCustomerId) {
  const [rows] = await db.execute(
    `SELECT shopify_id, zoho_id FROM sync_mappings WHERE shop_id = ? AND entity_type = ? AND shopify_id = ?`,
    [shopId, ENTITY_TYPE, shopifyCustomerId],
  );

  return rows[0] || null;
}

export async function saveCustomerMapping(
  shopId,
  shopifyCustomerId,
  zohoContactId,
) {
  await db.execute(
    `INSERT INTO sync_mappings (shop_id, entity_type, shopify_id, zoho_id, status, last_synced_at, last_error)
     VALUES (?, ?, ?, ?, 'synced', NOW(), NULL)
     ON DUPLICATE KEY UPDATE zoho_id = VALUES(zoho_id), status = 'synced', last_synced_at = NOW(), last_error = NULL`,
    [shopId, ENTITY_TYPE, shopifyCustomerId, zohoContactId],
  );
}

export async function markCustomerMappingError(
  shopId,
  shopifyCustomerId,
  errorMessage,
) {
  await db.execute(
    `UPDATE sync_mappings SET status = 'error', last_error = ? WHERE shop_id = ? AND entity_type = ? AND shopify_id = ?`,
    [errorMessage, shopId, ENTITY_TYPE, shopifyCustomerId],
  );
}

export async function deleteCustomerMapping(shopId, shopifyCustomerId) {
  await db.execute(
    `DELETE FROM sync_mappings WHERE shop_id = ? AND entity_type = ? AND shopify_id = ?`,
    [shopId, ENTITY_TYPE, shopifyCustomerId],
  );
}

// Shared by the manual "Sync now" bulk action and the customers webhooks -
// one source of truth for "how do we turn a Shopify customer into a Zoho
// Books contact" so the two call sites can't drift out of sync.
export function buildZohoContactPayload(customer) {
  const firstName = customer.firstName || "";
  const lastName = customer.lastName || "";
  const contactName =
    `${firstName} ${lastName}`.trim() || customer.email || "Unnamed customer";
  const address = customer.address || {};
  const phone = customer.phone || address.phone || "";

  const zohoAddress = {
    address: address.address1 || "",
    street2: address.address2 || "",
    city: address.city || "",
    state: address.province || "",
    zip: address.zip || "",
    country: address.country || "",
    phone: address.phone || phone,
  };

  return {
    contact_name: contactName,
    contact_type: "customer",
    customer_sub_type: "individual",
    contact_persons: [
      {
        first_name: firstName,
        last_name: lastName,
        email: customer.email,
        phone,
        is_primary_contact: true,
      },
    ],
    billing_address: zohoAddress,
    shipping_address: zohoAddress,
  };
}

// `customer` is { id, firstName, lastName, email, phone, address } - the
// same shape whether it came from the Admin GraphQL customers query or was
// normalized from a REST webhook payload (see the customers.create/update
// webhook routes).
export async function syncCustomerToZoho({
  shopId,
  zohoAuth,
  customer,
  mappings,
}) {
  if (!customer.email) {
    return { email: customer.email, status: "skipped" };
  }

  const payload = buildZohoContactPayload(customer);
  const existingMapping = mappings[customer.id];

  try {
    let zohoContactId = existingMapping?.zohoId;

    if (zohoContactId) {
      await updateZohoContact(zohoAuth, zohoContactId, payload);
    } else {
      const existingContact = await fetchZohoContactByEmail({
        ...zohoAuth,
        email: customer.email,
      });
      if (existingContact) {
        zohoContactId = existingContact.contact_id;
        await updateZohoContact(zohoAuth, zohoContactId, payload);
      } else {
        const created = await createZohoContact(zohoAuth, payload);
        zohoContactId = created.contact_id;
      }
    }

    await saveCustomerMapping(shopId, customer.id, zohoContactId);

    return { email: customer.email, zohoContactId, status: "success" };
  } catch (error) {
    console.error("Failed to sync customer to Zoho", customer.email, error);
    await markCustomerMappingError(shopId, customer.id, error.message);

    return { email: customer.email, status: "error", error: error.message };
  }
}

// Shopify's customers/create and customers/update webhooks deliver the
// classic REST-shaped customer resource - normalize it to the same
// { id, firstName, lastName, email, phone, address } shape the GraphQL-based
// bulk sync uses. `admin_graphql_api_id` is what lines up with the GIDs
// already stored in sync_mappings from GraphQL-based syncs.
export function normalizeRestCustomer(payload) {
  const defaultAddress = payload.default_address || {};

  return {
    id: payload.admin_graphql_api_id,
    firstName: payload.first_name || "",
    lastName: payload.last_name || "",
    email: payload.email || "",
    phone: payload.phone || "",
    address: {
      address1: defaultAddress.address1 || "",
      address2: defaultAddress.address2 || "",
      city: defaultAddress.city || "",
      province: defaultAddress.province || "",
      zip: defaultAddress.zip || "",
      country: defaultAddress.country || "",
      phone: defaultAddress.phone || "",
    },
  };
}

// Shared body for the customers/create and customers/update webhook routes -
// they only differ in which Shopify topic triggered them. Always resolves
// (never throws) so the route can respond 200 to Shopify regardless of what
// happened internally; failures are recorded in webhook_logs instead of
// surfacing as a webhook delivery failure (which would make Shopify retry
// and eventually disable the subscription).
export async function processCustomerUpsertWebhook({
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
    const customer = normalizeRestCustomer(payload);
    const mappings = await getCustomerMappings(shop.id);

    const result = await syncCustomerToZoho({
      shopId: shop.id,
      zohoAuth,
      customer,
      mappings,
    });

    await finishWebhookLog(logId, {
      status: result.status === "error" ? "failed" : "processed",
      errorMessage: result.status === "error" ? result.error : null,
    });
  } catch (error) {
    console.error("Failed to process customer webhook", topic, error);
    await finishWebhookLog(logId, {
      status: "failed",
      errorMessage: error.message,
    });
  }
}

// For the Zoho contact mapped to this (now-deleted) Shopify customer: try a
// hard delete first, but Zoho refuses to delete a contact that's been used
// in any transaction (invoice, payment, etc.) - so fall back to
// deactivating it instead, which preserves that transaction history. The
// mapping row is removed either way (the Shopify side is gone regardless);
// if BOTH the delete and the deactivate attempt fail, the row is kept with
// status "error" instead, so the failure stays visible rather than
// silently vanishing.
export async function syncCustomerDeletionToZoho({
  shopId,
  zohoAuth,
  shopifyCustomerId,
}) {
  const mapping = await getCustomerMapping(shopId, shopifyCustomerId);
  if (!mapping) return { status: "skipped" };

  try {
    await deleteZohoContact(zohoAuth, mapping.zoho_id);
    await deleteCustomerMapping(shopId, shopifyCustomerId);
    return { zohoContactId: mapping.zoho_id, status: "deleted" };
  } catch (deleteError) {
    try {
      await setZohoContactActiveStatus(zohoAuth, mapping.zoho_id, false);
      await deleteCustomerMapping(shopId, shopifyCustomerId);
      return { zohoContactId: mapping.zoho_id, status: "deactivated" };
    } catch (deactivateError) {
      console.error(
        "Failed to delete or deactivate Zoho contact for deleted customer",
        mapping.zoho_id,
        deactivateError,
      );
      await markCustomerMappingError(
        shopId,
        shopifyCustomerId,
        deactivateError.message,
      );
      return {
        zohoContactId: mapping.zoho_id,
        status: "error",
        error: deactivateError.message,
      };
    }
  }
}
