import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:430,height:900}});
 await page.goto('http://127.0.0.1:3000/');
 await page.getByRole('heading',{name:'连接模拟数据',exact:true}).waitFor({timeout:30000});
 await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'NOVA',exact:true}).click();
 const input=page.getByRole('textbox',{name:'告诉 NOVA 你的需求'});
 async function send(text){await input.fill(text);const response=page.waitForResponse(r=>r.url().endsWith('/api/agent/chat')&&r.request().method()==='POST',{timeout:90000});await page.getByRole('button',{name:'发送',exact:true}).click();const data=await(await response).json();if(data.provider==='unavailable'||!data.turn)throw Error(JSON.stringify(data));await page.getByText(data.turn.message.content,{exact:true}).first().waitFor({timeout:30000});return data;}
 const a=await send('2027年7月去青岛玩，预算4000元');
 const b=await send('七月22号出发');
 const card=b.turn.components.find(c=>c.type==='goal_input_card');
 console.log(JSON.stringify({first:a,second:b}));
 if(card?.goal.targetCents!==400000||card.goal.targetDate!=='2027-07-22')throw Error('Goal fields lost across UI turns');
 await page.screenshot({path:'docs/evaluations/unified-browser.png',fullPage:true});
 console.log(JSON.stringify({passed:true,firstReply:a.turn.message.content,secondReply:b.turn.message.content,goal:card.goal}));
}finally{await browser.close();}
