import {test,expect} from './fixtures';
test.use({serviceWorkers:'block'});
test('homonym recipient is blocked until exact synthetic identity review, which never moves money',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'NOVA',exact:true}).click();await page.getByRole('button',{name:'转账与AA',exact:true}).click();
 const before=await (await page.request.get('/api/services')).json();await page.getByLabel('明确选择收款人').selectOption('contact-4');await page.getByRole('button',{name:'预览联系人转账'}).click();await expect(page.getByText('所选联系人尚未核对或资料已变化，请在收款人资料中先核对。',{exact:true})).toBeVisible();
 await page.getByText(/核对收款人资料 ·/).click();const identity=page.getByRole('article',{name:'收款人核对资料'});await expect(identity).toContainText('尾号1004');await identity.getByLabel('输入已核对的合成尾号（4位）').fill('1004');await identity.getByRole('checkbox').check();await identity.getByRole('button',{name:'核对并保存联系人'}).click();await expect(page.getByRole('dialog')).toContainText('不是银行实名验证');
 const confirm=async()=>{await page.getByRole('dialog').getByRole('button',{name:'确认此模拟金融操作'}).click();await expect(page.getByRole('dialog')).toBeHidden();};await confirm();await expect(identity).toContainText('当前版本已核对（模拟）');
 const after=await (await page.request.get('/api/services')).json();expect(after.accounts).toEqual(before.accounts);expect(after.recipients.find((r:{id:string})=>r.id==='contact-4').version).toBe(2);
 await page.getByRole('button',{name:'预览联系人转账'}).click();await expect(page.getByRole('dialog')).toContainText('尾号1004');await page.getByRole('dialog').getByRole('button',{name:'暂不操作'}).click();await expect(page.getByRole('dialog')).toBeHidden();
 await identity.getByRole('button',{name:'资料有疑问，重新核对'}).click();await confirm();await expect(identity).toContainText('当前资料尚未核对');await page.getByRole('button',{name:'预览联系人转账'}).click();await expect(page.getByText('所选联系人尚未核对或资料已变化，请在收款人资料中先核对。',{exact:true})).toBeVisible();
 expect((await (await page.request.get('/api/services')).json()).accounts).toEqual(before.accounts);await page.screenshot({path:`artifacts/recipient-identity-${test.info().project.name}.png`,fullPage:true});
});
