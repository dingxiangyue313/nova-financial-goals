import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const browser=await chromium.launch({channel:"chrome",headless:true});
try{
 const session=`audit-ui-${crypto.randomUUID()}`;
 const page=await browser.newPage({acceptDownloads:true});
 await page.addInitScript(value=>localStorage.setItem("nova_fusion_session",value),session);
 await page.goto(process.env.NOVA_BASE_URL??"http://localhost:5173/",{waitUntil:"domcontentloaded"});
 await page.waitForFunction(()=>Number(document.querySelector('[data-testid="twin-sync"]')?.getAttribute("data-twin-version"))>0);
 await page.evaluate(async value=>{const response=await fetch("/api/banking-tools",{method:"POST",headers:{"content-type":"application/json","x-nova-sandbox-session":value},body:JSON.stringify({tool:"append_audit_event",input:{eventType:"audit_ui_test",objectId:"sample",status:"succeeded",metadata:{source:"browser_test"}}})});if(!response.ok)throw new Error("Could not create audit event")},session);
 await page.getByRole("button",{name:"我的",exact:true}).click();
 await page.getByRole("button",{name:/审计与导出/}).click();
 await page.getByText("真实审计事件").waitFor();
 await page.getByText("audit_ui_test").waitFor();
 const [jsonDownload]=await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"下载 JSON 证据包"}).click()]);
 const report=JSON.parse(await readFile(await jsonDownload.path(),"utf8"));
 assert.ok(report.events.some(event=>event.event_type==="audit_ui_test"));
 assert.ok(report.reportHash&&report.tamperEvident);
 const [csvDownload]=await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"下载 CSV 审计表"}).click()]);
 const csv=await readFile(await csvDownload.path(),"utf8");
 assert.ok(csv.includes("audit_ui_test")&&csv.includes("event_hash"));
 console.log("Local audit UI: profile entry, live events, JSON and CSV downloads passed");
}finally{await browser.close()}
