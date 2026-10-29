import test from 'node:test';import assert from 'node:assert/strict';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';import {consumerFixture} from './product-mission.ts';import {aaCatalogFixture,aaCases} from './aa-catalog.ts';
import {initializeServices,executeServiceAction,reconcileServices,requestTravelQuotes,validateServiceBalances} from './financial-services.ts';import {signProviderEvent,applyProviderEvent} from './provider-events.ts';import {DemoStateSchema} from '../shared/contracts.ts';import type {ProviderEvent} from '../shared/financial-services.ts';
const base=()=>{const s=initializeServices(createJapanMoneyMissionFixture());s.financialServices.risk={level:4,tolerateLoss:true,useByDate:'2027-09-30',expiresOn:'2027-01-01'};return s;};
const apply=(s:ReturnType<typeof base>,event:ProviderEvent,session='a')=>applyProviderEvent(s,session,event,signProviderEvent(session,event));
test('T-A05 twelve AA cases conserve cents, duplicate receipts once, overdue not cash and close retains collection',async()=>{
 const initial=await consumerFixture(),s=aaCatalogFixture(initial),d=s.financialServices;assert.equal(s.finance.checkingCents,initial.finance.checkingCents+40000);assert.equal(aaCases.length,12);assert.equal(d.splits.length,12);for(const split of d.splits)assert.equal(split.shares.reduce((n,p)=>n+p.amountCents,0),split.totalCents);
 const odd=d.splits.find(s=>s.id==='aa-sample-odd')!;assert.deepEqual(odd.shares.map(p=>p.amountCents),[9951,9950,9950,9950]);
 const duplicate=d.splits.find(s=>s.id==='aa-sample-duplicate')!;assert.equal(duplicate.shares.reduce((n,p)=>n+(p.recipientId==='self'?0:p.collectedCents),0),20000);assert.equal(d.journals.filter(j=>j.operationId===duplicate.id&&j.accountId==='checking').reduce((n,j)=>n+j.amountCents,0),20000);
 const closed=d.splits.find(s=>s.id==='aa-sample-closed-partial')!;assert.equal(closed.status,'closed');assert.equal(closed.shares[1].collectedCents,10000);assert.equal(d.splits.find(s=>s.id==='aa-sample-overdue')!.dueDate<s.clock,true);
 assert.equal(d.journals.filter(j=>j.operationId==='aa-sample-overdue').length,0);assert.equal(d.splits.find(s=>s.id==='aa-sample-settled')!.status,'collected');assert.equal(d.journals.filter(j=>j.operationId==='aa-sample-paynow'&&j.amountCents<0).length,1);assert.ok(DemoStateSchema.safeParse(s).success);
});
test('W-A08 revisioned investment events never settle pending early or replay cash/shares and survive serialized restore',()=>{
 let s=executeServiceAction(base(),{kind:'buy',productId:'liquid',accountId:'checking',amountCents:10000},'buy');
 const e:ProviderEvent={id:'pending',provider:'nova-sim-provider',domain:'investment',subjectId:'buy',revision:2,status:'pending',reportedOn:s.clock};s=apply(s,e);s.clock=s.financialServices.investments[0].settlesOn;assert.equal(reconcileServices(s,'buy'),s);assert.equal(s.financialServices.positions.length,0);
 const old={...e,id:'older',revision:1,status:'failed' as const};s=apply(s,old);assert.equal(s.financialServices.providerEventLog.at(-1)!.outcome,'stale');
 const settled={...e,id:'settled',revision:3,status:'settled' as const,reportedOn:s.clock};const before=s;s=apply(s,settled);validateServiceBalances(before,s);assert.equal(s.financialServices.positions[0].quantityMicro,'100000000');const restored=DemoStateSchema.parse(JSON.parse(JSON.stringify(s)));assert.equal(apply(restored,settled),restored);
 const regressed=apply(restored,{...settled,id:'late-pending',revision:4,status:'pending'});assert.equal(regressed.financialServices.investments[0].status,'settled');assert.deepEqual(regressed.accounts,restored.accounts);assert.equal(regressed.financialServices.providerEventLog.at(-1)!.outcome,'terminal_ignored');
 assert.throws(()=>applyProviderEvent(s,'other',settled,signProviderEvent('a',settled)),/SIGNATURE_INVALID/);assert.throws(()=>apply(s,{...settled,status:'failed'}),/EVENT_CONFLICT/);
});
test('W-A08 rejected and unknown investment events refund once; delayed settlement cannot resurrect rejection',()=>{
 const initial=base();initial.financialServices.fault='timeout_after';let s=executeServiceAction(initial,{kind:'buy',productId:'liquid',accountId:'checking',amountCents:10000},'buy');
 const event:ProviderEvent={id:'reject',provider:'nova-sim-provider',domain:'investment',subjectId:'buy',revision:2,status:'failed',reportedOn:s.clock};s=apply(s,event);assert.deepEqual(s.accounts,initial.accounts);assert.equal(apply(s,event),s);s=apply(s,{...event,id:'older-success',revision:1,status:'settled'});assert.equal(s.financialServices.investments[0].status,'failed');assert.equal(s.financialServices.positions.length,0);
});
test('Q-A05 order event is original-only, signed, monotonic and idempotent despite higher-version regression',()=>{
 let s=base();s=executeServiceAction(s,{kind:'card',id:'card-travel',action:'controls',online:true,overseas:true},'controls');s=requestTravelQuotes(s);const q=s.financialServices.quotes[1];s=executeServiceAction(s,{kind:'mandate',goalId:s.goal.id,accountId:'goal-wallet',maxPerOrderCents:300000,totalCents:300000,merchants:['stay-demo'],expiresAt:new Date(Date.now()+86400000).toISOString()},'mandate');
 // The original wallet needs enough for the signed hotel quote: use the already funded synthetic opening.
 s.accounts.find(a=>a.id==='goal-wallet')!.balanceCents=300000;s.financialServices.allocations.find(a=>a.accountId==='goal-wallet')!.amountCents=300000;s.accountSnapshots=s.accountSnapshots.map(a=>a.accountId==='goal-wallet'?{...a,balanceCents:300000}:a);s.financialServices.fault='timeout_after';
 s=executeServiceAction(s,{kind:'book',quoteIds:[q.id],goalId:s.goal.id,accountId:'goal-wallet',cardId:'card-travel',mandateId:'mandate'},'booking');
 const event:ProviderEvent={id:'booking-confirmed',provider:'nova-sim-provider',domain:'booking',subjectId:'booking:0',revision:3,status:'confirmed',reportedOn:s.clock};const before=s;s=apply(s,event);validateServiceBalances(before,s);assert.equal(s.financialServices.bookings[0].payment,'captured');assert.equal(apply(s,event),s);const settled=structuredClone(s.accounts);s=DemoStateSchema.parse(JSON.parse(JSON.stringify(s)));
 s=apply(s,{...event,id:'old-decline',revision:2,status:'failed'});s=apply(s,{...event,id:'new-pending',revision:4,status:'pending'});assert.deepEqual(s.accounts,settled);assert.equal(s.financialServices.bookings[0].status,'confirmed');
 assert.throws(()=>apply(s,{...event,id:'unknown-order',subjectId:'foreign'}),/SUBJECT_NOT_FOUND/);assert.throws(()=>apply(s,{...event,id:'future',reportedOn:'2099-01-01'}),/EVENT_FUTURE/);
});

test('W-A08 redemption failure releases reserved shares once, and successful settlement credits once',()=>{
 let s=executeServiceAction(base(),{kind:'buy',productId:'liquid',accountId:'checking',amountCents:10000},'seed-buy');s.clock=s.financialServices.investments[0].settlesOn;s=reconcileServices(s,'seed-buy');const cash=s.accounts.find(a=>a.id==='checking')!.balanceCents;
 s.financialServices.fault='timeout_after';s=executeServiceAction(s,{kind:'redeem',productId:'liquid',accountId:'checking',quantityMicro:'50000000'},'redeem');
 const rejected:ProviderEvent={id:'redeem-failed',provider:'nova-sim-provider',domain:'investment',subjectId:'redeem',revision:2,status:'failed',reportedOn:s.clock};s=apply(s,rejected);assert.equal(s.financialServices.positions[0].reservedMicro,'0');assert.equal(s.financialServices.positions[0].quantityMicro,'100000000');assert.equal(s.accounts.find(a=>a.id==='checking')!.balanceCents,cash);assert.equal(apply(s,rejected),s);
 s=executeServiceAction(s,{kind:'redeem',productId:'liquid',accountId:'checking',quantityMicro:'50000000'},'redeem-new');s.clock=s.financialServices.investments.find(o=>o.id==='redeem-new')!.settlesOn;
 const success:ProviderEvent={...rejected,id:'redeem-settled',subjectId:'redeem-new',status:'settled',reportedOn:s.clock};s=apply(s,success);assert.equal(s.financialServices.positions[0].quantityMicro,'50000000');assert.equal(s.accounts.find(a=>a.id==='checking')!.balanceCents,cash+5000);assert.equal(apply(s,success),s);
 const later=apply(s,{...success,id:'redeem-late-failed',revision:3,status:'failed'});assert.deepEqual(later.accounts,s.accounts);assert.deepEqual(later.financialServices.positions,s.financialServices.positions);
});
test('valid pending/settled event permutations converge to one investment settlement',()=>{
 let original=executeServiceAction(base(),{kind:'buy',productId:'liquid',accountId:'checking',amountCents:10000},'permutation');original.clock=original.financialServices.investments[0].settlesOn;
 const pending:ProviderEvent={id:'permutation-pending',provider:'nova-sim-provider',domain:'investment',subjectId:'permutation',revision:1,status:'pending',reportedOn:original.clock},settled:ProviderEvent={...pending,id:'permutation-settled',revision:2,status:'settled'};
 for(const events of [[pending,settled],[settled,pending],[pending,settled,pending,settled],[settled,settled,pending]]){let s=structuredClone(original);for(const e of events)s=apply(s,e);assert.equal(s.financialServices.positions[0].quantityMicro,'100000000');assert.equal(s.financialServices.events.filter(e=>e==='settle:permutation').length,1);assert.deepEqual(s.accounts,original.accounts);}
});
