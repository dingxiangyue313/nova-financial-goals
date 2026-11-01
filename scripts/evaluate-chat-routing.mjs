import {request} from '@playwright/test';import fs from 'node:fs';
let cases=[
['我要和同事A钱','aa_create'],['今天饭钱我们几个A一下','aa_create'],['跟同事平摊一下打车费','aa_create'],['帮我把聚餐费用分给大家','aa_create'],['给大家算算每个人该付多少','aa_create'],
['帮我给林夏转账500元','transfer'],['给小林打三百块','transfer'],['我要汇钱给朋友','transfer'],['我欠室友200帮我转给他','transfer'],['把房租转给房东','transfer'],
['看看谁还没把饭钱给我','aa_records'],['查下上次AA收齐没','aa_records'],['看看我现在有哪几张卡','cards'],['我卡丢了赶紧挂失','cards'],['想办一张信用卡','card_apply'],['换张卡扣视频会员费','subscription_card'],
['这个月钱都花哪了','spending'],['看看九月份账单','bills'],['视频会员不想续了帮我关掉','subscriptions'],['帮我管理一下订阅','subscriptions'],['把银行流水导进来','bill_import'],
['看看有哪些适合我的理财','investment_products'],['我想把买的基金赎回来','investment_holdings'],['看看理财到账没有','investment_holdings'],['做一下风险测评','investment_profile'],
['帮我找找去日本的机票住宿报价','travel_quotes'],['看看酒店订单退款到哪了','travel_orders'],['给旅行助手设个花钱上限','travel_mandate'],['我要核对机票付款','travel_payment'],
['把钱分配到旅行目标里','goal_allocation'],['每个月往旅行金里存点钱','goal_transfer'],['算算多花500会不会影响余额','cashflow'],['调整几个目标的资金计划','goal_adjust'],
['我想明年暑假去日本，一共一万元','chat'],['一共10000，明年暑假去','chat'],['转账是什么','chat'],['转账会影响我的旅行目标吗','chat'],['为什么要做风险评估','chat'],['不要给同事转账','no_navigation'],['想转账又想申请信用卡','clarify']
];
if(process.argv.includes('--retry-failed')){const old=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));cases=cases.filter(([text])=>old.results.some(r=>r.text===text&&!r.pass));}
const r=await request.newContext({baseURL:'http://127.0.0.1:3000',timeout:60000});await r.get('/api/session');const results=[];let cursor=0;
await Promise.all([0,1].map(async()=>{while(cursor<cases.length){const [text,expected]=cases[cursor++];const start=Date.now();try{const res=await r.post('/api/agent/route',{data:{message:text}});const data=await res.json();const actual=data.decision?.mode==='navigate'?data.decision.destination:data.decision?.mode;const pass=expected==='no_navigation'?actual==='chat'||actual==='clarify':actual===expected;results.push({text,expected,actual,pass,provider:data.provider,reason:data.reason,ms:Date.now()-start});console.log(JSON.stringify(results.at(-1)));}catch(e){results.push({text,expected,pass:false,error:e.message});}}}));
const merged=process.argv.includes('--retry-failed')?JSON.parse(fs.readFileSync(process.argv[2],'utf8')).results.filter(r=>!results.some(n=>n.text===r.text)).concat(results):results;
const report={total:merged.length,passed:merged.filter(r=>r.pass).length,results:merged};fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.log(JSON.stringify({total:report.total,passed:report.passed}));await r.dispose();
