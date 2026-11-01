import {test,expect} from './fixtures';
test.use({serviceWorkers:'block'});
test('natural-language mandate fills editable fields and never creates authority without confirmation',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'NOVA',exact:true}).click();await page.getByRole('button',{name:'旅行请求',exact:true}).click();
 const before=await (await page.request.get('/api/services')).json();
 await page.getByText('用一句话填写授权草稿',{exact:true}).click();
 await page.getByLabel('授权描述').fill('只允许樱旅航空和京都旅宿，单笔不超过2600元，累计4800元，有效至2026-11-20');
 await page.getByRole('button',{name:'整理为可编辑草稿'}).click();
 await expect(page.getByText('草稿已填写到下方。',{exact:false})).toBeVisible();
 const draft=await (await page.request.get('/api/services')).json();expect(draft.mandates).toEqual(before.mandates);expect(draft.twinVersion).toBe(before.twinVersion);
 await page.getByRole('button',{name:'核对创建授权'}).click();const dialog=page.getByRole('dialog');
 await expect(dialog).toContainText('2600');await expect(dialog).toContainText('4800');
 await dialog.getByRole('button',{name:'暂不操作'}).click();await expect(dialog).toBeHidden();
 expect((await (await page.request.get('/api/services')).json()).mandates).toEqual(before.mandates);
});
