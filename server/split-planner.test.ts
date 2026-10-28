import test from 'node:test';
import assert from 'node:assert/strict';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {initializeServices,executeServiceAction,describeServiceAction,collectSplit,reconcileServices,validateServiceBalances} from './financial-services.ts';
import {DemoStateSchema,type DemoState} from '../shared/contracts.ts';
import {verifyAuditChain} from './governance.ts';
const action={kind:'split' as const,totalCents:39801,participantIds:['self','contact-1','contact-2','contact-3'],accountId:'checking',alreadyPaid:true,dueDate:'2026-11-05'};
const base=()=>initializeServices(createJapanMoneyMissionFixture());
function apply(state:DemoState,raw:unknown,id:string){const next=executeServiceAction(state,raw,id);validateServiceBalances(state,next);assert.ok(verifyAuditChain(next.audit));return next;}
test('custom AA is exact to the cent and invalid membership or total cannot change cash',()=>{
 const state=base(),shares=[{recipientId:'self',amountCents:10000},{recipientId:'contact-1',amountCents:0},{recipientId:'contact-2',amountCents:9801},{recipientId:'contact-3',amountCents:20000}];
 const before=structuredClone(state);
 const next=apply(state,{...action,shares},'custom');
 assert.deepEqual(next.financialServices.splits[0].shares.map(s=>s.amountCents),[10000,0,9801,20000]);
 assert.deepEqual(next.finance,state.finance);
 const collected=collectSplit(next,'custom');assert.equal(collectSplit(collected,'custom'),collected,'zero shares cannot produce repeated collection events or version changes');
 for(const malformed of [shares.slice(1),[...shares.slice(0,3),shares[0]],shares.map((s,i)=>i===0?{...s,amountCents:10001}:s),shares.map((s,i)=>i===0?{...s,amountCents:-1}:s)])assert.throws(()=>describeServiceAction(state,{...action,shares:malformed}));
 assert.deepEqual(state,before);
});
test('other payer creates only a liability and collection queries never credit the current user',()=>{
 const state=base(),next=apply(state,{...action,payerId:'contact-1'},'other');
 assert.deepEqual(next.finance,state.finance);assert.deepEqual(next.accounts,state.accounts);
 assert.equal(collectSplit(next,'other'),next);
 assert.throws(()=>describeServiceAction(state,{...action,payerId:'contact-1',alreadyPaid:false}),/OTHER_PAYER_NOT_PAID/);
 const paid=apply(next,{kind:'pay_split_share',id:'other',accountId:'checking'},'pay');
 assert.equal(paid.finance.checkingCents,next.finance.checkingCents-9951);
 assert.equal(paid.financialServices.splits[0].shares.find(s=>s.recipientId==='self')!.collectedCents,9951);
 assert.equal(executeServiceAction(paid,{kind:'pay_split_share',id:'other',accountId:'checking'},'pay'),paid);
 assert.throws(()=>describeServiceAction(paid,{kind:'pay_split_share',id:'other',accountId:'checking'}),/NOT_PAYABLE/);
 assert.ok(DemoStateSchema.safeParse(paid).success);
});
test('unknown AA share payments block retries and close until original-provider reconciliation',()=>{
 for(const fault of ['timeout_before','timeout_after'] as const){
  const start=apply(base(),{...action,payerId:'contact-1'},'other');start.financialServices.fault=fault;
  const pending=apply(start,{kind:'pay_split_share',id:'other',accountId:'checking'},'pay');
  assert.deepEqual(pending.finance,start.finance);
  assert.throws(()=>describeServiceAction(pending,{kind:'pay_split_share',id:'other',accountId:'checking'}),/STATUS_REQUIRED/);
  assert.throws(()=>describeServiceAction(pending,{kind:'close_split',id:'other'}),/STATUS_REQUIRED/);
  const final=reconcileServices(pending,'pay');validateServiceBalances(pending,final);
  assert.equal(final.finance.checkingCents,start.finance.checkingCents-(fault==='timeout_after'?9951:0));
  assert.equal(final.financialServices.splits[0].shares.find(s=>s.recipientId==='self')!.collectedCents,fault==='timeout_after'?9951:0);
  assert.equal(reconcileServices(final,'pay'),final);
 }
});
test('closing a partially collected custom split preserves actual receipts and never credits outstanding money',()=>{
 const start=apply(base(),action,'self-payer'),partial=collectSplit(start,'self-payer');
 const next=apply(partial,{kind:'close_split',id:'self-payer'},'close');
 assert.deepEqual(next.finance,partial.finance);assert.deepEqual(next.financialServices.splits[0].shares,partial.financialServices.splits[0].shares);
 assert.equal(collectSplit(next,'self-payer'),next);assert.throws(()=>describeServiceAction(next,{kind:'pay_split_share',id:'self-payer',accountId:'checking'}),/NOT_PAYABLE/);
});
