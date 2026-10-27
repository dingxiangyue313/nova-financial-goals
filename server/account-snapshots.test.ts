import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAccountSnapshot } from './account-snapshots.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
test('confirmed balance snapshot changes only the specified eligible account', () => {
  const state = createJapanMoneyMissionFixture();
  const next = applyAccountSnapshot(state, { accountId: 'checking', balanceCents: 800000, currency: 'CNY', asOf: state.clock });
  assert.equal(next.finance.checkingCents, 800000); assert.equal(next.goal.savedCents, 200000);
  assert.equal(next.finance.emergencyCents, 2000000); assert.equal(next.approvals.at(-1)!.status, 'consumed');
  assert.throws(() => applyAccountSnapshot(state, { accountId: 'goal-wallet', balanceCents: 90000, currency: 'CNY', asOf: state.clock }), /CHECKING_ONLY/);
  assert.throws(() => applyAccountSnapshot(state, { accountId: 'checking', balanceCents: 800000, currency: 'CNY', asOf: '2028-01-01' }), /FUTURE/);
});
