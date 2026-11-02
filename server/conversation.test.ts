import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {ConversationStateSchema,SemanticCommandSchema} from '../shared/conversation.ts';
import {reduceConversation,amountFromEvidence} from './conversation.ts';
import {converse} from './chat-controller.ts';
import {getGoalDraft,getConversationState,getState,saveConversationState,getAgentTaskForThread} from './store.ts';
const command=(v:Record<string,unknown>)=>SemanticCommandSchema.parse({operation:'goal',lifecycle:'continue',taskId:null,capability:null,patches:[],transfer:{recipient:null,amount:null,account:null},timeHint:null,question:null,answer:null,...v});
test('new goals isolate fields, resuming restores the chosen goal, invalid input is atomic',()=>{
 const a=reduceConversation(ConversationStateSchema.parse({}),command({lifecycle:'new',patches:[{field:'targetCents',value:'8000',evidence:'8000'}]}),'预算8000');
 const b=reduceConversation(a.state,command({lifecycle:'new',patches:[{field:'title',value:'电脑',evidence:'电脑'}]}),'再创建电脑目标');
 assert.equal(b.task?.goal.targetCents,undefined);
 const restored=reduceConversation(b.state,command({operation:'resume',taskId:a.task!.id}),'回到旅行');assert.equal(restored.task?.goal.targetCents,800000);
 const frozen=JSON.stringify(restored.state);
 assert.throws(()=>reduceConversation(restored.state,command({patches:[{field:'savedCents',value:'9999',evidence:'9999'}]}),'已存500'));
 assert.equal(JSON.stringify(restored.state),frozen);
 const cancelled=reduceConversation(restored.state,command({operation:'cancel'}),'取消');
 assert.throws(()=>reduceConversation(cancelled.state,command({operation:'resume'}),'继续'));
 assert.ok(reduceConversation(cancelled.state,command({lifecycle:'new'}),'新目标').task?.status==='active');
});
test('full chat uses one model interpretation and projects complete isolated goal state',async()=>{
 const session=randomUUID(),fetchBefore=globalThis.fetch,key=process.env.DEEPSEEK_API_KEY;let calls=0;
 const before=structuredClone(getState(session));
 const turns=[
  command({lifecycle:'new',patches:[{field:'title',value:'旅行',evidence:'旅行'},{field:'targetCents',value:'8000',evidence:'8000'}]}),
  command({lifecycle:'new',patches:[{field:'title',value:'电脑',evidence:'电脑'}]}),
 ];
 try{
  process.env.DEEPSEEK_API_KEY='test-only';globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(turns[calls++])}}]}));
  const a=await converse(session,null,'旅行预算8000');assert.equal(calls,1);assert.ok(a.turn);
  const original=getConversationState(session,a.threadId).activeTaskId!;
  const b=await converse(session,a.threadId,'另建电脑目标');assert.equal(calls,2);assert.equal(getGoalDraft(session,a.threadId)?.targetCents,null);assert.equal(b.turn?.intent,'goal_planning');
  assert.notEqual(getGoalDraft(session,a.threadId)?.id,original);
  assert.equal(getAgentTaskForThread(session,a.threadId)?.facts.targetCents,null);
  turns.push(command({operation:'resume',taskId:original}));
  await converse(session,a.threadId,'返回旅行');assert.equal(calls,3);assert.equal(getGoalDraft(session,a.threadId)?.targetCents,800000);assert.equal(getGoalDraft(session,a.threadId)?.title,'旅行');
  const snapshot=getConversationState(session,a.threadId);assert.throws(()=>saveConversationState(session,a.threadId,snapshot,snapshot.version-1),/CONVERSATION_STATE_CHANGED/);
  assert.deepEqual(getState(session).accounts,before.accounts);assert.deepEqual(getState(session).goals,before.goals);
 }finally{globalThis.fetch=fetchBefore;if(key===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=key;}
});
test('amount conversion keeps units and never takes an unrelated numeric fragment',()=>{
 assert.equal(amountFromEvidence('5000','费用5000元'),500000);
 assert.equal(amountFromEvidence('2','两万元'),2000000);
 assert.equal(amountFromEvidence('9999','已存3500元'),null);
 assert.equal(amountFromEvidence('450块钱','450块钱'),45000);
});
test('date normalization inherits the task year without changing budget',()=>{
 const initial=reduceConversation(ConversationStateSchema.parse({}),command({lifecycle:'new',patches:[{field:'targetCents',value:'6000',evidence:'6000'},{field:'targetDate',value:'2028-09-30',evidence:'2028年9月30日'}]}),'2028年9月30日预算6000','2026-11-02');
 const next=reduceConversation(initial.state,command({patches:[{field:'targetDate',value:'2026-10-20',evidence:'10月20日'}]}),'改到10月20日','2026-11-02');
 assert.equal(next.task?.goal.targetDate,'2028-10-20');assert.equal(next.task?.goal.targetCents,600000);
});
test('choosing a task precedes clarification; ambiguous candidates do not change the active task',()=>{
 const a=reduceConversation(ConversationStateSchema.parse({}),command({lifecycle:'new',patches:[{field:'title',value:'厨房装修',evidence:'厨房'},{field:'targetCents',value:'18000',evidence:'18000'}]}),'厨房18000');
 const b=reduceConversation(a.state,command({lifecycle:'new',patches:[{field:'title',value:'卧室装修',evidence:'卧室'}]}),'卧室');
 const restored=reduceConversation(b.state,command({operation:'clarify',taskId:a.task!.id,question:'请补充日期'}),'回到厨房');
 assert.equal(restored.state.activeTaskId,a.task!.id);assert.equal(restored.task?.goal.targetCents,1800000);
 assert.equal(restored.task?.name,'厨房装修');assert.ok(restored.task!.revision>0);assert.equal(restored.task?.fieldSources.targetCents.evidence,'18000');
 const ambiguous=reduceConversation(b.state,command({operation:'resume',taskCandidates:[a.task!.id,b.task!.id]}),'返回装修');
 assert.equal(ambiguous.choices?.length,2);assert.equal(ambiguous.state.activeTaskId,b.task!.id);
});
test('business actions change service even with the previous taskId and preserve previous draft for resume',()=>{
 const auth=reduceConversation(ConversationStateSchema.parse({}),command({operation:'manage_travel_authorization'}),'设置旅行授权');
 const pay=reduceConversation(auth.state,command({operation:'review_travel_payment',taskId:auth.task!.id}),'核对付款');
 assert.equal(pay.task?.capability,'travel_payment');assert.notEqual(pay.task?.id,auth.task!.id);
 const restore=reduceConversation(pay.state,command({operation:'resume',taskId:auth.task!.id}),'返回授权');
 assert.equal(restore.task?.capability,'travel_mandate');
 const schedule=reduceConversation(restore.state,command({operation:'schedule_goal_deposit'}),'安排工资到账后转入');
 assert.equal(schedule.task?.kind,'service');assert.equal(schedule.task?.capability,'goal_transfer');
});
test('fully specified time metadata is normalized into a date only with grounded day evidence',()=>{
 const a=reduceConversation(ConversationStateSchema.parse({}),command({lifecycle:'new',timeHint:'2028-07',patches:[{field:'targetCents',value:'8000',evidence:'8000'}]}),'2028年7月旅行8000元','2026-11-02');
 const b=reduceConversation(a.state,command({timeHint:'2028-07-22'}),'七月22号出发','2026-11-02');
 assert.equal(b.task?.goal.targetDate,'2028-07-22');assert.equal(b.task?.goal.targetCents,800000);
 const c=reduceConversation(a.state,command({timeHint:'2028-07-01'}),'时间还是七月','2026-11-02');
 assert.equal(c.task?.goal.targetDate,undefined);
});
