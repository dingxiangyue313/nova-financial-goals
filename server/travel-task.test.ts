import test from 'node:test';
import assert from 'node:assert/strict';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {initializeServices,executeServiceAction,requestTravelQuotes,reconcileServices} from './financial-services.ts';
import {travelTask,travelProof} from './travel-task.ts';
import {DemoStateSchema} from '../shared/contracts.ts';
function funded(){let s=initializeServices(createJapanMoneyMissionFixture());s.accounts.find(a=>a.id==='goal-wallet')!.balanceCents=800000;s.goal.savedCents=800000;s.goals=[s.goal];s.accountSnapshots.find(a=>a.accountId==='goal-wallet')!.balanceCents=800000;s.financialServices.allocations[0].amountCents=800000;const card=s.financialServices.cards.find(c=>c.id==='card-travel')!;card.online=true;card.overseas=true;s=requestTravelQuotes(s);return executeServiceAction(s,{kind:'mandate',goalId:s.goal.id,accountId:'goal-wallet',maxPerOrderCents:300000,totalCents:500000,merchants:['air-demo','stay-demo'],expiresAt:new Date(Date.now()+86400000).toISOString()},'grant');}
function book(s:ReturnType<typeof funded>){return executeServiceAction(s,{kind:'book',goalId:s.goal.id,accountId:'goal-wallet',cardId:'card-travel',mandateId:'grant',quoteIds:s.financialServices.quotes.map(q=>q.id)},'book');}
test('task is derived, versioned and replayable without submitting any operation',()=>{
 const state=initializeServices(createJapanMoneyMissionFixture()),before=structuredClone(state),task=travelTask(state,state.goal.id);
 assert.equal(task.schemaVersion,1);assert.equal(task.id,`travel-task:${state.goal.id}`);assert.equal(task.status,'planning');assert.equal(task.nodes.length,7);
 assert.deepEqual(travelTask(DemoStateSchema.parse(JSON.parse(JSON.stringify(state))),state.goal.id),task);assert.deepEqual(state,before);
 assert.throws(()=>travelTask(state,'foreign-goal'),/GOAL_NOT_FOUND/);
});
test('successful independent orders remain booked after quote expiry and a later lost card, without pretending fulfillment',()=>{
 let state=book(funded());const task=travelTask(state,state.goal.id,Date.now()+2*86400000);
 assert.equal(task.status,'booked');assert.equal(task.coverageCents,800000);assert.equal(task.nodes.find(n=>n.id==='quotes')!.status,'complete');
 state=executeServiceAction(state,{kind:'card',id:'card-travel',action:'lost'},'lost');assert.equal(travelTask(state,state.goal.id).status,'booked');
 const proof=travelProof(state,state.goal.id);assert.ok(proof.operations.some(o=>o.operationId==='book'));assert.ok(proof.audit.length>0);
 assert.ok(proof.task.limitations.some(l=>l.includes('实际履约')));assert.ok(!JSON.stringify(proof).includes('approvalToken'));assert.ok(!JSON.stringify(proof).includes('signature'));
});
test('unknown and partial orders preserve their independent recovery state and confirmed coverage',()=>{
 for(const fault of ['timeout_after','partial'] as const){const initial=funded();initial.financialServices.fault=fault;const state=book(initial),task=travelTask(state,state.goal.id);
  assert.equal(task.status,'needs_attention');
  if(fault==='timeout_after'){assert.equal(task.nodes.find(n=>n.id==='air-demo')!.status,'unknown');assert.equal(travelTask(reconcileServices(state,'book'),state.goal.id).status,'booked');}
  else {assert.equal(task.nodes.find(n=>n.id==='air-demo')!.status,'complete');assert.equal(task.nodes.find(n=>n.id==='stay-demo')!.status,'needs_recovery');}
 }
});
test('refund pending removes confirmed coverage and cannot be presented as settled cash',()=>{
 const initial=book(funded()),hotel=initial.financialServices.bookings.find(b=>b.merchantId==='stay-demo')!;
 const state=executeServiceAction(initial,{kind:'cancel_booking',id:hotel.id},'cancel'),task=travelTask(state,state.goal.id);
 assert.equal(task.status,'refund_pending');assert.equal(task.coverageCents,580000);assert.match(task.nodes.find(n=>n.id==='stay-demo')!.detail,/退款在途/);
 assert.equal(state.accounts.find(a=>a.id==='goal-wallet')!.balanceCents,300000);
});
test('task readiness cannot hide an insufficient mandate, card limit or stale balance',()=>{
 const state=funded();state.financialServices.mandates[0].maxPerOrderCents=10000;
 assert.equal(travelTask(state,state.goal.id).nodes.find(n=>n.id==='mandate')!.status,'pending');
 state.financialServices.mandates[0].maxPerOrderCents=300000;state.financialServices.cards.find(c=>c.id==='card-travel')!.limitCents=10000;
 assert.equal(travelTask(state,state.goal.id).nodes.find(n=>n.id==='card')!.status,'blocked');
 state.accountSnapshots=[];assert.equal(travelTask(state,state.goal.id).nodes.find(n=>n.id==='funds')!.status,'blocked');
});
