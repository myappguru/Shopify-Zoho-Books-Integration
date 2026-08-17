# Shopify ↔ Zoho Books/Inventory Integration — Scope Status

_Last updated: 2026-08-17, against branch `rushikesh`_

**Overall status: Integration Setup (Section A) through Inventory Synchronization (Section G) are fully implemented and manually confirmed working end-to-end against a real dev store/Zoho account (2026-08-17), including oversell prevention.** Shopify app plumbing, navigation shell, and a database schema anticipating the target entities are in place. Zoho OAuth, organization settings, warehouse mapping, tax settings, and default account mapping (now including an Inventory account) are all implemented end-to-end on the Settings page. Products, customers, and orders sync Shopify → Zoho both on-demand ("Sync now" on their respective pages) and automatically via webhooks; invoices and payments are generated/recorded automatically when an order is paid, with a bulk backfill for already-paid orders built into the Orders page's "Sync now" too. Order Status Sync (Section H) and Refund & Cancellation (Section I) are now also feature-complete — Section H's one real gap (Fulfilled) was built as a Zoho Package + Shipment Order, and Section I's two real gaps (credit notes + refunds) were built on top of it; both are awaiting first live test. Sections J-L below have no sync code yet.

**Testing status (updated 2026-08-17, verified via direct DB queries against the real dev store/Zoho account, not inferred):** Order sync (Section D) — ✅ confirmed, 5/5 orders synced. Invoice sync (Section E) — ✅ confirmed, 5 invoice mappings exist and synced. Payment sync (Section F) — ✅ confirmed working for 4 of 5 test orders (4 payment mappings, `synced`); the 5th (order #1001) hit a real bug during this test, now fixed (see below) — its own Zoho invoice is left under-valued as pre-existing bad data, not retried automatically. Inventory sync (Section G) — ✅ confirmed both directions: Shopify→Zoho webhook correctly pushes/skips (`webhook_logs` shows real activity, including correct no-op skips when Zoho already matches), Zoho→Shopify pull confirmed with a real run of 19/19 successful updates.

**Real bug found and fixed during this test:** order #1001's payment failed with Zoho error `24016` ("amount entered is more than the balance due"). Root cause: `orderSync.server.js`'s line-item resolution, when re-syncing an order whose variant was already linked to a Zoho item, rebuilt a synthetic product+variant pair from just the order's line item data and called the same update path the Products page uses — renaming the item using a duplicated title (`"X - X"` instead of its real `"X - Special X"`), which collided with a different item and failed (Zoho code 1001, "Item already exists"), silently dropping that line item from the Zoho sales order and undercounting the invoice by the dropped item's value ($49.95 of $149.75). Fixed: order sync now reuses an already-linked Zoho item directly instead of re-running the update - it only needs the link, not a second, worse source of truth for the item's name/price (which would also have overwritten the catalog rate with that one order's price). Also added the same `describeZohoError` detail-capturing pattern already used elsewhere to `productSync.server.js`/`customerSync.server.js`, since the generic `.message`-only error is what hid this for so long. Order #1001's own Zoho invoice is still under-valued from before this fix (needs a manual correction directly in Zoho, or can be left as a known one-off) - the fix prevents this for future orders, it doesn't retroactively repair this one.

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
- **Line items**: for a variant that's *already* linked to a Zoho item, the existing `zohoItemId` is reused directly rather than calling `syncVariantToZoho` again — that update path was tried initially, but re-running it from an order's line-item data (which only has `lineItem.title`, not a separate product/variant title) rebuilds a duplicated, incorrect item name, confirmed live to collide with a different item and fail (Zoho code 1001, "Item already exists"), silently dropping that line item from the order and undercounting its total (found via a real payment-sync failure, see Section F). Only genuinely new/unmapped variants still go through the full `syncVariantToZoho` create-or-link flow. Line items without a SKU or a real variant (custom/manual line items) are skipped, same as product sync skips SKU-less variants; if every line item on an order gets skipped, the whole order sync is skipped (Zoho requires at least one line item).
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

**Retested 2026-08-17 and confirmed working** — `sync_mappings` shows 5 `entity_type = "invoice"` rows, all `status = "synced"`.

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

**Tested 2026-08-17 and confirmed working for 4 of 5 orders** — `sync_mappings` shows 4 `entity_type = "payment"` rows, `status = "synced"`. The 5th (order #1001) hit a real bug (now fixed — see the top-of-document testing note and Section D's line-item resolution fix) that left its own Zoho invoice permanently under-valued; that one order's bad data wasn't retroactively repaired, so it'll keep failing payment sync until someone corrects the invoice directly in Zoho or writes it off.

### G. Inventory Synchronization

| Item | Status |
|---|---|
| Shopify → Zoho | ✅ (live, webhook-driven; untested against real data) |
| Zoho → Shopify | ✅ (manual "Pull from Zoho" on the Inventory page; untested against real data) |
| Prevent overselling | ✅ (enforces Shopify's own inventoryPolicy=DENY; confirmed live 2026-08-17) |
| Warehouse stock sync | ✅ (reuses Section A's warehouse mapping) |
| Multi-location inventory | ✅ (one adjustment per Shopify location, via its mapped Zoho warehouse) |

`app/models/inventorySync.server.js` (`syncInventoryLevelToZoho`) pushes a Shopify location's `available` quantity for one variant into Zoho as an inventory **adjustment**. Zoho's adjustment API only accepts a signed delta, not an absolute "set to N", so the item's current `warehouse_stock_on_hand` at that warehouse is fetched first (`fetchZohoItem`) and the difference is computed before calling `createZohoInventoryAdjustment` (`POST` to Zoho's inventory adjustments endpoint, both added to `app/zoho.server.js`). Requires both the variant (Section B mapping) and the Shopify location (Section A warehouse mapping) to already be mapped — either missing, or the Zoho item not being inventory-tracked, causes a skip rather than a guess.

Triggered by Shopify's `inventory_levels/update` webhook (`app/routes/webhooks.inventory_levels.update.jsx`, topic registered in `shopify.app.toml`). That webhook's payload is unusually thin — just `{ inventory_item_id, location_id, available }`, no SKU/variant/product — so the handler resolves the inventory item back to its variant via an Admin GraphQL call using the `admin` client `authenticate.webhook` provides.

A new **Inventory account** dropdown was added to Settings' "Default accounts" section (`accountSettings.inventoryAccountId`, from the same live chart-of-accounts fetch as the sales/payment account dropdowns). Product sync (`buildZohoItemPayload` in `app/models/productSync.server.js`) now conditionally sends `track_inventory: true` + `inventory_account_id` when this setting is present — without it, items are created untracked exactly as before Section G existed. This field is deliberately all-or-nothing: sending `track_inventory: false` (or `true` with no account id) trips a Zoho validation bug that returns a misleading "invalid Product Type" error, confirmed during Section B's original build.

`app/routes/app.inventory.jsx` is now a real status/activity page (was a placeholder) — shows whether Zoho is connected, whether an inventory account is set, whether any warehouse mapping exists, and the 10 most recent `INVENTORY_LEVELS_UPDATE` webhook_logs rows, each labeled with the actual product/variant/location it was about (see below).

**UI fixes (2026-08-17):** the activity log originally collapsed every non-error outcome into a single `"processed"` badge, hiding whether Zoho was actually updated or the sync silently skipped (no inventory account set, item unmapped, warehouse unmapped, or already in sync) — this made the "Inventory account not set" warning above it look contradicted by activity appearing below. Fixed by having `webhooks.inventory_levels.update.jsx` pass through the real outcome (`synced`/`skipped`/`failed`) and the skip reason. Separately, the log only ever showed a raw Shopify GID (`resource_id`) with no product name, so it was impossible to tell *which* product/variant/location a row was about — added a `resource_label` column to `webhook_logs` (migration `20260817120000_add_resource_label_to_webhook_logs.js`) populated from an expanded Admin GraphQL query (variant SKU/title/product title + location name), rendered as e.g. `"Blue T-Shirt - Large (SKU BTS-L) @ Warehouse A — available: 42"`.

**Zoho → Shopify** (2026-08-17): added as a manual "Pull from Zoho" button on the same Inventory page, not a webhook — Zoho has no equivalent of Shopify's signed third-party webhooks; getting Zoho to notify this app in real time would require the user to hand-configure a Workflow Rule + webhook URL inside Zoho's own UI (decided against for the first pass; can revisit if real-time turns out to matter). Clicking it (`fetchZohoStockForMappedProducts` in `app/models/inventorySync.server.js`) reads every mapped product's current stock at every mapped Zoho warehouse, resolves each one back to its Shopify variant/location pair, and diffs against Shopify's live quantity (fetched via one batched Admin GraphQL `nodes()` query covering every mapped variant) — only pairs that actually differ get written, via a single `inventorySetQuantities` mutation call for the whole batch. This button doubles as the "bulk backfill" item, since it checks every mapping every time rather than only recently-changed ones.

**Loop safety**: pushing a Zoho quantity into Shopify triggers the Shopify `inventory_levels/update` webhook (the Shopify → Zoho direction above), which re-fetches the Zoho item and computes a delta against it — since the pull just set Shopify to match Zoho, that delta is zero and the webhook skips creating a new adjustment, so the loop stops after one hop. This wasn't new code — it fell out of the existing delta-based skip logic in `syncInventoryLevelToZoho` — but is worth remembering as the reason a bidirectional inventory sync doesn't spiral.

**Real bug found and fixed (2026-08-17), not just a UI issue:** the Warehouse mapping dropdown on Settings was empty for this user's org, and it turned out to be because `fetchWarehouses` in `app/zoho.server.js` called `/inventory/v1/warehouses` — the standalone **Zoho Inventory app's** warehouse collection, which is empty for an org that only uses **Zoho Books' own native multi-location inventory feature** (Settings → Locations in Zoho's UI). Confirmed live: `/books/v3/locations` returns this org's real locations ("Head Office", "World Center"), and a real synced item's own detail response reports per-location stock under `item.locations[]` (`location_id`/`location_stock_on_hand`) — not `item.warehouses[]` (`warehouse_id`/`warehouse_stock_on_hand`), which is what `syncInventoryLevelToZoho` and `fetchZohoStockForMappedProducts` in `app/models/inventorySync.server.js` were reading. **This meant the entire Section G feature (both directions) was non-functional for any org in this situation** — not just cosmetically empty, since even a saved mapping would never have matched any location. Fixed by pointing `fetchWarehouses` at `/books/v3/locations` (remapped to the `warehouse_id`/`warehouse_name` shape the rest of the app already expects, to avoid a wider rename) and switching both inventory-sync functions to read `item.locations[]`. `createZohoInventoryAdjustment`'s own `location_id` field needed no change — a comment already in that function correctly anticipated this exact naming split. The Settings page's warehouse list is cached for 15 minutes (`app_settings`), so after this fix a user needs to click "Refresh from Zoho" (Organization settings tab) rather than just reloading.

**Second real bug, found on first actual click of "Sync now" (2026-08-17):** Shopify's `inventorySetQuantities` mutation in `app.inventory.jsx` threw `Field is not defined on InventorySetQuantitiesInput` for `ignoreCompareQuantity`. Verified against Shopify's live Admin GraphQL schema (API version 2026-07) via the Shopify AI Toolkit's admin-docs search + validator: `ignoreCompareQuantity` is not a field on `InventorySetQuantitiesInput` in this API version (older doc examples referencing it are stale) — its compare-and-set behavior is now controlled per quantity entry by simply omitting `compareQuantity`/`changeFromQuantity`, and separately, **as of API version 2026-04 this mutation requires an idempotency key via the `@idempotent(key: ...)` directive**, which the original call didn't provide at all. Fixed by adding a `$idempotencyKey: String!` variable + `@idempotent(key: $idempotencyKey)` on the mutation selection (one fresh `crypto.randomUUID()` per batch call), and dropping `ignoreCompareQuantity` from the input entirely. A second attempt then hit `InventoryQuantityInput must include the following argument: changeFromQuantity` — that field turned out to be mandatory-but-nullable: it must be explicitly present (even as `null`, which is how you opt out of its compare-and-swap check) rather than simply omitted. Fixed by adding `changeFromQuantity: null` to each entry.

**Overselling prevention (2026-08-17):** an accurate synced stock number alone doesn't stop a merchant from overselling - Shopify only blocks checkout at zero if the variant's own `inventoryPolicy` is `DENY` (`CONTINUE` allows selling past zero, i.e. backorders). Confirmed the correct current mutation via the Shopify AI Toolkit before writing anything (`productVariantsBulkUpdate` with `variants: [{ id, inventoryPolicy: "DENY" }]` - the schema was validated live, not assumed). `denyOversellForVariant()` in `app/models/productSync.server.js` calls this whenever a variant becomes inventory-tracked (i.e. whenever `inventoryAccountId` is set and a sync succeeds) - wired into the Products page's "Sync now"/Dashboard's "Sync everything" (both pass `admin` through), the `products/create`/`products/update` webhooks (both updated to pass `admin` from `authenticate.webhook`), and the direct Orders "Sync now" path for a variant discovered for the first time via an order's line items. Deliberately **not** threaded into every order-related call site (the `orders/*` webhooks, or the invoice/payment-triggered on-the-fly order sync) - those are a comparatively rare edge case (a variant that's never once been touched by product sync, only ever seen through a webhook-driven order), and `admin` is optional throughout this feature specifically so those paths degrade to a safe no-op rather than needing every caller updated. Always sends the mutation (not conditionally checked against the variant's current policy first) since nothing in this app currently reads that field - a same-value update is a harmless no-op.

**Confirmed live 2026-08-17** — queried the 5 most recently product-synced variants directly via the Admin API after a "Sync now" run: all show `inventoryPolicy: "DENY"` and `inventoryItem.tracked: true`.

**Tested 2026-08-17, both directions confirmed working.** Shopify → Zoho: `webhook_logs` shows real `INVENTORY_LEVELS_UPDATE` activity, correctly resolving variants/locations and correctly skipping when Zoho's stock already matches (no spurious adjustments). Zoho → Shopify: a "Pull from Zoho" run (`sync_logs`, `entity_type = "inventory"`) shows 19/19 successful updates in one run, with a later run correctly showing 0/0 (nothing left to change, confirming the idempotent-diff behavior works as intended rather than just always writing).

### H. Order Status Synchronization

| Item | Status |
|---|---|
| Pending / Confirmed | ✅ (implicit — sales order exists once Section D syncs it) |
| Paid | ✅ (Section E/F — invoice + payment) |
| Cancelled | ✅ (Section D — `orders/cancelled` voids the Zoho sales order) |
| Refunded | ⬜ (Section I scope) |
| Fulfilled | ✅ (built 2026-08-17, not yet manually tested — see below) |

Every other status was already covered by Sections D/E/F under a different name; the one genuine gap was **Fulfilled** — nothing recorded a shipment on the Zoho side when an order shipped in Shopify. Built as a Zoho **Package + Shipment Order** (the real Zoho Inventory records for "these items shipped"), not just a notes-field annotation, per an explicit build-approach choice.

`app/models/fulfillmentSync.server.js` (`syncFulfillmentToZoho`), triggered by Shopify's `fulfillments/create` webhook (`app/routes/webhooks.fulfillments.create.jsx`, topic registered in `shopify.app.toml`):
- Looks up the order's Zoho sales order via the existing order mapping (Section D) — skips (not an error) if the order hasn't synced to Zoho yet.
- Fetches the sales order's own line items (`fetchZohoSalesOrder`) and matches them to the fulfillment's line items by SKU to get each one's `line_item_id` — mirrors the SKU-matching convention used throughout Sections B–D. Fulfilled lines with no SKU match (e.g. a line item never synced to the sales order) are left out of the package rather than failing the whole shipment; if nothing matches, the whole fulfillment is skipped.
- `createZohoPackage` (`POST /inventory/v1/packages`) then `createZohoShipmentOrder` (`POST /inventory/v1/shipmentorders`, referencing that package) — both added to `app/zoho.server.js`, endpoints verified live against this org's actual Zoho account (confirmed via a real `GET` call that this org's Zoho Books-native-locations setup can still use the Packages/Shipment Orders API, despite lacking a full Zoho Inventory warehouse subscription per Section G's earlier finding). Zoho requires non-empty `delivery_method`/`tracking_number` on the shipment even though a Shopify fulfillment can have either blank — falls back to `"Other"`/the fulfillment's own name rather than sending an empty string.
- Mapping persists in `sync_mappings` (`entity_type = "fulfillment"`, `shopify_id` = fulfillment GID, `zoho_id` = shipment_id) so a redelivered webhook is a no-op.

**Not yet manually tested** — needs a real Shopify fulfillment triggered against an order that's already synced to Zoho (Section D), plus a dev-server restart so `shopify.app.toml`'s new `fulfillments/create` subscription actually registers.

### I. Refund & Cancellation

| Item | Status |
|---|---|
| Sync cancelled orders | ✅ (already existed — Section D's `orders/cancelled` voids the Zoho sales order) |
| Create credit notes | ✅ (built 2026-08-17, not yet manually tested — see below) |
| Record refunds | ✅ (built 2026-08-17, not yet manually tested — see below) |
| Reverse inventory | ✅ (falls out of Section G's existing webhook, no new code needed — see below) |

`app/models/refundSync.server.js` (`syncRefundToZoho`), triggered by Shopify's `refunds/create` webhook (`app/routes/webhooks.refunds.create.jsx`, topic registered in `shopify.app.toml`):
- Looks up the order's Zoho **invoice** via the existing invoice mapping (Section E) — a refund only makes sense against something that was actually invoiced, so this skips (not an error) if the order was never invoiced in Zoho.
- Fetches the invoice's own line items (`fetchZohoInvoice`, new in `app/zoho.server.js`) and matches them to the refund's line items by SKU to get each one's `line_item_id`/`item_id` — same SKU-matching convention as Sections D/H. Refunded lines with no SKU match are left out of the credit note rather than failing the whole refund; if nothing matches, the whole refund is skipped.
- `createZohoCreditNote` (`POST /books/v3/creditnotes`) creates a Zoho **Credit Note** referencing the invoice's line items directly (`invoice_id`/`invoice_item_id` on each credit note line) so Zoho pulls the correct price/tax from the invoice rather than needing it recomputed here. This deliberately does **not** reduce the invoice's own balance — the invoice stays a clean paid-in-full historical record (Section F); the credit note is Zoho's separate "customer is owed X back" document.
- If the refund actually moved money (Shopify's webhook payload's `transactions` array has a `kind: "refund"` entry — a pure restock-only correction can legitimately have none), `createZohoCreditNoteRefund` (`POST /creditnotes/{id}/refunds`) records the real payout, reusing `paymentSync.server.js`'s existing `mapPaymentMode()` for the refund method and Settings' `paymentAccountId` (Section A) as the account it's paid back out of.
- Mapping persists in `sync_mappings` (`entity_type = "refund"`, `shopify_id` = refund GID, `zoho_id` = creditnote_id) so a redelivered webhook is a no-op.
- **Reverse inventory needed no new code**: Shopify itself adjusts its own inventory levels when a refund line item's `restock_type` isn't `"no_restock"`, which fires the existing `inventory_levels/update` webhook (Section G) and pushes the corrected quantity into Zoho through that already-built path — verified by inspection of Shopify's own refund/restock behavior, not something this feature needed to duplicate.

**Not yet manually tested** — needs a real Shopify refund issued against an order that's already been invoiced in Zoho (Section E), plus a dev-server restart so `shopify.app.toml`'s new `refunds/create` subscription actually registers.

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
8. ~~Add inventory sync, both directions, plus oversell prevention.~~ **Done 2026-08-17.** (Shopify → Zoho: `inventory_levels/update` webhook → `app/models/inventorySync.server.js`, done 2026-08-14, manually tested. Zoho → Shopify: manual "Pull from Zoho" button, same file, manually tested. Oversell prevention: `denyOversellForVariant()` in `app/models/productSync.server.js` forces Shopify's `inventoryPolicy` to `DENY` on inventory-tracked variants via `productVariantsBulkUpdate` - written and schema-validated, not yet manually tested. See Section G for the full breakdown.) Section G is now feature-complete.
9. ~~Add order status sync (Section H).~~ **Fulfilled-status gap done 2026-08-17, not yet manually tested.** (Every other status was already covered incidentally by Sections D/E/F. `app/models/fulfillmentSync.server.js` creates a Zoho Package + Shipment Order from Shopify's `fulfillments/create` webhook. See Section H for the full breakdown.)
10. ~~Add refund & cancellation (Section I).~~ **Done 2026-08-17, not yet manually tested.** (Cancellation already existed via Section D. `app/models/refundSync.server.js` creates a Zoho Credit Note + records the actual refund from Shopify's `refunds/create` webhook; inventory reversal falls out of Section G's existing webhook for free. See Section I for the full breakdown.) Remaining: tax mapping (Section J), shipping detail handling (Section K) — both currently unstarted.
10. Build reporting views off `sync_logs`.
11. Add automated tests (unit + integration) and a UAT pass.
