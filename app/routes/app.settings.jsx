import { useMemo, useState } from "react";
import { Form, useLoaderData, useNavigation } from "react-router";
import { loader, action } from "../models/settings.server";
import { useZohoConnectionSync } from "../hooks/useZohoConnectionSync";

export { loader, action };

const NAV_ITEMS = [
  { key: "organization", label: "Organization Settings", icon: "organization" },
  { key: "connection", label: "Zoho Books Connection", icon: "link" },
  { key: "warehouses", label: "Warehouse Mapping", icon: "inventory" },
  { key: "tax", label: "Tax Settings", icon: "receipt" },
  { key: "accounts", label: "Account Settings", icon: "bank" },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function Icon({ type, className = "" }) {
  return <s-icon className={className} type={type}></s-icon>;
}

function monthName(value) {
  const month = Number(value);
  return MONTHS[month - 1] || value || "—";
}

function fiscalYear(value) {
  const start = Number(value) || 1;
  const end = start === 1 ? 12 : start === 12 ? 11 : start - 1;
  return `${monthName(start)} – ${monthName(end)}`;
}

function display(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

function SettingCard({ icon, tone = "blue", label, value }) {
  return (
    <div className="setting-card">
      <div className={`setting-icon ${tone}`}>
        <Icon type={icon} />
      </div>
      <div className="setting-copy">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const data = useLoaderData();
  const navigation = useNavigation();
  const [section, setSection] = useState("organization");
  const [storeOpen, setStoreOpen] = useState(false);
  useZohoConnectionSync();

  const refreshing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "refresh-zoho-data";

  const organization = data.organization || {};
  const refreshedAt = organization.fetchedAt
    ? new Date(organization.fetchedAt)
    : null;

  return (
    <s-page heading="Settings" inlineSize="large">
      <style>{`
        .settings-page{max-width:1214px;margin:0 auto;padding:0 0 26px;color:#18233d;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
        .settings-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin:0 0 38px}
        .settings-title{margin:0;font-size:31px;line-height:38px;font-weight:700;color:#111827;letter-spacing:-.55px}
        .settings-sub{margin:4px 0 0;font-size:15px;line-height:23px;color:#344563}
        .head-actions{display:flex;align-items:center;gap:12px;padding-top:0}
        .connected{height:42px;padding:0 14px;border-radius:9px;background:#eaf8f0;color:#078b51;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;white-space:nowrap}
        .connected-dot{width:8px;height:8px;border-radius:50%;background:#08a15b;box-shadow:0 0 0 2px rgba(8,161,91,.08)}
        .refresh-btn{width:48px;height:48px;border:1px solid #d8e0ed;background:#fff;border-radius:9px;display:grid;place-items:center;color:#17305c;cursor:pointer}
        .refresh-btn s-icon{width:20px;height:20px}
        .store-wrap{position:relative}
        .store-btn{height:48px;min-width:236px;border:1px solid #d8e0ed;background:#fff;border-radius:9px;padding:0 14px;display:flex;align-items:center;justify-content:space-between;gap:18px;color:#17233c;font-size:13px;font-weight:600;cursor:pointer}
        .store-left{display:flex;align-items:center;gap:10px}
        .store-left s-icon{width:19px;height:19px;color:#1264ed}
        .chevron{display:flex;transition:transform .15s}
        .chevron.open{transform:rotate(180deg)}
        .dropdown{position:absolute;right:0;top:54px;z-index:50;min-width:236px;padding:6px;border:1px solid #d8e0ed;border-radius:10px;background:#fff;box-shadow:0 14px 35px rgba(20,35,60,.14)}
        .dropdown-item{width:100%;border:0;background:#fff;border-radius:7px;padding:10px 11px;display:flex;align-items:center;gap:9px;text-align:left;font-size:12px;color:#17233c;cursor:pointer}
        .dropdown-item.active,.dropdown-item:hover{background:#edf5ff;color:#1264ed}

        .settings-shell{display:grid;grid-template-columns:230px 1fr;border:1px solid #e1e7f0;border-radius:11px;background:#fff;box-shadow:0 1px 3px rgba(20,35,60,.035);overflow:hidden;min-height:856px}
        .settings-nav{border-right:1px solid #e5eaf1;padding:0 12px 20px}
        .settings-nav-title{height:57px;padding:0 14px;display:flex;align-items:center;color:#1264ed;font-size:14px;font-weight:600;border-bottom:1px solid #e5eaf1;margin:0 -12px 10px}
        .nav-item{width:100%;height:46px;border:0;background:#fff;border-radius:8px;display:flex;align-items:center;gap:10px;padding:0 12px;color:#182b50;font-size:13px;text-align:left;cursor:pointer}
        .nav-item:hover{background:#f5f8fc}
        .nav-item.active{background:#edf5ff;color:#1264ed;font-weight:600}
        .nav-icon{width:18px;height:18px;display:grid;place-items:center;flex:0 0 18px}
        .nav-icon s-icon{width:18px;height:18px}
        .settings-content{min-width:0;display:flex;flex-direction:column}

        .content-head{height:104px;box-sizing:border-box;padding:27px 30px 21px;border-bottom:1px solid #e5eaf1;display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
        .content-title{margin:0;font-size:18px;line-height:24px;font-weight:650;color:#111827}
        .content-sub{margin:4px 0 0;font-size:13px;line-height:20px;color:#344563}
        .refresh-zoho{height:43px;padding:0 15px;border:1px solid #d5ddea;background:#fff;border-radius:8px;display:flex;align-items:center;gap:8px;color:#17233c;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
        .refresh-zoho s-icon{width:17px;height:17px}
        .refresh-zoho:disabled{opacity:.6;cursor:default}
        .info{margin:22px 30px 20px;border:1px solid #b8d2ff;background:#f2f7ff;border-radius:8px;min-height:46px;box-sizing:border-box;padding:0 14px;display:flex;align-items:center;gap:10px;color:#38527b;font-size:12px;line-height:18px}
        .info-icon{color:#1264ed;display:grid;place-items:center;flex:0 0 auto}
        .info-icon s-icon{width:18px;height:18px}
        .stale{background:#fff8e9;border-color:#f2d79a;color:#7b5c20}
        .details-grid{padding:0 30px 22px;display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .setting-card{height:89px;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:10px;background:#fff;display:flex;align-items:center;padding:15px 18px;gap:16px}
        .setting-icon{width:48px;height:48px;border-radius:11px;display:grid;place-items:center;flex:0 0 auto}
        .setting-icon s-icon{width:23px;height:23px}
        .setting-icon.blue{background:#edf5ff;color:#1264ed}.setting-icon.red{background:#fff0f1;color:#df3939}.setting-icon.orange{background:#fff5e9;color:#ec8a00}.setting-icon.purple{background:#f3ecff;color:#7040e9}.setting-icon.green{background:#eaf8f0;color:#0a9858}.setting-icon.gray{background:#f2f4f7;color:#45536c}
        .setting-copy{display:flex;flex-direction:column;gap:5px;min-width:0}
        .setting-copy span{font-size:12px;line-height:16px;color:#596a87}
        .setting-copy strong{font-size:13px;line-height:18px;font-weight:500;color:#24385d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .meta-row{margin:0 30px;padding:18px 0;border-top:1px solid #e6ebf1;display:flex;justify-content:space-between;gap:16px;color:#526483;font-size:11px;line-height:16px;min-height:63px;box-sizing:border-box}
        .meta-row span{display:flex;align-items:center;gap:7px}
        .meta-row s-icon{width:15px;height:15px}
        .content-footer{margin-top:auto;border-top:1px solid #e5eaf1;padding:16px 30px;display:flex;justify-content:flex-end;gap:12px}
        .secondary-btn,.primary-btn{height:40px;padding:0 18px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer}
        .secondary-btn{border:1px solid #d6deea;background:#fff;color:#263856}.primary-btn{border:1px solid #1264ed;background:#1264ed;color:#fff}

        .simple-section{padding:30px;flex:1}.simple-card{border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:14px}.simple-card h3{margin:0 0 6px;font-size:16px}.simple-card p{margin:0 0 14px;font-size:12px;color:#526483}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field label{display:block;font-size:12px;font-weight:600;margin-bottom:6px}.field select{width:100%;height:40px;border:1px solid #d5ddea;border-radius:7px;padding:0 10px;background:#fff;font-size:12px}.mapping-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:center;padding:12px 0;border-top:1px solid #edf0f4}.mapping-row:first-child{border-top:0}.save-row{display:flex;justify-content:flex-end;margin-top:18px}.empty-state{padding:40px;text-align:center;color:#66758f;font-size:13px}
        @media(max-width:900px){.settings-shell{grid-template-columns:190px 1fr;min-height:700px}.details-grid{grid-template-columns:1fr}.head-actions{flex-wrap:wrap}.settings-head{flex-direction:column}.content-head{height:auto;min-height:104px;flex-direction:column}}
        @media(max-width:650px){.settings-shell{grid-template-columns:1fr}.settings-nav{border-right:0;border-bottom:1px solid #e5eaf1}.settings-nav-title{margin-bottom:6px}.details-grid{padding:0 16px 18px}.info{margin:16px}.content-head{padding:20px 16px}.meta-row{margin:0 16px;flex-direction:column}.content-footer{padding:14px 16px}.field-row{grid-template-columns:1fr}.settings-head{margin-bottom:20px}.store-btn{min-width:210px}}
      `}</style>

      <div className="settings-page">
        <div className="settings-head">
          <div>
            <h1 className="settings-title">Settings</h1>
            <p className="settings-sub">Manage your organization, Zoho Books connection and integration preferences.</p>
          </div>
          <div className="head-actions">
            <span className="connected"><span className="connected-dot" />{data.connection ? "Connected" : "Not connected"}</span>
            <Form method="post">
              <input type="hidden" name="intent" value="refresh-zoho-data" />
              <button className="refresh-btn" type="submit" title="Refresh" disabled={refreshing}>
                <Icon type="refresh" />
              </button>
            </Form>
            <div className="store-wrap">
              <button className="store-btn" type="button" onClick={() => setStoreOpen((value) => !value)}>
                <span className="store-left"><Icon type="store" /><span>My Shopify Store</span></span>
                <span className={`chevron ${storeOpen ? "open" : ""}`}><Icon type="chevron-down" /></span>
              </button>
              {storeOpen && <div className="dropdown"><button className="dropdown-item active" type="button"><Icon type="store" />My Shopify Store</button></div>}
            </div>
          </div>
        </div>

        <div className="settings-shell">
          <aside className="settings-nav">
            <div className="settings-nav-title">Organization Settings</div>
            {NAV_ITEMS.map((item) => (
              <button key={item.key} className={`nav-item ${section === item.key ? "active" : ""}`} type="button" onClick={() => setSection(item.key)}>
                <span className="nav-icon"><Icon type={item.icon} /></span>{item.label}
              </button>
            ))}
          </aside>

          <main className="settings-content">
            {section === "organization" && <OrganizationSection organization={organization} refreshedAt={refreshedAt} refreshing={refreshing} />}
            {section === "connection" && <ConnectionSection data={data} />}
            {section === "warehouses" && <WarehouseSection data={data} />}
            {section === "tax" && <TaxSection data={data} />}
            {section === "accounts" && <AccountSection data={data} />}
          </main>
        </div>
      </div>
    </s-page>
  );
}

function OrganizationSection({ organization, refreshedAt, refreshing }) {
  return (
    <>
      <div className="content-head">
        <div><h2 className="content-title">Organization Settings</h2><p className="content-sub">View and manage your Zoho organization details.</p></div>
        <Form method="post"><input type="hidden" name="intent" value="refresh-zoho-data" /><button className="refresh-zoho" type="submit" disabled={refreshing}><Icon type="refresh" />{refreshing ? "Refreshing…" : "Refresh from Zoho"}</button></Form>
      </div>
      <div className={`info ${organization.stale ? "stale" : ""}`}><span className="info-icon"><Icon type="info" /></span>{organization.stale ? "These details are from the last successful Zoho refresh. Refresh again to retry." : "These details are fetched from your Zoho organization. Click “Refresh from Zoho” to get the latest data."}</div>
      <div className="details-grid">
        <SettingCard label="Organization Name" value={display(organization.organizationName, "—")} icon="organization" tone="blue" />
        <SettingCard label="Industry Type" value={display(organization.industryType, "—")} icon="business-entity" tone="red" />
        <SettingCard label="Currency" value={`${display(organization.currencyCode, "—")}${organization.currencySymbol ? ` - ${organization.currencySymbol}` : ""}`} icon="cash-dollar" tone="orange" />
        <SettingCard label={display(organization.taxIdLabel, "Tax ID / GSTIN")} value={display(organization.taxIdValue, "—")} icon="file" tone="purple" />
        <SettingCard label="Fiscal Year" value={fiscalYear(organization.fiscalYearStartMonth)} icon="calendar" tone="blue" />
        <SettingCard label="Plan Name" value={display(organization.planName, "—")} icon="plan" tone="purple" />
        <SettingCard label="Time Zone" value={display(organization.timeZone, "—")} icon="clock" tone="purple" />
        <SettingCard label="Language" value={display(organization.languageCode, "—")} icon="globe" tone="blue" />
        <SettingCard label="Date Format" value={display(organization.dateFormat, "—")} icon="calendar" tone="blue" />
        <SettingCard label="Organization ID (Zoho)" value={display(organization.organizationId, "—")} icon="hashtag" tone="gray" />
      </div>
      <div className="meta-row"><span>Last refreshed on {refreshedAt ? refreshedAt.toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span><span>Data is refreshed every 24 hours <Icon type="clock" /></span></div>
      <div className="content-footer"><button className="secondary-btn" type="button">Discard Changes</button><button className="primary-btn" type="button">Save Changes</button></div>
    </>
  );
}

function ConnectionSection({ data }) {
  return <div className="simple-section"><div className="content-head" style={{ margin: "-30px -30px 24px" }}><div><h2 className="content-title">Zoho Books Connection</h2><p className="content-sub">Manage your Zoho Books authorization and connection status.</p></div></div><div className="simple-card"><h3>{data.connection ? "Zoho Books is connected" : "Connect Zoho Books"}</h3><p>{data.connection ? `Organization: ${display(data.connection.organizationName)} · ID: ${display(data.connection.organizationId)}` : "Connect your Zoho Books organization to enable synchronization."}</p>{data.connection ? <Form method="post"><input type="hidden" name="intent" value="disconnect" /><button className="secondary-btn" type="submit">Disconnect</button></Form> : <a className="primary-btn" href={data.zohoAuthUrl || "#"}>Connect Zoho Books</a>}</div></div>;
}

function WarehouseSection({ data }) {
  return <div className="simple-section"><div className="content-head" style={{ margin: "-30px -30px 24px" }}><div><h2 className="content-title">Warehouse Mapping</h2><p className="content-sub">Map Shopify locations to Zoho Books warehouses.</p></div></div><Form method="post"><input type="hidden" name="intent" value="save-warehouse-mapping" /><div className="simple-card">{data.locations.length === 0 ? <div className="empty-state">No Shopify locations found.</div> : data.locations.map((location) => <div className="mapping-row" key={location.id}><strong style={{ fontSize: 12 }}>{location.name}</strong><select name={`warehouse:${location.id}`} defaultValue={data.warehouseMappings[location.id] || ""}><option value="">Not mapped</option>{data.warehouses.map((warehouse) => <option key={warehouse.id || warehouse.warehouse_id} value={warehouse.id || warehouse.warehouse_id}>{warehouse.name || warehouse.warehouse_name}</option>)}</select></div>)}</div><div className="save-row"><button className="primary-btn" type="submit">Save Mapping</button></div></Form></div>;
}

function TaxSection({ data }) {
  return <div className="simple-section"><div className="content-head" style={{ margin: "-30px -30px 24px" }}><div><h2 className="content-title">Tax Settings</h2><p className="content-sub">Configure Shopify tax behavior and Zoho tax mappings.</p></div></div><Form method="post"><input type="hidden" name="intent" value="save-tax-settings" /><div className="simple-card"><div className="field-row"><div className="field"><label>Default Zoho Tax</label><select name="defaultTaxId" defaultValue={data.taxSettings.defaultTaxId || ""}><option value="">Select tax</option>{data.taxes.map((tax) => <option key={tax.tax_id || tax.id} value={tax.tax_id || tax.id}>{tax.tax_name || tax.name}</option>)}</select></div><div className="field"><label>Prices Include Tax</label><select name="pricesIncludeTax" defaultValue={String(Boolean(data.taxSettings.pricesIncludeTax))}><option value="false">No</option><option value="true">Yes</option></select></div></div></div><div className="simple-card"><h3>Tax Rate Mapping</h3>{data.taxRateRows.length === 0 ? <div className="empty-state">No Shopify tax rates detected.</div> : data.taxRateRows.map((row) => <div className="mapping-row" key={row.key}><strong style={{ fontSize: 12 }}>{row.label}</strong><select name={`taxrate:${row.key}`} defaultValue={data.taxSettings.rateMap?.[row.key] || ""}><option value="">Not mapped</option>{data.taxes.map((tax) => <option key={tax.tax_id || tax.id} value={tax.tax_id || tax.id}>{tax.tax_name || tax.name}</option>)}</select></div>)}</div><div className="save-row"><button className="primary-btn" type="submit">Save Tax Settings</button></div></Form></div>;
}

function AccountSection({ data }) {
  const settings = data.accountSettings || {};
  return <div className="simple-section"><div className="content-head" style={{ margin: "-30px -30px 24px" }}><div><h2 className="content-title">Account Settings</h2><p className="content-sub">Set the default Zoho Books accounts used by the integration.</p></div></div><Form method="post"><input type="hidden" name="intent" value="save-account-settings" /><div className="simple-card"><div className="field-row"><div className="field"><label>Sales Account</label><select name="salesAccountId" defaultValue={settings.salesAccountId || ""}><option value="">Select account</option>{data.accounts.map((account) => <option key={account.account_id || account.id} value={account.account_id || account.id}>{account.account_name || account.name}</option>)}</select></div><div className="field"><label>Payment Account</label><select name="paymentAccountId" defaultValue={settings.paymentAccountId || ""}><option value="">Select account</option>{data.accounts.map((account) => <option key={account.account_id || account.id} value={account.account_id || account.id}>{account.account_name || account.name}</option>)}</select></div><div className="field"><label>Inventory Account</label><select name="inventoryAccountId" defaultValue={settings.inventoryAccountId || ""}><option value="">Select account</option>{data.accounts.map((account) => <option key={account.account_id || account.id} value={account.account_id || account.id}>{account.account_name || account.name}</option>)}</select></div></div></div><div className="save-row"><button className="primary-btn" type="submit">Save Account Settings</button></div></Form></div>;
}
