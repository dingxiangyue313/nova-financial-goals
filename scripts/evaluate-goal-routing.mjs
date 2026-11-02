import {request} from '@playwright/test';
const client=await request.newContext({baseURL:'http://127.0.0.1:3000',timeout:90000});
const messages=[
 '我想在2027年6月去日本，预算¥8,000。','我想在2027年6月去日本，预算8000元',
 '2027年六月去日本玩，预计花八千元','明年6月去日本，攒8000块',
 '帮我制定一个明年去日本的储蓄目标，预算八千','想攒一万块明年暑假去旅游',
 '我要在2027年6月30日前存够8000元','明年买电脑，预算12000元',
 '计划明年换手机，需要6000元','我想存3万元做应急金',
 '我想半年攒够两万','年底前攒5000元买礼物',
 '想为明年旅行存点钱','创建一个买车目标，十万元',
 '我想存钱读研，预算5万','计划给父母准备一万元旅游基金',
 '明年6月去日本，总预算8,000元，已存2000元','去日本需要八千，我现在存了两千',
 '先不转账了，帮我规划明年去日本的8000元预算','我希望2027年暑假去日本，预算是8000人民币'
];
const rows=[];let cursor=0;
await Promise.all(Array.from({length:3},async()=>{while(cursor<messages.length){const message=messages[cursor++];const response=await client.post('/api/agent/route',{data:{message}});const r=await response.json();const pass=r.provider==='deepseek'&&r.decision?.mode==='chat'&&r.decision.chatIntent==='goal_planning';rows.push({message,pass,...r});console.log(JSON.stringify({message,pass,reason:r.reason}));}}));
await client.get('/api/session');
const response=await client.post('/api/agent/chat',{data:{message:messages[0],threadId:null}});const r=await response.json();
console.log(JSON.stringify({passed:rows.filter(r=>r.pass).length,total:rows.length,originalSentence:{status:response.status(),provider:r.provider,mode:r.decision?.mode,intent:r.turn?.intent,reply:r.turn?.message?.content,components:r.turn?.components}}));
await client.dispose();
if(rows.some(r=>!r.pass)||!r.turn||r.turn.intent!=='goal_planning')process.exitCode=1;
