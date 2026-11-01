import { openCategory } from './fixtures';
import {test,expect} from './fixtures';
test.use({serviceWorkers:'block'});
test('synthetic missing employment requires explicit supplement and later review without increasing cash',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'NOVA',exact:true}).click();await openCategory(page,'卡片');await page.getByRole('button',{name:'申请新卡',exact:true}).click();
 const before=await (await page.request.get('/api/services')).json();
 const confirm=async()=>{await page.getByRole('dialog').getByRole('button',{name:'确认此模拟金融操作'}).click();await expect(page.getByRole('dialog')).toBeHidden();};
 await page.getByRole('checkbox',{name:'信用卡申请暂缺就业说明（合成资料）'}).check();await page.getByRole('button',{name:'申请日常信用卡',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('缺少就业说明');await confirm();
 const result=page.getByRole('article',{name:'卡片申请结果'});await result.getByRole('button',{name:'查询申请进度'}).click();await expect(result).toContainText('待补充资料');
 await expect(result.getByRole('button',{name:'核对补交资料'})).toBeDisabled();await result.getByLabel('就业说明类型').selectOption('synthetic_freelance');await result.getByRole('checkbox',{name:'我确认仅提交虚构样例，不含真实身份或收入材料'}).check();
 await result.getByRole('button',{name:'核对补交资料'}).click();await expect(page.getByRole('dialog')).toContainText('合成自由职业收入说明');
 const prepared=await (await page.request.get('/api/services')).json();expect(prepared.applications[0].status).toBe('needs_information');await confirm();await expect(result).toContainText('等待重新审核');
 await result.getByRole('button',{name:'查询申请进度'}).click();await expect(result).toContainText('已通过');await expect(result).toContainText('获批');
 const after=await (await page.request.get('/api/services')).json();expect(after.applications).toHaveLength(1);expect(after.cards).toHaveLength(before.cards.length+1);expect(after.accounts).toEqual(before.accounts);const card=after.cards.find((c:{id:string})=>c.id.startsWith('card:'));expect(card.status).toBe('locked');await page.getByRole('button',{name:'我的卡片',exact:true}).click();const region=page.getByRole('region',{name:`${card.label}尾号${card.suffix}`});await region.getByRole('button',{name:'解除临时锁'}).click();await confirm();await expect(region).toContainText('正常');
 await page.screenshot({path:`artifacts/card-supplement-${test.info().project.name}.png`,fullPage:true});
});
