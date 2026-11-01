import { openCategory } from './fixtures';
import {test,expect} from './fixtures';
test.use({serviceWorkers:'block'});
test('card application can be reviewed then withdrawn without issuing a card',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'NOVA',exact:true}).click();await openCategory(page,'卡片');await page.getByRole('button',{name:'申请新卡',exact:true}).click();
 const before=await (await page.request.get('/api/services')).json();
 const confirm=async()=>{await page.getByRole('dialog').getByRole('button',{name:'确认此模拟金融操作'}).click();await expect(page.getByRole('dialog')).toBeHidden();};
 await page.getByRole('button',{name:'申请日常信用卡',exact:true}).click();await confirm();
 const result=page.getByRole('article',{name:'卡片申请结果'});await expect(result).toContainText('审核中');await expect(result).toContainText('尚无生效额度');
 await result.getByRole('button',{name:'核对撤回申请'}).click();await expect(page.getByRole('dialog')).toContainText('撤回仍在审核');await confirm();
 await expect(result).toContainText('已撤回');await page.reload();await page.getByRole('button',{name:'NOVA',exact:true}).click();await openCategory(page,'卡片');await page.getByRole('button',{name:'申请新卡',exact:true}).click();await expect(page.getByRole('article',{name:'卡片申请结果'})).toContainText('已撤回');
 const after=await (await page.request.get('/api/services')).json();expect(after.cards).toEqual(before.cards);expect(after.accounts).toEqual(before.accounts);
});
