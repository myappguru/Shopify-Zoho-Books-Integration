# Shopify ↔ Zoho Books/Inventory Integration — Scope Status

_Last updated: 2026-08-14, against branch `rushikesh`_

**Overall status: Integration Setup (Section A) through Payment Synchronization (Section F) all implemented and automatic via webhooks; inventory sync (Section G onward) not started.** Shopify app plumbing, navigation shell, and a database schema anticipating the target entities are in place. Zoho OAuth, organization settings, warehouse mapping, tax settings, and default account mapping are all implemented end-to-end on the Settings page. Products, customers, and orders sync Shopify → Zoho both on-demand ("Sync now" on their respective pages) and automatically via webhooks; invoices and payments are generated/recorded automatically when an order is paid, with a bulk backfill for already-paid orders built into the Orders page's "Sync now" too. Sections G-L below have no sync code yet.

**Testing status:** order → sales order sync (Section D) is manually confirmed working against a real dev-store order/Zoho account, after two real bugs were caught and fixed during that test (see Section D's note). Invoice creation (Section E) had a wrong-endpoint bug fixed but **has not been re-tested since** — `sync_mappings` shows zero invoice rows as of this update. Payment sync (Section F) is brand new code that **has never been run**. Click "Sync now" on the Orders page and check `sync_mappings`/`sync_logs` before treating either as working.

Legend: ✅ Implemented · 🟡 Partial (UI/schema only, no working logic) · ⬜ Not started

---

## 1. Objective

Automate sync of products, customers, orders, invoices, payments, and inventory between Shopify and Zoho Books/Inventory.

**Status: ⬜ Not started end-to-end.** No data flows between Shopify and Zoho yet in either direction.

---

## 2. Scope

### A. Integration Setup

| Item | Status | Evidence |
|---|---|---|
| Shopify store connection | ✅ | `app/shopify.server.js` — working `shopifyApp()` config, MySQL session storage |
| Zoho API authentication (OAuth) | ✅ | `app/zoho.server.js` (auth URL, signed state, code exchange, token refresh, org lookup), `app/routes/auth.zoho.callback.jsx` (OAuth callback), `app/models/zohoConnection.server.js` (persistence + `getValidAccessToken` auto-refresh). Dashboard and Settings "Connect"/"Disconnect" buttons are wired and functional. |
| Organization settings | ✅ | Settings page (`app/routes/app.settings.jsx`) shows the connected organization name/ID/data center and lets you disconnect. It now also pulls fresh org-level details from Zoho on every page load (`fetchOrganizationDetails` in `app/zoho.server.js`) — currency, fiscal year start month, time zone, language, date format, industry type, tax ID label/value, plan name — and caches them in `app_settings.settings` (`app/models/appSettings.server.js`) with a "Refresh from Zoho" button and a stale-data banner if the live call fails. |
| Warehouse mapping | ✅ | Settings page's "Warehouse mapping" section lists live Shopify locations (Admin GraphQL `locations` query) next to a dropdown of Zoho Inventory warehouses (`fetchWarehouses` in `app/zoho.server.js`, `GET /inventory/v1/warehouses`). Saved mapping is persisted per shop into `sync_mappings` (`entity_type = "warehouse"`) via `app/models/warehouseMapping.server.js` — no schema change needed, that table already fit shopify_id/zoho_id pairs. Organization details and the warehouse list are cached in `app_settings` with a 15-minute TTL and only re-fetched from Zoho on cache miss or an explicit "Refresh from Zoho" button — fetching live on every page view hit Zoho's org-wide API rate limit during testing. |
| Tax settings (GST/VAT) | ✅ | Settings page's "Tax settings" section lists live Zoho Books taxes (`fetchTaxes`, `GET /books/v3/settings/taxes`) in a "Default tax" dropdown, plus a "Shopify prices already include tax" checkbox. Saved into `app_settings.settings.taxSettings` (`{ defaultTaxId, pricesIncludeTax }`). |
| Default accounts / payment accounts | ✅ | Settings page's "Default accounts" section lists the live Zoho chart of accounts (`fetchChartOfAccounts`, `GET /books/v3/chartofaccounts`), filtered into a "Sales account" dropdown (`account_type` income/other_income) and a "Payment account" dropdown (bank/cash). Saved into `app_settings.settings.accountSettings` (`{ salesAccountId, paymentAccountId }`). |

### B. Product Synchronization

| Item | Status |
|---|---|
| Sync products Shopify → Zoho | ✅ |
| SKU, name, description, price, inventory qty, status | 🟡 (qty shown, not yet pushed into Zoho stock — see note) |
| Auto-create new products | ✅ |
| SKU mapping for existing products | ✅ |

`app/routes/app.products.jsx` lists live Shopify products/variants (Admin GraphQL) with a manual "Sync now" button. For each variant with a SKU: if already mapped, updates the existing Zoho Inventory item; if not, looks up by SKU (`fetchZohoItemBySku`) to link an existing Zoho item before creating a new one (`createZohoItem`) — avoiding duplicates. Syncs name, SKU, description, and price (`rate`), and active/inactive status via the dedicated `POST /items/{id}/active|inactive` endpoints (Zoho doesn't allow setting `status` through create/update). Mappings persist in `sync_mappings` (`entity_type = "product"`, `shopify_id` = variant GID, `zoho_id` = item_id); each run writes a summary row to `sync_logs` (`entity_type = "product"`), shown as a "Last sync" banner. Deliberately **not** creating Zoho items as inventory-tracked yet (no `track_inventory` field sent — passing it at all, even `false`, trips a Zoho validation bug returning a misleading "invalid Product Type" error, confirmed by testing directly against the API) — inventory tracking needs an account mapping this app hasn't collected, and it's what Section G (Inventory Synchronization) actually covers; Shopify's `inventoryQuantity` is displayed in the UI but not pushed to Zoho's stock ledger yet. Products are fetched 50 at a time with no pagination UI yet.

The per-variant sync logic (`buildZohoItemPayload`/`syncVariantToZoho`/`syncProductToZoho` in `app/models/productSync.server.js`) is shared between the manual button and three webhooks (`products/create`, `products/update`, `products/delete`, registered in `shopify.app.toml`) — so a product created, edited, or deleted directly in Shopify now syncs to Zoho automatically, not just when someone clicks "Sync now". A REST-webhook-payload normalizer (`normalizeRestProduct`) converts Shopify's classic webhook JSON shape into the same `{id, title, status, description, variants}` shape the GraphQL-based bulk sync uses. Each webhook delivery is logged to `webhook_logs`, keyed by Shopify's `webhook_id` (unique constraint) so redelivered webhooks are recognized and skipped rather than reprocessed.

`products/delete` deletes the matching Zoho item(s) outright (`deleteZohoItem`) when possible, falling back to deactivating (`setZohoItemActiveStatus(..., false)`) if Zoho refuses the delete because the item has transaction history — this required a schema change: `sync_mappings` gained a `shopify_parent_id` column (migration `20260813130000_add_parent_id_to_sync_mappings.js`) storing each variant mapping's parent product GID, since Shopify's delete webhook payload is just `{id}` with no variant info and there was previously no way to look up "which mappings belong to this product." Confirmed Zoho Books and Zoho Inventory share one underlying item catalog for a connected org (deleting via the Inventory API removes it from Books' item list too), so one delete call covers both.

### C. Customer Synchronization

| Item | Status |
|---|---|
| Auto-create customers in Zoho Books | ✅ |
| Update existing customer info | ✅ |
| Billing / shipping address sync | ✅ |
| Email & phone sync | ✅ |

`app/routes/app.customers.jsx` lists live Shopify customers (Admin GraphQL) with a manual "Sync now" button, mirroring the product-sync architecture exactly. For each customer with an email: if already mapped, updates the existing Zoho Books contact; if not, looks up by email (`fetchZohoContactByEmail`) to link an existing Zoho contact before creating a new one (`createZohoContact`) — avoiding duplicates. Syncs name (as `contact_name`/`contact_persons`), email, phone, and billing/shipping address (mapped from Shopify's `defaultAddress` into Zoho's `address`/`street2`/`state` field names). Mappings persist in `sync_mappings` (`entity_type = "customer"`, `shopify_id` = customer GID, `zoho_id` = contact_id); each run writes a summary row to `sync_logs` (`entity_type = "customer"`), shown as a "Last sync" banner, same as products.

The per-customer sync logic (`buildZohoContactPayload`/`syncCustomerToZoho` in `app/models/customerSync.server.js`) is shared between the manual button and three webhooks (`customers/create`, `customers/update`, `customers/delete`, registered in `shopify.app.toml`) — so a customer created, edited, or deleted directly in Shopify (or at checkout) now syncs to Zoho automatically. A REST-webhook-payload normalizer (`normalizeRestCustomer`) converts Shopify's classic webhook JSON shape into the same `{id, firstName, lastName, email, phone, address}` shape the GraphQL-based bulk sync uses. Each webhook delivery is logged to `webhook_logs` the same way as products.

`customers/delete` deletes the matching Zoho contact outright (`deleteZohoContact`) when possible, falling back to deactivating (`setZohoContactActiveStatus(..., false)`) if Zoho refuses the delete because the contact has transaction history (invoices, payments) — the same fallback pattern as `products/delete`. Unlike products, customers have no variant/parent hierarchy, so this needed no `sync_mappings` schema change — one mapping row per customer, looked up directly by `shopify_id`.

Not yet handled: multiple/non-default addresses (only `defaultAddress` syncs), B2B "company" contact type (`customer_sub_type` is hardcoded to `"individual"`), and Shopify's Protected Customer Data approval process (this app already requests `read_customers`/`write_customers` scopes, but accessing PII in production may require Shopify's separate protected-data review — untested here).

### D. Order Synchronization

| Item | Status |
|---|---|
| Sales orders, order date, line items, qty | ✅ |
| Discounts, shipping charges, taxes | ✅ |
| Coupon details, order notes | ✅ |

`app/routes/app.orders.jsx` lists live Shopify orders (Admin GraphQL) with a manual "Sync now" button. Each order becomes a Zoho Books **Sales Order** (not yet an Invoice — that's Section E, a distinct build step). The sync logic (`app/models/orderSync.server.js`) composes the product and customer sync already built:

- **Customer**: resolved via the exact same `syncCustomerToZoho` used by Section C, auto-creating/linking the Zoho contact on the fly if the order's customer hasn't synced yet. Guest checkouts (no linked Shopify customer account) fall back to a synthetic mapping key (`guest:<email>`) built from the order's email/billing address, so repeat guest orders from the same email reuse one Zoho contact instead of duplicating it.
- **Line items**: each resolved via the exact same `syncVariantToZoho` used by Section B, auto-creating/linking the Zoho item on the fly if that variant hasn't synced yet. Line items without a SKU or a real variant (custom/manual line items) are skipped, same as product sync skips SKU-less variants; if every line item on an order gets skipped, the whole order sync is skipped (Zoho requires at least one line item).
- **Tax/discount/shipping/notes**: `defaultTaxId` and `pricesIncludeTax` come from the Settings page's tax settings (Section A) and are applied to every line item / the order as `tax_id` / `is_inclusive_tax`. Shopify's order-level discount and shipping totals map to Zoho's `discount`/`shipping_charge` fields. The order note and any discount/coupon codes are concatenated into Zoho's `notes` field (Zoho has no first-class coupon-code field). The Shopify order number is stored as `reference_number` for traceability.
- **Not yet used**: `accountSettings.salesAccountId` — Zoho sales order line items use each item's own configured income account, so this setting isn't consumed by Sections D/E; only `paymentAccountId` gets used, by Section F.

Mappings persist in `sync_mappings` (`entity_type = "order"`, `shopify_id` = order GID, `zoho_id` = salesorder_id). The webhooks (`orders/create`, `orders/updated`, `orders/cancelled`, registered in `shopify.app.toml`) reuse the same `syncOrderToZoho` via a `normalizeRestOrder` REST-payload normalizer, matching the products/customers pattern. `orders/cancelled` **voids** the Zoho sales order (`voidZohoSalesOrder`) rather than deleting it — the Shopify order still exists, just cancelled, so the accounting record is kept and the mapping row's status is set to `voided` rather than being removed.

Once a sales order actually has an invoice against it (Section E), Zoho locks its line items from further edits — a later `updateZohoSalesOrder` call returns Zoho error code `36023` ("not allowed to update or delete a product which is marked as invoiced"). `syncOrderToZoho` treats that specific code as an expected terminal state (order is finished, nothing left to sync) rather than a failure, refreshing the mapping's `last_synced_at` instead of marking it `error`.

**Manually tested and confirmed working** against a real dev-store order and Zoho account (2026-08-14).

### E. Invoice Creation

| Item | Status |
|---|---|
| Auto-generate invoice on order created/paid | ✅ (on paid; see note) |
| Invoice includes customer, products, tax, shipping, discounts, currency | ✅ |

`app/models/invoiceSync.server.js` generates a Zoho Books **Invoice** by converting the order's existing Zoho **Sales Order** (Section D) via Zoho's "create invoice from sales order" endpoint (`POST /books/v3/invoices/fromsalesorder?salesorder_id=...`) — rather than rebuilding customer/line-item/tax/discount/shipping data a second time, the invoice inherits all of it directly from the sales order that's already there. This is triggered by Shopify's `orders/paid` webhook, which fires when an order's financial status becomes "paid" — whether that's immediate (card payment at checkout) or later (manual/bank-transfer terms). If the order hasn't been synced to Zoho as a sales order yet (e.g. Zoho wasn't connected when the order came in), the sales order is created on the spot via the same `syncOrderToZoho` from Section D before being converted, so a payment webhook never has to wait on someone visiting the Orders page first.

Mappings persist in `sync_mappings` (`entity_type = "invoice"`, `shopify_id` = order GID, `zoho_id` = invoice_id). Unlike products/customers/orders, invoice sync has no "update" path — once an order has an invoice mapping, repeat `orders/paid` deliveries are skipped as already-invoiced (an invoice is a one-time accounting document, not something to keep re-syncing). Invoice status (Invoiced / Not invoiced / Invoice error) is shown as a badge on the existing Orders page — there's no separate "Invoices" nav item/page, since none was in the original 8-page nav shell.

**Bugs found and fixed during testing:**
1. The endpoint originally used (`POST /salesorders/{id}/invoices`) doesn't exist in Zoho's API and returned `"Invalid URL Passed"` on every attempt. Verified the correct endpoint (`/invoices/fromsalesorder`) by pulling Zoho's raw API doc HTML directly rather than trusting a summarized fetch, which had given a subtly wrong answer.
2. After fixing #1, invoice creation started failing with a different Zoho error: `code 36026, "There are no items in this sales order to be invoiced."` — these particular test sales orders had already been fully invoiced by something outside this app's tracking (confirmed via a live diagnostic query: `status: "invoiced"`, full `invoiced_quantity` on every line item — most likely earlier manual testing directly in Zoho's own UI). First attempted a fix matching by `reference_number`, but that proved unreliable — Zoho's own "convert to invoice" UI action doesn't carry over the sales order's custom `reference_number` to the resulting invoice (confirmed by inspecting live data: the existing invoices had reference numbers like `"SO-00001"` that didn't correlate to either the Shopify order number or the sales order's own `salesorder_number`). The real, reliable fix: a sales order's own detail response (`GET /salesorders/{id}`) includes Zoho's authoritative `invoices: [{invoice_id, ...}]` link array regardless of how the invoice was created — `fetchZohoSalesOrder` in `zoho.server.js` fetches this, and `syncInvoiceForOrder` adopts `invoices[0].invoice_id` when Zoho reports code 36026, the same "link to existing instead of failing/duplicating" pattern already used for products (SKU) and customers (email).

**Not yet re-tested after fix #2's correction** (the reference_number approach was tried, found unreliable via live data inspection, and replaced with the sales-order-detail approach above, all before re-running "Sync now"). Click "Sync now" on the Orders page again and check for `entity_type = "invoice"` rows in `sync_mappings` before treating this as done.

### F. Payment Synchronization

| Item | Status |
|---|---|
| Record payment against invoice | ✅ |
| Payment method mapping | ✅ |
| Payment date | ✅ |
| Partial payment support | ⬜ |

`app/models/paymentSync.server.js` records a Zoho Books **customer payment** and applies it against the order's invoice in a single call (`POST /books/v3/customerpayments`, with an `invoices: [{invoice_id, amount_applied}]` array — Zoho creates and applies the payment together, no separate "apply payment" step needed). This is where `accountSettings.paymentAccountId` from the Settings page finally gets used, as the payment's deposit `account_id`.

- **Amount**: Shopify's own order total (`totalPrice`/`total_price`) — the authoritative "what was actually charged" figure, rather than re-deriving it from line items/tax/shipping/discount.
- **Payment method mapping**: Shopify's `payment_gateway_names` (e.g. `shopify_payments`, `paypal`, `bank_transfer`, `manual`/`cash`) are mapped to one of Zoho's fixed `payment_mode` values (`check`, `cash`, `creditcard`, `banktransfer`, `bankremittance`, `autotransaction`, `others` — Zoho doesn't accept arbitrary gateway names) via `mapPaymentMode()`, falling back to `"others"` for anything unrecognized.
- **Payment date**: the order's `updatedAt`/`updated_at` at the time it was marked paid (falls back to `createdAt` if unavailable).
- **Customer**: resolved from the customer mapping already established during order/invoice sync (Section C/D) — no new Zoho contact lookup needed.

`syncInvoiceAndPaymentForOrder()` composes Sections E and F into a single entry point (ensure invoice exists → record payment against it), used by both the `orders/paid` webhook (`webhooks.orders.paid.jsx`, now pointing at `paymentSync.server.js` instead of `invoiceSync.server.js`) and the Orders page "Sync now" backfill, so the two call sites can't drift apart. Payment status (Paid / Not recorded / Payment error) is shown as its own badge column on the Orders page, alongside Sync and Invoice.

Like invoice sync, payment sync is one-shot/non-idempotent-by-design — once an order has a payment mapping, it's left alone rather than re-recorded.

**Not yet implemented:** partial payment support (only orders with `displayFinancialStatus` exactly `PAID` are picked up; `PARTIALLY_PAID` is left alone, matching Section E's same restriction — full partial-payment handling is really Section I/refund-adjacent scope).

**Not yet tested at all.** This code was just written and has never been run against a real order/Zoho account — `sync_mappings` has zero `entity_type = "payment"` rows. Click "Sync now" on the Orders page to exercise it for the first time.

### G. Inventory Synchronization

| Item | Status |
|---|---|
| Shopify → Zoho | ⬜ |
| Zoho → Shopify | ⬜ |
| Prevent overselling | ⬜ |
| Warehouse stock sync | ⬜ |
| Multi-location inventory | ⬜ |

`app/routes/app.inventory.jsx` is a placeholder page.

### H. Order Status Synchronization

| Item | Status |
|---|---|
| Pending / Confirmed / Paid / Cancelled / Refunded / Fulfilled | ⬜ |

No status-mapping logic exists.

### I. Refund & Cancellation

| Item | Status |
|---|---|
| Sync cancelled orders | ⬜ |
| Create credit notes | ⬜ |
| Record refunds | ⬜ |
| Reverse inventory | ⬜ |

Not started.

### J. Tax Mapping

| Item | Status |
|---|---|
| GST/VAT mapping | ⬜ |
| Tax-inclusive/exclusive pricing | ⬜ |
| Shipping tax | ⬜ |
| Discount tax handling | ⬜ |

Not started.

### K. Shipping Details

| Item | Status |
|---|---|
| Shipping method | ⬜ |
| Shipping charges | ⬜ |
| Tracking number | ⬜ |
| Courier details | ⬜ |

Not started.

### L. Reporting Validation

| Item | Status |
|---|---|
| Sales reports | ⬜ |
| Inventory reports | ⬜ |
| Customer reports | ⬜ |
| Payment reconciliation | ⬜ |

`app/routes/app.sync-history.jsx` is a placeholder. `sync_logs` and `webhook_logs` tables exist as schema scaffolding (entity type, direction, records processed/succeeded/failed, error message, metadata) but nothing writes to or reads from them yet.

---

## 3. Testing

| Item | Status |
|---|---|
| Connection testing | ⬜ |
| Product/customer/order/invoice/payment/inventory sync testing | ⬜ |
| Refund testing | ⬜ |
| End-to-end UAT | ⬜ |

No test files, `__tests__` directories, or Cypress/Playwright config exist in the repo.

---

## What IS actually working today (infrastructure, non-Zoho)

- **Shopify OAuth & sessions** — `app/shopify.server.js`, real working config via `@shopify/shopify-app-react-router` + MySQL session storage.
- **DB connectivity** — `app/db.server.js` (mysql2 pool), `knexfile.js` (migrations only; not used elsewhere in app code).
- **DB schema** — 6 Knex migrations: `shops`, `zoho_connections`, `sync_mappings`, `sync_logs`, `webhook_logs`, `app_settings`. All 6 tables are now used: `app_settings` (settings cache), `sync_mappings` (`entity_type` "warehouse", "product", "customer", "order", and "invoice"), `sync_logs` (one row per manual "Sync now" run), and `webhook_logs` (one row per webhook delivery).
- **Shopify webhooks** — `webhooks.app.uninstalled.jsx`, `webhooks.app.scopes_update.jsx` (template boilerplate) plus `webhooks.products.create/update/delete.jsx`, `webhooks.customers.create/update/delete.jsx`, `webhooks.orders.create/updated/cancelled.jsx`, and `webhooks.orders.paid.jsx` (route the same Zoho sync logic used by their respective manual "Sync now" buttons where applicable, see Sections B, C, D, and E).
- **Navigation shell** — `app/routes/app.jsx` — Polaris + App Bridge nav linking all 8 planned pages.
- **Dashboard** — `app/routes/app._index.jsx` — static UI mockup (connection badge, stat tiles hardcoded to 0, "Sync Now"/"Connect" buttons with no handlers).
- **Help & Support page** — the one genuinely functional non-Zoho page (Tawk.to widget, mailto link, App Store review link, dismissible banner via localStorage).
- **i18n** — `app/locales/` with 20+ languages, wired into all pages via `useTranslation`.
- **Theme extension** — `extensions/zoho-embed/blocks/zoho-sync-badge.liquid` — cosmetic storefront badge only, no real data binding.
- **Dependencies** — Shopify/Polaris/App Bridge + `knex`/`mysql2` installed. **No Zoho SDK, no HTTP client (axios/node-fetch) installed yet** — a blocker for starting any Zoho API work.

---

## Suggested next steps (build order)

1. ~~Implement Zoho OAuth (token exchange + refresh), persisting to `zoho_connections`. Wire the dashboard "Connect" button to it.~~ **Done 2026-08-12.** (Used Node's built-in `fetch` — no new HTTP client dependency needed. OAuth is opened in a new browser tab via `window.open`, not inside the embedded admin iframe, because Shopify's `authenticate.admin` session doesn't carry over to a bare top-level navigation; the callback instead trusts an HMAC-signed `state` param. Handles Zoho's multi-data-center accounts servers correctly — the callback reads the `accounts-server` query param Zoho provides and uses it for the token exchange/refresh, rather than assuming every merchant is on `accounts.zoho.com`; this matters because the app is public and merchants can be on any Zoho region: .com, .in, .eu, .com.au, etc.)
2. ~~Build organization settings UI backed by `app_settings`.~~ **Done 2026-08-13.** (Settings page now live-fetches full org details from Zoho Books (`GET /books/v3/organizations/{id}`) on every load via `fetchOrganizationDetails`, and caches them into `app_settings.settings.organization` via `mergeAppSettings`. Shows currency, fiscal year start month, time zone, language, date format, industry type, tax ID label/value, and Zoho plan name, with a manual "Refresh from Zoho" button and a stale-data fallback/banner if the live call fails.)
3. ~~Add warehouse mapping UI.~~ **Done 2026-08-13.** (Settings page's "Warehouse mapping" section pairs live Shopify locations against live Zoho Inventory warehouses in a per-location dropdown; saved into `sync_mappings` with `entity_type = "warehouse"`, `shopify_id` = location GID, `zoho_id` = warehouse_id.)
4. ~~Add tax settings (GST/VAT) and default account/payment account mapping UI.~~ **Done 2026-08-13.** (Settings page's "Tax settings" section: default-tax dropdown from live Zoho taxes + a "prices include tax" checkbox, saved to `app_settings.taxSettings`. "Default accounts" section: sales-account and payment-account dropdowns from the live Zoho chart of accounts, saved to `app_settings.accountSettings`. All of Integration Setup (Section A) is now ✅. Along the way, switched organization/warehouses/taxes/accounts to a 15-minute cache-then-refresh pattern in `app_settings` after live per-page-load fetching hit Zoho's org-wide daily API rate limit during testing — see `loadZohoList`/`loadOrganizationSettings` in `app/routes/app.settings.jsx`.)
5. ~~Implement product sync (Shopify → Zoho first, one direction) using `sync_mappings` for SKU mapping.~~ **Done 2026-08-13.** (Manual "Sync now" button on `app/routes/app.products.jsx`; see Section B above for the full breakdown. Inventory-tracking the Zoho items themselves is deferred to step 8.)
6. ~~Add Shopify webhook subscriptions and route them into sync logic, logging to `webhook_logs`.~~ **Done 2026-08-13, for products.** (`products/create`/`products/update` reuse the exact same sync code as the "Sync now" button; `products/delete` deletes-or-deactivates the matching Zoho item(s). See Section B for the full breakdown. Order/inventory webhooks still need to be added once those sync features themselves exist below.)
7. ~~Implement customer sync (Shopify → Zoho, one direction) using `sync_mappings` for email-based mapping, plus webhooks.~~ **Done 2026-08-14.** (Manual "Sync now" button on `app/routes/app.customers.jsx`, sync logic in `app/models/customerSync.server.js`, webhooks `customers/create`/`update`/`delete`. See Section C for the full breakdown — built as a direct mirror of the product-sync architecture from step 5/6.)
7b. ~~Implement order sync (Shopify → Zoho, as Zoho Sales Orders) composing product + customer sync, consuming `taxSettings` from step 4.~~ **Done 2026-08-14, not yet manually tested.** (Manual "Sync now" button on `app/routes/app.orders.jsx`, sync logic in `app/models/orderSync.server.js`, webhooks `orders/create`/`updated`/`cancelled`. See Section D for the full breakdown.)
7c. ~~Implement invoice creation (Zoho Sales Order → Zoho Invoice) triggered by `orders/paid`.~~ **Done 2026-08-14, not yet manually tested.** (Sync logic in `app/models/invoiceSync.server.js`, webhook `orders/paid`, invoice status badge added to `app/routes/app.orders.jsx` in lieu of a dedicated Invoices page. See Section E for the full breakdown.) Next: payment sync - this is where `accountSettings` from step 4 finally gets consumed.
8. Add inventory bidirectional sync + oversell prevention — this is where the warehouse mapping from step 3 gets consumed.
9. Add refund/cancellation, tax mapping, shipping detail handling.
10. Build reporting views off `sync_logs`.
11. Add automated tests (unit + integration) and a UAT pass.
