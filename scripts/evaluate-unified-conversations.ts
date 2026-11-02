import 'dotenv/config';
import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {converse} from '../server/chat-controller.ts';import {getConversationState,getState} from '../server/store.ts';
type Step={text:string;goal?:Record<string,unknown>;capability?:string;kind?:string;status?:string;mode?:string;recipientQuery?:string;amountCents?:number|null;allowRefusal?:boolean};
// Frozen before the first real run. Whole conversation is the unit of success.
const cases:Step[][]=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):[
 [{text:'想在2027年五月去看极光，总共准备两万元',goal:{targetCents:2000000}},{text:'现在手头为这件事攒了3500元',goal:{targetCents:2000000,savedCents:350000}}],
 [{text:'我打算2027年8月买一辆自行车，预算6500元',goal:{targetCents:650000}},{text:'预算不是6500，是7200元',goal:{targetCents:720000}}],
 [{text:'明年十月搬家，需要一万五千元',goal:{targetCents:1500000}},{text:'现有三千元，月存不能超过900元',goal:{savedCents:300000,monthlyContributionCapCents:90000}}],
 [{text:'我想2027年6月去西安玩，费用5000元',goal:{targetCents:500000}},{text:'六月18号出发',goal:{targetDate:'2027-06-18',targetCents:500000}}],
 [{text:'计划在2027年9月30日换电脑，总预算12000，已存4000元',goal:{targetCents:1200000,savedCents:400000}},{text:'只改到10月20日，预算不变',goal:{targetDate:'2027-10-20',targetCents:1200000}}],
 [{text:'给婚礼存八万元，2027年底用',goal:{targetCents:8000000}},{text:'另外新建一个学摄影目标',goal:{targetCents:undefined},kind:'goal'}],
 [{text:'明年去云南，预算9000元',goal:{targetCents:900000}},{text:'先放着，给赵敏转260元',capability:'transfer'},{text:'继续刚才云南旅行那个',goal:{targetCents:900000},kind:'goal'}],
 [{text:'明年考证需要8000元',goal:{targetCents:800000}},{text:'另外新建买平板目标，预算4500元',goal:{targetCents:450000}},{text:'回到考证目标',goal:{targetCents:800000}}],
 [{text:'想攒一万元学习基金',goal:{targetCents:1000000}},{text:'取消这个规划',status:'cancelled'},{text:'再新建一个健身目标',kind:'goal',goal:{targetCents:undefined}}],
 [{text:'为养猫准备6000元，已经存了1000元',goal:{targetCents:600000,savedCents:100000}},{text:'另开一个装修目标，要五万元',goal:{targetCents:5000000,savedCents:undefined}}],
 [{text:'给王雯打450块钱',capability:'transfer'},{text:'少打一点，改为320元',capability:'transfer'}],
 [{text:'转700元给刘洋',capability:'transfer'},{text:'另外新建一笔给陈晨的转账',capability:'transfer'}],
 [{text:'聚餐花了560元，我们四个人均摊',capability:'aa_create'},{text:'看看之前发起的AA谁还没付',capability:'aa_records'}],
 [{text:'我的信用卡丢了，想挂失',capability:'cards'},{text:'再看看办新卡要怎么申请',capability:'card_apply'}],
 [{text:'看看我现在持有的基金',capability:'investment_holdings'},{text:'我想重新做风险偏好测评',capability:'investment_profile'}],
 [{text:'帮我看一下上月开支分类',capability:'spending'},{text:'我要上传一份银行流水',capability:'bill_import'}],
 [{text:'我想检查还有哪些自动续费',capability:'subscriptions'},{text:'把订阅的付款卡换一下',capability:'subscription_card'}],
 [{text:'想看东京往返机票和住宿报价',capability:'travel_quotes'},{text:'查下已订酒店的退款状态',capability:'travel_orders'}],
 [{text:'安排每个月5号往目标里转入',capability:'goal_transfer'},{text:'看看目标里现在有多少可支付的钱',capability:'goal_allocation'}],
 [{text:'转账和分摊有什么区别？',mode:'chat'},{text:'别替我转账，我只是问问',mode:'notNavigate'}],
];
const out=process.argv[2]??'unified-eval.json';fs.writeFileSync(out+'.cases.json',JSON.stringify(cases,null,2));
let cursor=0;const rows:unknown[]=[];
await Promise.all(Array.from({length:3},async()=>{while(cursor<cases.length){const index=cursor++,steps=cases[index],session=randomUUID(),before=structuredClone(getState(session));let threadId:string|null=null;const turns=[];
 for(const step of steps){try{const r=await converse(session,threadId,step.text);threadId=r.threadId;const state=getConversationState(session,threadId);const task=state.tasks.find(t=>t.id===state.activeTaskId);
 const pass=r.provider!=='unavailable'&&(!step.mode||(step.mode==='notNavigate'?r.decision.mode!=='navigate':r.decision.mode===step.mode))&&(!step.capability||task?.capability===step.capability)&&(!step.kind||task?.kind===step.kind)&&(!step.status||task?.status===step.status)&&(!step.goal||Object.entries(step.goal).every(([k,v])=>v==null?task?.goal[k as keyof typeof task.goal]==null:task?.goal[k as keyof typeof task.goal]===v));
 const slotPass=(step.recipientQuery===undefined||task?.recipientQuery===step.recipientQuery)&&(!('amountCents' in step)||task?.amountCents===step.amountCents);
 turns.push({step,pass:(pass||(step.allowRefusal&&r.provider==='unavailable'&&r.decision.mode==='clarify'))&&slotPass,response:r,task});}catch(e){turns.push({step,pass:false,error:e instanceof Error?e.message:String(e)});}}
 const after=getState(session);const safe=JSON.stringify(before.accounts)===JSON.stringify(after.accounts)&&JSON.stringify(before.goals)===JSON.stringify(after.goals);const pass=safe&&turns.every(t=>t.pass);rows.push({index,pass,safe,turns});console.log(JSON.stringify({index,pass,failed:turns.filter(t=>!t.pass).map(t=>t.step.text)}));
}}));
const summary={conversations:rows.length,passed:(rows as Array<{pass:boolean}>).filter(r=>r.pass).length};fs.writeFileSync(out,JSON.stringify({summary,rows},null,2));console.log(JSON.stringify(summary));
