import {chromium,expect} from '@playwright/test';import fs from 'node:fs';
const browser=await chromium.launch({channel:'msedge',headless:true}),rows=[];
try{
 const page=await browser.newPage({viewport:{width:430,height:900}});await page.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('heading',{name:'连接模拟数据',exact:true}).waitFor({timeout:30000});await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'NOVA',exact:true}).click();
 const input=page.getByRole('textbox',{name:'告诉 NOVA 你的需求'});
 async function send(text){await input.fill(text);const button=page.getByRole('button',{name:'发送',exact:true});await expect(button).toBeEnabled({timeout:30000});const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/agent/chat')&&r.request().method()==='POST',{timeout:90000}),button.click()]);const r=await response.json();rows.push({text,response:r});if(r.provider==='unavailable'||!r.turn)throw Error(JSON.stringify(r));await page.getByText(r.turn.message.content,{exact:true}).first().waitFor({timeout:30000});return r;}
 const first=await send('2028年7月22日去青岛，预算4000元');
 if(!first.turn.message.content.includes('存了多少'))throw Error('Missing savings question');await expect(page.getByText(/已存\s*待确认/).last()).toBeVisible();
 const corrected=await send('总预算改成4800元，日期不变');if(!corrected.turn.message.content.includes('¥4,800')||!corrected.turn.message.content.includes('日期保持2028年7月22日'))throw Error('Correction reply does not match state');
 const fresh=await send('另建买吉他的目标，预算2000元');if(fresh.turn.message.content.includes('¥4,800'))throw Error('Old task facts leaked into new task reply');
 const restored=await send('回到青岛旅行那个');if(!restored.turn.message.content.includes('已切回')||!restored.turn.message.content.includes('¥4,800'))throw Error('Task restore reply failed');
 const knowledge=await send('退款在途是什么意思？');if(!knowledge.turn.message.content.includes('尚未退回到账'))throw Error('Ungrounded knowledge reply');
 const balance=await send('直接查一下日常活期现在余额');if(!balance.replyEvidence?.length&&!balance.turn.message.content.includes('缺少当前有效余额'))throw Error('Balance reply without source or missing-data explanation');
 await page.screenshot({path:'docs/evaluations/grounded-replies-browser.png',fullPage:true});console.log(JSON.stringify({passed:true,turns:rows.length}));
}catch(e){console.log(JSON.stringify({passed:false,error:e.message,turns:rows.length}));process.exitCode=1;}
finally{fs.writeFileSync(process.argv[2]??'docs/evaluations/grounded-replies-browser.json',JSON.stringify(rows,null,2));await browser.close();}
