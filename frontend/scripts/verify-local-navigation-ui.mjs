import { chromium } from "@playwright/test";

const browser=await chromium.launch({channel:"chrome",headless:true});
try{
 const page=await browser.newPage();
 const errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 await page.addInitScript(value=>localStorage.setItem("nova_fusion_session",value),`nav-ui-${crypto.randomUUID()}`);
 await page.goto(process.env.NOVA_BASE_URL??"http://localhost:5173/",{waitUntil:"domcontentloaded"});
 await page.waitForFunction(()=>Number(document.querySelector('[data-testid="twin-sync"]')?.getAttribute("data-twin-version"))>0);
 for(const label of ["目标","Life","NOVA","动态","我的","首页"]){
  await page.getByRole("button",{name:label,exact:true}).click();
  await page.locator(".fusion-main").waitFor();
  if(errors.length)throw new Error(`${label}: ${errors.join("; ")}`);
 }
 await page.getByRole("button",{name:"目标",exact:true}).click();
 await page.locator(".fusion-goal-button").first().click();
 await page.getByText("选择适合你的节奏").waitFor();
 await page.getByRole("button",{name:"返回首页"}).click();
 await page.getByRole("button",{name:"NOVA",exact:true}).click();
 for(const label of ["财务分身","安全","工具","审计"]){
  await page.getByRole("button",{name:label,exact:true}).click();
  if(errors.length)throw new Error(`${label}: ${errors.join("; ")}`);
 }
 console.log("Local navigation UI: all main pages, goal detail and NOVA tabs opened without runtime errors");
}finally{await browser.close()}
