import test from 'node:test';
import assert from 'node:assert/strict';
import { consumerFixture, productMission, fundedConsumerFixture } from './product-mission.ts';
import { verifyAuditChain } from './governance.ts';

test('the consumer adapter uses the updated core without changing authoritative balances', async () => {
  const state = await consumerFixture();
  const view = productMission(state);
  assert.equal(view.rows.length, 186);
  assert.equal(state.finance.checkingCents, 724000);
  assert.equal(state.goal.savedCents, 200000);
  assert.equal(view.brief.totalExpenseCents, 477800);
  assert.equal(view.snapshot.moneyMission?.billBrief?.totalExpenseCents,477800);
  assert.equal(view.forecast.minimumBalanceCents, 317200);
  assert.equal(view.plans[1].monthlyCents, 100000);
  assert.ok(verifyAuditChain(state.audit));
});
test('the funded trip is an explicit separate simulation opening, with no preselected payment result',async()=>{
  const state=await fundedConsumerFixture();
  assert.equal(state.finance.checkingCents,724000);assert.equal(state.goal.savedCents,800000);
  assert.equal(state.accounts.find(a=>a.id==='goal-wallet')!.balanceCents,800000);
  assert.equal(state.financialServices.bookings.length,0);assert.equal(state.financialServices.mandates.length,0);
  assert.equal(productMission(state).brief.totalExpenseCents,477800);
});
