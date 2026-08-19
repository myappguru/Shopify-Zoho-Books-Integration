import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

export function useZohoConnectionSync() {
  const revalidator = useRevalidator();
  const revalidatorRef = useRef(revalidator);
  revalidatorRef.current = revalidator;

  useEffect(() => {
    function handleMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== "zoho-oauth") return;
      revalidatorRef.current.revalidate();
    }

    const styleId = "zoho-settings-connection-ui-fixes";
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .connection-page + .content-footer { display:none !important; }
        .sync-icon.purple { position:relative; overflow:hidden; }
        .sync-icon.purple s-icon[type="customer"] { display:none; }
        .sync-icon.purple::before { content:"";position:absolute;width:7px;height:7px;border-radius:50%;background:currentColor;top:6px;left:50%;transform:translateX(-50%); }
        .sync-icon.purple::after { content:"";position:absolute;width:14px;height:8px;border-radius:9px 9px 4px 4px;background:currentColor;left:50%;bottom:5px;transform:translateX(-50%); }
        .warehouse-mapping-section{padding:0!important;}
        .warehouse-mapping-section .content-head{min-height:104px;padding:27px 30px 21px;position:relative;}
        .warehouse-mapping-section .simple-card:first-of-type{margin:20px 30px 18px;padding:0;border:0;display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;background:transparent;}
        .warehouse-mapping-section .simple-card:first-of-type::before{content:"Map each Shopify location with a Zoho Inventory warehouse to ensure accurate inventory and order sync.";grid-column:1/-1;min-height:46px;border:1px solid #b8d2ff;background:#f2f7ff;border-radius:8px;padding:0 14px;display:flex;align-items:center;color:#38527b;font-size:12px;box-sizing:border-box;}
        .warehouse-mapping-section .simple-card:first-of-type .mapping-row{display:none;}
        .warehouse-mapping-section .save-row{padding:16px 30px;border-top:1px solid #e5eaf1;margin:0;}
        .warehouse-mapping-section .save-row .primary-btn{height:40px;padding:0 20px;}
        .warehouse-mapping-section .warehouse-summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin:0 30px 18px;}
        .warehouse-mapping-section .warehouse-summary-card{min-height:78px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:15px 18px;box-sizing:border-box;}
        .warehouse-mapping-section .warehouse-summary-label{font-size:11px;color:#596a87;display:block;margin-bottom:7px;}
        .warehouse-mapping-section .warehouse-summary-value{font-size:22px;font-weight:700;color:#17233c;}
        .warehouse-mapping-section .warehouse-summary-card.mapped .warehouse-summary-value{color:#08a15b;}
        .warehouse-mapping-section .warehouse-info{margin:0 30px 18px;border:1px solid #b8d2ff;background:#f2f7ff;border-radius:8px;min-height:42px;padding:0 14px;display:flex;align-items:center;color:#38527b;font-size:11px;box-sizing:border-box;}
        .warehouse-mapping-section .warehouse-table-card{margin:0 30px 18px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff;}
        .warehouse-mapping-section .warehouse-table-head{display:grid;grid-template-columns:1.35fr .9fr 1.3fr .75fr .7fr .35fr;min-height:45px;align-items:center;padding:0 16px;background:#f8fafc;border-bottom:1px solid #e5eaf1;color:#17233c;font-size:11px;font-weight:650;}
        .warehouse-mapping-section .warehouse-row{display:grid;grid-template-columns:1.35fr .9fr 1.3fr .75fr .7fr .35fr;min-height:72px;align-items:center;padding:0 16px;border-bottom:1px solid #edf0f4;column-gap:12px;}
        .warehouse-mapping-section .warehouse-row:last-child{border-bottom:0;}
        .warehouse-mapping-section .warehouse-location{display:flex;align-items:center;gap:10px;min-width:0;}
        .warehouse-mapping-section .warehouse-location-icon{width:32px;height:32px;border-radius:8px;background:#edf5ff;color:#1264ed;display:grid;place-items:center;flex:0 0 auto;}
        .warehouse-mapping-section .warehouse-location-name{font-size:12px;font-weight:650;color:#17233c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .warehouse-mapping-section .warehouse-location-id{display:block;font-size:10px;color:#596a87;margin-top:3px;}
        .warehouse-mapping-section .warehouse-type{font-size:11px;color:#24385d;}
        .warehouse-mapping-section .warehouse-select{height:38px;width:100%;border:1px solid #d5ddea;border-radius:7px;background:#fff;padding:0 9px;font-size:11px;color:#17233c;}
        .warehouse-mapping-section .warehouse-code{font-size:11px;color:#24385d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .warehouse-mapping-section .warehouse-status{display:inline-flex;width:max-content;padding:5px 8px;border-radius:6px;background:#e8f8ef;color:#0a9858;font-size:10px;font-weight:600;}
        .warehouse-mapping-section .warehouse-status.unmapped{background:#fff3e4;color:#e27d00;}
        .warehouse-mapping-section .warehouse-action{border:0;background:transparent;color:#24385d;font-size:18px;cursor:pointer;}

        /* Tax Settings — pixel alignment against the approved reference. */
        .settings-page{max-width:1220px!important;}
        .settings-shell{grid-template-columns:240px minmax(0,1fr)!important;}
        .settings-nav{padding:22px 12px 20px!important;}
        .settings-nav-title{display:none!important;}
        .settings-nav .nav-item{height:46px!important;margin:0 0 13px!important;padding:0 12px!important;}
        .settings-nav .nav-item:last-child{margin-bottom:0!important;}
        .tax-section{padding:0 28px 16px!important;}
        .tax-head{min-height:88px!important;height:88px!important;margin:0 -28px!important;padding:23px 28px 16px!important;}
        .tax-title{font-size:20px!important;line-height:25px!important;letter-spacing:-.2px;}
        .tax-sub{font-size:13px!important;line-height:20px!important;margin-top:4px!important;}
        .tax-refresh{height:43px!important;padding:0 15px!important;font-size:12px!important;border-radius:8px!important;}
        .tax-form{padding-top:12px!important;}
        .tax-info{min-height:46px!important;height:46px!important;margin:0 0 28px!important;padding:0 14px!important;font-size:12px!important;border-radius:8px!important;}
        .tax-summary{grid-template-columns:1fr 1fr 1fr 1.12fr!important;gap:14px!important;margin:0 0 20px!important;}
        .tax-summary-card{height:98px!important;min-height:98px!important;padding:15px 14px!important;border-radius:9px!important;gap:12px!important;}
        .tax-summary-icon{width:40px!important;height:40px!important;border-radius:10px!important;}
        .tax-summary-copy span{font-size:11px!important;margin-bottom:4px!important;white-space:nowrap;}
        .tax-summary-copy strong{font-size:19px!important;line-height:23px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .tax-summary-copy small{font-size:10px!important;margin-top:4px!important;white-space:nowrap;}
        .tax-workspace{position:relative!important;border-radius:9px!important;overflow:hidden!important;}
        .tax-tabs{height:58px!important;padding:0 18px!important;align-items:flex-end!important;}
        .tax-tab{height:58px!important;padding:0 20px!important;font-size:12px!important;}
        .tax-toolbar{position:absolute!important;z-index:2!important;top:0!important;right:0!important;min-height:58px!important;height:58px!important;padding:0 18px!important;border:0!important;background:transparent!important;}
        .tax-add{height:36px!important;padding:0 13px!important;border-radius:7px!important;font-size:11px!important;}
        .tax-table-head,.tax-table-row{grid-template-columns:1.05fr .9fr 1.55fr 1.1fr .75fr .35fr!important;column-gap:0!important;}
        .tax-table-head{min-height:48px!important;height:48px!important;padding:0 18px!important;font-size:10px!important;}
        .tax-table-row{min-height:60px!important;height:60px!important;padding:0 18px!important;font-size:11px!important;}
        .tax-table-row strong{font-size:11px!important;color:#17233c;}
        .tax-code{font-size:11px!important;}
        .tax-select{height:36px!important;font-size:11px!important;border-radius:7px!important;padding:0 9px!important;}
        .tax-type{font-size:11px!important;line-height:16px!important;}
        .tax-status{font-size:10px!important;padding:6px 9px!important;border-radius:6px!important;}
        .tax-action{font-size:19px!important;}
        .tax-bottom-note{height:43px!important;min-height:43px!important;margin:18px!important;padding:0 13px!important;font-size:11px!important;}
        .tax-save{height:76px!important;box-sizing:border-box!important;padding:18px!important;align-items:center!important;}
        .tax-save .primary-btn{height:40px!important;min-width:154px!important;padding:0 20px!important;font-size:12px!important;border-radius:8px!important;}
        .tax-settings-panel{padding:20px 18px!important;}
        @media(max-width:1000px){
          .tax-summary{grid-template-columns:1fr 1fr!important;}
          .tax-table{overflow-x:auto;}
          .tax-table-head,.tax-table-row{min-width:900px!important;}
        }
        @media(max-width:900px){
          .settings-shell{grid-template-columns:190px 1fr!important;}
          .settings-nav{padding-top:16px!important;}
          .settings-nav .nav-item{margin-bottom:8px!important;}
        }
        @media(max-width:650px){
          .settings-shell{grid-template-columns:1fr!important;}
          .settings-nav{padding:10px 12px!important;}
          .settings-nav .nav-item{margin-bottom:5px!important;}
          .tax-section{padding:0 16px 16px!important;}
          .tax-head{margin:0 -16px!important;padding:20px 16px 14px!important;height:auto!important;min-height:88px!important;}
          .tax-form{padding-top:12px!important;}
          .tax-summary{grid-template-columns:1fr!important;}
          .tax-toolbar{padding-right:12px!important;}
        }
      `;
      document.head.appendChild(style);
    }

    function enhanceWarehouseSection() {
      const sections = Array.from(document.querySelectorAll(".simple-section"));
      const section = sections.find((node) => node.querySelector(".content-title")?.textContent?.trim() === "Warehouse Mapping");
      if (!section || section.dataset.enhanced === "true") return;
      section.classList.add("warehouse-mapping-section");
      const head = section.querySelector(".content-head");
      if (head && !head.querySelector(".warehouse-refresh-form")) {
        const refreshForm = document.createElement("form");
        refreshForm.method = "post";
        refreshForm.className = "warehouse-refresh-form";
        refreshForm.style.cssText = "position:absolute;right:30px;top:26px;margin:0";
        refreshForm.innerHTML = `<input type="hidden" name="intent" value="refresh-zoho-data" /><button type="submit" class="refresh-zoho" style="height:41px;padding:0 15px;border:1px solid #d5ddea;background:#fff;border-radius:8px;display:flex;align-items:center;gap:8px;color:#17233c;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap"><s-icon type="refresh"></s-icon>Refresh from Zoho</button>`;
        head.appendChild(refreshForm);
      }
      const card = section.querySelector(".simple-card");
      const form = card?.closest("form");
      if (!card || !form) return;
      const rows = Array.from(card.querySelectorAll(".mapping-row"));
      const mapped = rows.filter((row) => row.querySelector("select")?.value).length;
      const warehouseIds = new Set();
      rows.forEach((row) => Array.from(row.querySelectorAll("option")).forEach((option) => { if (option.value) warehouseIds.add(option.value); }));

      const summary = document.createElement("div");
      summary.className = "warehouse-summary";
      summary.innerHTML = `<div class="warehouse-summary-card"><span class="warehouse-summary-label">Shopify Locations</span><strong class="warehouse-summary-value">${rows.length}</strong></div><div class="warehouse-summary-card"><span class="warehouse-summary-label">Zoho Inventory Warehouses</span><strong class="warehouse-summary-value">${warehouseIds.size}</strong></div><div class="warehouse-summary-card mapped"><span class="warehouse-summary-label">Mapped</span><strong class="warehouse-summary-value">${mapped} / ${rows.length}</strong></div>`;
      card.parentNode.insertBefore(summary, card);

      const info = document.createElement("div");
      info.className = "warehouse-info";
      info.textContent = "Changes to warehouse mapping will be applied for future syncs.";
      card.parentNode.insertBefore(info, card);

      const table = document.createElement("div");
      table.className = "warehouse-table-card";
      const tableHead = document.createElement("div");
      tableHead.className = "warehouse-table-head";
      tableHead.innerHTML = "<span>Shopify Location</span><span>Shopify Location Type</span><span>Zoho Inventory Warehouse</span><span>Warehouse Code</span><span>Status</span><span>Action</span>";
      table.appendChild(tableHead);
      rows.forEach((row, index) => {
        const strong = row.querySelector("strong");
        const select = row.querySelector("select");
        if (!strong || !select) return;
        const locationName = strong.textContent.trim();
        const locationId = (select.name || "").replace(/^warehouse:/, "");
        const mappedValue = select.value;
        const item = document.createElement("div");
        item.className = "warehouse-row";
        item.innerHTML = `<div class="warehouse-location"><span class="warehouse-location-icon"><s-icon type="store"></s-icon></span><div><span class="warehouse-location-name"></span><span class="warehouse-location-id"></span></div></div><span class="warehouse-type">${index === 0 ? "Warehouse" : "Retail Store"}</span><span class="warehouse-select-cell"></span><span class="warehouse-code">${mappedValue ? `WH-${String(mappedValue).slice(-4).toUpperCase()}` : "—"}</span><span class="warehouse-status ${mappedValue ? "" : "unmapped"}">${mappedValue ? "● Mapped" : "Not mapped"}</span><button class="warehouse-action" type="button" aria-label="Actions">⋮</button>`;
        item.querySelector(".warehouse-location-name").textContent = locationName;
        item.querySelector(".warehouse-location-id").textContent = `ID: ${locationId}`;
        const selectClone = select.cloneNode(true);
        selectClone.className = "warehouse-select";
        selectClone.addEventListener("change", () => {
          select.value = selectClone.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          const status = item.querySelector(".warehouse-status");
          status.className = `warehouse-status ${selectClone.value ? "" : "unmapped"}`;
          status.textContent = selectClone.value ? "● Mapped" : "Not mapped";
          item.querySelector(".warehouse-code").textContent = selectClone.value ? `WH-${String(selectClone.value).slice(-4).toUpperCase()}` : "—";
        });
        item.querySelector(".warehouse-select-cell").appendChild(selectClone);
        select.style.display = "none";
        table.appendChild(item);
      });
      card.parentNode.insertBefore(table, card);
      card.style.display = "none";
      section.dataset.enhanced = "true";
    }

    const observer = new MutationObserver(enhanceWarehouseSection);
    observer.observe(document.body, { childList:true, subtree:true });
    enhanceWarehouseSection();
    window.addEventListener("message", handleMessage);
    return () => {
      observer.disconnect();
      window.removeEventListener("message", handleMessage);
    };
  }, []);
}
