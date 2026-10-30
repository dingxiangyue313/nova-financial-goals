import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test('task graph survives refresh and exports a local proof without changing authority or funds',async({page,request})=>{
 await page.goto('/');await page.getByRole('button',{name:'金融任务：转账、AA、理财、卡片与旅行预订'}).click();await page.getByRole('button',{name:'旅行请求',exact:true}).click();
 await page.getByText('旅行任务步骤与证明',{exact:true}).click();
 await expect(page.getByRole('heading',{name:'含税费报价 · 待准备'})).toBeVisible();
 const before=await (await page.request.get('/api/services')).json(),goal=before.goals[0].id;
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'下载旅行任务证明包'}).click();const file=await downloadPromise;expect(file.suggestedFilename()).toBe('nova-travel-task-proof.json');
 const proof=await (await page.request.get(`/api/services/tasks/${goal}/proof`)).json();expect(proof.task.nodes).toHaveLength(8);expect(proof.operations).toHaveLength(0);expect(proof.task.status).toBe('planning');
 expect((await request.get(`/api/services/tasks/${goal}/proof`)).ok()).toBe(false);
 const after=await (await page.request.get('/api/services')).json();expect(after.accounts).toEqual(before.accounts);expect(after.twinVersion).toBe(before.twinVersion);expect(after.mandates).toEqual(before.mandates);
 await page.reload();await page.getByRole('button',{name:'金融任务：转账、AA、理财、卡片与旅行预订'}).click();await page.getByRole('button',{name:'旅行请求',exact:true}).click();await page.getByText('旅行任务步骤与证明',{exact:true}).click();
 await expect(page.getByRole('heading',{name:'含税费报价 · 待准备'})).toBeVisible();
});
