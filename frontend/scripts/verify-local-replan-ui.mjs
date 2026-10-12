import { chromium } from "@playwright/test";

const browser=await chromium.launch({channel:"chrome",headless:true});
try{
  const page=await browser.newPage();
  await page.addInitScript(()=>localStorage.setItem("nova_fusion_session",`replan-ui-${crypto.randomUUID()}`));
  await page.goto(process.env.NOVA_BASE_URL??"http://localhost:5173/",{waitUntil:"domcontentloaded"});
  await page.getByTestId("twin-sync").waitFor();
  await page.waitForFunction(()=>Number(document.querySelector('[data-testid="twin-sync"]')?.getAttribute("data-twin-version"))>0);
  await page.getByRole("button",{name:"目标",exact:true}).click();
  await page.locator(".fusion-goal-button").first().click();
  await page.getByRole("button",{name:"修改目标并用 AI 重新规划"}).click();
  await page.getByRole("textbox",{name:"描述目标修改要求"}).fill("把日本旅行预算改为9000元，重新规划每月投入");
  if(!await page.getByRole("button",{name:"用 AI 重新规划"}).isEnabled())throw new Error("Replan action is disabled");
  const [response]=await Promise.all([page.waitForResponse(result=>result.url().endsWith("/api/agent")&&result.request().method()==="POST"),page.getByRole("button",{name:"用 AI 重新规划"}).click()]);
  const body=await response.json();
  if(response.status()!==200||body.provider!=="deepseek"||body.intent?.intent!=="update_goal")throw new Error(`AI replan failed: HTTP ${response.status()}`);
  await page.getByText("审查目标修改草案").waitFor();
  await page.getByRole("button",{name:"生成审批快照"}).click();
  await page.getByRole("button",{name:"确认参数并执行"}).click();
  await page.getByRole("button",{name:"目标",exact:true}).click();
  await page.getByText("¥9,000").first().waitFor();
  await page.locator(".fusion-goal-button").first().click();
  await page.getByText("¥9,000").first().waitFor();
  const planAmounts=await page.locator(".fusion-plan strong").allTextContents();
  if(planAmounts.some(value=>value.includes("¥520")||value.includes("¥760")||value.includes("¥1,020")))throw new Error(`Plan options are stale: ${planAmounts.join(", ")}`);
  await page.getByRole("button",{name:"返回首页"}).click();
  await page.getByText("¥9,000").first().waitFor();
  console.log(`Local replan UI: DeepSeek update synced across goals, feasibility, and home; plans: ${planAmounts.join(", ")}`);
}finally{await browser.close()}
