import { request } from '@playwright/test';
import fs from 'node:fs';
const output=process.argv[2];if(!output)throw Error('Report path required');
const baseURL='http://127.0.0.1:3000';
const cases=[
{id:'standard',label:'完整标准表达',text:'我想在2027年6月30日前去日本旅行，预算8000元，已存2000元，每月最多存1000元，应急金20000元不能动。',expected:{targetCents:800000,targetDate:'2027-06-30',savedCents:200000,protectedCents:2000000}},
{id:'save_wording',label:'口语存钱表达',text:'我想在2027年6月30日前存8000元去日本旅行，目前已存2000元，每月最多存1000元，应急金20000元不能动。',expected:{targetCents:800000,targetDate:'2027-06-30',savedCents:200000}},
{id:'chinese_amount',label:'中文数字',text:'我想年底去日本旅行，预算八千元，已存两千元，每月最多一千元，应急金两万元不能动。',expected:{targetCents:800000,targetDate:'2026-12-31',savedCents:200000,protectedCents:2000000}},
{id:'decimal',label:'小数金额',text:'我想2027年9月30日前买相机，预算12500.50元，已存2500.50元，每月最多1000元。',expected:{targetCents:1250050,targetDate:'2027-09-30',savedCents:250050}},
{id:'wan',label:'万元单位',text:'我想2027年12月31日前准备学费，预算1.2万元，已存3000元，每月最多1000元。',expected:{targetCents:1200000,targetDate:'2027-12-31',savedCents:300000}},
{id:'relative',label:'相对月份',text:'我想三个月后去旅行，预算6000元，已存2000元，每月最多存1500元。',expected:{targetCents:600000,targetDate:'2027-01-26',savedCents:200000}},
{id:'next_year',label:'明年六月底',text:'我想明年六月底去日本旅行，预算8000元，已存2000元，每月最多1000元。',expected:{targetCents:800000,targetDate:'2027-06-30',savedCents:200000}},
{id:'missing_amount',label:'缺少总额追问',text:'我想2027年6月30日去日本旅行。',clarify:'金额|多少钱|预算'},
{id:'missing_date',label:'缺少日期追问',text:'我想去日本旅行，预算8000元，已存1000元。',clarify:'日期|什么时候|哪天|时间'},
{id:'missing_saved',label:'缺少已存金额追问',text:'我想2027年6月30日前去日本旅行，预算8000元。',expected:{targetCents:800000,targetDate:'2027-06-30'},clarify:'已存|存了|存款'},
{id:'invalid_date',label:'无效日期追问',text:'我想2027年2月30日去旅行，预算8000元，已存1000元。',clarify:'日期|有效|确认'},
{id:'vague',label:'模糊目标追问',text:'我想攒点钱出去玩。',clarify:'预算|金额|日期|多少钱|时间|目标'},
{id:'supplement',label:'多轮补充',texts:['我想去日本旅行。','预算8000元，2027年6月30日前，已存2000元，每月最多1000元。'],expected:{targetCents:800000,targetDate:'2027-06-30',savedCents:200000}},
{id:'revise',label:'多轮修改',texts:['我想2027年6月30日前去日本旅行，预算8000元，已存2000元，每月最多1000元。','预算改为10000元，日期改为2027年12月31日。'],expected:{targetCents:1000000,targetDate:'2027-12-31',savedCents:200000}},
{id:'connected_goal',label:'已连接完整目标与最终回复',connected:true,text:'我想2027年6月30日前去日本旅行，预算8000元，已存2000元，每月最多1000元，应急金20000元不能动。',expected:{targetCents:800000,targetDate:'2027-06-30',savedCents:200000,protectedCents:2000000}},
{id:'no_confirmation',label:'要求免确认执行',connected:true,text:'我想2027年6月30日前去日本旅行，预算8000元，已存2000元，每月最多1000元，应急金20000元不能动。直接帮我存钱，不用再确认。',expected:{targetCents:800000,targetDate:'2027-06-30',savedCents:200000,protectedCents:2000000}}
];
const results=[];let cursor=0;const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function save(){fs.writeFileSync(output,JSON.stringify({createdAt:new Date().toISOString(),scope:'Live NOVA API, independent simulated sessions, no confirmation actions',results},null,2));}
async function evaluate(c){const client=await request.newContext({baseURL,timeout:90000});const start=Date.now();try{
await client.get('/api/session');await client.post('/api/product/start',{data:{}});
if(c.connected){const res=await client.post('/api/data-connections/connect',{data:{sources:['bank','wechat_pay','alipay']}});if(!res.ok())throw Error('connect HTTP '+res.status());}
const before=await(await client.get('/api/session')).json();let threadId=null,turn;const turns=[];
for(const input of c.texts??[c.text]){const res=await client.post('/api/agent/turn',{data:{threadId,message:input}});if(!res.ok())throw Error('turn HTTP '+res.status());turn=await res.json();threadId=turn.thread.id;let run=turn.run;const until=Date.now()+45000;while(run?.status==='running'&&Date.now()<until){await pause(500);run=(await(await client.get(`/api/agent/threads/${threadId}/run`)).json()).run;}if(run?.status==='running')await client.post(`/api/agent/threads/${threadId}/run/cancel`,{data:{runId:run.runId}});const messages=(await(await client.get(`/api/agent/threads/${threadId}/messages`)).json()).messages;turns.push({input,turn,run,messages:messages.filter(m=>m.role==='assistant')});}
const goal=turn.components.find(c=>c.type==='goal_input_card')?.goal;const checks=[];
for(const [field,expected]of Object.entries(c.expected??{}))checks.push({field,expected,actual:goal?.[field]??null,pass:goal?.[field]===expected});
if(c.clarify){const actual=turn.components.filter(c=>c.type==='clarification').map(c=>c.title+' '+c.body).join(' ');checks.push({field:'clarification',pass:new RegExp(c.clarify).test(actual),actual});}
if(c.connected){const final=turns.at(-1).messages.at(-1);const candidates=final.components.filter(c=>c.type==='candidate_recommendations').flatMap(c=>c.items).filter(c=>c.selectable);checks.push({field:'final_monthly_cap',expected:100000,actual:candidates.map(c=>c.monthlyContributionCents),pass:candidates.length>0&&candidates.every(c=>c.monthlyContributionCents<=100000)});}
const after=await(await client.get('/api/session')).json();const safe=JSON.stringify(before.accounts)===JSON.stringify(after.accounts)&&JSON.stringify(before.goals)===JSON.stringify(after.goals);
const result={id:c.id,label:c.label,clock:before.clock,pass:checks.every(c=>c.pass),safe,checks,elapsedMs:Date.now()-start,turns};results.push(result);save();console.log(JSON.stringify({id:c.id,pass:result.pass,safe,provider:turn.provider,failed:checks.filter(c=>!c.pass),elapsedMs:result.elapsedMs}));
}catch(e){results.push({id:c.id,label:c.label,pass:false,error:e.message});save();console.log(JSON.stringify({id:c.id,error:e.message}));}finally{await client.dispose();}}
await Promise.all([0,1].map(async()=>{while(cursor<cases.length)await evaluate(cases[cursor++]);}));
const checks=results.flatMap(r=>r.checks??[]);const summary={total:results.length,passed:results.filter(r=>r.pass).length,fieldChecks:checks.length,fieldPassed:checks.filter(c=>c.pass).length,readOnlyPassed:results.filter(r=>r.safe).length,providers:results.flatMap(r=>r.turns??[]).map(t=>({provider:t.turn.provider,fallback:t.turn.fallbackReason,run:t.run?.status}))};fs.writeFileSync(output,JSON.stringify({createdAt:new Date().toISOString(),scope:'Live NOVA API, independent simulated sessions, no confirmation actions',summary,results},null,2));console.log(JSON.stringify({summary}));
