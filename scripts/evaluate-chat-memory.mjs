import {request} from '@playwright/test';import fs from 'node:fs';
const r=await request.newContext({baseURL:'http://127.0.0.1:3000',timeout:90000});await r.get('/api/session');await r.post('/api/product/start',{data:{}});const before=await(await r.get('/api/session')).json();const rows=[];let threadId=null;
const scenarios=[
 ['帮我给林夏转账500元',d=>d.decision.destination==='transfer'&&d.memory.recipientQuery==='林夏'&&d.memory.amountCents===50000],
 ['金额改成300',d=>d.decision.destination==='transfer'&&d.memory.amountCents===30000&&d.memory.recipientQuery==='林夏'],
 ['换成工资卡',d=>d.decision.destination==='transfer'&&/工资卡/.test(d.memory.sourceAccount)&&d.memory.amountCents===30000],
 ['回到刚才那个',d=>d.decision.destination==='transfer'&&d.memory.amountCents===30000],
 ['取消刚才的任务',d=>d.memory.status==='cancelled'&&d.decision.mode==='clarify'],
 ['继续刚才那个',d=>d.decision.mode==='clarify'],
 ['新建一笔转账给小陈',d=>d.memory.destination==='transfer'&&d.memory.amountCents===null&&!d.memory.recipientQuery.includes('林夏')],
 ['先不转账了，我要和同事A钱',d=>d.decision.destination==='aa_create'&&d.memory.amountCents===null],
 ['回到刚才那个',d=>d.decision.destination==='aa_create'],
 ['先不聊AA了，我想明年去日本旅行，预算10000元',d=>d.decision.mode==='chat'&&d.turn?.intent==='goal_planning'],
 ['已存2000元，明年暑假去',d=>d.decision.mode==='chat'&&/暑假/.test(d.turn?.message.content??'')&&/10,000|10000/.test(d.turn?.message.content??'')],
 ['7月15日',d=>d.turn?.components.some(c=>c.type==='goal_input_card'&&c.goal.targetCents===1000000&&c.goal.targetDate==='2027-07-15')],
 ['转账和AA有什么区别',d=>d.decision.mode==='chat'&&d.turn?.intent==='clarification'&&d.turn?.components.some(c=>c.type==='explanation')],
 ['看看我的卡片',d=>d.decision.destination==='cards'],
 ['回到刚才那个页面',d=>d.decision.destination==='cards'],
 ['帮我管理订阅',d=>d.decision.destination==='subscriptions'],
 ['刚才那个页面',d=>d.decision.destination==='subscriptions'],
 ['看看我买的理财',d=>d.decision.destination==='investment_holdings'],
 ['回去看看',d=>d.decision.destination==='investment_holdings'],
 ['我想转账同时也想办信用卡',d=>d.decision.mode==='clarify'],
];
for(const [message,check]of scenarios){const res=await r.post('/api/agent/chat',{data:{message,threadId}});const data=await res.json();threadId=data.threadId??threadId;const row={message,pass:!!check(data),response:data};rows.push(row);console.log(JSON.stringify({message,pass:row.pass,mode:data.decision?.mode,destination:data.decision?.destination,memory:data.memory,reply:data.turn?.message.content}));}
const after=await(await r.get('/api/session')).json();const safe=JSON.stringify(before.accounts)===JSON.stringify(after.accounts)&&JSON.stringify(before.goals)===JSON.stringify(after.goals);const summary={total:rows.length,passed:rows.filter(r=>r.pass).length,safe};fs.writeFileSync(process.argv[2],JSON.stringify({summary,rows},null,2));console.log(JSON.stringify(summary));await r.dispose();
