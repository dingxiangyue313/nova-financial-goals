import test from 'node:test';
import assert from 'node:assert/strict';
import { consumerFixture, productMission } from './product-mission.ts';
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
