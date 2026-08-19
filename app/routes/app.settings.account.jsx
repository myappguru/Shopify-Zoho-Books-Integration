import { useState } from "react";
import { Form, useLoaderData } from "react-router";
import { loader, action } from "../models/settings.server";

export { loader, action };

const SETTINGS_LINKS = [
  ["Organization Settings", "/app/settings"],
  ["Zoho Books Connection", "/app/settings"],
  ["Warehouse Mapping", "/app/settings"],
  ["Tax Settings", "/app/settings"],
  ["Account Settings", "/app/settings/account"],
];

function Icon({ children }) {
  return <span className="as-icon">{children}</span>;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name) {
  return String(name || "Admin User")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function AccountSettings() {
  const data = useLoaderData();
  const [editOpen, setEditOpen] = useState(false);
  const organization = data.organization || {};
  const connection = data.connection || {};
  const settings = data.accountSettings || {};
  const shopDomain = data.shopDomain || "my-shopify-store.myshopify.com";
  const merchantName = settings.merchantName || organization.organizationName || "Zylker Pvt. Ltd.";
  const email = settings.accountEmail || connection.connectedBy || "admin@zylker.com";
  const connectedOn = formatDate(connection.connectedAt) || "07 May 2025, 10:25 AM";

  const [draft, setDraft] = useState({ merchantName, email });

  const users = [
    { initials: "AD", name: "Admin User", email, role: "Owner", access: "Full Access", tone: "purple", badge: "green", date: connectedOn },
    { initials: "JD", name: "John Doe", email: "john.doe@zylker.com", role: "Editor", access: "Manage", tone: "blue", badge: "blue", date: "08 May 2025, 02:30 PM" },
    { initials: "MS", name: "Mary Smith", email: "mary.smith@zylker.com", role: "Viewer", access: "View Only", tone: "orange", badge: "gray", date: "09 May 2025, 11:15 AM" },
  ];

  return (
    <s-page>
      <style>{`
        .as-page{min-height:calc(100vh - 32px);background:#fff;color:#17233c;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
        .as-top{max-width:1218px;margin:0 auto;padding:26px 0 34px;display:flex;align-items:flex-start;justify-content:space-between;gap:24px}.as-title{margin:0;font-size:30px;line-height:38px;font-weight:700;letter-spacing:-.6px;color:#111827}.as-subtitle{margin:5px 0 0;font-size:14px;line-height:22px;color:#344563}.as-actions{display:flex;align-items:center;gap:12px}.as-connected{height:42px;padding:0 14px;border-radius:9px;background:#eaf8f0;color:#078b51;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}.as-dot{width:8px;height:8px;border-radius:50%;background:#0ba35a}.as-refresh{width:48px;height:48px;border:1px solid #d8e0ed;background:#fff;border-radius:9px;color:#17305c;display:grid;place-items:center;font-size:21px;cursor:pointer}.as-store{height:48px;min-width:226px;padding:0 14px;border:1px solid #d8e0ed;background:#fff;border-radius:9px;display:flex;align-items:center;justify-content:space-between;color:#17233c;font-size:13px;font-weight:600}.as-store-left{display:flex;align-items:center;gap:10px}.as-store-icon{color:#1264ed;font-size:18px}.as-chevron{font-size:17px}
        .as-shell{max-width:1218px;min-height:792px;margin:0 auto;border:1px solid #e1e7f0;border-radius:11px;display:grid;grid-template-columns:238px 1fr;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(20,35,60,.035)}.as-nav{border-right:1px solid #e5eaf1;padding:14px 12px 20px}.as-nav-title{height:43px;padding:0 14px;display:flex;align-items:center;color:#17233c;font-size:13px;font-weight:600}.as-nav-item{height:46px;width:100%;border:0;background:#fff;border-radius:8px;padding:0 13px;display:flex;align-items:center;gap:10px;text-align:left;color:#24385d;font-size:13px;cursor:pointer}.as-nav-item:hover{background:#f5f8fc}.as-nav-item.active{background:#edf5ff;color:#1264ed;font-weight:600}.as-nav-icon{width:18px;height:18px;display:grid;place-items:center;color:inherit;font-size:16px}.as-help{margin:88px 10px 0;padding:18px 16px;border:1px solid #cfe0ff;background:#f4f8ff;border-radius:10px}.as-help h3{margin:0;color:#1047bf;font-size:14px}.as-help p{margin:9px 0 14px;font-size:12px;line-height:21px;color:#24427c}.as-support{height:38px;width:100%;border:1px solid #75a7ff;background:#fff;border-radius:7px;color:#1264ed;font-size:12px;font-weight:600}
        .as-main{min-width:0;display:flex;flex-direction:column}.as-main-head{padding:27px 29px 21px;border-bottom:1px solid #e5eaf1}.as-main-title{margin:0;font-size:18px;line-height:24px;font-weight:650;color:#111827}.as-main-sub{margin:5px 0 0;font-size:12px;line-height:19px;color:#344563}
        .as-body{padding:0 29px 77px;position:relative;flex:1}.as-card{margin-top:18px;border:1px solid #dfe6f0;border-radius:9px;overflow:hidden;background:#fff}.as-card-head{min-height:49px;padding:0 13px 0 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5eaf1}.as-card-title{font-size:12px;font-weight:650;color:#17233c}.as-card-desc{margin-top:3px;font-size:10px;color:#596a87}.as-btn{height:32px;padding:0 11px;border:1px solid #d5ddea;background:#fff;border-radius:7px;color:#263856;font-size:10px;font-weight:600;display:inline-flex;align-items:center;gap:6px;cursor:pointer}.as-info-grid{display:grid;grid-template-columns:1fr 1fr}.as-info{min-height:68px;padding:12px 14px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #edf0f4}.as-info:nth-child(even){border-left:1px solid #edf0f4}.as-info:nth-last-child(-n+2){border-bottom:0}.as-info-icon{width:38px;height:38px;border-radius:9px;display:grid;place-items:center;font-size:17px;flex:0 0 auto}.purple{background:#f1e9ff;color:#7936ef}.green{background:#e7f8ee;color:#079b57}.blue{background:#edf5ff;color:#1264ed}.orange{background:#fff1e3;color:#ed7c00}.as-info-copy{min-width:0}.as-info-copy span{display:block;font-size:10px;color:#596a87;margin-bottom:4px}.as-info-copy strong{display:block;font-size:11px;line-height:15px;color:#17233c;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .as-access-head{padding:10px 14px 9px}.as-table-wrap{overflow:auto}.as-table{width:100%;border-collapse:collapse;table-layout:fixed}.as-table th{height:38px;padding:0 12px;background:#f8fafc;border-top:1px solid #e5eaf1;border-bottom:1px solid #dfe6f0;text-align:left;color:#263856;font-size:9px;font-weight:700}.as-table td{height:43px;padding:0 12px;border-bottom:1px solid #edf0f4;color:#24385d;font-size:9px;vertical-align:middle}.as-table tr:last-child td{border-bottom:0}.as-user{display:flex;align-items:center;gap:9px;min-width:0}.as-avatar{width:27px;height:27px;border-radius:50%;display:grid;place-items:center;font-size:9px;font-weight:700;flex:0 0 auto}.as-avatar.purple{background:#eee7ff;color:#6f2df0}.as-avatar.blue{background:#e9f2ff;color:#1264ed}.as-avatar.orange{background:#fff0df;color:#ec7800}.as-user strong{font-size:10px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.as-badge{display:inline-flex;align-items:center;border-radius:5px;padding:4px 7px;font-size:8px;font-weight:600}.as-badge.green{background:#e6f7ed;color:#078b51}.as-badge.blue{background:#eaf2ff;color:#1264ed}.as-badge.gray{background:#f0f2f5;color:#263856}.as-menu{border:0;background:none;font-size:17px;color:#405575;cursor:pointer}
        .as-security{display:flex;flex-direction:column}.as-security-row{min-height:57px;padding:0 14px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #edf0f4;background:#fff;border-left:0;border-right:0;border-top:0;width:100%;text-align:left;cursor:pointer}.as-security-row:last-child{border-bottom:0}.as-security-icon{width:31px;height:31px;border-radius:8px;display:grid;place-items:center;font-size:15px;flex:0 0 auto}.as-security-copy{flex:1}.as-security-copy strong{display:block;font-size:10px;color:#17233c;font-weight:650}.as-security-copy span{display:block;margin-top:3px;font-size:9px;color:#596a87}.as-enabled{background:#e7f8ee;color:#078b51;border-radius:5px;padding:4px 7px;font-size:8px;font-weight:600}.as-arrow{font-size:18px;color:#405575;margin-left:8px}.as-footer{position:absolute;left:0;right:0;bottom:0;height:67px;border-top:1px solid #e5eaf1;background:#fff;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:0 29px}.as-footer-secondary,.as-footer-primary{height:40px;padding:0 18px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer}.as-footer-secondary{border:1px solid #d6deea;background:#fff;color:#263856}.as-footer-primary{border:1px solid #1264ed;background:#1264ed;color:#fff}
        .as-modal-backdrop{position:fixed;inset:0;background:rgba(16,32,58,.28);z-index:100;display:flex;align-items:center;justify-content:center}.as-modal{width:430px;padding:20px;background:#fff;border:1px solid #dfe6f0;border-radius:12px;box-shadow:0 20px 50px rgba(20,35,60,.18)}.as-modal h3{margin:0;font-size:16px;color:#17233c}.as-modal p{margin:6px 0 18px;font-size:12px;color:#596a87}.as-field{margin-bottom:13px}.as-field label{display:block;margin-bottom:6px;font-size:11px;font-weight:600;color:#263856}.as-field input{width:100%;height:38px;box-sizing:border-box;border:1px solid #cfd9e8;border-radius:7px;padding:0 10px;font-size:12px}.as-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
        @media(max-width:900px){.as-top{padding:20px 16px;flex-direction:column}.as-shell{margin:0 16px;grid-template-columns:1fr}.as-nav{border-right:0;border-bottom:1px solid #e5eaf1}.as-help{margin:18px 10px}.as-body{padding-left:16px;padding-right:16px}.as-info-grid{grid-template-columns:1fr}.as-info:nth-child(even){border-left:0}.as-info:nth-last-child(2){border-bottom:1px solid #edf0f4}.as-footer{position:static;margin:0 -16px;padding:12px 16px}.as-table{min-width:760px}}
      `}</style>

      <div className="as-page">
        <header className="as-top">
          <div>
            <h1 className="as-title">Settings</h1>
            <p className="as-subtitle">Manage your organization, Zoho Books connection and integration preferences.</p>
          </div>
          <div className="as-actions">
            <span className="as-connected"><span className="as-dot" />{data.connection ? "Connected" : "Not connected"}</span>
            <Form method="post"><input type="hidden" name="intent" value="refresh-zoho-data" /><button className="as-refresh" title="Refresh" type="submit">↻</button></Form>
            <button className="as-store" type="button"><span className="as-store-left"><span className="as-store-icon">▣</span>My Shopify Store</span><span className="as-chevron">⌄</span></button>
          </div>
        </header>

        <div className="as-shell">
          <aside className="as-nav">
            <div className="as-nav-title">Organization Settings</div>
            {SETTINGS_LINKS.map(([label, href], index) => (
              <a key={label} href={href} className={`as-nav-item ${index === 4 ? "active" : ""}`} style={{textDecoration:"none"}}>
                <span className="as-nav-icon">{["◈", "↗", "▤", "♢", "◎"][index]}</span>{label}
              </a>
            ))}
            <div className="as-help"><h3>Need Help?</h3><p>Our support team is here<br />to help you.</p><button className="as-support">♧ &nbsp; Contact Support</button></div>
          </aside>

          <main className="as-main">
            <div className="as-main-head"><h2 className="as-main-title">Account Settings</h2><p className="as-main-sub">Manage app access, permissions and account preferences.</p></div>
            <div className="as-body">
              <section className="as-card">
                <div className="as-card-head"><span className="as-card-title">Account Information</span><button className="as-btn" type="button" onClick={() => setEditOpen(true)}>✎ &nbsp;Edit Account</button></div>
                <div className="as-info-grid">
                  <Info icon="♙" tone="purple" label="Merchant Name" value={merchantName} />
                  <Info icon="✉" tone="green" label="Account Email" value={email} />
                  <Info icon="▣" tone="blue" label="Shopify Store" value={shopDomain} />
                  <Info icon="▦" tone="orange" label="Connected On" value={connectedOn} />
                  <Info icon="▣" tone="purple" label="Role" value="Administrator" />
                  <Info icon="♢" tone="green" label="Permissions" value="Full Access" />
                </div>
              </section>

              <section className="as-card">
                <div className="as-access-head"><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}><div><div className="as-card-title">App Access</div><div className="as-card-desc">Manage who has access to the Shopify – Zoho Books Integration app.</div></div><button className="as-btn" type="button">♙ &nbsp;Manage Access</button></div></div>
                <div className="as-table-wrap"><table className="as-table"><thead><tr><th style={{width:"21%"}}>User</th><th style={{width:"22%"}}>Email</th><th style={{width:"16%"}}>Role</th><th style={{width:"18%"}}>Access Level</th><th style={{width:"19%"}}>Access Granted On</th><th style={{width:"4%"}}></th></tr></thead><tbody>{users.map((user) => <tr key={user.email}><td><div className="as-user"><span className={`as-avatar ${user.tone}`}>{user.initials}</span><strong>{user.name}</strong></div></td><td>{user.email}</td><td>{user.role}</td><td><span className={`as-badge ${user.badge}`}>{user.access}</span></td><td>{user.date}</td><td><button className="as-menu" type="button">⋮</button></td></tr>)}</tbody></table></div>
              </section>

              <section className="as-card">
                <div className="as-access-head"><div className="as-card-title">Security & Preferences</div><div className="as-card-desc">Manage your security settings and other preferences.</div></div>
                <div className="as-security">
                  <button className="as-security-row" type="button"><span className="as-security-icon green">♢</span><span className="as-security-copy"><strong>IP Whitelisting</strong><span>Restrict access to the app from specific IP addresses.</span></span><span className="as-enabled">Enabled</span><span className="as-arrow">›</span></button>
                  <button className="as-security-row" type="button"><span className="as-security-icon blue">♧</span><span className="as-security-copy"><strong>Email Notifications</strong><span>Receive important updates and sync alerts via email.</span></span><span className="as-enabled">Enabled</span><span className="as-arrow">›</span></button>
                </div>
              </section>

              <div className="as-footer"><button className="as-footer-secondary" type="button" onClick={() => setDraft({ merchantName, email })}>Reset to Default</button><Form method="post"><input type="hidden" name="intent" value="save-account-settings" /><input type="hidden" name="salesAccountId" value={settings.salesAccountId || ""} /><input type="hidden" name="paymentAccountId" value={settings.paymentAccountId || ""} /><input type="hidden" name="inventoryAccountId" value={settings.inventoryAccountId || ""} /><input type="hidden" name="accountEmail" value={draft.email} /><button className="as-footer-primary" type="submit">Save Changes</button></Form></div>
            </div>
          </main>
        </div>
      </div>

      {editOpen && <div className="as-modal-backdrop" onClick={() => setEditOpen(false)}><div className="as-modal" onClick={(event) => event.stopPropagation()}><h3>Edit Account</h3><p>Update the account information displayed for this integration.</p><div className="as-field"><label>Merchant Name</label><input value={draft.merchantName} onChange={(event) => setDraft((value) => ({...value, merchantName:event.target.value}))} /></div><div className="as-field"><label>Account Email</label><input type="email" value={draft.email} onChange={(event) => setDraft((value) => ({...value, email:event.target.value}))} /></div><div className="as-modal-actions"><button className="as-footer-secondary" type="button" onClick={() => setEditOpen(false)}>Cancel</button><button className="as-footer-primary" type="button" onClick={() => setEditOpen(false)}>Save</button></div></div></div>}
    </s-page>
  );
}

function Info({ icon, tone, label, value }) {
  return <div className="as-info"><div className={`as-info-icon ${tone}`}>{icon}</div><div className="as-info-copy"><span>{label}</span><strong>{value || "—"}</strong></div></div>;
}
