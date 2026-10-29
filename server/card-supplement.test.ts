import test from 'node:test';
import assert from 'node:assert/strict';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {initializeServices,executeServiceAction,describeServiceAction,reconcileServices} from './financial-services.ts';
import {DemoStateSchema} from '../shared/contracts.ts';
import {ServiceActionSchema} from '../shared/financial-services.ts';
import {serviceIssues} from './service-monitor.ts';
const base=()=>initializeServices(createJapanMoneyMissionFixture());
const apply={kind:'apply_card',product:'everyday_credit',requestedLimitCents:500000,employmentEvidence:'missing'} as const;
const supplement={kind:'supplement_card_application',id:'apply',employment:'synthetic_freelance',acknowledged:true} as const;
test('missing synthetic evidence blocks approval; supplement reuses application and needs a later review',()=>{
 const initial=base(),pending=executeServiceAction(initial,apply,'apply');
 const missing=reconcileServices(pending,'apply');assert.equal(missing.financialServices.applications[0].status,'needs_information');assert.equal(missing.financialServices.cards.length,initial.financialServices.cards.length);
 assert.ok(serviceIssues(missing).some(i=>i.sourceId==='apply'&&i.title.includes('补充')));
 assert.equal(reconcileServices(missing,'apply'),missing);assert.throws(()=>describeServiceAction(missing,apply),/APPLICATION_PENDING/);
 const prepared=describeServiceAction(missing,supplement);assert.deepEqual(prepared.state.accounts,missing.accounts);
 const submitted=executeServiceAction(missing,supplement,'supplement');assert.equal(submitted.financialServices.applications.length,1);assert.equal(submitted.financialServices.applications[0].status,'under_review');
 assert.equal(submitted.financialServices.cards.length,initial.financialServices.cards.length);assert.equal(executeServiceAction(submitted,supplement,'supplement'),submitted);
 const approved=reconcileServices(submitted,'supplement');assert.equal(approved.financialServices.applications[0].status,'approved');assert.equal(approved.financialServices.cards.length,initial.financialServices.cards.length+1);
 assert.equal(approved.financialServices.receipts.find(r=>r.operationId==='supplement')!.status,'succeeded');assert.deepEqual(approved.accounts,initial.accounts);assert.deepEqual(approved.finance,initial.finance);assert.ok(DemoStateSchema.safeParse(approved).success);
 assert.equal(reconcileServices(approved,'apply'),approved);assert.throws(()=>describeServiceAction(approved,supplement),/NOT_AWAITING_INFORMATION/);
});
test('missing evidence can be withdrawn; unknown provider must resolve before supplementation',()=>{
 const missing=reconcileServices(executeServiceAction(base(),apply,'apply'),'apply');
 const withdrawn=executeServiceAction(missing,{kind:'withdraw_card_application',id:'apply'},'withdraw');assert.equal(withdrawn.financialServices.applications[0].status,'withdrawn');assert.throws(()=>describeServiceAction(withdrawn,supplement),/NOT_AWAITING_INFORMATION/);
 const initial=base();initial.financialServices.fault='timeout_after';const unknown=executeServiceAction(initial,apply,'apply');assert.throws(()=>describeServiceAction(unknown,supplement),/NOT_AWAITING_INFORMATION/);assert.equal(reconcileServices(unknown,'apply').financialServices.applications[0].status,'needs_information');
 assert.equal(ServiceActionSchema.safeParse({...supplement,acknowledged:false}).success,false);assert.equal(ServiceActionSchema.safeParse({...supplement,employment:'real_identity_upload'}).success,false);
});
