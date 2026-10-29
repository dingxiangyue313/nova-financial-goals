import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test('subscription reminder can snooze and persist read state without a cancellation or cash change',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'查看账单与消费'}).click();const before=await (await page.request.get('/api/session')).json();
 await page.getByRole('article',{name:'CloudBox Plus订阅处理'}).getByRole('button',{name:'续费前提醒'}).click();
 await page.getByText('续费提醒收件箱',{exact:true}).click();await expect(page.getByRole('heading',{name:'CloudBox Plus · 待提醒'})).toBeVisible();
 await page.getByRole('button',{name:'明天再提醒'}).click();await expect(page.getByText('计划 2026-11-04 · 稍后到 2026-10-27。',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'标为已读'}).click();await expect(page.getByRole('heading',{name:'CloudBox Plus · 已读'})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'查看账单与消费'}).click();await page.getByText('续费提醒收件箱',{exact:true}).click();await expect(page.getByRole('heading',{name:'CloudBox Plus · 已读'})).toBeVisible();
 const after=await (await page.request.get('/api/session')).json();expect(after.finance).toEqual(before.finance);const mission=await (await page.request.get('/api/product/mission')).json();expect(mission.subscriptions.find((s:{id:string})=>s.id==='cloudbox-plus').status).toBe('active');
});
