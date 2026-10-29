import test from 'node:test';
import assert from 'node:assert/strict';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {initializeServices,executeServiceAction,describeServiceAction,reconcileServices} from './financial-services.ts';
import {DemoStateSchema} from '../shared/contracts.ts';
const base=()=>initializeServices(createJapanMoneyMissionFixture());
test('withdrawal is governed, idempotent and cannot later issue a card or move cash',()=>{
 const initial=base(),submitted=executeServiceAction(initial,{kind:'apply_card',product:'everyday_credit',requestedLimitCents:500000},'apply');
 assert.equal(submitted.financialServices.applications[0].status,'under_review');
 const action={kind:'withdraw_card_application',id:'apply'} as const;
 assert.match(describeServiceAction(submitted,action).label,/撤回/);
 const withdrawn=executeServiceAction(submitted,action,'withdraw');
 assert.equal(withdrawn.financialServices.applications[0].status,'withdrawn');
 assert.deepEqual(withdrawn.accounts,initial.accounts);assert.deepEqual(withdrawn.finance,initial.finance);
 assert.equal(executeServiceAction(withdrawn,action,'withdraw'),withdrawn);
 assert.equal(reconcileServices(withdrawn,'apply').financialServices.cards.length,initial.financialServices.cards.length);
 assert.throws(()=>describeServiceAction(withdrawn,action),/NOT_WITHDRAWABLE/);
 assert.ok(DemoStateSchema.safeParse(withdrawn).success);
});
test('unknown and approved applications cannot be withdrawn; approved limits and reasons are explicit',()=>{
 const initial=base();initial.financialServices.fault='timeout_after';
 const unknown=executeServiceAction(initial,{kind:'apply_card',product:'everyday_credit',requestedLimitCents:50000000},'apply');
 assert.throws(()=>describeServiceAction(unknown,{kind:'withdraw_card_application',id:'apply'}),/NOT_WITHDRAWABLE/);
 const approved=reconcileServices(unknown,'apply'),application=approved.financialServices.applications[0];
 assert.equal(application.status,'approved');assert.equal(application.approvedCents,initial.finance.monthlyIncomeCents*2);
 assert.match(application.decisionReason!,/低于申请值/);
 assert.throws(()=>describeServiceAction(approved,{kind:'withdraw_card_application',id:'apply'}),/NOT_WITHDRAWABLE/);
 assert.deepEqual(approved.accounts,initial.accounts);
});
