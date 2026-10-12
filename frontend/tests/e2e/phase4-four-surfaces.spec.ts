import { expect,test,type Page } from "@playwright/test";

const newSession=()=>`e2e-phase4-${Date.now()}-${crypto.randomUUID()}`;
async function open(page:Page,session=newSession()){
 await page.addInitScript(value=>localStorage.setItem("nova_fusion_session",value),session);
 await page.goto("/");
 await expect(page.getByTestId("twin-sync")).toHaveAttribute("data-twin-version",/^[1-9]\d*$/);
 return session;
}
const version=async(page:Page)=>Number(await page.getByTestId("twin-sync").getAttribute("data-twin-version"));
const balance=async(page:Page)=>(await page.getByTestId("checking-balance").innerText()).trim();
async function go(page:Page,name:"首页"|"Life"|"NOVA"|"动态"){await page.getByRole("button",{name,exact:true}).click();await expect(page.getByTestId("twin-sync")).toBeVisible()}

test("一次购物操作在 Today、Life、Twin、Activity 使用同一版本和余额",async({page})=>{
 await open(page);const before=await version(page);
 await go(page,"Life");await page.getByRole("button",{name:"确认",exact:true}).click();
 await expect.poll(()=>version(page)).toBeGreaterThan(before);const committedVersion=await version(page),committedBalance=await balance(page);
 await expect(page.getByTestId("latest-state")).toContainText("Shibuya Loft 支出已记账");
 for(const surface of ["首页","Life","NOVA","动态"] as const){await go(page,surface);if(surface==="NOVA")await page.getByRole("button",{name:/财务分身/}).click();await expect(page.getByTestId("twin-sync")).toHaveAttribute("data-twin-version",String(committedVersion));await expect(page.getByTestId("checking-balance")).toHaveText(committedBalance)}
 await expect(page.getByText("life_payment_succeeded").first()).toBeVisible();
});

test("拒绝链路写入审计但不执行扣款",async({page})=>{
 await open(page);const beforeVersion=await version(page),beforeBalance=await balance(page);
 await go(page,"Life");await page.getByRole("button",{name:"拒绝",exact:true}).click();await go(page,"动态");
 await expect(page.getByText("life_payment_rejected").first()).toBeVisible();
 expect(await balance(page)).toBe(beforeBalance);expect(await version(page)).toBe(beforeVersion);
});

test("刷新恢复、重复点击和弱网不会产生状态回退",async({page,context})=>{
 const session=await open(page);await go(page,"Life");const before=await version(page);
 const confirm=page.getByRole("button",{name:"确认",exact:true});await confirm.dblclick().catch(async()=>confirm.click());
 await expect.poll(()=>version(page)).toBeGreaterThan(before);const committed=await version(page),committedBalance=await balance(page);
 await page.reload();await expect(page.getByTestId("twin-sync")).toHaveAttribute("data-twin-version",String(committed));await expect(page.getByTestId("checking-balance")).toHaveText(committedBalance);
 await context.route("**/api/financial-twin",async route=>{await new Promise(resolve=>setTimeout(resolve,250));await route.continue()});
 await page.reload();await expect(page.getByTestId("twin-sync")).toHaveAttribute("data-twin-version",String(committed));expect(await version(page)).toBeGreaterThanOrEqual(committed);
 expect(session).toMatch(/^e2e-phase4-/);
});

for(const width of [360,768,1440])test(`响应式 ${width}px 不产生页面横向溢出`,async({page})=>{
 await page.setViewportSize({width,height:900});await open(page);for(const surface of ["首页","Life","NOVA","动态"] as const){await go(page,surface);await expect(page.getByTestId("twin-sync")).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true)}
});
