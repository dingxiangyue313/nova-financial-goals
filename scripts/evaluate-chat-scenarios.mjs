import {request} from '@playwright/test';
import fs from 'node:fs';
const goals=['我想在2027年6月去日本，预算¥8,000。','明年攒一万去旅游','年底前存5000买礼物','计划明年换电脑，需要12000元','想存三万元应急金','半年攒两万','我要买车，预算十万','创建留学目标，五万元','明年六月去日本玩，预计花八千元','2027年6月30日前攒8000','预算改成9000','已经存了2000元','每个月最多存1500','时间改成2027年7月15日','一共10000，明年暑假去','不动应急金，明年想买电脑','我想给父母攒一万元旅游基金','先不聊AA了，规划明年旅行预算8000','买手机预算6000，我已经存了两千','想为孩子攒学费，明年需要三万'];
const pairs={transfer:['给林夏转500元','帮我打钱给小陈'],aa_create:['我要和同事A钱','饭钱我们四个人平摊'],aa_records:['查看AA收款记录','看看谁还没付AA钱'],investment_products:['看看有哪些理财产品','我要买理财'],investment_holdings:['看看我买的理财','我要赎回持仓'],investment_profile:['做一下风险评估','评测我的投资风险偏好'],cards:['我的银行卡在哪','我要挂失银行卡'],card_apply:['我想申请信用卡','办一张新的银行卡'],subscription_card:['更换订阅付款卡','云盘扣款换张卡'],bills:['看看本月账单','打开月账单'],spending:['钱主要花在哪里','这个月餐饮花费增加了吗'],subscriptions:['帮我取消自动续费','看看我有哪些订阅'],bill_import:['我要导入账单','上传一份交易流水'],travel_quotes:['找一下日本机票和酒店报价','查看旅行报价请求'],travel_mandate:['设置旅行预算授权','调整旅行付款授权额度'],travel_payment:['核对旅行付款','我要支付已选机票和酒店'],travel_orders:['查看旅行订单','查一下酒店退款进度'],goal_allocation:['调整目标资金分配','查看目标可支付金额'],goal_transfer:['设置工资到账后存入目标','安排目标每月转入'],cashflow:['试算一下未来收支','这笔额外支出对余额有什么影响'],goal_adjust:['修改目标储蓄计划','调整所有目标的月度投入方案']};
const knowledge=['转账和AA有什么区别','什么是基金赎回','退款在途是什么意思','什么是目标资金分配','信用卡和借记卡有什么区别','为什么订阅涨价了','什么是应急金','授权和实际付款有什么区别'];
const ambiguous=['帮我转账同时申请信用卡','我要买理财还要取消订阅','帮我处理一下','我要弄那个东西','给朋友转钱还是AA我还没想好','帮我挂失卡同时导入账单'];
const negatives=['不要帮我转账','我不想申请信用卡','先别帮我取消订阅','不要给我订机票'];
const cases=[...goals.map(message=>({group:'goal',message,mode:'chat',intent:'goal_planning'})),...Object.entries(pairs).flatMap(([destination,messages])=>messages.map(message=>({group:destination,message,mode:'navigate',destination}))),...knowledge.map(message=>({group:'knowledge',message,mode:'chat',intent:'clarification'})),...ambiguous.map(message=>({group:'ambiguous',message,mode:'clarify'})),...negatives.map(message=>({group:'negative',message,notNavigate:true}))];
if(cases.length!==80)throw Error(`Expected 80, got ${cases.length}`);
const rawClient=await request.newContext({baseURL:'http://127.0.0.1:3000',timeout:90000});
for(const c of cases)if(c.message==='预算改成9000'||c.message==='时间改成2027年7月15日')c.message='日本旅行目标'+c.message;
for(let i=0;i<20;i++){
 try{if((await rawClient.get('/api/session')).ok())break;}catch{}
 if(i===19)throw Error('Local service not ready');
 await new Promise(r=>setTimeout(r,1000));
}
let nextRequest=Date.now();
const client={dispose:()=>rawClient.dispose(),post:async(...args)=>{
 for(let attempt=0;attempt<3;attempt++){
  const start=Math.max(Date.now(),nextRequest);nextRequest=start+2300;
  await new Promise(r=>setTimeout(r,Math.max(0,start-Date.now())));
  const res=await rawClient.post(...args);if(res.status()!==429)return res;
  await new Promise(r=>setTimeout(r,61000));
 }
 throw Error('rate limit retries exhausted');
}};
const rows=[];let cursor=0;
await Promise.all(Array.from({length:3},async()=>{while(cursor<cases.length){const c=cases[cursor++];try{const res=await client.post('/api/agent/route',{data:{message:c.message}});const r=await res.json();const pass=res.ok()&&r.provider!=='unavailable'&&(c.notNavigate?r.decision.mode!=='navigate':r.decision.mode===c.mode&&(!c.destination||r.decision.destination===c.destination)&&(!c.intent||r.decision.chatIntent===c.intent));rows.push({...c,pass,response:r});console.log(JSON.stringify({message:c.message,pass,actual:r.decision,reason:r.reason}));}catch(e){rows.push({...c,pass:false,error:e.message});}}}));
const summary={total:rows.length,passed:rows.filter(r=>r.pass).length};fs.writeFileSync(process.argv[2],JSON.stringify({summary,rows},null,2));console.log(JSON.stringify(summary));await client.dispose();
