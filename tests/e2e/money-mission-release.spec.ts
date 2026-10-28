import { test, expect } from '@playwright/test';
test.use({serviceWorkers:'block'});
test('consumer confirms subscription and schedule then reloads without moving cash',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'查看账单与消费'}).click();
 await page.getByRole('button',{name:'不再使用，准备取消'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'确认并执行模拟操作'}).click();
 await expect(page.getByRole('heading',{name:'比较目标方案',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'选择并核对平衡方案'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'确认并执行模拟操作'}).click();
 await page.getByRole('button',{name:'预览转账安排'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'确认并执行模拟操作'}).click();
 const state=await (await page.request.get('/api/session')).json();
 expect(state.goal.savedCents).toBe(200000);expect(state.finance.checkingCents).toBe(724000);
 expect(state.transferSchedules).toHaveLength(1);expect(state.auditChainValid).toBe(true);
 expect(state.subscriptionActions.some((a:{nextChargeSuppressed:boolean})=>a.nextChargeSuppressed)).toBe(true);
 await page.reload();const after=await (await page.request.get('/api/session')).json();
 expect(after.transferSchedules).toEqual(state.transferSchedules);expect(after.goal.savedCents).toBe(200000);
});
test('empty-history import preserves authoritative balances',async({page})=>{
 await page.request.get('/api/session');await page.request.post('/api/demo/reset');
 expect((await page.request.post('/api/product/start',{data:{includeHistory:false}})).ok()).toBeTruthy();
 await page.goto('/');await page.getByRole('button',{name:'继续日本旅行 Money Mission'}).click();
 await page.getByRole('button',{name:'导入 NOVA 合成样例'}).click();
 await page.getByRole('button',{name:'提交并去重'}).click();
 await expect(page.getByRole('button',{name:'不再使用，准备取消'})).toBeVisible();
 const state=await (await page.request.get('/api/session')).json();
 expect(state.statementImportBatches.some((b:{status:string})=>b.status==='committed')).toBe(true);
 expect(state.finance.checkingCents).toBe(724000);expect(state.goal.savedCents).toBe(200000);
});
