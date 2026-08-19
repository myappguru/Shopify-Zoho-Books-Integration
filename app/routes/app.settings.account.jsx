import { useState } from "react";
import { Form, useLoaderData } from "react-router";
import { loader, action } from "../models/settings.server";

export { loader, action };

const links = [
  ["Organization Settings", "/app/settings", "grid"],
  ["Zoho Books Connection", "/app/settings", "link"],
  ["Warehouse Mapping", "/app/settings", "warehouse"],
  ["Tax Settings", "/app/settings", "tax"],
  ["Account Settings", "/app/settings/account", "user"],
];

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    link: <><path d="M10 13.5l-1.5 1.5a4 4 0 01-5.7-5.7l3-3a4 4 0 015.7 0"/><path d="M14 10.5l1.5-1.5a4 4 0 015.7 5.7l-3 3a4 4 0 01-5.7 0"/><path d="M8 16l8-8"/></>,
    warehouse: <><path d="M3 10l9-7 9 7v10H3z"/><path d="M7 20v-6h10v6M9 10h.01M15 10h.01"/></>,
    tax: <><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/></>,
    user: <><circle cx="12" cy="8" r="3.5"/><path d="M5 21a7 7 0 0114 0"/></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>,
    store: <><path d="M4 10h16v10H4zM3 10l2-6h14l2 6"/><path d="M8 14h4v6H8z"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></>,
    shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/><path d="M8 12l2.5 2.5L16 9"/></>,
    bell: <><path d="M18 9a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    users: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0112 0M15 14a5 5 0 016 5"/></>,
    refresh: <><path d="M20 11a8 8 0 00-14.7-4L3 10M3 5v5h5M4 13a8 8 0 0014.7 4L21 14M21 19v-5h-5"/></>,
    chevron: <path d="M7 10l5 5 5-5"/>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 015.2 1c0 2-2.7 2-2.7 4M12 17h.01"/></>,
    check: <path d="M5 12l4 4L19 6"/>,
    arrow: <path d="M9 6l6 6-6 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatDate(value) {
  if (!value) return "07 May 2025, 10:25 AM";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).replace("am", "AM").replace("pm", "PM");
}

function InfoItem({ icon, tone, label, value }) {
  return <div className="account-info-item"><span className={`account-info-icon ${tone}`}><Icon name={icon} size={19}/></span><div><span className="account-label">{label}</span><strong className="account-value">{value || "—"}</strong></div></div>;
}

export default function AccountSettings() {
  const data = useLoaderData();
  const organization = data.organization || {};
  const connection = data.connection || {};
  const settings = data.accountSettings || {};
  const shopDomain = data.shopDomain || "my-shopify-store.myshopify.com";
  const merchantName = settings.merchantName || organization.organizationName || "Zylker Pvt. Ltd.";
  const email = settings.accountEmail || connection.connectedBy || "admin@zylker.com";
  const connectedOn = formatDate(connection.connectedAt);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState({ merchantName, email });
  const [storeOpen, setStoreOpen] = useState(false);
  const users = [
    { initials: "AD", name: "Admin User", email, role: "Owner", access: "Full Access", badge: "green", avatar: "purple", date: connectedOn },
    { initials: "JD", name: "John Doe", email: "john.doe@zylker.com", role: "Editor", access: "Manage", badge: "blue", avatar: "blue", date: "08 May 2025, 02:30 PM" },
    { initials: "MS", name: "Mary Smith", email: "mary.smith@zylker.com", role: "Viewer", access: "View Only", badge: "gray", avatar: "orange", date: "09 May 2025, 11:15 AM" },
  ];

  return <s-page>
    <style>{`
      *{box-sizing:border-box}.account-page{min-height:100vh;background:#fff;color:#16233d;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}.account-top{max-width:1218px;margin:0 auto;padding:26px 0 34px;display:flex;justify-content:space-between;align-items:flex-start}.account-top h1{margin:0;font-size:30px;line-height:38px;letter-spacing:-.6px;color:#101827}.account-top p{margin:5px 0 0;font-size:14px;color:#344563}.top-actions{display:flex;gap:12px;align-items:center}.connected{height:42px;padding:0 14px;border-radius:9px;background:#eaf8f0;color:#078b51;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px}.connected-dot{width:8px;height:8px;border-radius:50%;background:#0ba35a}.refresh{width:48px;height:48px;border:1px solid #d8e0ed;border-radius:9px;background:#fff;color:#172c50;display:grid;place-items:center;cursor:pointer}.store-wrap{position:relative}.store-select{height:48px;min-width:226px;padding:0 14px;border:1px solid #d8e0ed;border-radius:9px;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:18px;font-size:13px;font-weight:600;color:#17233c;cursor:pointer}.store-name{display:flex;align-items:center;gap:10px}.store-name svg{color:#1264ed}.store-menu{position:absolute;right:0;top:54px;width:226px;padding:5px;border:1px solid #d8e0ed;border-radius:9px;background:#fff;box-shadow:0 12px 30px rgba(20,35,60,.12);z-index:20}.store-option{width:100%;padding:9px;border:0;border-radius:6px;background:#edf5ff;color:#1264ed;text-align:left;font-size:12px}
      .settings-shell{max-width:1218px;min-height:792px;margin:0 auto;border:1px solid #e0e7f0;border-radius:11px;overflow:hidden;display:grid;grid-template-columns:238px 1fr;background:#fff;box-shadow:0 1px 3px rgba(20,35,60,.03)}.settings-nav{border-right:1px solid #e5eaf1;padding:14px 12px 20px}.nav-title{height:43px;padding:0 14px;display:flex;align-items:center;font-size:13px;font-weight:600;color:#17233c}.nav-link{height:46px;width:100%;padding:0 13px;border:0;border-radius:8px;background:#fff;color:#24385d;display:flex;align-items:center;gap:10px;text-decoration:none;font-size:13px}.nav-link:hover{background:#f5f8fc}.nav-link.active{background:#edf5ff;color:#1264ed;font-weight:600}.nav-icon{width:18px;display:grid;place-items:center}.help-card{margin:88px 10px 0;padding:18px 16px;border:1px solid #cfe0ff;border-radius:10px;background:#f4f8ff}.help-card h3{margin:0;color:#1047bf;font-size:14px}.help-card p{margin:9px 0 14px;color:#24427c;font-size:12px;line-height:21px}.support{width:100%;height:38px;border:1px solid #75a7ff;border-radius:7px;background:#fff;color:#1264ed;font-size:12px;font-weight:600}
      .settings-main{min-width:0;display:flex;flex-direction:column}.main-head{padding:27px 29px 21px;border-bottom:1px solid #e5eaf1}.main-head h2{margin:0;font-size:18px;line-height:24px;color:#111827}.main-head p{margin:5px 0 0;font-size:12px;color:#344563}.main-body{padding:0 29px 78px;position:relative;flex:1}.card{margin-top:18px;border:1px solid #dfe6f0;border-radius:9px;overflow:hidden;background:#fff}.card-head{min-height:50px;padding:0 13px 0 14px;border-bottom:1px solid #e5eaf1;display:flex;align-items:center;justify-content:space-between}.card-title{font-size:12px;font-weight:650;color:#17233c}.card-description{margin-top:3px;font-size:10px;color:#596a87}.outline{height:32px;padding:0 11px;border:1px solid #d5ddea;border-radius:7px;background:#fff;color:#263856;display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:600;cursor:pointer}.info-grid{display:grid;grid-template-columns:1fr 1fr}.account-info-item{min-height:69px;padding:12px 14px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #edf0f4}.account-info-item:nth-child(even){border-left:1px solid #edf0f4}.account-info-item:nth-last-child(-n+2){border-bottom:0}.account-info-icon{width:38px;height:38px;border-radius:9px;display:grid;place-items:center;flex:0 0 auto}.tone-purple{background:#f1e9ff;color:#7936ef}.tone-green{background:#e7f8ee;color:#079b57}.tone-blue{background:#edf5ff;color:#1264ed}.tone-orange{background:#fff1e3;color:#ed7c00}.account-label{display:block;margin-bottom:4px;font-size:10px;color:#596a87}.account-value{display:block;font-size:11px;line-height:15px;font-weight:500;color:#17233c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.access-head{padding:10px 14px 9px}.table-wrap{overflow:auto}.access-table{width:100%;border-collapse:collapse;table-layout:fixed}.access-table th{height:38px;padding:0 12px;background:#f8fafc;border-top:1px solid #e5eaf1;border-bottom:1px solid #dfe6f0;text-align:left;font-size:9px;color:#263856;font-weight:700}.access-table td{height:43px;padding:0 12px;border-bottom:1px solid #edf0f4;font-size:9px;color:#24385d}.access-table tr:last-child td{border-bottom:0}.user{display:flex;align-items:center;gap:9px;min-width:0}.avatar{width:27px;height:27px;border-radius:50%;display:grid;place-items:center;font-size:9px;font-weight:700;flex:0 0 auto}.avatar-purple{background:#eee7ff;color:#6f2df0}.avatar-blue{background:#e9f2ff;color:#1264ed}.avatar-orange{background:#fff0df;color:#ec7800}.user-name{font-size:10px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge{display:inline-flex;border-radius:5px;padding:4px 7px;font-size:8px;font-weight:600}.badge-green{background:#e6f7ed;color:#078b51}.badge-blue{background:#eaf2ff;color:#1264ed}.badge-gray{background:#f0f2f5;color:#263856}.menu{border:0;background:transparent;color:#405575;font-size:17px;cursor:pointer}.security{display:flex;flex-direction:column}.security-row{min-height:57px;padding:0 14px;display:flex;align-items:center;gap:12px;border:0;border-bottom:1px solid #edf0f4;background:#fff;text-align:left;cursor:pointer}.security-row:last-child{border-bottom:0}.security-icon{width:31px;height:31px;border-radius:8px;display:grid;place-items:center;flex:0 0 auto}.security-copy{flex:1}.security-copy strong{display:block;font-size:10px;color:#17233c;font-weight:650}.security-copy span{display:block;margin-top:3px;font-size:9px;color:#596a87}.enabled{padding:4px 7px;border-radius:5px;background:#e7f8ee;color:#078b51;font-size:8px;font-weight:600}.arrow{color:#405575}.save-bar{position:absolute;left:0;right:0;bottom:0;height:67px;padding:0 29px;border-top:1px solid #e5eaf1;background:#fff;display:flex;align-items:center;justify-content:flex-end;gap:12px}.reset,.save{height:40px;padding:0 18px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer}.reset{border:1px solid #d6deea;background:#fff;color:#263856}.save{border:1px solid #1264ed;background:#1264ed;color:#fff}.modal-backdrop{position:fixed;inset:0;background:rgba(16,32,58,.28);z-index:100;display:flex;align-items:center;justify-content:center}.modal{width:430px;padding:20px;border:1px solid #dfe6f0;border-radius:12px;background:#fff;box-shadow:0 20px 50px rgba(20,35,60,.18)}.modal h3{margin:0;font-size:16px}.modal p{margin:6px 0 18px;font-size:12px;color:#596a87}.field{margin-bottom:13px}.field label{display:block;margin-bottom:6px;font-size:11px;font-weight:600}.field input{width:100%;height:38px;border:1px solid #cfd9e8;border-radius:7px;padding:0 10px;font-size:12px}.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}@media(max-width:900px){.account-top{padding:20px 16px;flex-direction:column}.settings-shell{margin:0 16px;grid-template-columns:1fr}.settings-nav{border-right:0;border-bottom:1px solid #e5eaf1}.help-card{margin:18px 10px}.main-body{padding-left:16px;padding-right:16px}.info-grid{grid-template-columns:1fr}.account-info-item:nth-child(even){border-left:0}.account-info-item:nth-last-child(2){border-bottom:1px solid #edf0f4}.save-bar{position:static;margin:0 -16px;padding:12px 16px}.access-table{min-width:760px}}
    `}</style>
    <div className="account-page">
      <header className="account-top">
        <div><h1>Settings</h1><p>Manage your organization, Zoho Books connection and integration preferences.</p></div>
        <div className="top-actions">
          <span className="connected"><span className="connected-dot"/>{data.connection ? "Connected" : "Not connected"}</span>
          <Form method="post"><input type="hidden" name="intent" value="refresh-zoho-data"/><button className="refresh" title="Refresh"><Icon name="refresh" size={19}/></button></Form>
          <div className="store-wrap"><button className="store-select" type="button" onClick={()=>setStoreOpen(v=>!v)}><span className="store-name"><Icon name="store" size={18}/>My Shopify Store</span><Icon name="chevron" size={16}/></button>{storeOpen&&<div className="store-menu"><button className="store-option" type="button">My Shopify Store</button></div>}</div>
        </div>
      </header>
      <div className="settings-shell">
        <aside className="settings-nav">
          <div className="nav-title">Organization Settings</div>
          {links.map(([label, href, icon])=><a key={label} href={href} className={`nav-link ${label === "Account Settings" ? "active" : ""}`}><span className="nav-icon"><Icon name={icon}/></span>{label}</a>)}
          <div className="help-card"><h3>Need Help?</h3><p>Our support team is here<br/>to help you.</p><button className="support"><Icon name="help" size={15}/> &nbsp; Contact Support</button></div>
        </aside>
        <main className="settings-main">
          <div className="main-head"><h2>Account Settings</h2><p>Manage app access, permissions and account preferences.</p></div>
          <div className="main-body">
            <section className="card"><div className="card-head"><span className="card-title">Account Information</span><button className="outline" type="button" onClick={()=>setEditOpen(true)}><Icon name="edit" size={14}/>Edit Account</button></div><div className="info-grid">
              <InfoItem icon="user" tone="tone-purple" label="Merchant Name" value={merchantName}/><InfoItem icon="mail" tone="tone-green" label="Account Email" value={email}/><InfoItem icon="store" tone="tone-blue" label="Shopify Store" value={shopDomain}/><InfoItem icon="calendar" tone="tone-orange" label="Connected On" value={connectedOn}/><InfoItem icon="lock" tone="tone-purple" label="Role" value="Administrator"/><InfoItem icon="shield" tone="tone-green" label="Permissions" value="Full Access"/>
            </div></section>
            <section className="card"><div className="access-head"><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}><div><div className="card-title">App Access</div><div className="card-description">Manage who has access to the Shopify – Zoho Books Integration app.</div></div><button className="outline" type="button"><Icon name="users" size={14}/>Manage Access</button></div></div><div className="table-wrap"><table className="access-table"><thead><tr><th style={{width:"21%"}}>User</th><th style={{width:"22%"}}>Email</th><th style={{width:"16%"}}>Role</th><th style={{width:"18%"}}>Access Level</th><th style={{width:"19%"}}>Access Granted On</th><th style={{width:"4%"}}/></tr></thead><tbody>{users.map(u=><tr key={u.email}><td><div className="user"><span className={`avatar avatar-${u.avatar}`}>{u.initials}</span><span className="user-name">{u.name}</span></div></td><td>{u.email}</td><td>{u.role}</td><td><span className={`badge badge-${u.badge}`}>{u.access}</span></td><td>{u.date}</td><td><button className="menu" type="button">⋮</button></td></tr>)}</tbody></table></div></section>
            <section className="card"><div className="access-head"><div className="card-title">Security &amp; Preferences</div><div className="card-description">Manage your security settings and other preferences.</div></div><div className="security"><button className="security-row" type="button"><span className="security-icon tone-green"><Icon name="shield" size={16}/></span><span className="security-copy"><strong>IP Whitelisting</strong><span>Restrict access to the app from specific IP addresses.</span></span><span className="enabled">Enabled</span><span className="arrow"><Icon name="arrow" size={15}/></span></button><button className="security-row" type="button"><span className="security-icon tone-blue"><Icon name="bell" size={16}/></span><span className="security-copy"><strong>Email Notifications</strong><span>Receive important updates and sync alerts via email.</span></span><span className="enabled">Enabled</span><span className="arrow"><Icon name="arrow" size={15}/></span></button></div></section>
            <div className="save-bar"><button className="reset" type="button" onClick={()=>setDraft({merchantName,email})}>Reset to Default</button><Form method="post"><input type="hidden" name="intent" value="save-account-settings"/><input type="hidden" name="salesAccountId" value={settings.salesAccountId || ""}/><input type="hidden" name="paymentAccountId" value={settings.paymentAccountId || ""}/><input type="hidden" name="inventoryAccountId" value={settings.inventoryAccountId || ""}/><button className="save" type="submit">Save Changes</button></Form></div>
          </div>
        </main>
      </div>
    </div>
    {editOpen&&<div className="modal-backdrop" onClick={()=>setEditOpen(false)}><div className="modal" onClick={e=>e.stopPropagation()}><h3>Edit Account</h3><p>Update the account information displayed for this integration.</p><div className="field"><label>Merchant Name</label><input value={draft.merchantName} onChange={e=>setDraft({...draft,merchantName:e.target.value})}/></div><div className="field"><label>Account Email</label><input type="email" value={draft.email} onChange={e=>setDraft({...draft,email:e.target.value})}/></div><div className="modal-actions"><button className="reset" type="button" onClick={()=>setEditOpen(false)}>Cancel</button><button className="save" type="button" onClick={()=>setEditOpen(false)}>Save</button></div></div></div>}
  </s-page>;
}
