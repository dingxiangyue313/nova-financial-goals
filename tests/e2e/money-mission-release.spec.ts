import { test, expect } from '@playwright/test';
test.use({serviceWorkers:'block'});
test('subscription cancellation stays verified after reload without changing account cash',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'查看账单与消费'}).click();
 await page.getByRole('button',{name:'不再使用，准备取消'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'确认并执行模拟操作'}).click();
 await expect(page.getByText(/已关闭自动续费：CloudBox Plus/)).toBeVisible();
 const state=await (await page.request.get('/api/session')).json();
 expect(state.goal.savedCents).toBe(200000);expect(state.finance.checkingCents).toBe(724000);
 expect(state.transferSchedules).toHaveLength(0);expect(state.auditChainValid).toBe(true);
 expect(state.subscriptionActions.some((a:{nextChargeSuppressed:boolean})=>a.nextChargeSuppressed)).toBe(true);
 await page.reload();const after=await (await page.request.get('/api/session')).json();
 expect(after.transferSchedules).toEqual(state.transferSchedules);expect(after.goal.savedCents).toBe(200000);
});
test('empty-history import preserves authoritative balances',async({page})=>{
 await page.request.get('/api/session');await page.request.post('/api/demo/reset');
 expect((await page.request.post('/api/product/start',{data:{includeHistory:false}})).ok()).toBeTruthy();
 await page.goto('/');await page.getByRole('button',{name:'查看账单与消费'}).click();await page.getByText('数据覆盖与账单导入',{exact:true}).click();
 await page.getByRole('button',{name:'导入 NOVA 合成样例'}).click();
 await page.getByRole('button',{name:'提交并去重'}).click();
 await expect(page.getByRole('button',{name:'不再使用，准备取消'})).toBeVisible();
 const state=await (await page.request.get('/api/session')).json();
 expect(state.statementImportBatches.some((b:{status:string})=>b.status==='committed')).toBe(true);
 expect(state.finance.checkingCents).toBe(724000);expect(state.goal.savedCents).toBe(200000);
});

test('dated cashflow explains salary stress and editable expense without changing money or authorization',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'查看账单与消费'}).click();await page.getByText('查看工资前余额与日期试算',{exact:true}).click();
 const timeline=page.getByRole('region',{name:'日期现金流试算'});
 await expect(timeline).toContainText('最低余额 ¥3,172');
 const before=await (await page.request.get('/api/session')).json();
 await timeline.getByRole('button',{name:'工资晚到三天'}).click();
 await expect(timeline.getByText(/工资延迟三天/)).toBeVisible();
 await timeline.getByRole('button',{name:'基准假设',exact:true}).click();
 await timeline.getByLabel('额外支出日期').fill('2026-11-02');
 await timeline.getByLabel('额外支出（元）').fill('500');
 await timeline.getByRole('button',{name:'只试算这笔支出的影响'}).click();
 await expect(timeline).toContainText('最低余额 ¥2,672');
 await timeline.getByText('查看逐日余额表',{exact:true}).click();
 await expect(timeline.getByRole('table')).toBeVisible();
 const after=await (await page.request.get('/api/session')).json();
 expect(after.twinVersion).toBe(before.twinVersion);expect(after.finance).toEqual(before.finance);
 expect(after.transferSchedules).toEqual(before.transferSchedules);expect(after.approvalSummaries).toEqual(before.approvalSummaries);
});
