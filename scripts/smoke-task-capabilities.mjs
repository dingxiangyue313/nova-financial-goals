import {chromium,expect} from '@playwright/test';import fs from 'node:fs';
const browser=await chromium.launch({channel:'msedge',headless:true}),rows=[];
try{
 const page=await browser.newPage({viewport:{width:430,height:900}});
 await page.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('heading',{name:'连接模拟数据',exact:true}).waitFor({timeout:30000});await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'NOVA',exact:true}).click();
 const input=page.getByRole('textbox',{name:'告诉 NOVA 你的需求'});
 async function send(text){await input.fill(text);const button=page.getByRole('button',{name:'发送',exact:true});await expect(button).toBeEnabled({timeout:30000});const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/agent/chat')&&r.request().method()==='POST',{timeout:90000}),button.click()]);const r=await response.json();rows.push({text,response:r});if(r.provider==='unavailable')throw Error(JSON.stringify(r));if(r.turn)await page.getByText(r.turn.message.content,{exact:true}).first().waitFor({timeout:30000});return r;}
 const goal=r=>r.turn?.components.find(c=>c.type==='goal_input_card')?.goal;
 await send('2027年7月去青岛玩，预算4000元');
 const a=goal(await send('七月22号出发'));if(a?.targetCents!==400000||a.targetDate!=='2027-07-22')throw Error('Date continuation failed');
 const t=await send('先给苏禾转780元');if(t.decision.destination!=='transfer')throw Error('Transfer destination failed');
 await page.getByRole('heading',{name:'联系人转账',exact:true}).waitFor();if(await page.getByLabel('转账金额（元）',{exact:true}).inputValue()!=='780')throw Error('Transfer amount prefill failed');
 if(await page.getByLabel('收款人',{exact:true}).inputValue()!=='')throw Error('Recipient identity was selected automatically');
 await page.getByRole('button',{name:'返回',exact:true}).click();
 const b=goal(await send('继续青岛旅行那个目标'));if(b?.targetCents!==400000||b.targetDate!=='2027-07-22')throw Error('Goal restore failed');
 const fresh=await send('另外建一个学吉他目标，预算6000元');if(!/6,000|6000/.test(fresh.turn?.message.content??''))throw Error('New goal missing');
 const c=goal(await send('回到青岛旅行目标'));if(c?.targetCents!==400000||c.targetDate!=='2027-07-22')throw Error('Second goal restore failed');
 for(const [text,destination,title]of [['设置旅行消费的授权额度','travel_mandate','预算授权'],['核对已选机票和酒店的付款','travel_payment','核对付款']]){
  const r=await send(text);if(r.decision.destination!==destination)throw Error('Travel business action mismatch');
  await page.getByRole('heading',{name:title,exact:true}).last().waitFor({timeout:30000});await page.getByRole('button',{name:'返回',exact:true}).click();
 }
 await page.screenshot({path:'docs/evaluations/steps12-browser.png',fullPage:true});console.log(JSON.stringify({passed:true,turns:rows.length}));
}catch(e){console.log(JSON.stringify({passed:false,error:e.message,turns:rows.length}));process.exitCode=1;}
finally{fs.writeFileSync(process.argv[2]??'docs/evaluations/steps12-browser-result.json',JSON.stringify(rows,null,2));await browser.close();}
