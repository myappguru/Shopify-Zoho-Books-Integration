import { Fragment, useState } from "react";
import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getConnectionForShopDomain,
  disconnect,
  getValidAccessToken,
} from "../models/zohoConnection.server";
import { getAppSettings, mergeAppSettings } from "../models/appSettings.server";
import {
  getWarehouseMappings,
  saveWarehouseMapping,
  removeWarehouseMapping,
} from "../models/warehouseMapping.server";
import {
  getAuthorizationUrl,
  fetchOrganizationDetails,
  fetchWarehouses,
  fetchTaxes,
  fetchChartOfAccounts,
} from "../zoho.server";
import { useZohoConnectionSync } from "../hooks/useZohoConnectionSync";

const LOCATIONS_QUERY = `#graphql
  query WarehouseMappingLocations {
    locations(first: 50) {
      edges {
        node {
          id
          name
          isActive
        }
      }
    }
  }
`;

// Org details and the warehouse list rarely change, but Zoho enforces an
// org-wide API rate limit (calls/day) - hitting Zoho on every single page
// view/navigation burns through that quota fast (hit in practice during
// normal dev usage). So both are cached in app_settings and only re-fetched
// from Zoho when the cache is older than this, or on an explicit refresh.
const CACHE_TTL_MS = 15 * 60 * 1000;

function isFresh(fetchedAt) {
  return (
    Boolean(fetchedAt) &&
    Date.now() - new Date(fetchedAt).getTime() < CACHE_TTL_MS
  );
}

// Serves cached organization settings when fresh; otherwise (or when
// `force` is set by the "Refresh from Zoho" action) fetches live from Zoho
// and re-caches. Falls back to whatever was cached last time if the live
// call fails (e.g. token refresh hiccup, rate limit), so the page still
// renders something useful.
async function loadOrganizationSettings(
  shop,
  token,
  connection,
  { force = false } = {},
) {
  const cached = await getAppSettings(shop.id);

  if (!force && isFresh(cached.organization?.fetchedAt)) {
    return cached.organization;
  }

  try {
    if (!token) throw new Error("No valid Zoho access token");

    const org = await fetchOrganizationDetails(connection.organization_id, {
      accessToken: token.accessToken,
      apiDomain: token.apiDomain,
    });

    const settings = await mergeAppSettings(shop.id, "organization", {
      currencyCode: org.currency_code || null,
      currencySymbol: org.currency_symbol || null,
      fiscalYearStartMonth: org.fiscal_year_start_month || null,
      timeZone: org.time_zone || null,
      languageCode: org.language_code || null,
      dateFormat: org.date_format || null,
      industryType: org.industry_type_formatted || org.industry_type || null,
      taxIdLabel: org.tax_id_label || null,
      taxIdValue: org.tax_id_value || null,
      planName: org.plan_name || null,
      fetchedAt: new Date().toISOString(),
      stale: false,
    });

    return settings.organization;
  } catch (error) {
    console.error("Failed to refresh Zoho organization settings", error);

    if (!cached.organization) return null;
    return { ...cached.organization, stale: true };
  }
}

// Shared cache-then-refresh helper for the simple "list of things from
// Zoho" data (warehouses, taxes, chart of accounts) - all follow the same
// shape: cached as { items, fetchedAt } under an app_settings key, only
// re-fetched from Zoho when the cache is stale/missing or `force`d.
async function loadZohoList(
  shop,
  key,
  token,
  fetchList,
  { force = false } = {},
) {
  const cached = await getAppSettings(shop.id);
  const cachedList = cached[key];

  if (!force && isFresh(cachedList?.fetchedAt)) {
    return { items: cachedList.items, error: false };
  }

  try {
    if (!token) throw new Error("No valid Zoho access token");

    const items = await fetchList();
    await mergeAppSettings(shop.id, key, {
      items,
      fetchedAt: new Date().toISOString(),
    });

    return { items, error: false };
  } catch (error) {
    console.error(`Failed to fetch Zoho ${key}`, error);

    if (!cachedList) return { items: [], error: true };
    return { items: cachedList.items, error: true };
  }
}

function fetchWarehousesFor(token, connection) {
  return fetchWarehouses({
    accessToken: token.accessToken,
    apiDomain: token.apiDomain,
    organizationId: connection.organization_id,
  });
}

function fetchTaxesFor(token, connection) {
  return fetchTaxes({
    accessToken: token.accessToken,
    apiDomain: token.apiDomain,
    organizationId: connection.organization_id,
  });
}

function fetchAccountsFor(token, connection) {
  return fetchChartOfAccounts({
    accessToken: token.accessToken,
    apiDomain: token.apiDomain,
    organizationId: connection.organization_id,
  });
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, connection } = await getConnectionForShopDomain(session.shop);

  const token = connection
    ? await getValidAccessToken(shop.id).catch(() => null)
    : null;

  const organization = connection
    ? await loadOrganizationSettings(shop, token, connection)
    : null;

  const { items: warehouses, error: warehouseSyncError } = connection
    ? await loadZohoList(shop, "warehouses", token, () =>
        fetchWarehousesFor(token, connection),
      )
    : { items: [], error: false };
  const warehouseMappings = connection
    ? await getWarehouseMappings(shop.id)
    : {};

  const { items: taxes, error: taxSyncError } = connection
    ? await loadZohoList(shop, "taxes", token, () =>
        fetchTaxesFor(token, connection),
      )
    : { items: [], error: false };
  const { items: accounts, error: accountSyncError } = connection
    ? await loadZohoList(shop, "accounts", token, () =>
        fetchAccountsFor(token, connection),
      )
    : { items: [], error: false };

  const appSettings = await getAppSettings(shop.id);
  const taxSettings = appSettings.taxSettings || {};
  const accountSettings = appSettings.accountSettings || {};

  const locationsResponse = await admin.graphql(LOCATIONS_QUERY);
  const locationsJson = await locationsResponse.json();
  const locations = (locationsJson.data?.locations?.edges || []).map(
    ({ node }) => node,
  );

  return {
    connection: connection
      ? {
          organizationId: connection.organization_id,
          organizationName: connection.organization_name,
          dataCenter: connection.data_center,
          connectedAt: connection.connected_at,
        }
      : null,
    organization,
    locations,
    warehouses,
    warehouseMappings,
    warehouseSyncError,
    taxes,
    taxSyncError,
    taxSettings,
    accounts,
    accountSyncError,
    accountSettings,
    zohoAuthUrl: connection ? null : getAuthorizationUrl(session.shop),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "disconnect") {
    const { shop } = await getConnectionForShopDomain(session.shop);
    await disconnect(shop.id);
  }

  if (intent === "refresh-zoho-data") {
    const { shop, connection } = await getConnectionForShopDomain(session.shop);

    if (connection) {
      const token = await getValidAccessToken(shop.id).catch(() => null);
      await loadOrganizationSettings(shop, token, connection, { force: true });
      await loadZohoList(
        shop,
        "warehouses",
        token,
        () => fetchWarehousesFor(token, connection),
        { force: true },
      );
      await loadZohoList(
        shop,
        "taxes",
        token,
        () => fetchTaxesFor(token, connection),
        { force: true },
      );
      await loadZohoList(
        shop,
        "accounts",
        token,
        () => fetchAccountsFor(token, connection),
        { force: true },
      );
    }
  }

  if (intent === "save-warehouse-mapping") {
    const { shop } = await getConnectionForShopDomain(session.shop);

    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("warehouse:")) continue;

      const locationId = key.slice("warehouse:".length);
      if (value) {
        await saveWarehouseMapping(shop.id, locationId, value);
      } else {
        await removeWarehouseMapping(shop.id, locationId);
      }
    }
  }

  if (intent === "save-tax-settings") {
    const { shop } = await getConnectionForShopDomain(session.shop);

    await mergeAppSettings(shop.id, "taxSettings", {
      defaultTaxId: formData.get("defaultTaxId") || null,
      pricesIncludeTax: formData.get("pricesIncludeTax") === "true",
    });
  }

  if (intent === "save-account-settings") {
    const { shop } = await getConnectionForShopDomain(session.shop);

    await mergeAppSettings(shop.id, "accountSettings", {
      salesAccountId: formData.get("salesAccountId") || null,
      paymentAccountId: formData.get("paymentAccountId") || null,
      inventoryAccountId: formData.get("inventoryAccountId") || null,
    });
  }

  return null;
};

function openZohoAuthWindow(zohoAuthUrl) {
  // No `noopener` here on purpose - useZohoConnectionSync needs
  // window.opener to survive so the popup can post back when it's done.
  window.open(zohoAuthUrl, "zoho-connect", "width=600,height=720");
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthName(monthNumber) {
  return MONTH_NAMES[Number(monthNumber) - 1] || monthNumber;
}

// Grouped the same way as the scope doc's sections - just "Integration
// setup" for now, but structured so a "Sync settings" or "Reporting" group
// can be added alongside it later without reshaping this.
const NAV_GROUPS = [
  {
    heading: "Integration setup",
    items: [
      { key: "connection", label: "Zoho Books connection", icon: "link" },
      { key: "organization", label: "Organization settings", icon: "settings" },
      { key: "warehouses", label: "Warehouse mapping", icon: "inventory" },
      { key: "tax", label: "Tax settings", icon: "receipt" },
      { key: "accounts", label: "Default accounts", icon: "bank" },
    ],
  },
];

export default function SettingsPage() {
  const {
    connection,
    organization,
    locations,
    warehouses,
    warehouseMappings,
    warehouseSyncError,
    taxes,
    taxSyncError,
    taxSettings,
    accounts,
    accountSyncError,
    accountSettings,
    zohoAuthUrl,
  } = useLoaderData();
  const navigation = useNavigation();
  const isRefreshingZoho =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "refresh-zoho-data";
  useZohoConnectionSync();

  const [selectedSection, setSelectedSection] = useState("connection");
  // Sections other than "connection" need a Zoho connection to mean anything -
  // fall back to "connection" if we land on one of them while disconnected
  // (e.g. right after clicking "Disconnect").
  const activeSection =
    connection || selectedSection === "connection"
      ? selectedSection
      : "connection";

  const [navSearch, setNavSearch] = useState("");
  const visibleNavGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.label.toLowerCase().includes(navSearch.trim().toLowerCase()),
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <s-page heading="Settings">
      <s-grid gridTemplateColumns="260px 1fr" gap="large">
        <s-box
          padding="base"
          background="base"
          border="base"
          borderRadius="base"
        >
          <s-stack direction="block" gap="large">
            <s-search-field
              label="Search settings"
              labelAccessibilityVisibility="exclusive"
              placeholder="Search settings"
              value={navSearch}
              onInput={(event) => setNavSearch(event.target.value)}
            ></s-search-field>

            <s-divider></s-divider>

            {visibleNavGroups.length === 0 ? (
              <s-text color="subdued">No matching settings.</s-text>
            ) : (
              visibleNavGroups.map((group) => (
                <s-stack key={group.heading} direction="block" gap="small">
                  {group.items.map((item) => (
                    <s-clickable
                      key={item.key}
                      onClick={() => setSelectedSection(item.key)}
                      padding="base"
                      borderRadius="base"
                      background={
                        activeSection === item.key ? "subdued" : undefined
                      }
                      disabled={item.key !== "connection" && !connection}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          minWidth: 0,
                        }}
                      >
                        <s-icon type={item.icon}></s-icon>
                        <s-text
                          color="base"
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.label}
                        </s-text>
                      </div>
                    </s-clickable>
                  ))}
                </s-stack>
              ))
            )}
          </s-stack>
        </s-box>

        <s-stack gap="base">
          {activeSection === "connection" && (
            <s-section heading="Zoho Books connection">
              {connection ? (
                <s-stack gap="base">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-badge tone="success">Connected</s-badge>
                    <s-text type="strong">{connection.organizationName}</s-text>
                  </s-stack>

                  <s-divider></s-divider>

                  <s-grid gridTemplateColumns="180px 1fr" gap="base">
                    <s-text color="subdued">Organization ID</s-text>
                    <s-text>{connection.organizationId}</s-text>
                  </s-grid>
                  {connection.dataCenter && (
                    <s-grid gridTemplateColumns="180px 1fr" gap="base">
                      <s-text color="subdued">Data center</s-text>
                      <s-text>{connection.dataCenter}</s-text>
                    </s-grid>
                  )}

                  <Form method="post">
                    <input type="hidden" name="intent" value="disconnect" />
                    <s-button variant="secondary" type="submit">
                      Disconnect Zoho Books
                    </s-button>
                  </Form>
                </s-stack>
              ) : (
                <s-stack gap="base">
                  <s-badge tone="warning">Not connected</s-badge>
                  <s-paragraph color="subdued">
                    Connect your Zoho Books organization to start configuring
                    synchronization.
                  </s-paragraph>
                  <s-button
                    variant="primary"
                    onClick={() => openZohoAuthWindow(zohoAuthUrl)}
                  >
                    Connect Zoho Books
                  </s-button>
                </s-stack>
              )}
            </s-section>
          )}

          {activeSection === "organization" && connection && (
            <s-section heading="Organization settings">
              {organization ? (
                <s-stack gap="base">
                  {organization.stale && (
                    <s-banner heading="Refresh failed" tone="warning">
                      Couldn&apos;t refresh these details from Zoho just now —
                      showing the last known values.
                    </s-banner>
                  )}

                  <s-paragraph color="subdued">
                    Pulled live from your connected Zoho Books organization.
                  </s-paragraph>

                  <s-stack gap="base">
                    {[
                      {
                        key: "currency",
                        label: "Currency",
                        value: organization.currencyCode
                          ? `${organization.currencyCode} (${organization.currencySymbol})`
                          : null,
                      },
                      {
                        key: "fiscalYear",
                        label: "Fiscal year start",
                        value: monthName(organization.fiscalYearStartMonth),
                      },
                      {
                        key: "timeZone",
                        label: "Time zone",
                        value: organization.timeZone,
                      },
                      {
                        key: "language",
                        label: "Language",
                        value: organization.languageCode,
                      },
                      {
                        key: "dateFormat",
                        label: "Date format",
                        value: organization.dateFormat,
                      },
                      {
                        key: "industry",
                        label: "Industry",
                        value: organization.industryType,
                      },
                      organization.taxIdLabel && {
                        key: "taxId",
                        label: organization.taxIdLabel,
                        value: organization.taxIdValue || "Not set",
                      },
                      {
                        key: "plan",
                        label: "Zoho plan",
                        value: organization.planName,
                      },
                    ]
                      .filter((row) => row && row.value)
                      .map((row, index, rows) => (
                        <Fragment key={row.key}>
                          <s-grid gridTemplateColumns="180px 1fr" gap="base">
                            <s-text color="subdued">{row.label}</s-text>
                            <s-text>{row.value}</s-text>
                          </s-grid>
                          {index < rows.length - 1 && <s-divider></s-divider>}
                        </Fragment>
                      ))}
                  </s-stack>

                  {organization.fetchedAt && (
                    <s-text color="subdued">
                      Last synced from Zoho:{" "}
                      {new Date(organization.fetchedAt).toLocaleString()}
                    </s-text>
                  )}

                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="refresh-zoho-data"
                    />
                    <s-button
                      variant="secondary"
                      type="submit"
                      loading={isRefreshingZoho}
                    >
                      Refresh from Zoho
                    </s-button>
                  </Form>
                </s-stack>
              ) : (
                <s-paragraph>
                  Organization details couldn&apos;t be loaded from Zoho. Try
                  disconnecting and reconnecting.
                </s-paragraph>
              )}
            </s-section>
          )}

          {activeSection === "warehouses" && connection && (
            <s-section heading="Warehouse mapping">
              <s-stack gap="base">
                {warehouseSyncError && (
                  <s-banner
                    heading="Couldn't load Zoho warehouses"
                    tone="warning"
                  >
                    Showing Shopify locations without Zoho warehouse options.
                    Use the &quot;Refresh from Zoho&quot; button on the
                    Organization settings tab to try again (this can also mean
                    Zoho&apos;s API rate limit for your organization is
                    temporarily exhausted).
                  </s-banner>
                )}

                {locations.length === 0 ? (
                  <s-paragraph>No Shopify locations found.</s-paragraph>
                ) : (
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="save-warehouse-mapping"
                    />
                    <s-stack gap="base">
                      <s-paragraph color="subdued">
                        Match each Shopify location to the Zoho Inventory
                        warehouse that holds its stock.
                      </s-paragraph>

                      {locations.map((location) => (
                        <s-select
                          key={location.id}
                          name={`warehouse:${location.id}`}
                          label={location.name}
                          placeholder="Not mapped"
                          value={warehouseMappings[location.id] || ""}
                        >
                          {warehouses.map((warehouse) => (
                            <s-option
                              key={warehouse.warehouse_id}
                              value={warehouse.warehouse_id}
                            >
                              {warehouse.warehouse_name}
                            </s-option>
                          ))}
                        </s-select>
                      ))}

                      <s-button variant="primary" type="submit">
                        Save warehouse mapping
                      </s-button>
                    </s-stack>
                  </Form>
                )}
              </s-stack>
            </s-section>
          )}

          {activeSection === "tax" && connection && (
            <s-section heading="Tax settings">
              <s-stack gap="base">
                {taxSyncError && (
                  <s-banner heading="Couldn't load Zoho taxes" tone="warning">
                    Showing this form without live Zoho tax options. Use the
                    &quot;Refresh from Zoho&quot; button on the Organization
                    settings tab to try again.
                  </s-banner>
                )}

                <Form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value="save-tax-settings"
                  />
                  <s-stack gap="base">
                    <s-paragraph color="subdued">
                      Choose the Zoho Books tax (GST/VAT) to apply by default
                      when syncing orders and invoices.
                    </s-paragraph>

                    <s-select
                      name="defaultTaxId"
                      label="Default tax"
                      placeholder="No default tax"
                      value={taxSettings.defaultTaxId || ""}
                    >
                      {taxes.map((tax) => (
                        <s-option key={tax.tax_id} value={tax.tax_id}>
                          {tax.tax_name} ({tax.tax_percentage}%)
                        </s-option>
                      ))}
                    </s-select>

                    <s-checkbox
                      name="pricesIncludeTax"
                      value="true"
                      checked={Boolean(taxSettings.pricesIncludeTax)}
                      label="Shopify prices already include tax"
                    ></s-checkbox>

                    <s-button variant="primary" type="submit">
                      Save tax settings
                    </s-button>
                  </s-stack>
                </Form>
              </s-stack>
            </s-section>
          )}

          {activeSection === "accounts" && connection && (
            <s-section heading="Default accounts">
              <s-stack gap="base">
                {accountSyncError && (
                  <s-banner
                    heading="Couldn't load Zoho accounts"
                    tone="warning"
                  >
                    Showing this form without live Zoho account options. Use the
                    &quot;Refresh from Zoho&quot; button on the Organization
                    settings tab to try again.
                  </s-banner>
                )}

                <Form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value="save-account-settings"
                  />
                  <s-stack gap="base">
                    <s-paragraph color="subdued">
                      Choose which Zoho Books accounts synced sales and payments
                      should post against.
                    </s-paragraph>

                    <s-select
                      name="salesAccountId"
                      label="Sales account"
                      placeholder="No default sales account"
                      value={accountSettings.salesAccountId || ""}
                    >
                      {accounts
                        .filter(
                          (account) =>
                            account.account_type === "income" ||
                            account.account_type === "other_income",
                        )
                        .map((account) => (
                          <s-option
                            key={account.account_id}
                            value={account.account_id}
                          >
                            {account.account_name}
                          </s-option>
                        ))}
                    </s-select>

                    <s-select
                      name="paymentAccountId"
                      label="Payment account"
                      placeholder="No default payment account"
                      value={accountSettings.paymentAccountId || ""}
                    >
                      {accounts
                        .filter(
                          (account) =>
                            account.account_type === "bank" ||
                            account.account_type === "cash",
                        )
                        .map((account) => (
                          <s-option
                            key={account.account_id}
                            value={account.account_id}
                          >
                            {account.account_name}
                          </s-option>
                        ))}
                    </s-select>

                    <s-select
                      name="inventoryAccountId"
                      label="Inventory account"
                      placeholder="No inventory account (inventory tracking stays off)"
                      value={accountSettings.inventoryAccountId || ""}
                    >
                      {accounts.map((account) => (
                        <s-option
                          key={account.account_id}
                          value={account.account_id}
                        >
                          {account.account_name}
                        </s-option>
                      ))}
                    </s-select>
                    <s-paragraph color="subdued">
                      Required to enable inventory sync (usually named
                      &quot;Inventory Asset&quot; in your Zoho chart of
                      accounts). Zoho doesn&apos;t label this account type
                      distinctly from others, so the full list is shown here.
                    </s-paragraph>

                    <s-button variant="primary" type="submit">
                      Save default accounts
                    </s-button>
                  </s-stack>
                </Form>
              </s-stack>
            </s-section>
          )}
        </s-stack>
      </s-grid>
    </s-page>
  );
}
