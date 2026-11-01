import {test,expect} from './fixtures';
test.use({serviceWorkers:'block'});
test('spending investigation records feedback without hiding evidence and survives refresh',async({page,playwright})=>{
 await page.goto('/');await page.getByRole('button',{name:'查看账单与消费'}).click();await page.getByRole('button',{name:'支出分析',exact:true}).click();await page.getByText('核对支出变化',{exact:true}).click();
 const before=await (await page.request.get('/api/services')).json();
 const item=page.getByRole('article',{name:'订阅变化调查'});await expect(item).toContainText('增加¥10');await expect(item).toContainText('基线窗口2026-07-01 至 2026-09-30');
 await item.getByText(/查看比较窗口与逐笔证据/).click();await item.getByRole('button',{name:/查看来源/}).first().click();await expect(page.getByText('已核验来源',{exact:true})).toBeVisible();
 await item.getByRole('button',{name:'这是预期支出',exact:true}).click();await expect(item).toContainText('已记录：这是预期支出');
 const after=await (await page.request.get('/api/services')).json();expect(after.accounts).toEqual(before.accounts);
 await page.reload();await page.getByRole('button',{name:'查看账单与消费'}).click();await page.getByRole('button',{name:'支出分析',exact:true}).click();await page.getByText('核对支出变化',{exact:true}).click();await expect(page.getByRole('article',{name:'订阅变化调查'})).toContainText('已记录：这是预期支出');
 const other=await playwright.request.newContext({baseURL:"http://localhost:3177"});const isolated=await (await other.post('/api/product/bill-investigation',{data:{periodStart:'2026-10-01',periodEnd:'2026-10-26'}})).json();expect(isolated.items.every((i:{review:unknown})=>!i.review)).toBeTruthy();await other.dispose();
 await page.screenshot({path:`artifacts/bill-review-${test.info().project.name}.png`,fullPage:true});
});
