import {test,expect} from './fixtures';
test.use({serviceWorkers:'block'});
test('complete questionnaire supports cash-only then comparable suitable products with separate purchase confirmation',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'金融任务：转账、AA、理财、卡片与旅行预订'}).click();await page.getByRole('button',{name:'理财',exact:true}).click();
 const before=await (await page.request.get('/api/services')).json();
 await expect(page.getByRole('button',{name:'核对完整风险资料'})).toBeDisabled();
 await page.getByLabel('这笔资金的用途').selectOption('education');await page.getByLabel('最早用钱日期',{exact:true}).fill('2027-06-30');
 await page.getByLabel('可承受的本金损失').selectOption('0');await page.getByLabel('资金需要多快可用').selectOption('quarter');await page.getByLabel('投资经验',{exact:true}).selectOption('basic');await page.getByLabel('收入稳定程度').selectOption('stable');
 const confirm=async()=>{await page.getByRole('button',{name:'核对完整风险资料'}).click();await page.getByRole('dialog').getByRole('button',{name:'确认此模拟金融操作'}).click();await expect(page.getByRole('dialog')).toBeHidden();};
 await confirm();await page.getByRole('button',{name:'比较费用、流动性与压力情景'}).click();await expect(page.getByText('当前没有匹配的产品，可以保持现金或重新核对资料。')).toBeVisible();
 await page.getByLabel('可承受的本金损失').selectOption('1500');await page.getByRole('checkbox',{name:/我理解这些模拟产品非保本/}).check();await confirm();
 await page.getByRole('button',{name:'比较费用、流动性与压力情景'}).click();await expect(page.getByRole('heading',{name:'短期稳健（模拟）',exact:true})).toBeVisible();
 await expect(page.getByText(/压力情景（净值下降5%）净额 ¥946.2/)).toBeVisible();
 const after=await (await page.request.get('/api/services')).json();expect(after.accounts).toEqual(before.accounts);expect(after.investments).toHaveLength(0);
 await page.getByRole('button',{name:'预览申购短期稳健（模拟）'}).click();await expect(page.getByRole('dialog')).toContainText('申购总额¥1000');await page.getByRole('dialog').getByRole('button',{name:'暂不操作'}).click();
 expect((await (await page.request.get('/api/services')).json()).investments).toHaveLength(0);
});
