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
import { startSyncLog, finishSyncLog } from "./syncLog.server";

const ENTITY_TYPE = "customer";

function describeZohoError(error) {
  return error.details ? `${error.message}: ${JSON.stringify(error.details)}` : error.message;
}

export async function getSyncedCustomerCount(shopId) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS count FROM sync_mappings WHERE shop_id = ? AND entity_type = ? AND status = 'synced'`,
    [shopId, ENTITY_TYPE],
  );
  return rows[0]?.count || 0;
}

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

export async function saveCustomerMapping(shopId, shopifyCustomerId, zohoContactId) {
  await db.execute(
    `INSERT INTO sync_mappings (shop_id, entity_type, shopify_id, zoho_id, status, last_synced_at, last_error)
     VALUES (?, ?, ?, ?, 'synced', NOW(), NULL)
     ON DUPLICATE KEY UPDATE zoho_id = VALUES(zoho_id), status = 'synced', last_synced_at = NOW(), last_error = NULL`,
    [shopId, shopifyCustomerId, zohoContactId],
  );
}

export async function markCustomerMappingError(shopId, shopifyCustomerId, errorMessage) {
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

export function buildZohoContactPayload(customer) {
  const firstName = customer.firstName || "";
  const lastName = customer.lastName || "";
  const contactName = `${firstName} ${lastName}`.trim() || customer.email || "Unnamed customer";
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
    contact_persons: [{
      first_name: firstName,
      last_name: lastName,
      email: customer.email,
      phone,
      is_primary_contact: true,
    }],
    billing_address: zohoAddress,
    shipping_address: zohoAddress,
  };
}

export async function syncCustomerToZoho({ shopId, zohoAuth, customer, mappings }) {
  if (!customer.email) return { email: customer.email, status: "skipped" };

  const payload = buildZohoContactPayload(customer);
  const existingMapping = mappings[customer.id];

  try {
    let zohoContactId = existingMapping?.zohoId;

    if (zohoContactId) {
      await updateZohoContact(zohoAuth, zohoContactId, payload);
    } else {
      const existingContact = await fetchZohoContactByEmail({ ...zohoAuth, email: customer.email });
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
    const description = describeZohoError(error);
    await markCustomerMappingError(shopId, customer.id, description);
    return { email: customer.email, status: "error", error: description };
  }
}

export const CUSTOMERS_QUERY = `#graphql
  query SyncableCustomers($first: Int, $after: String, $last: Int, $before: String) {
    customers(first: $first, after: $after, last: $last, before: $before) {
      edges {
        node {
          id
          firstName
          lastName
          email
          phone
          state
          tags
          numberOfOrders
          amountSpent { amount currencyCode }
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

export function normalizeCustomerNode(node) {
  const address = node.defaultAddress || {};

  return {
    id: node.id,
    firstName: node.firstName || "",
    lastName: node.lastName || "",
    email: node.email || "",
    phone: node.phone || "",
    state: node.state || "ENABLED",
    tags: node.tags || [],
    numberOfOrders: Number(node.numberOfOrders || 0),
    amountSpent: node.amountSpent?.amount || "0.00",
    amountSpentCurrency: node.amountSpent?.currencyCode || "USD",
    address: {
      address1: address.address1 || "",
      address2: address.address2 || "",
      city: address.city || "",
      province: address.province || "",
      zip: address.zip || "",
      country: address.country || "",
      phone: address.phone || "",
    },
  };
}

async function fetchAllCustomersForSync(admin) {
  const allCustomers = [];
  let after = null;

  for (;;) {
    const response = await admin.graphql(CUSTOMERS_QUERY, { variables: { first: 250, after } });
    const json = await response.json();
    const edges = json.data?.customers?.edges || [];
    allCustomers.push(...edges.map(({ node }) => normalizeCustomerNode(node)));
    const pageInfo = json.data?.customers?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  return allCustomers;
}

export async function runCustomerSync({ admin, shop, zohoAuth }) {
  const logId = await startSyncLog(shop.id, { entityType: "customer", direction: "shopify_to_zoho" });
  const customers = await fetchAllCustomersForSync(admin);
  const mappings = await getCustomerMappings(shop.id);
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const customer of customers) {
    processed += 1;
    const result = await syncCustomerToZoho({ shopId: shop.id, zohoAuth, customer, mappings });
    if (result.status === "success") succeeded += 1;
    else if (result.status === "error") failed += 1;
  }

  await finishSyncLog(logId, { recordsProcessed: processed, recordsSuccess: succeeded, recordsFailed: failed });
  return { processed, succeeded, failed };
}
