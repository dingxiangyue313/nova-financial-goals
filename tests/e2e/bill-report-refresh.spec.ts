import {test,expect} from './fixtures';
test.use({serviceWorkers:'block'});
test('a changed financial version visibly retires a previously selected report',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'查看账单与消费'}).click();await page.getByRole('button',{name:'账单概览',exact:true}).click();
 await page.getByLabel('账单月份').fill('2026-09');await page.getByRole('button',{name:'查看月账单',exact:true}).click();await expect(page.getByRole('heading',{name:'9月账单',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'订阅管理',exact:true}).click();await page.getByRole('article',{name:'CloudBox Plus订阅处理'}).getByRole('button',{name:'保留',exact:true}).click();
 await page.getByRole('button',{name:'账单概览',exact:true}).click();await expect(page.getByText('数据已更新，旧报告已失效。当前显示最新月份；可重新选择原期间生成报告。',{exact:false})).toBeVisible();await expect(page.getByRole('heading',{name:'10月账单',exact:true})).toBeVisible();
});
