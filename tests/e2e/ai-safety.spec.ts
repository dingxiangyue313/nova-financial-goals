import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openSafety(page: Page) {
  await page.goto('/');
  await page.getByTitle('个人设置', {exact:true}).click();
  await page.getByRole('button', { name: 'NOVA AI 安全', exact: true }).click();
}
async function mode(page: Page, enabled: boolean) {
  const result = await page.request.post('/api/demo/ai-safety/safe-mode', { data: { enabled, reasonCode: 'manual_demo' } });
  expect(result.ok()).toBeTruthy();
}
test.afterEach(async ({ page }) => {
  if (process.env.NOVA_E2E_AI_SAFETY_CONTROLS === 'true') await mode(page, false);
});
test('个人设置打开 API 驱动的安全中心', async ({ page }) => {
  await openSafety(page);
  await expect(page.getByText('产品级安全控制，不代表机构整体合规')).toBeVisible();
  const overview = await (await page.request.get('/api/ai-safety')).json();
  await expect(page.getByTestId('safety-passport')).toHaveCount(overview.passports.length);
  await expect(page.getByText('AI 不可直接执行', {exact:false})).toHaveCount(overview.passports.length);
  await expect(page.getByText(`已启用 ${overview.passports.filter((p: {enabled:boolean})=>p.enabled).length} 项 · 未启用 ${overview.passports.filter((p: {enabled:boolean})=>!p.enabled).length} 项`)).toBeVisible();
  await page.emulateMedia({reducedMotion:'reduce'});
  const report = await new AxeBuilder({page}).include('[data-testid="ai-safety-screen"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(report.violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: `.superpowers/sdd/2026-10-29-nova-ai-safety-control-center/task-5-safety-${page.viewportSize()!.width}.png`, fullPage:true});
});
test('成绩单展示服务端报告，未验证时保持中性', async ({page}) => {
  const overview = await (await page.request.get('/api/ai-safety')).json();
  const evaluation = {suiteVersion:'nova-ai-safety-v1',mode:'deterministic',status:'passed',generatedAt:new Date().toISOString(),total:30,passed:30,criticalFailures:0,categories:['prompt','context','evidence','authorization','privacy','resilience'].map(category=>({category,total:5,passed:5}))};
  await page.route('**/api/ai-safety',route=>route.fulfill({json:{...overview,evaluation}}));
  await openSafety(page);
  await expect(page.getByText('◇ 已通过 · 30/30')).toBeVisible();
  await expect(page.getByText('确定性模式（规则评测）')).toBeVisible();
  await expect(page.locator('time')).toHaveAttribute('datetime',evaluation.generatedAt);
  await expect(page.getByText(/：5\/5/)).toHaveCount(6);
  await page.unroute('**/api/ai-safety');
  await page.route('**/api/ai-safety',route=>route.fulfill({json:{...overview,evaluation:null}}));
  await openSafety(page);
  await expect(page.getByText('○ 尚未验证')).toBeVisible();
  await expect(page.getByText('◇ 已通过 · 30/30')).toHaveCount(0);
});
test('禁用演示权限时 DOM 无开关', async ({page})=>{
  const overview=await(await page.request.get('/api/ai-safety')).json();
  await page.route('**/api/ai-safety',route=>route.fulfill({json:{...overview,demoControlsEnabled:false}}));
  await openSafety(page);
  await expect(page.getByTestId('safety-passport')).toHaveCount(overview.passports.length);
  await expect(page.getByRole('switch')).toHaveCount(0);
  if(process.env.NOVA_E2E_AI_SAFETY_CONTROLS!=='true') {
    expect(overview.demoControlsEnabled).toBe(false);
    expect((await page.request.post('/api/demo/ai-safety/safe-mode',{data:{enabled:true,reasonCode:'manual_demo'}})).status()).toBe(404);
  }
});
test('加载、接口不可用和非法响应均不显示安全通过',async({page})=>{
  await page.route('**/api/ai-safety',async route=>{await new Promise(resolve=>setTimeout(resolve,1000));await route.fulfill({status:503,json:{error:'unavailable'}});});
  await openSafety(page);
  await expect(page.getByText('正在读取安全状态…')).toBeVisible();
  await expect(page.getByText('○ 安全状态暂不可用，尚未验证。')).toBeVisible();
  await page.unroute('**/api/ai-safety');
  await page.route('**/api/ai-safety',route=>route.fulfill({json:{control:{mode:'normal'},unexpected:'unsafe'}}));
  await page.getByRole('button',{name:'重新读取'}).click();
  await expect(page.getByText('○ 读取安全状态失败，尚未验证。')).toBeVisible();
});
test('真实 Safe Mode 修改持久化且只读保留',async({page})=>{
  test.skip(process.env.NOVA_E2E_AI_SAFETY_CONTROLS!=='true','requires explicit safety demo test flag');
  await mode(page,false); await openSafety(page);
  const toggle=page.getByRole('switch',{name:'Safe Mode 演示开关'});
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked','true');
  await openSafety(page);
  await expect(toggle).toHaveAttribute('aria-checked','true');
  await expect(page.getByText('模型调用已停止 · AI 写操作已停止')).toBeVisible();
  await expect(page.getByText('确定性只读功能仍可用，历史回执和取消操作仍可用。')).toBeVisible();
  const control=await page.request.get('/api/ai-safety/control');
  expect(control.headers()['cache-control']).toBe('no-store');
  expect((await control.json()).mode).toBe('safe_mode');
});
test('完成运行后查看结构化回执，Escape 与关闭恢复焦点',async({page})=>{
  await page.goto('/');
  const created=await(await page.request.post('/api/agent/threads',{data:{title:'回执验收'}})).json();
  const threadId=created.thread.id;
  const privateMessage='我想年底去日本旅行，预算 ¥8,000';
  await page.request.post('/api/agent/turn',{data:{threadId,message:privateMessage}});
  await page.request.post('/api/data-connections/connect',{data:{sources:['bank','wechat_pay','alipay']}});
  await page.request.post('/api/agent/turn',{data:{threadId,message:'已存 0 元'}});
  await expect.poll(async()=>{const value=await(await page.request.get(`/api/agent/threads/${threadId}/run`)).json();return value.run?.status;}).toBe('fallback');
  await page.getByTitle('新建目标 / NOVA 智能对话').click();
  await page.getByRole('button',{name:/回执验收/}).click();
  const opener=page.getByRole('button',{name:'查看 AI 决策回执'});
  await opener.click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByText(/处理来源：/)).toBeVisible();
  for(const text of ['降级原因：','工具计数：','证据引用：','人审状态：','审计链']) await expect(dialog.getByText(text,{exact:false})).toBeVisible();
  await expect(dialog).not.toContainText(privateMessage);
  await expect(dialog).not.toContainText('已存 0 元');
  await page.keyboard.press('Tab'); expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(opener).toBeFocused();
  await opener.click(); await dialog.getByRole('button',{name:'关闭回执'}).click(); await expect(opener).toBeFocused();
});
test('旧写卡被服务端阻断后仍可取消',async({page})=>{
  test.skip(process.env.NOVA_E2E_AI_SAFETY_CONTROLS!=='true','requires explicit safety demo test flag');
  await mode(page,false); await page.goto('/');
  await page.getByTitle('新建目标 / NOVA 智能对话').click();
  await page.getByPlaceholder('描述目标、风险或授权范围…').fill('允许旅行 Agent 在 ¥500 内订票');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  const confirm=page.getByRole('button',{name:'确认创建授权'}).first();
  await expect(confirm).toBeVisible();
  const before=await(await page.request.get('/api/session')).json();
  await mode(page,true); await confirm.click();
  await expect(page.getByText('安全模式已阻断此写操作，你仍可取消。')).toBeVisible();
  const after=await(await page.request.get('/api/session')).json();
  expect(after.finance).toEqual(before.finance); expect(after.mandate).toEqual(before.mandate);
  const cancellation=page.waitForResponse(r=>r.url().endsWith('/api/agent/action')&&r.request().postDataJSON()?.decision==='cancel');
  await page.getByRole('button',{name:'取消',exact:true}).first().click(); expect((await cancellation).ok()).toBe(true);
});
