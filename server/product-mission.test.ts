import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProductPlanSelection, consumerFixture, productMission, fundedConsumerFixture } from './product-mission.ts';
import { verifyAuditChain } from './governance.ts';
import {snapshot} from './presentation.ts';
import {connectDataSources} from './data-connections.ts';
import { activatePlan } from './domain.ts';
import { createFixture } from './fixtures.ts';
import { applySpendingTrendDemo } from './risk.ts';

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
test('connection response retains the imported bill summary without changing its history',async()=>{
  const state=await consumerFixture();
  const connected=connectDataSources(state,['bank','wechat_pay','alipay']);
  const view=snapshot(connected.state);
  assert.equal(view.moneyMission?.billBrief?.totalExpenseCents,477800);
  assert.ok(view.moneyMission?.billBrief?.categories.length);
});
test('the funded trip is an explicit separate simulation opening, with no preselected payment result',async()=>{
  const state=await fundedConsumerFixture();
  assert.equal(state.finance.checkingCents,724000);assert.equal(state.goal.savedCents,800000);
  assert.equal(state.accounts.find(a=>a.id==='goal-wallet')!.balanceCents,800000);
  assert.equal(state.financialServices.bookings.length,0);assert.equal(state.financialServices.mandates.length,0);
  assert.equal(productMission(state).brief.totalExpenseCents,477800);
});
test('confirming a product plan makes the previous goal risk stale in the same state change',()=>{
  const risk = applySpendingTrendDemo(activatePlan(createFixture(), 'balanced')).state;
  const impactId = risk.pendingImpact!.id;
  const updated = applyProductPlanSelection(risk, { monthlyCents: 120000,
    firstMonthContributionCents: 180000 });
  assert.equal(updated.riskSignals.find(signal => signal.impactId === impactId)?.status, 'stale');
  assert.equal(updated.pendingImpact, null);
  assert.equal(updated.goal.monthlyContributionCents, 120000);
  assert.equal(updated.goal.firstMonthContributionCents, 180000);
  assert.equal(updated.twinVersion, risk.twinVersion + 1);
});
