import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { initializeServices, executeServiceAction, describeServiceAction, reconcileServices, collectSplit, requestTravelQuotes, financialServicesView, validateServiceBalances, nextTradingDay } from './financial-services.ts';
import { verifyAuditChain } from './governance.ts';
import type { DemoState } from '../shared/contracts.ts';

function apply(s:DemoState,action:unknown,id:string=randomUUID()) { const next=executeServiceAction(s,action,id);validateServiceBalances(s,next);assert.ok(verifyAuditChain(next.audit));return next; }
function base(){return initializeServices(createJapanMoneyMissionFixture());}
function funded(){const s=base();s.accounts.find(a=>a.id==='goal-wallet')!.balanceCents=800000;s.goal.savedCents=800000;s.goals=[s.goal];s.financialServices.allocations[0].amountCents=800000;s.accountSnapshots.find(x=>x.accountId==='goal-wallet')!.balanceCents=800000;s.financialServices.cards.find(c=>c.id==='card-travel')!.online=true;s.financialServices.cards.find(c=>c.id==='card-travel')!.overseas=true;return s;}
function authorized(s:DemoState){s=requestTravelQuotes(s);return apply(s,{kind:'mandate',goalId:s.goal.id,accountId:'goal-wallet',maxPerOrderCents:300000,totalCents:500000,merchants:['air-demo','stay-demo'],expiresAt:new Date(Date.now()+86400000).toISOString()},'mandate');}
function booking(s:DemoState){return {kind:'book',quoteIds:s.financialServices.quotes.slice(-2).map(q=>q.id),accountId:'goal-wallet',cardId:'card-travel',goalId:s.goal.id,mandateId:'mandate'};}

test('a new purchase cannot borrow the unlocked holding period of older shares',()=>{
  let s=apply(base(),{kind:'risk_profile',level:2,tolerateLoss:true,useByDate:'2027-09-30'});
  s=apply(s,{kind:'buy',productId:'steady',accountId:'checking',amountCents:10000},'first-lot');
  s.clock='2026-10-27';s=reconcileServices(s,'first-lot');
  s.clock='2026-11-05';s.accountSnapshots=s.accountSnapshots.map(x=>({...x,asOf:s.clock}));
  s=apply(s,{kind:'buy',productId:'steady',accountId:'checking',amountCents:10000},'second-lot');
  s.clock='2026-11-06';s=reconcileServices(s,'second-lot');
  assert.throws(()=>describeServiceAction(s,{kind:'redeem',productId:'steady',accountId:'checking',quantityMicro:s.financialServices.positions[0].quantityMicro}),/POSITION_LOCKED/);
});

test('unknown original transfers reconcile across a financial date change without fresh authority or replay',()=>{
  let s=base();s.financialServices.fault='timeout_after';
  s=apply(s,{kind:'transfer',recipientId:'contact-1',recipientVersion:1,accountId:'checking',amountCents:30000},'cross-day');
  assert.equal(s.finance.checkingCents,724000);s.clock='2026-10-27';
  assert.throws(()=>describeServiceAction(s,{kind:'transfer',recipientId:'contact-2',recipientVersion:1,accountId:'checking',amountCents:1}),/BALANCE_STALE/);
  const settled=reconcileServices(s,'cross-day');validateServiceBalances(s,settled);
  assert.equal(settled.finance.checkingCents,694000);assert.deepEqual(reconcileServices(settled,'cross-day'),settled);
});

test('contacts are explicit and immutable; transfer debits once and preserves protected funds',()=>{
  const s=base(),input={kind:'transfer',recipientId:'contact-1',recipientVersion:1,accountId:'checking',amountCents:30000};
  assert.throws(()=>describeServiceAction(s,{...input,recipientVersion:2}),/RECIPIENT_CHANGED/);
  assert.throws(()=>describeServiceAction(s,{...input,amountCents:400000}),/INSUFFICIENT/);
  const next=apply(s,input,'transfer');assert.equal(next.finance.checkingCents,694000);assert.equal(next.finance.emergencyCents,2000000);
  assert.deepEqual(executeServiceAction(next,input,'transfer'),next);
  assert.equal(next.financialServices.journals.reduce((n,j)=>n+j.amountCents,0),0);
});
test('AA allocates the last cent exactly and collections are scoped and idempotent',()=>{
  let s=apply(base(),{kind:'split',totalCents:39801,participantIds:['self','contact-1','contact-2','contact-3'],accountId:'checking',alreadyPaid:true,dueDate:'2026-11-01'},'aa');
  assert.deepEqual(s.financialServices.splits[0].shares.map(x=>x.amountCents),[9951,9950,9950,9950]);assert.equal(s.finance.checkingCents,724000);
  s=collectSplit(s,'aa');assert.equal(s.finance.checkingCents,743900);assert.equal(s.financialServices.splits[0].status,'partial');
  assert.deepEqual(collectSplit(s,'aa'),s);assert.throws(()=>collectSplit(s,'foreign'),/NOT_FOUND/);
  s=apply(s,{kind:'close_split',id:'aa'});assert.deepEqual(collectSplit(s,'aa'),s);
});
test('investment suitability rejects missing, loss-intolerant and short-horizon profiles',()=>{
  const buy={kind:'buy',productId:'liquid',accountId:'checking',amountCents:100000};let s=base();
  assert.throws(()=>describeServiceAction(s,buy),/RISK_PROFILE_REQUIRED/);
  s=apply(s,{kind:'risk_profile',level:1,tolerateLoss:false,useByDate:'2027-09-30'});
  assert.throws(()=>describeServiceAction(s,buy),/NOT_SUITABLE/);
  s=apply(s,{kind:'risk_profile',level:2,tolerateLoss:true,useByDate:'2026-11-01'});
  assert.throws(()=>describeServiceAction(s,{...buy,productId:'term90'}),/NOT_SUITABLE/);
  assert.throws(()=>describeServiceAction(s,{...buy,productId:'paused'}),/PAUSED/);
});
test('purchase and redemption have separate cash, shares and T+1 settlement',()=>{
  let s=apply(base(),{kind:'risk_profile',level:2,tolerateLoss:true,useByDate:'2027-09-30'});
  s=apply(s,{kind:'buy',productId:'liquid',accountId:'checking',amountCents:100000},'buy');
  assert.equal(s.finance.checkingCents,624000);assert.equal(s.financialServices.positions.length,0);assert.equal(s.financialServices.investments[0].status,'pending');
  assert.deepEqual(reconcileServices(s,'buy'),s);s.clock='2026-10-27';s=reconcileServices(s,'buy');
  assert.equal(s.financialServices.positions[0].quantityMicro,'1000000000');assert.deepEqual(reconcileServices(s,'buy'),s);
  s=apply(s,{kind:'redeem',productId:'liquid',accountId:'checking',quantityMicro:'100000000'},'redeem');
  assert.equal(s.finance.checkingCents,624000);assert.equal(s.financialServices.positions[0].reservedMicro,'100000000');
  s.clock='2026-10-28';s=reconcileServices(s,'redeem');assert.equal(s.finance.checkingCents,634000);assert.equal(s.financialServices.positions[0].quantityMicro,'900000000');assert.deepEqual(reconcileServices(s,'redeem'),s);
  assert.equal(nextTradingDay('2026-10-30'),'2026-11-02');
});
test('redemption fee uses integer micro-shares and exposes only unreserved valuation',()=>{
  let s=base();s.financialServices.positions.push({productId:'steady',quantityMicro:'5000000000',reservedMicro:'0',acquiredOn:'2026-10-01'});
  s=apply(s,{kind:'redeem',productId:'steady',accountId:'checking',quantityMicro:'1500000000'},'fee');
  assert.equal(s.financialServices.investments[0].amountCents,149700);assert.equal(s.financialServices.investments[0].feeCents,300);
  assert.equal(financialServicesView(s).positions[0].valueCents,350000);
  assert.throws(()=>describeServiceAction(s,{kind:'redeem',productId:'steady',accountId:'checking',quantityMicro:'4000000000'}),/INSUFFICIENT_SHARES/);
});
test('cards support application, limits, controls, locks and irreversible loss without creating cash',()=>{
  let s=apply(base(),{kind:'apply_card',product:'everyday_credit',requestedLimitCents:1000000},'app');assert.equal(s.financialServices.applications[0].status,'under_review');
  s=reconcileServices(s,'app');assert.equal(s.financialServices.applications[0].status,'approved');assert.deepEqual(reconcileServices(s,'app'),s);
  const before=s.finance.checkingCents;s=apply(s,{kind:'card',id:'card-credit',action:'limit',limitCents:1500000});assert.equal(s.finance.checkingCents,before);
  s=apply(s,{kind:'card',id:'card-travel',action:'lock'});s=apply(s,{kind:'card',id:'card-travel',action:'unlock'});s=apply(s,{kind:'card',id:'card-travel',action:'lost'});
  assert.throws(()=>describeServiceAction(s,{kind:'card',id:'card-travel',action:'unlock'}),/CARD_LOST/);
});
test('signed quotes enforce fees, expiry, card rules and exact mandate scope',()=>{
  let s=authorized(funded());const input=booking(s);assert.equal(s.financialServices.quotes.reduce((n,q)=>n+q.totalCents,0),500000);
  const invalid=structuredClone(s);invalid.financialServices.quotes[0].totalCents--;assert.throws(()=>describeServiceAction(invalid,input),/SIGNATURE/);
  assert.throws(()=>describeServiceAction(s,input,Date.now()+16*60000),/QUOTE_EXPIRED/);
  s=apply(s,{kind:'card',id:'card-travel',action:'lock'});assert.throws(()=>describeServiceAction(s,input),/PAYMENT_BLOCKED/);
});
test('partial bookings preserve successful money and maintain goal coverage after paying',()=>{
  let s=authorized(funded());s.financialServices.fault='partial';s=apply(s,booking(s),'book');
  assert.equal(s.goal.savedCents,520000);assert.deepEqual(s.financialServices.bookings.map(b=>b.status),['confirmed','failed']);
  assert.equal(s.financialServices.holds.filter(h=>h.status==='active').length,0);
  const g=financialServicesView(s).goals[0];assert.equal(g.coveredCents,800000);assert.equal(g.bookedCents,280000);assert.equal(g.bookingReady,false);
  assert.deepEqual(executeServiceAction(s,booking(s),'book'),s);
  s=apply(s,{kind:'cancel_booking',id:s.financialServices.bookings[0].id},'refund');assert.equal(s.goal.savedCents,520000);assert.equal(financialServicesView(s).goals[0].coveredCents,520000);
  s.clock='2026-10-27';s=reconcileServices(s);assert.equal(s.goal.savedCents,800000);assert.deepEqual(reconcileServices(s),s);
});
for(const fault of ['timeout_before','timeout_after'] as const)test(`${fault}: uncertain bookings hold funds and reconcile without duplicate payment`,()=>{
  let s=authorized(funded());s.financialServices.fault=fault;s=apply(s,booking(s),'unknown');
  assert.equal(s.goal.savedCents,800000);assert.equal(financialServicesView(s).accounts.find(a=>a.id==='goal-wallet')!.availableCents,300000);
  s=reconcileServices(s,'unknown');assert.equal(s.goal.savedCents,fault==='timeout_after'?300000:800000);assert.deepEqual(reconcileServices(s,'unknown'),s);
});
test('mandate edits cannot erase spent/reserved money, revoke stops new orders only',()=>{
  let s=authorized(funded());s.financialServices.fault='timeout_after';s=apply(s,booking(s),'hold');
  const m=s.financialServices.mandates[0];assert.throws(()=>describeServiceAction(s,{kind:'mandate',id:m.id,goalId:m.goalId,accountId:m.accountId,maxPerOrderCents:300000,totalCents:400000,merchants:m.merchants,expiresAt:m.expiresAt}),/MANDATE_SCOPE/);
  s=apply(s,{kind:'revoke_mandate',id:m.id});assert.equal(s.financialServices.holds.filter(h=>h.status==='active').length,2);
  s=reconcileServices(s,'hold');assert.equal(s.goal.savedCents,300000);
});
test('global balance guard blocks legacy tools spending reserved cash',()=>{
  const old=authorized(funded());old.financialServices.fault='timeout_after';const held=apply(old,booking(old),'held');
  const bad=structuredClone(held);bad.accounts.find(a=>a.id==='goal-wallet')!.balanceCents=100000;
  assert.throws(()=>validateServiceBalances(held,bad),/RESERVED_FUNDS/);
});
