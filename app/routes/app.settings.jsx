import { useState } from "react";
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
const MONTHS = [
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
function Icon({ type }) {
  return <s-icon type={type}></s-icon>;
}
function display(value, fallback = "—") {
  return value === null || value === undefined || value === ""
    ? fallback
    : value;
}
function monthName(value) {
  return MONTHS[Number(value) - 1] || value || "—";
}
function fiscalYear(value) {
  const start = Number(value) || 1;
  const end = start === 1 ? 12 : start === 12 ? 11 : start - 1;
  return `${monthName(start)} – ${monthName(end)}`;
}
function formatDate(value) {
  return value
    ? new Date(value).toLocaleString([], {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    : "—";
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
  const testing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "test-connection";
  const organization = data.organization || {};
  return (
    <s-page heading="Settings" inlineSize="large">
      <style>{`
      .settings-page{max-width:1214px;margin:0 auto;padding:0 0 26px;color:#18233d;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}.settings-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin:0 0 38px}.settings-title{margin:0;font-size:31px;line-height:38px;font-weight:700;color:#111827;letter-spacing:-.55px}.settings-sub{margin:4px 0 0;font-size:15px;line-height:23px;color:#344563}.head-actions{display:flex;align-items:center;gap:12px}.connected{height:42px;padding:0 14px;border-radius:9px;background:#eaf8f0;color:#078b51;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;white-space:nowrap}.connected-dot{width:8px;height:8px;border-radius:50%;background:#08a15b}.refresh-btn{width:48px;height:48px;border:1px solid #d8e0ed;background:#fff;border-radius:9px;display:grid;place-items:center;color:#17305c;cursor:pointer}.store-wrap{position:relative}.store-btn{height:48px;min-width:236px;border:1px solid #d8e0ed;background:#fff;border-radius:9px;padding:0 14px;display:flex;align-items:center;justify-content:space-between;gap:18px;color:#17233c;font-size:13px;font-weight:600;cursor:pointer}.store-left{display:flex;align-items:center;gap:10px}.store-left s-icon{width:19px;height:19px;color:#1264ed}.chevron{display:flex;transition:transform .15s}.chevron.open{transform:rotate(180deg)}.dropdown{position:absolute;right:0;top:54px;z-index:50;min-width:236px;padding:6px;border:1px solid #d8e0ed;border-radius:10px;background:#fff;box-shadow:0 14px 35px rgba(20,35,60,.14)}.dropdown-item{width:100%;border:0;background:#fff;border-radius:7px;padding:10px 11px;display:flex;align-items:center;gap:9px;text-align:left;font-size:12px;color:#17233c;cursor:pointer}.dropdown-item.active,.dropdown-item:hover{background:#edf5ff;color:#1264ed}
      .settings-shell{display:grid;grid-template-columns:230px 1fr;border:1px solid #e1e7f0;border-radius:11px;background:#fff;box-shadow:0 1px 3px rgba(20,35,60,.035);overflow:hidden;min-height:856px}.settings-nav{border-right:1px solid #e5eaf1;padding:0 12px 20px}.settings-nav-title{height:57px;padding:0 14px;display:flex;align-items:center;color:#1264ed;font-size:14px;font-weight:600;border-bottom:1px solid #e5eaf1;margin:0 -12px 10px}.nav-item{width:100%;height:46px;border:0;background:#fff;border-radius:8px;display:flex;align-items:center;gap:10px;padding:0 12px;color:#182b50;font-size:13px;text-align:left;cursor:pointer}.nav-item:hover{background:#f5f8fc}.nav-item.active{background:#edf5ff;color:#1264ed;font-weight:600}.nav-icon{width:18px;height:18px;display:grid;place-items:center;flex:0 0 18px}.nav-icon s-icon{width:18px;height:18px}.settings-content{min-width:0;display:flex;flex-direction:column}.content-head{min-height:104px;box-sizing:border-box;padding:27px 30px 21px;border-bottom:1px solid #e5eaf1;display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.content-title{margin:0;font-size:18px;line-height:24px;font-weight:650;color:#111827}.content-sub{margin:4px 0 0;font-size:13px;line-height:20px;color:#344563}.refresh-zoho{height:43px;padding:0 15px;border:1px solid #d5ddea;background:#fff;border-radius:8px;display:flex;align-items:center;gap:8px;color:#17233c;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}.refresh-zoho:disabled{opacity:.6}.info{margin:22px 30px 20px;border:1px solid #b8d2ff;background:#f2f7ff;border-radius:8px;min-height:46px;box-sizing:border-box;padding:0 14px;display:flex;align-items:center;gap:10px;color:#38527b;font-size:12px}.details-grid{padding:0 30px 22px;display:grid;grid-template-columns:1fr 1fr;gap:14px}.setting-card{height:89px;border:1px solid #e2e8f0;border-radius:10px;display:flex;align-items:center;padding:15px 18px;gap:16px}.setting-icon{width:48px;height:48px;border-radius:11px;display:grid;place-items:center;flex:0 0 auto}.setting-icon.blue{background:#edf5ff;color:#1264ed}.setting-icon.red{background:#fff0f1;color:#df3939}.setting-icon.orange{background:#fff5e9;color:#ec8a00}.setting-icon.purple{background:#f3ecff;color:#7040e9}.setting-icon.gray{background:#f2f4f7;color:#45536c}.setting-copy{display:flex;flex-direction:column;gap:5px;min-width:0}.setting-copy span{font-size:12px;color:#596a87}.setting-copy strong{font-size:13px;font-weight:500;color:#24385d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta-row{margin:0 30px;padding:18px 0;border-top:1px solid #e6ebf1;display:flex;justify-content:space-between;color:#526483;font-size:11px}.content-footer{margin-top:auto;border-top:1px solid #e5eaf1;padding:16px 30px;display:flex;justify-content:flex-end;gap:12px}.secondary-btn,.primary-btn{height:40px;padding:0 18px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;box-sizing:border-box}.secondary-btn{border:1px solid #d6deea;background:#fff;color:#263856}.primary-btn{border:1px solid #1264ed;background:#1264ed;color:#fff}
      .connection-page{padding:0 30px 30px}.connection-status{margin-top:13px;border:1px solid #9ce0bc;background:#f5fff9;border-radius:8px;min-height:82px;padding:14px 18px;display:grid;grid-template-columns:1fr 190px 185px;align-items:center;gap:20px}.connection-status-main{display:flex;align-items:center;gap:13px}.success-icon{width:31px;height:31px;border-radius:50%;background:#087c43;color:#fff;display:grid;place-items:center;flex:0 0 auto}.success-icon s-icon{width:17px;height:17px}.status-title{font-size:13px;font-weight:650;color:#086b3c}.status-copy{margin-top:5px;font-size:12px;color:#38527b}.status-meta span{display:block;font-size:11px;color:#596a87;margin-bottom:5px}.status-meta strong{font-size:12px;font-weight:500;color:#24385d}.connection-box{margin-top:20px;border:1px solid #e1e7f0;border-radius:8px;overflow:hidden}.box-head{min-height:56px;padding:0 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e6ebf1}.box-title{font-size:13px;font-weight:650;color:#17233c}.outline-btn{height:34px;padding:0 12px;border:1px solid #d5ddea;background:#fff;border-radius:7px;color:#263856;font-size:11px;font-weight:600;display:flex;align-items:center;gap:7px;text-decoration:none;cursor:pointer}.outline-btn s-icon{width:15px;height:15px}.org-grid{display:grid;grid-template-columns:repeat(3,1fr)}.org-cell{min-height:64px;padding:12px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #edf0f4}.org-cell:nth-child(3n+2),.org-cell:nth-child(3n+3){border-left:1px solid #edf0f4}.org-cell:nth-last-child(-n+3){border-bottom:0}.mini-icon{width:29px;height:29px;border-radius:7px;display:grid;place-items:center;flex:0 0 auto;background:#edf5ff;color:#1264ed}.mini-icon.orange{background:#fff2e8;color:#ed7800}.mini-icon.purple{background:#f3ecff;color:#7040e9}.mini-copy span{display:block;font-size:10px;color:#596a87;margin-bottom:4px}.mini-copy strong{font-size:11px;font-weight:500;color:#24385d}.token-box{padding:18px}.token-row{display:grid;grid-template-columns:1fr 180px 70px;gap:22px;align-items:center}.token-field{height:42px;border:1px solid #d5ddea;border-radius:7px;display:flex;align-items:center;padding:0 10px;background:#fbfcfe}.token-value{flex:1;font-family:monospace;font-size:11px;color:#17233c;overflow:hidden;white-space:nowrap}.token-eye{border:0;background:none;padding:4px;color:#526483;cursor:pointer;display:flex}.token-copy{height:34px;padding:0 13px;border:1px solid #9ebfff;background:#fff;border-radius:7px;color:#17233c;font-size:11px;font-weight:600;cursor:pointer}.valid{justify-self:end;background:#e9f8ef;color:#0a9858;border-radius:6px;padding:5px 8px;font-size:10px;font-weight:600}.sync-box{padding:0 18px 10px}.sync-row{min-height:54px;border:1px solid #edf0f4;border-radius:8px;display:flex;align-items:center;gap:12px;padding:0 12px;margin-top:8px}.sync-row:first-child{margin-top:12px}.sync-icon{width:30px;height:30px;border-radius:7px;display:grid;place-items:center;background:#edf5ff;color:#1264ed}.sync-icon.orange{background:#fff2e8;color:#ed7800}.sync-icon.purple{background:#f3ecff;color:#7040e9}.sync-copy{flex:1}.sync-copy strong{display:block;font-size:11px;color:#17233c}.sync-copy span{display:block;font-size:10px;color:#596a87;margin-top:3px}.switch{position:relative;width:38px;height:22px;display:inline-block}.switch input{opacity:0;width:0;height:0}.slider{position:absolute;inset:0;background:#c9d2df;border-radius:20px;cursor:pointer}.slider:before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.15s;box-shadow:0 1px 2px rgba(0,0,0,.12)}.switch input:checked+.slider{background:#1677ff}.switch input:checked+.slider:before{transform:translateX(16px)}
      .simple-section{padding:0 28px 28px;flex:1}.simple-card{border:1px solid #e2e8f0;border-radius:10px;padding:24px;margin-bottom:16px}.simple-card h3{margin:0 0 8px;font-size:18px}.simple-card p{margin:0 0 16px;font-size:14px;color:#526483}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field label{display:block;font-size:13px;font-weight:600;margin-bottom:7px}.field select{width:100%;height:42px;border:1px solid #d5ddea;border-radius:7px;padding:0 10px;background:#fff;font-size:13px}.mapping-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:center;padding:12px 0;border-top:1px solid #edf0f4}.mapping-row:first-child{border-top:0}.save-row{display:flex;justify-content:flex-end;margin-top:18px}.empty-state{padding:40px;text-align:center;color:#66758f;font-size:13px}
      .warehouse-section{padding:0 28px 28px;flex:1;min-width:0}.warehouse-head{min-height:104px;box-sizing:border-box;margin:0 -28px;padding:25px 28px 21px;border-bottom:1px solid #e5eaf1;display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.warehouse-title{margin:0;font-size:21px;line-height:28px;font-weight:700;color:#111827;letter-spacing:-.25px}.warehouse-sub{margin:5px 0 0;font-size:14px;line-height:21px;color:#344563}.warehouse-refresh{height:40px;font-size:13px}.warehouse-form{padding-top:24px}.warehouse-summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}.warehouse-stat{height:86px;border:1px solid #dfe6f0;border-radius:10px;padding:15px 18px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:7px}.warehouse-stat span{font-size:12px;color:#596a87}.warehouse-stat strong{font-size:23px;line-height:27px;color:#1c2940;font-weight:700}.warehouse-stat .mapped-value{color:#079b57}.warehouse-notice{margin:18px 0;border:1px solid #b8d2ff;background:#f2f7ff;border-radius:8px;min-height:43px;padding:0 13px;box-sizing:border-box;display:flex;align-items:center;gap:9px;color:#38527b;font-size:12px}.warehouse-table{border:1px solid #dfe6f0;border-radius:9px;overflow:hidden;background:#fff}.warehouse-table-head,.warehouse-table-row{display:grid;grid-template-columns:1.55fr 1.05fr 1.35fr .9fr .75fr .45fr;align-items:center}.warehouse-table-head{min-height:45px;padding:0 16px;background:#f8fafc;border-bottom:1px solid #dfe6f0;color:#263856;font-size:11px;font-weight:700}.warehouse-table-row{min-height:76px;padding:0 16px;border-bottom:1px solid #e8edf3;color:#24385d;font-size:12px}.warehouse-table-row:last-child{border-bottom:0}.warehouse-location{display:flex;align-items:center;gap:11px;min-width:0}.warehouse-location-icon{width:34px;height:34px;border-radius:8px;background:#edf5ff;color:#526483;display:grid;place-items:center;flex:0 0 auto}.warehouse-location-icon s-icon{width:17px;height:17px}.warehouse-location strong{display:block;font-size:13px;line-height:18px;color:#17233c;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.warehouse-location small{display:block;margin-top:3px;font-size:10px;line-height:14px;color:#596a87;word-break:break-all}.warehouse-type{font-size:12px;color:#405575}.warehouse-select{width:100%;max-width:202px;height:38px;border:1px solid #cfd9e8;border-radius:7px;background:#fff;padding:0 10px;font-size:12px;color:#17233c}.warehouse-code{font-size:12px;color:#405575;white-space:nowrap;justify-self:center;text-align:center}.warehouse-status{justify-self:center;border-radius:6px;padding:7px 10px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}.warehouse-status.mapped{background:#e8f8ef;color:#078b51}.warehouse-status.unmapped{background:#fff4df;color:#a56700}.warehouse-action{border:0;background:transparent;color:#405575;font-size:20px;line-height:1;cursor:pointer;justify-self:end;padding:7px}.warehouse-footer{display:flex;justify-content:flex-end;padding-top:18px}.warehouse-save{height:40px;padding:0 22px;font-size:13px}.warehouse-empty{padding:40px;text-align:center;color:#66758f;font-size:13px}
      .tax-section{padding:0 28px 28px;flex:1;min-width:0}.tax-head{min-height:104px;box-sizing:border-box;margin:0 -28px;padding:25px 28px 21px;border-bottom:1px solid #e5eaf1;display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.tax-title{margin:0;font-size:21px;line-height:28px;font-weight:700;color:#111827}.tax-sub{margin:5px 0 0;font-size:14px;line-height:21px;color:#344563}.tax-refresh{height:40px;font-size:13px}.tax-form{padding-top:24px}.tax-info{margin:0 0 20px;border:1px solid #b8d2ff;background:#f2f7ff;border-radius:8px;min-height:46px;padding:0 14px;display:flex;align-items:center;gap:10px;color:#38527b;font-size:12px}.tax-summary{display:grid;grid-template-columns:1fr 1fr 1fr 1.15fr;gap:14px;margin-bottom:20px}.tax-summary-card{min-height:96px;border:1px solid #dfe6f0;border-radius:10px;padding:15px 16px;box-sizing:border-box;display:flex;align-items:center;gap:12px}.tax-summary-icon{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;flex:0 0 auto;background:#f1eaff;color:#7040e9}.tax-summary-icon.green{background:#e9f8ef;color:#079b57}.tax-summary-icon.orange{background:#fff4e5;color:#ed8a00}.tax-summary-icon.blue{background:#edf5ff;color:#1264ed}.tax-summary-copy span{display:block;font-size:12px;color:#596a87;margin-bottom:5px}.tax-summary-copy strong{display:block;font-size:19px;line-height:24px;color:#17233c;font-weight:700}.tax-summary-copy small{display:block;font-size:12px;color:#66758f;margin-top:4px}.tax-summary-copy .green-text{color:#079b57}.tax-workspace{border:1px solid #dfe6f0;border-radius:9px;overflow:hidden;background:#fff}.tax-tabs{height:58px;display:flex;align-items:flex-end;padding:0 18px;border-bottom:1px solid #dfe6f0}.tax-tab{height:58px;padding:0 20px;border:0;border-bottom:2px solid transparent;background:#fff;color:#24385d;font-size:13px;font-weight:500;cursor:pointer}.tax-tab.active{color:#1264ed;border-bottom-color:#1264ed;font-weight:600}.tax-toolbar{min-height:58px;display:flex;align-items:center;justify-content:flex-end;padding:0 18px;border-bottom:1px solid #edf0f4}.tax-add{height:36px;padding:0 13px;border:1px solid #d5ddea;background:#fff;border-radius:7px;color:#263856;font-size:12px;font-weight:600;display:flex;align-items:center;gap:7px;cursor:pointer}.tax-table-head,.tax-table-row{display:grid;grid-template-columns:1.05fr .9fr 1.55fr 1.1fr .75fr .35fr;align-items:center;column-gap:12px}.tax-table-head{min-height:48px;padding:0 18px;background:#f8fafc;border-bottom:1px solid #dfe6f0;color:#263856;font-size:12px;font-weight:700}.tax-table-row{min-height:61px;padding:0 18px;border-bottom:1px solid #e8edf3;color:#24385d;font-size:11px}.tax-table-row:last-child{border-bottom:0}.tax-code{color:#526483}.tax-select{width:100%;height:36px;border:1px solid #cfd9e8;border-radius:7px;background:#fff;padding:0 9px;color:#17233c;font-size:11px}.tax-type{line-height:16px;color:#405575}.tax-status{justify-self:start;border-radius:6px;padding:6px 9px;font-size:10px;font-weight:600;white-space:nowrap}.tax-status.mapped{background:#e8f8ef;color:#078b51}.tax-status.unmapped{background:#fff4df;color:#a56700}.tax-action{border:0;background:transparent;color:#405575;font-size:19px;cursor:pointer;justify-self:end}.tax-bottom-note{margin:18px;border:1px solid #b8d2ff;background:#f2f7ff;border-radius:8px;min-height:43px;padding:0 13px;display:flex;align-items:center;gap:9px;color:#38527b;font-size:12px}.tax-settings-panel{padding:22px 18px}.tax-setting-card{border:1px solid #e2e8f0;border-radius:9px;padding:18px;margin-bottom:14px}.tax-setting-card h3{margin:0 0 6px;font-size:14px;color:#17233c}.tax-setting-card p{margin:0 0 14px;font-size:12px;color:#596a87}.tax-checkbox{display:flex;align-items:center;gap:9px;font-size:12px;color:#263856;margin-top:12px}.tax-checkbox input{width:16px;height:16px}.tax-save{display:flex;justify-content:flex-end;padding:18px;border-top:1px solid #e5eaf1}.tax-save button{height:40px;padding:0 22px}.tax-empty{padding:42px 20px;text-align:center;color:#66758f;font-size:12px}
      @media(max-width:1000px){.warehouse-table{overflow-x:auto}.warehouse-table-head,.warehouse-table-row{min-width:920px}.warehouse-summary{grid-template-columns:1fr 1fr}.tax-summary{grid-template-columns:1fr 1fr}.tax-table{overflow-x:auto}.tax-table-head,.tax-table-row{min-width:940px}}@media(max-width:900px){.settings-shell{grid-template-columns:190px 1fr;min-height:700px}.details-grid{grid-template-columns:1fr}.head-actions{flex-wrap:wrap}.settings-head{flex-direction:column}.connection-status{grid-template-columns:1fr}.org-grid{grid-template-columns:1fr}.org-cell{border-left:0!important}.token-row{grid-template-columns:1fr}.valid{justify-self:start}.tax-summary{grid-template-columns:1fr 1fr}}@media(max-width:650px){.settings-shell{grid-template-columns:1fr}.settings-nav{border-right:0;border-bottom:1px solid #e5eaf1}.settings-nav-title{margin-bottom:6px}.connection-page{padding:0 16px 20px}.connection-status{padding:14px}.box-head{padding:0 12px}.org-cell{padding:12px}.token-row{gap:10px}.content-head{padding:20px 16px}.settings-head{margin-bottom:20px}.store-btn{min-width:210px}.warehouse-section{padding:0 16px 20px}.warehouse-head{margin:0 -16px;padding:20px 16px}.warehouse-summary{grid-template-columns:1fr}.warehouse-form{padding-top:18px}.tax-section{padding:0 16px 20px}.tax-head{margin:0 -16px;padding:20px 16px}.tax-summary{grid-template-columns:1fr}.tax-table-head,.tax-table-row{padding-left:14px;padding-right:14px}}
    `}</style>
      <div className="settings-page">
        <div className="settings-head">
          <div>
            <h1 className="settings-title">Settings</h1>
            <p className="settings-sub">
              Manage your organization, Zoho Books connection and integration
              preferences.
            </p>
          </div>
          <div className="head-actions">
            <span className="connected">
              <span className="connected-dot" />
              {data.connection ? "Connected" : "Not connected"}
            </span>
            <Form method="post">
              <input type="hidden" name="intent" value="refresh-zoho-data" />
              <button
                className="refresh-btn"
                type="submit"
                title="Refresh"
                disabled={refreshing}
              >
                <Icon type="refresh" />
              </button>
            </Form>
            <div className="store-wrap">
              <button
                className="store-btn"
                type="button"
                onClick={() => setStoreOpen((v) => !v)}
              >
                <span className="store-left">
                  <Icon type="store" />
                  <span>My Shopify Store</span>
                </span>
                <span className={`chevron ${storeOpen ? "open" : ""}`}>
                  <Icon type="chevron-down" />
                </span>
              </button>
              {storeOpen && (
                <div className="dropdown">
                  <button className="dropdown-item active" type="button">
                    <Icon type="store" />
                    My Shopify Store
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="settings-shell">
          <aside className="settings-nav">
            <div className="settings-nav-title">Organization Settings</div>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                className={`nav-item ${section === item.key ? "active" : ""}`}
                type="button"
                onClick={() => setSection(item.key)}
              >
                <span className="nav-icon">
                  <Icon type={item.icon} />
                </span>
                {item.label}
              </button>
            ))}
          </aside>
          <main className="settings-content">
            {section === "organization" && (
              <OrganizationSection
                organization={organization}
                refreshing={refreshing}
              />
            )}
            {section === "connection" && (
              <ConnectionSection data={data} testing={testing} />
            )}
            {section === "warehouses" && <WarehouseSection data={data} />}
            {section === "tax" && <TaxSection data={data} />}
            {section === "accounts" && <AccountSection data={data} />}
          </main>
        </div>
      </div>
    </s-page>
  );
}

function OrganizationSection({ organization, refreshing }) {
  return (
    <>
      <div className="content-head">
        <div>
          <h2 className="content-title">Organization Settings</h2>
          <p className="content-sub">
            View and manage your Zoho organization details.
          </p>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value="refresh-zoho-data" />
          <button className="refresh-zoho" type="submit" disabled={refreshing}>
            <Icon type="refresh" />
            {refreshing ? "Refreshing…" : "Refresh from Zoho"}
          </button>
        </Form>
      </div>
      <div className="info">
        <Icon type="info" />
        These details are fetched from your Zoho organization. Click “Refresh
        from Zoho” to get the latest data.
      </div>
      <div className="details-grid">
        <SettingCard
          label="Organization Name"
          value={display(organization.organizationName)}
          icon="organization"
          tone="blue"
        />
        <SettingCard
          label="Industry Type"
          value={display(organization.industryType)}
          icon="business-entity"
          tone="red"
        />
        <SettingCard
          label="Currency"
          value={`${display(organization.currencyCode)}${organization.currencySymbol ? ` - ${organization.currencySymbol}` : ""}`}
          icon="cash-dollar"
          tone="orange"
        />
        <SettingCard
          label={display(organization.taxIdLabel, "Tax ID / GSTIN")}
          value={display(organization.taxIdValue)}
          icon="file"
          tone="purple"
        />
        <SettingCard
          label="Fiscal Year"
          value={fiscalYear(organization.fiscalYearStartMonth)}
          icon="calendar"
          tone="blue"
        />
        <SettingCard
          label="Plan Name"
          value={display(organization.planName)}
          icon="plan"
          tone="purple"
        />
        <SettingCard
          label="Time Zone"
          value={display(organization.timeZone)}
          icon="clock"
          tone="purple"
        />
        <SettingCard
          label="Language"
          value={display(organization.languageCode)}
          icon="globe"
          tone="blue"
        />
        <SettingCard
          label="Date Format"
          value={display(organization.dateFormat)}
          icon="calendar"
          tone="blue"
        />
        <SettingCard
          label="Organization ID (Zoho)"
          value={display(organization.organizationId)}
          icon="hashtag"
          tone="gray"
        />
      </div>
      <div className="meta-row">
        <span>Last refreshed on {formatDate(organization.fetchedAt)}</span>
        <span>Data is refreshed every 24 hours</span>
      </div>
      <div className="content-footer">
        <button className="secondary-btn" type="button">
          Discard Changes
        </button>
        <button className="primary-btn" type="button">
          Save Changes
        </button>
      </div>
    </>
  );
}

function ConnectionSection({ data, testing }) {
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const connected = Boolean(data.connection);
  const token =
    data.connection?.tokenMasked || "zoho••••••••••••••••••••••••••••••••";
  const organization = data.organization || {};
  const tokenValid = data.connection?.tokenExpiresAt
    ? new Date(data.connection.tokenExpiresAt).getTime() > Date.now()
    : connected;
  const zohoBooksUrl = data.connection?.dataCenter
    ? `https://books.zoho.${data.connection.dataCenter}`
    : "https://www.zoho.com/books/";
  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { }
  };
  return (
    <>
      <div className="content-head">
        <div>
          <h2 className="content-title">Zoho Books Connection</h2>
          <p className="content-sub">
            Connect your Zoho Books organization and manage the connection
            settings.
          </p>
        </div>
        <a className="outline-btn" href={data.zohoAuthUrl || "#"}>
          <Icon type="refresh" />
          Reconnect
        </a>
      </div>
      <div className="connection-page">
        {connected ? (
          <div className="connection-status">
            <div className="connection-status-main">
              <span className="success-icon">
                <Icon type="check-circle" />
              </span>
              <div>
                <div className="status-title">Connected to Zoho Books</div>
                <div className="status-copy">
                  Your store is successfully connected to Zoho Books.
                </div>
              </div>
            </div>
            <div className="status-meta">
              <span>Connected on</span>
              <strong>{formatDate(data.connection.connectedAt)}</strong>
            </div>
            <div className="status-meta">
              <span>Connected by</span>
              <strong>{display(data.connection.connectedBy)}</strong>
            </div>
          </div>
        ) : (
          <div
            className="connection-status"
            style={{ borderColor: "#f2d79a", background: "#fffaf0" }}
          >
            <div className="connection-status-main">
              <span className="success-icon" style={{ background: "#d88900" }}>
                <Icon type="link" />
              </span>
              <div>
                <div className="status-title" style={{ color: "#8a5a00" }}>
                  Not connected to Zoho Books
                </div>
                <div className="status-copy">
                  Connect your Zoho Books organization to enable
                  synchronization.
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="connection-box">
          <div className="box-head">
            <span className="box-title">Zoho Organization Details</span>
            <a
              className="outline-btn"
              href={zohoBooksUrl}
              target="_blank"
              rel="noreferrer"
            >
              View in Zoho Books <Icon type="external" />
            </a>
          </div>
          <div className="org-grid">
            <OrgCell
              icon="organization"
              label="Organization Name"
              value={display(
                organization.organizationName,
                data.connection?.organizationName,
              )}
            />
            <OrgCell
              icon="hashtag"
              label="Zoho Books Organization ID"
              value={display(
                organization.organizationId,
                data.connection?.organizationId,
              )}
            />
            <OrgCell
              icon="plan"
              label="Books Edition"
              value={display(organization.planName, "Professional")}
            />
            <OrgCell
              icon="cash-dollar"
              tone="orange"
              label="Base Currency"
              value={`${display(organization.currencyCode)}${organization.currencySymbol ? ` - ${organization.currencySymbol}` : ""}`}
            />
            <OrgCell
              icon="globe"
              tone="orange"
              label="Zoho Books Region"
              value={
                data.connection?.dataCenter
                  ? `${String(data.connection.dataCenter).toUpperCase()} Data Center`
                  : "—"
              }
            />
            <OrgCell
              icon="calendar"
              tone="purple"
              label="Financial Year"
              value={fiscalYear(organization.fiscalYearStartMonth)}
            />
          </div>
        </div>
        <div className="connection-box">
          <div className="box-head">
            <div>
              <div className="box-title">Access Token</div>
              <div className="content-sub">
                Secure access token used to authenticate API requests.
              </div>
            </div>
          </div>
          <div className="token-box">
            <div className="token-row">
              <div className="token-field">
                <span className="token-value">
                  {showToken ? token : token.replace(/[^•]/g, "•")}
                </span>
                <button
                  className="token-eye"
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                >
                  <Icon type="view" />
                </button>
              </div>
              <button className="token-copy" type="button" onClick={copyToken}>
                {copied ? "Copied" : "Copy"}
              </button>
              <span className="valid">{tokenValid ? "Valid" : "Expired"}</span>
            </div>
            <div style={{ marginTop: 10, fontSize: 10, color: "#596a87" }}>
              Token expiry: {formatDate(data.connection?.tokenExpiresAt)}
            </div>
          </div>
        </div>
        <div className="connection-box">
          <div className="box-head">
            <div>
              <div className="box-title">Sync Preferences</div>
              <div className="content-sub">
                Choose what data you want to sync with Zoho Books.
              </div>
            </div>
          </div>
          <SyncPreferences data={data} />
        </div>
      </div>
      <div className="content-footer">
        <Form method="post">
          <input type="hidden" name="intent" value="test-connection" />
          <button className="secondary-btn" type="submit" disabled={testing}>
            {testing ? "Testing…" : "Test Connection"}
          </button>
        </Form>
        <Form method="post">
          <input type="hidden" name="intent" value="save-sync-preferences" />
          <input type="hidden" name="productsEnabled" value="true" />
          <button className="primary-btn" type="submit">
            Save Changes
          </button>
        </Form>
      </div>
    </>
  );
}
function OrgCell({ icon, tone = "blue", label, value }) {
  return (
    <div className="org-cell">
      <div className={`mini-icon ${tone}`}>
        <Icon type={icon} />
      </div>
      <div className="mini-copy">
        <span>{label}</span>
        <strong>{display(value)}</strong>
      </div>
    </div>
  );
}
function SyncPreferences({ data }) {
  const prefs = data.syncPreferences || {
    products: true,
    orders: true,
    customers: true,
  };
  return (
    <div className="sync-box">
      <SyncRow
        name="Products"
        description="Sync products and inventory to Zoho Books."
        icon="product"
        checked={prefs.products !== false}
      />
      <SyncRow
        name="Orders"
        description="Sync orders as invoices/sales orders."
        icon="order"
        tone="orange"
        checked={prefs.orders !== false}
      />
      <SyncRow
        name="Customers"
        description="Sync customers to Zoho Books."
        icon="customer"
        tone="purple"
        checked={prefs.customers !== false}
      />
    </div>
  );
}
function SyncRow({ name, description, icon, tone = "blue", checked }) {
  return (
    <div className="sync-row">
      <span className={`sync-icon ${tone}`}>
        <Icon type={icon} />
      </span>
      <div className="sync-copy">
        <strong>{name}</strong>
        <span>{description}</span>
      </div>
      <label className="switch">
        <input type="checkbox" defaultChecked={checked} />
        <span className="slider" />
      </label>
    </div>
  );
}

function TaxSection({ data }) {
  const taxes = data.taxes || [];
  const rows = data.taxRateRows || [];
  const settings = data.taxSettings || {};
  const mappedCount = rows.filter((row) =>
    Boolean(settings.rateMap?.[row.key]),
  ).length;
  const unmappedCount = Math.max(rows.length - mappedCount, 0);
  const defaultTax = taxes.find(
    (tax) =>
      String(tax.tax_id || tax.id) === String(settings.defaultTaxId || ""),
  );
  const taxName = (tax) => tax?.tax_name || tax?.name || "—";
  const taxId = (tax) => tax?.tax_id || tax?.id || "—";
  const taxRate = (tax) => tax?.tax_percentage ?? tax?.rate ?? tax?.percentage;
  const taxType = (tax) =>
    tax?.tax_type || tax?.tax_type_formatted || "Goods & Services Tax";
  const codeFor = (row) =>
    row.code ||
    String(row.key || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "");
  const selectedTax = (row) =>
    taxes.find(
      (tax) => String(taxId(tax)) === String(settings.rateMap?.[row.key] || ""),
    );
  const [tab, setTab] = useState("mapping");
  return (
    <div className="tax-section">
      <div className="tax-head">
        <div>
          <h2 className="tax-title">Tax Settings</h2>
          <p className="tax-sub">
            Configure how taxes are synced from Shopify to Zoho Books.
          </p>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value="refresh-zoho-data" />
          <button className="refresh-zoho tax-refresh" type="submit">
            <Icon type="refresh" />
            Refresh from Zoho
          </button>
        </Form>
      </div>
      <Form method="post" className="tax-form">
        <input type="hidden" name="intent" value="save-tax-settings" />
        <div className="tax-info">
          <Icon type="info" />
          Map your Shopify tax settings to Zoho Books tax accounts for accurate
          tax calculation and reporting.
        </div>
        <div className="tax-summary">
          <div className="tax-summary-card">
            <div className="tax-summary-icon">
              <Icon type="receipt" />
            </div>
            <div className="tax-summary-copy">
              <span>Total Tax Rates</span>
              <strong>{rows.length}</strong>
              <small>Active tax rates</small>
            </div>
          </div>
          <div className="tax-summary-card">
            <div className="tax-summary-icon green">
              <Icon type="check-circle" />
            </div>
            <div className="tax-summary-copy">
              <span>Mapped Tax Rates</span>
              <strong>{mappedCount}</strong>
              <small className="green-text">
                {rows.length
                  ? `${Math.round((mappedCount / rows.length) * 100)}% mapped`
                  : "0% mapped"}
              </small>
            </div>
          </div>
          <div className="tax-summary-card">
            <div className="tax-summary-icon orange">
              <Icon type="alert-circle" />
            </div>
            <div className="tax-summary-copy">
              <span>Unmapped Tax Rates</span>
              <strong>{unmappedCount}</strong>
              <small>
                {unmappedCount ? "Needs mapping" : "No unmapped rates"}
              </small>
            </div>
          </div>
          <div className="tax-summary-card">
            <div className="tax-summary-icon blue">
              <Icon type="cash-dollar" />
            </div>
            <div className="tax-summary-copy">
              <span>Default Tax Account</span>
              <strong>{taxName(defaultTax)}</strong>
              <small>
                {defaultTax ? `(${taxId(defaultTax)})` : "Not configured"}
              </small>
            </div>
          </div>
        </div>
        {data.taxSyncError && (
          <div className="tax-info">
            <Icon type="info" />
            Zoho tax data could not be refreshed. Showing the last cached tax
            data, if available.
          </div>
        )}
        <div className="tax-workspace">
          <div className="tax-tabs">
            <button
              className={`tax-tab ${tab === "mapping" ? "active" : ""}`}
              type="button"
              onClick={() => setTab("mapping")}
            >
              Tax Rate Mapping
            </button>
            <button
              className={`tax-tab ${tab === "settings" ? "active" : ""}`}
              type="button"
              onClick={() => setTab("settings")}
            >
              Tax Settings
            </button>
          </div>
          {tab === "mapping" ? (
            <>
              <div className="tax-toolbar">
                <button className="tax-add" type="button">
                  <Icon type="plus" />
                  Add Custom Mapping
                </button>
              </div>
              {rows.length === 0 ? (
                <div className="tax-empty">No Shopify tax rates detected.</div>
              ) : (
                <div className="tax-table">
                  <div className="tax-table-head">
                    <span>Shopify Tax Rate</span>
                    <span>Shopify Tax Code</span>
                    <span>Zoho Books Tax Account</span>
                    <span>Tax Type</span>
                    <span>Status</span>
                    <span>Action</span>
                  </div>
                  {rows.map((row) => {
                    const selected = selectedTax(row);
                    const selectedId = settings.rateMap?.[row.key] || "";
                    return (
                      <div className="tax-table-row" key={row.key}>
                        <strong>{row.label || row.key}</strong>
                        <span className="tax-code">{codeFor(row)}</span>
                        <select
                          className="tax-select"
                          name={`taxrate:${row.key}`}
                          defaultValue={selectedId}
                        >
                          <option value="">Not mapped</option>
                          {taxes.map((tax) => (
                            <option key={taxId(tax)} value={taxId(tax)}>
                              {taxName(tax)}
                              {taxRate(tax) !== undefined &&
                                taxRate(tax) !== null
                                ? ` (${taxRate(tax)}%)`
                                : ""}
                            </option>
                          ))}
                        </select>
                        <span className="tax-type">{taxType(selected)}</span>
                        <span
                          className={`tax-status ${selectedId ? "mapped" : "unmapped"}`}
                        >
                          {selectedId ? "Mapped" : "Not mapped"}
                        </span>
                        <button
                          className="tax-action"
                          type="button"
                          aria-label={`Actions for ${row.label || row.key}`}
                        >
                          ⋮
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="tax-bottom-note">
                <Icon type="info" />
                Tax mappings will be used for all future syncs. You can update
                mappings at any time.
              </div>
            </>
          ) : (
            <div className="tax-settings-panel">
              <div className="tax-setting-card">
                <h3>Default Tax Account</h3>
                <p>
                  Select the default Zoho Books tax account used when a Shopify
                  tax rate has no specific mapping.
                </p>
                <div className="tax-field">
                  <label>Default Zoho Tax</label>
                  <select
                    name="defaultTaxId"
                    defaultValue={settings.defaultTaxId || ""}
                  >
                    <option value="">Select tax account</option>
                    {taxes.map((tax) => (
                      <option key={taxId(tax)} value={taxId(tax)}>
                        {taxName(tax)}
                        {taxRate(tax) !== undefined && taxRate(tax) !== null
                          ? ` (${taxRate(tax)}%)`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="tax-setting-card">
                <h3>Tax Calculation Preferences</h3>
                <p>
                  Choose how tax should be handled when syncing Shopify orders
                  to Zoho Books.
                </p>
                <label className="tax-checkbox">
                  <input
                    type="checkbox"
                    name="pricesIncludeTax"
                    value="true"
                    defaultChecked={Boolean(settings.pricesIncludeTax)}
                  />
                  Prices include tax
                </label>
                <label className="tax-checkbox">
                  <input
                    type="checkbox"
                    name="discountBeforeTax"
                    value="true"
                    defaultChecked={Boolean(settings.discountBeforeTax)}
                  />
                  Apply discounts before tax
                </label>
              </div>
            </div>
          )}
          <div className="tax-save">
            <button className="primary-btn" type="submit">
              Save Changes
            </button>
          </div>
        </div>
      </Form>
    </div>
  );
}

function WarehouseSection({ data }) {
  const locations = data.locations || [];
  const warehouses = data.warehouses || [];
  const mappings = data.warehouseMappings || {};
  const mappedCount = locations.filter((location) =>
    Boolean(mappings[location.id]),
  ).length;
  return (
    <div className="warehouse-section">
      <div className="warehouse-head">
        <div>
          <h2 className="warehouse-title">Warehouse Mapping</h2>
          <p className="warehouse-sub">
            Map your Shopify locations to Zoho Books warehouses.
          </p>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value="refresh-zoho-data" />
          <button className="refresh-zoho warehouse-refresh" type="submit">
            <Icon type="refresh" />
            Refresh from Zoho
          </button>
        </Form>
      </div>
      <Form method="post" className="warehouse-form">
        <input type="hidden" name="intent" value="save-warehouse-mapping" />
        <div className="warehouse-summary">
          <div className="warehouse-stat">
            <span>Shopify Locations</span>
            <strong>{locations.length}</strong>
          </div>
          <div className="warehouse-stat">
            <span>Zoho Inventory Warehouses</span>
            <strong>{warehouses.length}</strong>
          </div>
          <div className="warehouse-stat">
            <span>Mapped</span>
            <strong className="mapped-value">
              {mappedCount} / {locations.length}
            </strong>
          </div>
        </div>
        <div className="warehouse-notice">
          <Icon type="info" />
          Changes to warehouse mapping will be applied for future syncs.
        </div>
        <div className="warehouse-table">
          <div className="warehouse-table-head">
            <span>Shopify Location</span>
            <span>Shopify Location Type</span>
            <span>Zoho Inventory Warehouse</span>
            <span>Warehouse Code</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          {locations.length === 0 ? (
            <div className="warehouse-empty">No Shopify locations found.</div>
          ) : (
            locations.map((location) => {
              const selectedId = mappings[location.id] || "";
              const selectedWarehouse = warehouses.find(
                (warehouse) =>
                  String(warehouse.id || warehouse.warehouse_id) ===
                  String(selectedId),
              );
              const code =
                selectedWarehouse?.warehouse_code ||
                selectedWarehouse?.code ||
                selectedWarehouse?.warehouseCode ||
                "—";
              const locationType = location.name
                ?.toLowerCase()
                .includes("online")
                ? "Online Store"
                : location.name?.toLowerCase().includes("shop")
                  ? "Retail Store"
                  : "Warehouse";
              return (
                <div className="warehouse-table-row" key={location.id}>
                  <div className="warehouse-location">
                    <span className="warehouse-location-icon">
                      <Icon type="store" />
                    </span>
                    <div>
                      <strong>{location.name}</strong>
                      <small>ID: {location.id}</small>
                    </div>
                  </div>
                  <span className="warehouse-type">
                    {location.isActive === false ? "Inactive" : locationType}
                  </span>
                  <select
                    className="warehouse-select"
                    name={`warehouse:${location.id}`}
                    defaultValue={selectedId}
                  >
                    <option value="">Not mapped</option>
                    {warehouses.map((warehouse) => (
                      <option
                        key={warehouse.id || warehouse.warehouse_id}
                        value={warehouse.id || warehouse.warehouse_id}
                      >
                        {warehouse.name || warehouse.warehouse_name}
                      </option>
                    ))}
                  </select>
                  <span className="warehouse-code">{code}</span>
                  <span
                    className={`warehouse-status ${selectedId ? "mapped" : "unmapped"}`}
                  >
                    <span>•</span>
                    {selectedId ? "Mapped" : "Not Mapped"}
                  </span>
                  <button
                    type="button"
                    className="warehouse-action"
                    aria-label={`Actions for ${location.name}`}
                  >
                    ⋮
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="warehouse-footer">
          <button className="primary-btn warehouse-save" type="submit">
            Save Mapping
          </button>
        </div>
      </Form>
    </div>
  );
}
function AccountSection({ data }) {
  const settings = data.accountSettings || {};
  return (
    <div className="simple-section">
      <div className="content-head" style={{ margin: "0 -28px 24px" }}>
        <div>
          <h2 className="content-title">Account Settings</h2>
          <p className="content-sub">
            Set the default Zoho Books accounts used by the integration.
          </p>
        </div>
      </div>
      <Form method="post">
        <input type="hidden" name="intent" value="save-account-settings" />
        <div className="simple-card">
          <div className="field-row">
            <div className="field">
              <label>Sales Account</label>
              <select
                name="salesAccountId"
                defaultValue={settings.salesAccountId || ""}
              >
                <option value="">Select account</option>
                {data.accounts.map((account) => (
                  <option
                    key={account.account_id || account.id}
                    value={account.account_id || account.id}
                  >
                    {account.account_name || account.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Payment Account</label>
              <select
                name="paymentAccountId"
                defaultValue={settings.paymentAccountId || ""}
              >
                <option value="">Select account</option>
                {data.accounts.map((account) => (
                  <option
                    key={account.account_id || account.id}
                    value={account.account_id || account.id}
                  >
                    {account.account_name || account.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Inventory Account</label>
              <select
                name="inventoryAccountId"
                defaultValue={settings.inventoryAccountId || ""}
              >
                <option value="">Select account</option>
                {data.accounts.map((account) => (
                  <option
                    key={account.account_id || account.id}
                    value={account.account_id || account.id}
                  >
                    {account.account_name || account.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="save-row">
          <button className="primary-btn" type="submit">
            Save Account Settings
          </button>
        </div>
      </Form>
    </div>
  );
}
