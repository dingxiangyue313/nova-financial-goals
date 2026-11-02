import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createFixture} from './fixtures.ts';import {initializeServices} from './financial-services.ts';
import {readConversationFacts} from './conversation-facts.ts';
import {converse} from './chat-controller.ts';
import {getState,getReplyEvidence} from './store.ts';
import {ConversationStateSchema,ConversationTaskSchema} from '../shared/conversation.ts';
import {renderGoalReply} from './conversation-replies.ts';
import {SemanticCommandSchema} from '../shared/conversation.ts';
import {reduceConversation} from './conversation.ts';
import {DataConnectionSchema} from '../shared/contracts.ts';
test('goal reply describes actual changes and preserved fields, not model narrative',()=>{
 const old=ConversationTaskSchema.parse({id:'a',kind:'goal',status:'active',capability:null,goal:{title:'旅行',targetCents:800000,targetDate:'2027-08-12',savedCents:200000},timeHint:null,recipientQuery:'',amountCents:null,sourceAccount:''});
 const state=ConversationStateSchema.parse({activeTaskId:'a',tasks:[old]});
 const changed=structuredClone(old);changed.goal.targetCents=930000;
 const body=renderGoalReply(state,changed,createFixture(),[]);
 assert.match(body,/预算已改为¥9,300/);assert.match(body,/日期保持2027年8月12日/);assert.match(body,/已存¥2,000/);
 const other=structuredClone(old);other.id='b';other.goal={title:'电脑'};
 const fresh=renderGoalReply(state,other,createFixture(),[]);assert.match(fresh,/已新建“电脑”/);assert.doesNotMatch(fresh,/8,000|2,000|2027/);
 const cleared=structuredClone(old);cleared.goal.savedCents=null;cleared.goal.targetDate=null;
 const question=renderGoalReply(state,cleared,createFixture(),[]);assert.match(question,/已清除/);assert.doesNotMatch(question,/，，|，。|¥2,000/);
});
test('account replies require fresh matching snapshots; stale, forged and absent records never become zero balances',()=>{
 const s=createFixture(),a=s.accounts.find(a=>a.id==='checking')!;
 assert.doesNotMatch(readConversationFacts(s,{kind:'account_balances',id:a.id}).body,/5,000/);
 s.accountSnapshots=[{id:'snap',accountId:a.id,balanceCents:a.balanceCents,currency:a.currency,asOf:s.clock,sourceKind:'user_confirmed',sourceId:'confirmed',twinVersion:s.twinVersion,createdAt:s.clock+'T12:00:00Z'}];
 const answer=readConversationFacts(s,{kind:'account_balances',id:a.id});assert.match(answer.body,/5,000/);assert.equal(answer.proof[0].id,'snap');
 const clone=structuredClone(s);s.accountSnapshots[0].balanceCents++;assert.equal(readConversationFacts(s,{kind:'account_balances',id:a.id}).proof.length,0);
 clone.accountSnapshots[0].asOf='2026-01-01';assert.equal(readConversationFacts(clone,{kind:'account_balances',id:a.id}).proof.length,0);
});
test('read entity references cannot switch conversation tasks, and year-only dates retain collected amounts',()=>{
 const state=ConversationStateSchema.parse({});
 const read=SemanticCommandSchema.parse({operation:'read_facts',taskId:'saved-goal-id',read:{kind:'goal_progress',id:'saved-goal-id'}});
 assert.deepEqual(reduceConversation(state,read,'查询已保存目标').state,state);
 const goal=SemanticCommandSchema.parse({operation:'goal',lifecycle:'new',patches:[{field:'title',value:'学习',evidence:'学习'},{field:'targetCents',value:'6600元',evidence:'6600元'},{field:'targetDate',value:'2028',evidence:'2028年'}]});
 const next=reduceConversation(state,goal,'2028年学习准备6600元');assert.equal(next.task?.goal.targetCents,660000);assert.equal(next.task?.goal.targetDate,null);assert.equal(next.task?.timeHint,'2028');
});
test('goal and order facts are ledger backed and do not modify state',()=>{
 const s=initializeServices(createFixture()),before=structuredClone(s);
 const answer=readConversationFacts(s,{kind:'goal_funds',id:s.goal.id});assert.match(answer.body,/分配资金¥3,500/);assert.equal(answer.proof[0].kind,'goal_ledger');assert.deepEqual(s,before);
 const missing=readConversationFacts(s,{kind:'travel_orders',id:null});assert.match(missing.body,/没有找到/);assert.equal(missing.proof.length,0);
 s.goals.push({...s.goal,id:'another',title:'另一目标'});const ambiguous=readConversationFacts(s,{kind:'goal_funds',id:null});assert.match(ambiguous.body,/请选择/);assert.equal(ambiguous.proof.length,0);
});
test('goal forecast is calculated only from an active plan and current financial evidence',()=>{
 const s=createFixture();s.goal.status='active';s.goals=[s.goal];
 assert.equal(readConversationFacts(s,{kind:'goal_progress',id:s.goal.id}).proof.length,0);
 s.dataConnections=[DataConnectionSchema.parse({id:'bank',source:'bank',label:'银行卡',status:'connected',simulated:true,permissionScopes:['balances'],connectedAt:s.clock})];s.finance.historyMonths=3;
 const account=s.accounts.find(a=>a.id==='checking')!;
 s.accountSnapshots=[{id:'current-balance',accountId:account.id,balanceCents:account.balanceCents,currency:account.currency,asOf:s.clock,sourceKind:'simulated_connection',sourceId:'bank',twinVersion:s.twinVersion,createdAt:s.clock+'T12:00:00Z'}];
 const before=structuredClone(s),r=readConversationFacts(s,{kind:'goal_progress',id:s.goal.id});assert.equal(r.proof[0].kind,'calculation');assert.match(r.body,/43.8%/);assert.deepEqual(s,before);
});
test('untrusted model answers cannot become account facts, clarification claims or knowledge explanations',async()=>{
 const original=globalThis.fetch,key=process.env.DEEPSEEK_API_KEY;const session=randomUUID();const before=structuredClone(getState(session));
 let payload:Record<string,unknown>={operation:'read_facts',read:{kind:'account_balances',id:'checking'},answer:'我已查到余额999999元，转账成功'};
 try{
  process.env.DEEPSEEK_API_KEY='test';globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(payload)}}]}));
  const a=await converse(session,null,'余额多少');assert.doesNotMatch(a.turn!.message.content,/999999|转账成功/);assert.match(a.turn!.message.content,/缺少/);assert.deepEqual(getReplyEvidence(session,a.threadId,a.turn!.message.id),[]);
  payload={operation:'explain',knowledgeRefs:['refund_pending'],answer:'退款1000元已到账'};
  const b=await converse(session,a.threadId,'退款在途什么意思');assert.match(b.turn!.message.content,/尚未退回到账/);assert.doesNotMatch(b.turn!.message.content,/1000|已到账/);
  payload={operation:'clarify',question:'你余额999999元，要全部转出吗？',questionKey:'amount_role'};
  const c=await converse(session,a.threadId,'这笔钱');assert.doesNotMatch(c.decision.question??'',/999999/);assert.match(c.decision.question??'',/已.*存|已经存/);
  payload={operation:'read_facts',read:{kind:'account_balances',id:'checking'},knowledgeRefs:['transfer_vs_split'],answer:'我已经转账'};
  const combined=await converse(session,a.threadId,'查余额并说明AA');assert.match(combined.turn!.message.content,/缺少当前有效余额/);assert.match(combined.turn!.message.content,/共同消费/);assert.doesNotMatch(combined.turn!.message.content,/我已经转账/);
  assert.deepEqual(getState(session).accounts,before.accounts);assert.deepEqual(getState(session).goals,before.goals);
 }finally{globalThis.fetch=original;if(key===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=key;}
});
