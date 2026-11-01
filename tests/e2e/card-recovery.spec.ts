import {test,expect} from './fixtures';
test.use({serviceWorkers:'block'});
test('lost card replacement requires explicit confirmation and separate unlock while cash is unchanged',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'金融任务：转账、AA、理财、卡片与旅行预订'}).click();await page.getByRole('button',{name:'卡片',exact:true}).click();
 const before=await (await page.request.get('/api/services')).json();
 const old=page.getByRole('region',{name:'旅行借记卡尾号2002'});
 const confirm=async()=>{await page.getByRole('dialog').getByRole('button',{name:'确认此模拟金融操作'}).click();await expect(page.getByRole('dialog')).toBeHidden();};
 await old.getByRole('button',{name:'挂失此卡'}).click();await confirm();await old.getByText('查看此卡支付与挂失影响',{exact:true}).click();await expect(old).toContainText('目前没有关联旅行订单');await expect(old).toContainText('未建立绑定的订阅无法推断影响');await old.getByRole('button',{name:'核对补发此卡'}).click();await expect(page.getByRole('dialog')).toContainText('新卡初始锁定');await confirm();
 const view=await (await page.request.get('/api/services')).json();const replacement=view.cards.find((c:{id:string})=>c.id.startsWith('replacement:'));
 const card=page.getByRole('region',{name:`${replacement.label}尾号${replacement.suffix}`});await expect(card).toContainText('临时锁定');await expect(card).toContainText('线上已关闭');
 await card.getByRole('button',{name:'解除临时锁'}).click();await confirm();await expect(card).toContainText('正常');await expect(old).toContainText('已挂失');
 const after=await (await page.request.get('/api/services')).json();expect(after.accounts).toEqual(before.accounts);
});
