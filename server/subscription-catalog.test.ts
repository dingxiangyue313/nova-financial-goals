import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoStateSchema,type DemoState} from '../shared/contracts.ts';
import {subscriptionChargeDates} from '../shared/subscription-cycle.ts';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {addSubscriptionSamples,subscriptionReminders,subscriptionDisputes} from './subscription-catalog.ts';
import {previewStatementImport,commitStatementImport} from './statement-import.ts';
import {buildDatedCashflowForecast} from './cashflow-forecast.ts';
import {prepareSubscriptionAction,executeSubscriptionCancellation,reconcileSubscriptionCancellation,persistSubscriptionDecision,subscriptionSavingsEligible} from './subscription-service.ts';
import {createApprovalSnapshot,confirmApproval,verifyAuditChain} from './governance.ts';

function cancel(state:DemoState,id:string){
 const preview=prepareSubscriptionAction(state,{subscriptionId:id,action:'cancel'});
 const created=createApprovalSnapshot({...state,subscriptionActions:[...state.subscriptionActions,preview.action]},'execute_subscription_cancellation',preview.approvalParameters!,state.clock+'T12:05:00.000Z');
 const confirmed=confirmApproval(created.state,created.approval.id,created.approval.snapshotHash);
 return executeSubscriptionCancellation(confirmed.state,{actionId:preview.action.id,approvalToken:confirmed.token});
}
test('twelve subscription samples are additive, replay-safe and preserve baseline funds and history',()=>{
 const base=createJapanMoneyMissionFixture(),state=addSubscriptionSamples(base);
 assert.equal(state.subscriptions.length,12);assert.ok(DemoStateSchema.safeParse(state).success);
 assert.deepEqual(state.finance,base.finance);assert.deepEqual(state.accounts,base.accounts);assert.deepEqual(state.normalizedStatementRows,base.normalizedStatementRows);
 assert.equal(addSubscriptionSamples(state),state);assert.equal(verifyAuditChain(state.audit),true);
 const news=state.subscriptionActions.find(a=>a.subscriptionId==='newsbrief')!;
 assert.ok(subscriptionSavingsEligible(state,news.id));
});
test('annual charges remain whole, once-only charges never recur and cancellation keeps already paid service',()=>{
 const base=addSubscriptionSamples(createJapanMoneyMissionFixture());
 const forecast=buildDatedCashflowForecast(base,{accountId:'checking',horizonEnd:'2027-10-26',scenario:'baseline'});
 const annual=forecast.events.filter(e=>e.sourceRefs.includes('moviepass'));
 assert.deepEqual(annual.map(e=>[e.date,e.amountCents]),[['2026-11-05',-19800]]);
 assert.equal(forecast.events.filter(e=>e.sourceRefs.includes('travelsim')).length,1);
 assert.equal(forecast.events.filter(e=>e.sourceRefs.includes('newsbrief')).length,0);
 const cancelled=cancel(base,'moviepass');assert.equal(cancelled.action.status,'succeeded');
 assert.equal(cancelled.receipt?.refundCents,0);assert.equal(cancelled.action.paidThrough,'2026-11-04');
 assert.equal(buildDatedCashflowForecast(cancelled.state,{accountId:'checking',horizonEnd:'2027-10-26',scenario:'baseline'}).events.filter(e=>e.sourceRefs.includes('moviepass')).length,0);
 assert.deepEqual(cancelled.state.finance,base.finance);
});
test('annual leap date stays anchored and modified annual price invalidates prior approval',()=>{
 const base=addSubscriptionSamples(createJapanMoneyMissionFixture()),item=base.subscriptions.find(s=>s.id==='moviepass')!;
 assert.deepEqual(subscriptionChargeDates({...item,nextChargeDate:'2024-02-29'},'2028-03-01'),['2024-02-29','2025-02-28','2026-02-28','2027-02-28','2028-02-29']);
 const preview=prepareSubscriptionAction(base,{subscriptionId:item.id,action:'cancel'});
 const created=createApprovalSnapshot({...base,subscriptionActions:[...base.subscriptionActions,preview.action]},'execute_subscription_cancellation',preview.approvalParameters!,'2026-10-26T12:05:00.000Z');
 const confirmed=confirmApproval(created.state,created.approval.id,created.approval.snapshotHash);
 assert.throws(()=>executeSubscriptionCancellation({...confirmed.state,subscriptions:confirmed.state.subscriptions.map(s=>s.id===item.id?{...s,chargeCents:19900}:s)},{actionId:preview.action.id,approvalToken:confirmed.token}),/SUBSCRIPTION_TERMS_CHANGED/);
});
test('rejection, manual handling, pre-submit failure and lost response retain distinct recovery semantics',()=>{
 for(const [id,status] of [['gameclub','failed'],['fitspace','requires_merchant'],['learnnow','failed'],['designkit','unknown']] as const){
  const base=addSubscriptionSamples(createJapanMoneyMissionFixture()),result=cancel(base,id);
  assert.equal(result.action.status,status);assert.equal(subscriptionSavingsEligible(result.state,result.action.id),false);
  assert.deepEqual(result.state.finance,base.finance);
  if(id==='learnnow')assert.equal(result.action.merchantOperationId,null);
  if(id==='designkit'){
   assert.throws(()=>prepareSubscriptionAction(result.state,{subscriptionId:id,action:'cancel'}),/STATUS_REQUIRED/);
   const recovered=reconcileSubscriptionCancellation(result.state,result.action.id);
   assert.equal(recovered.action.status,'reconciled');assert.ok(subscriptionSavingsEligible(recovered.state,recovered.action.id));
   assert.equal(recovered.action.merchantOperationId,result.action.merchantOperationId);
  }
 }
});
test('reminders survive state serialization, become due by date and stop after a later local decision',()=>{
 const base=addSubscriptionSamples(createJapanMoneyMissionFixture());
 const choice=prepareSubscriptionAction(base,{subscriptionId:'moviepass',action:'remind'}).action;
 const stored=persistSubscriptionDecision(base,choice);
 assert.equal(subscriptionReminders(DemoStateSchema.parse(JSON.parse(JSON.stringify(stored))))[0].status,'scheduled');
 const due={...stored,clock:'2026-11-04'};assert.equal(subscriptionReminders(due)[0].status,'due');
 const keep=prepareSubscriptionAction(due,{subscriptionId:'moviepass',action:'keep'}).action;
 assert.equal(subscriptionReminders(persistSubscriptionDecision(due,keep)).length,0);
 const rejected=prepareSubscriptionAction(base,{subscriptionId:'shoppattern',action:'not_subscription'}).action;
 assert.throws(()=>prepareSubscriptionAction(persistSubscriptionDecision(base,rejected),{subscriptionId:'shoppattern',action:'cancel'}),/CLASSIFICATION_REJECTED/);
});
test('new charges after verified cancellation create evidence-linked disputes without invented refunds',()=>{
 const cancelled=cancel(addSubscriptionSamples(createJapanMoneyMissionFixture()),'devstudio');
 const state={...cancelled.state,clock:'2026-11-06'};
 const preview=previewStatementImport(state,{templateId:'bank-csv-v1',format:'csv',accountId:'checking',sourceKind:'bank',confidence:1,issues:[],rows:[{
   rowNumber:1,date:'2026-11-05',rawDescription:'DevStudio',amountCents:-3900,category:'subscriptions',merchantId:'devstudio',confidence:1,originalValues:{date:'2026-11-05',description:'DevStudio',amount:'-39'},issues:[],
 }]});
 const committed=commitStatementImport(preview.state,preview.batch.id,preview.state.twinVersion,preview.contentHash);
 const disputes=subscriptionDisputes(committed);
 assert.equal(disputes.length,1);assert.equal(disputes[0].amountCents,3900);assert.ok(disputes[0].evidenceId.startsWith('evidence-'));
 assert.deepEqual(committed.finance,state.finance);assert.deepEqual(subscriptionDisputes(committed),disputes);
 assert.equal(committed.receipts.filter(r=>r.tool==='execute_subscription_cancellation').length,state.receipts.filter(r=>r.tool==='execute_subscription_cancellation').length);
});
