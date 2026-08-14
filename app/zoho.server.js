import crypto from "node:crypto";

const ZOHO_ACCOUNTS_URL =
  process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REDIRECT_URI = process.env.ZOHO_REDIRECT_URI;

const ZOHO_SCOPES = [
  "ZohoBooks.fullaccess.all",
  "ZohoInventory.fullaccess.all",
].join(",");

const STATE_TTL_MS = 15 * 60 * 1000;

export class ZohoApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ZohoApiError";
    this.details = details;
  }
}

function getStateSecret() {
  return process.env.SHOPIFY_API_SECRET || "zoho-oauth-state-secret";
}

// Signs {shop, nonce, ts} so the OAuth callback can trust the shop domain
// without needing a Shopify-authenticated session (the callback is opened
// in a plain browser tab, outside the embedded admin iframe).
export function createOAuthState(shopDomain) {
  const payload = {
    shop: shopDomain,
    nonce: crypto.randomBytes(8).toString("hex"),
    ts: Date.now(),
  };
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getStateSecret())
    .update(json)
    .digest("base64url");

  return `${json}.${signature}`;
}

export function verifyOAuthState(state) {
  if (!state || !state.includes(".")) return null;

  const [json, signature] = state.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", getStateSecret())
    .update(json)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8"));

  if (Date.now() - payload.ts > STATE_TTL_MS) {
    return null;
  }

  return payload.shop;
}

export function getAuthorizationUrl(shopDomain) {
  const params = new URLSearchParams({
    scope: ZOHO_SCOPES,
    client_id: ZOHO_CLIENT_ID,
    response_type: "code",
    redirect_uri: ZOHO_REDIRECT_URI,
    access_type: "offline",
    prompt: "consent",
    state: createOAuthState(shopDomain),
  });

  return `${ZOHO_ACCOUNTS_URL}/oauth/v2/auth?${params.toString()}`;
}

// Zoho's callback echoes back an `accounts-server` param identifying which
// data center (accounts.zoho.com / .in / .eu / .com.au / ...) actually
// issued the code, regardless of which one we sent the user to. A code
// must be exchanged against that SAME data center or Zoho rejects it with
// "invalid_code" - so callers must pass this through rather than assuming
// a single global accounts URL. Merchants can be on any Zoho data center.
export async function exchangeCodeForToken(
  code,
  accountsServer = ZOHO_ACCOUNTS_URL,
) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    redirect_uri: ZOHO_REDIRECT_URI,
    code,
  });

  const response = await fetch(`${accountsServer}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new ZohoApiError("Failed to exchange Zoho authorization code", data);
  }

  return data;
}

// Refreshing a token has the same data-center requirement as the initial
// exchange - use the accounts-server that was recorded when this
// connection was created (see zohoConnection.server.js#getValidAccessToken).
export async function refreshAccessToken(
  refreshToken,
  accountsServer = ZOHO_ACCOUNTS_URL,
) {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  const response = await fetch(`${accountsServer}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new ZohoApiError("Failed to refresh Zoho access token", data);
  }

  return data;
}

export async function fetchOrganizations({ accessToken, apiDomain }) {
  const response = await fetch(`${apiDomain}/books/v3/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to fetch Zoho organizations", data);
  }

  return data.organizations || [];
}

// Full organization record (fiscal year, currency, tax basis, time zone, ...)
// - the /organizations list endpoint used during OAuth only carries enough
// to pick which org to connect to, so settings display fetches this separately.
export async function fetchOrganizationDetails(
  organizationId,
  { accessToken, apiDomain },
) {
  const response = await fetch(
    `${apiDomain}/books/v3/organizations/${organizationId}`,
    {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to fetch Zoho organization details", data);
  }

  return data.organization;
}

// Zoho Inventory warehouses for the connected organization - used to map
// against Shopify locations for (future) inventory sync. Unlike the
// /organizations endpoints, Inventory/Books resource endpoints require
// organization_id as a query param since one Zoho account can hold
// multiple organizations.
export async function fetchWarehouses({
  accessToken,
  apiDomain,
  organizationId,
}) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/inventory/v1/warehouses?${params.toString()}`,
    {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to fetch Zoho warehouses", data);
  }

  return data.warehouses || [];
}

// Org-level tax list (Settings > Taxes in Zoho Books) - used as the pick
// list for a default GST/VAT tax to apply during (future) order/invoice
// sync, since Shopify has no equivalent catalog of named tax rates to map
// against one-for-one.
export async function fetchTaxes({ accessToken, apiDomain, organizationId }) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/books/v3/settings/taxes?${params.toString()}`,
    {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to fetch Zoho taxes", data);
  }

  return data.taxes || [];
}

// Full chart of accounts - used as the pick list for default sales/payment
// accounts. Callers filter by account_type (e.g. "income"/"other_income"
// for sales, "bank"/"cash" for payments).
export async function fetchChartOfAccounts({
  accessToken,
  apiDomain,
  organizationId,
}) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/books/v3/chartofaccounts?${params.toString()}`,
    {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to fetch Zoho chart of accounts", data);
  }

  return data.chartofaccounts || [];
}

// Looks up a Zoho Inventory item by exact SKU match, so product sync can
// link to an item a merchant already has in Zoho instead of creating a
// duplicate. Returns null if none exists yet.
export async function fetchZohoItemBySku({
  accessToken,
  apiDomain,
  organizationId,
  sku,
}) {
  const params = new URLSearchParams({ organization_id: organizationId, sku });
  const response = await fetch(
    `${apiDomain}/inventory/v1/items?${params.toString()}`,
    {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to look up Zoho item by SKU", data);
  }

  return (data.items || []).find((item) => item.sku === sku) || null;
}

// Full item detail, including its `warehouses` array ({ warehouse_id,
// warehouse_stock_on_hand, ... }) for orgs with multi-warehouse inventory
// enabled - needed to know an item's current stock at a specific warehouse
// before adjusting it, since Zoho's inventory adjustment API only accepts
// a relative delta, not an absolute quantity to set.
export async function fetchZohoItem(
  { accessToken, apiDomain, organizationId },
  itemId,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/inventory/v1/items/${itemId}?${params.toString()}`,
    {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to fetch Zoho item", data);
  }

  return data.item;
}

// Adjusts an item's stock at a specific warehouse (Zoho calls this
// `location_id` in the adjustments API, even though the same id is called
// `warehouse_id` everywhere else - both refer to the same record).
// `quantityAdjusted` is a signed delta (+/-), not an absolute quantity -
// callers must compute it against the item's current stock first.
export async function createZohoInventoryAdjustment(
  { accessToken, apiDomain, organizationId },
  { itemId, locationId, quantityAdjusted, reason, date },
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const body = {
    date,
    reason,
    adjustment_type: "quantity",
    location_id: locationId,
    line_items: [
      {
        item_id: itemId,
        quantity_adjusted: quantityAdjusted,
        location_id: locationId,
      },
    ],
  };
  const response = await fetch(
    `${apiDomain}/inventory/v1/inventoryadjustments?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to create Zoho inventory adjustment", data);
  }

  return data.inventory_adjustment;
}

export async function createZohoItem(
  { accessToken, apiDomain, organizationId },
  item,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/inventory/v1/items?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(item),
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to create Zoho item", data);
  }

  return data.item;
}

export async function updateZohoItem(
  { accessToken, apiDomain, organizationId },
  itemId,
  item,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/inventory/v1/items/${itemId}?${params.toString()}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(item),
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to update Zoho item", data);
  }

  return data.item;
}

export async function deleteZohoItem(
  { accessToken, apiDomain, organizationId },
  itemId,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/inventory/v1/items/${itemId}?${params.toString()}`,
    {
      method: "DELETE",
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to delete Zoho item", data);
  }

  return data;
}

// Item status (active/inactive) isn't settable via create/update - Zoho
// only exposes it through these dedicated endpoints.
export async function setZohoItemActiveStatus(
  { accessToken, apiDomain, organizationId },
  itemId,
  isActive,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/inventory/v1/items/${itemId}/${isActive ? "active" : "inactive"}?${params.toString()}`,
    {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to set Zoho item status", data);
  }

  return data;
}

// Looks up a Zoho Books contact by exact email match, so customer sync can
// link to a contact a merchant already has in Zoho instead of creating a
// duplicate. Zoho's `email` list filter is fuzzy, so results are still
// checked for an exact (case-insensitive) match client-side - the same
// pattern as fetchZohoItemBySku.
export async function fetchZohoContactByEmail({
  accessToken,
  apiDomain,
  organizationId,
  email,
}) {
  const params = new URLSearchParams({ organization_id: organizationId, email });
  const response = await fetch(
    `${apiDomain}/books/v3/contacts?${params.toString()}`,
    {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to look up Zoho contact by email", data);
  }

  return (
    (data.contacts || []).find(
      (contact) => (contact.email || "").toLowerCase() === email.toLowerCase(),
    ) || null
  );
}

export async function createZohoContact(
  { accessToken, apiDomain, organizationId },
  contact,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/books/v3/contacts?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(contact),
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to create Zoho contact", data);
  }

  return data.contact;
}

export async function updateZohoContact(
  { accessToken, apiDomain, organizationId },
  contactId,
  contact,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/books/v3/contacts/${contactId}?${params.toString()}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(contact),
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to update Zoho contact", data);
  }

  return data.contact;
}

export async function deleteZohoContact(
  { accessToken, apiDomain, organizationId },
  contactId,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/books/v3/contacts/${contactId}?${params.toString()}`,
    {
      method: "DELETE",
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to delete Zoho contact", data);
  }

  return data;
}

// Like item status, a contact's active/inactive state isn't settable via
// create/update - only through these dedicated endpoints. Used as the
// fallback when a contact can't be hard-deleted because it has existing
// transaction history (invoices, payments, etc.).
export async function setZohoContactActiveStatus(
  { accessToken, apiDomain, organizationId },
  contactId,
  isActive,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/books/v3/contacts/${contactId}/${isActive ? "active" : "inactive"}?${params.toString()}`,
    {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to set Zoho contact status", data);
  }

  return data;
}

export async function createZohoSalesOrder(
  { accessToken, apiDomain, organizationId },
  salesOrder,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/books/v3/salesorders?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(salesOrder),
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to create Zoho sales order", data);
  }

  return data.salesorder;
}

export async function updateZohoSalesOrder(
  { accessToken, apiDomain, organizationId },
  salesOrderId,
  salesOrder,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/books/v3/salesorders/${salesOrderId}?${params.toString()}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(salesOrder),
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to update Zoho sales order", data);
  }

  return data.salesorder;
}

// Zoho sales orders aren't simply deleted when a Shopify order is cancelled
// (deleting is only allowed before an order has been invoiced/shipped, and
// would erase the accounting record) - voiding is the standard way to mark
// a sales order as no longer active while keeping it on the books.
export async function voidZohoSalesOrder(
  { accessToken, apiDomain, organizationId },
  salesOrderId,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/books/v3/salesorders/${salesOrderId}/status/void?${params.toString()}`,
    {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to void Zoho sales order", data);
  }

  return data;
}

// Converts an existing Zoho sales order into an invoice, carrying over its
// customer, line items, tax, discount, and shipping charge - so invoice
// creation doesn't need to rebuild any of that from the Shopify order
// again. Zoho requires no request body for this conversion.
export async function createZohoInvoiceFromSalesOrder(
  { accessToken, apiDomain, organizationId },
  salesOrderId,
) {
  const params = new URLSearchParams({
    organization_id: organizationId,
    salesorder_id: salesOrderId,
  });
  const response = await fetch(
    `${apiDomain}/books/v3/invoices/fromsalesorder?${params.toString()}`,
    {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to create Zoho invoice from sales order", data);
  }

  return data.invoice;
}

// Fetches full sales order detail, including its `invoices` array - Zoho's
// own authoritative link to whatever invoice(s) already exist for this
// sales order, however they were created (via this app's API calls, or
// manually in Zoho's own UI). Used to adopt an existing invoice instead of
// failing when Zoho reports the sales order has nothing left to invoice.
// Matching on `reference_number` was tried first but proved unreliable -
// Zoho's own "convert to invoice" UI action doesn't carry over the sales
// order's custom reference_number to the resulting invoice.
export async function fetchZohoSalesOrder(
  { accessToken, apiDomain, organizationId },
  salesOrderId,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/books/v3/salesorders/${salesOrderId}?${params.toString()}`,
    {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to fetch Zoho sales order", data);
  }

  return data.salesorder;
}

// Records a payment and applies it against one or more invoices in a
// single call - `payment.invoices` is the { invoice_id, amount_applied }
// pairing that both creates the payment and marks the invoice(s) as paid.
export async function createZohoCustomerPayment(
  { accessToken, apiDomain, organizationId },
  payment,
) {
  const params = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(
    `${apiDomain}/books/v3/customerpayments?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payment),
    },
  );

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new ZohoApiError("Failed to create Zoho customer payment", data);
  }

  return data.payment;
}

export function getPreferredOrganizationId() {
  return process.env.ZOHO_ORGANIZATION_ID || null;
}

export function dataCenterFromApiDomain(apiDomain) {
  try {
    const hostname = new URL(apiDomain).hostname;

    return hostname.replace(/^www\.zohoapis\./, "");
  } catch {
    return null;
  }
}
