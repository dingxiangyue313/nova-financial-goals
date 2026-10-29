import test from 'node:test';
import assert from 'node:assert/strict';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {initializeServices,executeServiceAction,describeServiceAction,reconcileServices,validateServiceBalances,financialServicesView} from './financial-services.ts';
import {DemoStateSchema} from '../shared/contracts.ts';
import {serviceIssues} from './service-monitor.ts';
const base=()=>initializeServices(createJapanMoneyMissionFixture());
test('replacement preserves lost card, uses same account, starts locked and cannot duplicate or create cash',()=>{
 let state=executeServiceAction(base(),{kind:'card',id:'card-travel',action:'lost'},'lost');const before=structuredClone(state);
 const next=executeServiceAction(state,{kind:'replace_card',id:'card-travel'},'replace');validateServiceBalances(state,next);
 assert.deepEqual(next.accounts,before.accounts);assert.deepEqual(next.finance,before.finance);assert.equal(next.financialServices.cards.find(c=>c.id==='card-travel')!.status,'lost');
 const card=next.financialServices.cards.find(c=>c.id==='replacement:replace')!;assert.equal(card.accountId,'goal-wallet');assert.equal(card.status,'locked');assert.equal(card.online,false);assert.equal(card.overseas,false);
 assert.throws(()=>describeServiceAction(next,{kind:'replace_card',id:'card-travel'}),/REPLACEMENT_EXISTS/);
 assert.equal(executeServiceAction(next,{kind:'replace_card',id:'card-travel'},'replace'),next);
 assert.throws(()=>describeServiceAction(next,{kind:'card',id:'card-travel',action:'unlock'}),/CARD_LOST/);
 const unlocked=executeServiceAction(next,{kind:'card',id:card.id,action:'unlock'},'unlock');assert.equal(unlocked.financialServices.cards.find(c=>c.id===card.id)!.online,false);
 assert.ok(DemoStateSchema.safeParse(unlocked).success);
});
test('unknown card changes block mutation until original query and preserve provider outcome without replay',()=>{
 for(const fault of ['timeout_before','timeout_after'] as const){
  const state=base();state.financialServices.fault=fault;
  const pending=executeServiceAction(state,{kind:'card',id:'card-main',action:'lock'},'lock');
  assert.equal(pending.financialServices.receipts.at(-1)!.status,'unknown');assert.equal(serviceIssues(pending).some(i=>i.sourceId==='lock'),true);
  assert.throws(()=>describeServiceAction(pending,{kind:'card',id:'card-main',action:'limit',limitCents:10000}),/STATUS_REQUIRED/);
  const resolved=reconcileServices(pending,'lock');assert.equal(resolved.financialServices.cards.find(c=>c.id==='card-main')!.status,fault==='timeout_after'?'locked':'active');
  assert.equal(resolved.financialServices.receipts.at(-1)!.status,fault==='timeout_after'?'succeeded':'failed');assert.equal(reconcileServices(resolved,'lock'),resolved);
  assert.deepEqual(resolved.finance,state.finance);assert.deepEqual(resolved.accounts,state.accounts);
 }
});
test('lost replacement unknown does not issue twice; declined or unsubmitted requests permit a new independent attempt',()=>{
 for(const fault of ['timeout_before','timeout_after','decline'] as const){
  let state=executeServiceAction(base(),{kind:'card',id:'card-travel',action:'lost'},'lost');state.financialServices.fault=fault;
  const pending=executeServiceAction(state,{kind:'replace_card',id:'card-travel'},'replace');
  if(fault!=='decline')assert.throws(()=>describeServiceAction(pending,{kind:'replace_card',id:'card-travel'}),/REPLACEMENT_EXISTS/);
  if(fault==='timeout_after')assert.throws(()=>describeServiceAction(pending,{kind:'card',id:'replacement:replace',action:'unlock'}),/STATUS_REQUIRED/);
  const resolved=reconcileServices(pending,'replace');
  assert.equal(resolved.financialServices.cards.length,fault==='timeout_after'?4:3);
  if(fault!=='timeout_after')assert.doesNotThrow(()=>describeServiceAction(resolved,{kind:'replace_card',id:'card-travel'}));
 }
});
test('application unknown queries original accepted or unaccepted state without duplicate cards',()=>{
 for(const fault of ['timeout_before','timeout_after','decline'] as const){
  const state=base();state.financialServices.fault=fault;
  const pending=executeServiceAction(state,{kind:'apply_card',product:'travel_debit',requestedLimitCents:100000},'apply');
  if(fault!=='decline')assert.throws(()=>describeServiceAction(pending,{kind:'apply_card',product:'travel_debit',requestedLimitCents:100000}),/APPLICATION_PENDING/);
  const resolved=reconcileServices(pending,'apply');assert.equal(resolved.financialServices.cards.length,fault==='timeout_after'?4:3);
  assert.equal(resolved.financialServices.applications[0].status,fault==='timeout_after'?'approved':'rejected');
  assert.equal(reconcileServices(resolved,'apply'),resolved);assert.deepEqual(resolved.finance,state.finance);
  assert.equal('providerAccepted' in financialServicesView(resolved).applications[0],false);
 }
});
