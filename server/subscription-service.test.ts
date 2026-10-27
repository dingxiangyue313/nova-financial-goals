import test from 'node:test';
import assert from 'node:assert/strict';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { prepareSubscriptionAction, executeSubscriptionCancellation, reconcileSubscriptionCancellation, subscriptionSavingsEligible } from './subscription-service.ts';
import { confirmApproval } from './governance.ts';

test('only exact approved verified merchant cancellation suppresses future charges', () => {
  const initial = createJapanMoneyMissionFixture();
  const preview = prepareSubscriptionAction(initial, { subscriptionId: 'cloudbox', action: 'cancel' });
  assert.throws(() => executeSubscriptionCancellation(preview.state, { actionId: preview.action.id, approvalToken: 'fake' }), /APPROVAL_TOKEN/);
  const approved = confirmApproval(preview.state, preview.action.approvalId!, preview.action.snapshotHash!);
  const result = executeSubscriptionCancellation(approved.state, { actionId: preview.action.id, approvalToken: approved.token });
  assert.equal(result.action.status, 'succeeded'); assert.equal(result.action.paidThrough, '2026-11-04');
  assert.equal(result.action.effectiveAt, '2026-11-05'); assert.equal(result.action.refundCents, 0);
  assert.equal(subscriptionSavingsEligible(result.state, result.action.id), true);
  assert.equal(result.receipt!.status, 'succeeded');
  assert.deepEqual(executeSubscriptionCancellation(result.state, { actionId: result.action.id, approvalToken: approved.token }).state, result.state);
});
test('timeout, merchant handling and denial do not fabricate savings; query resolves committed unknown safely', () => {
  for (const outcome of ['unknown', 'unknown_committed', 'failed', 'requires_merchant'] as const) {
    const preview = prepareSubscriptionAction(createJapanMoneyMissionFixture(), { subscriptionId: 'cloudbox', action: 'cancel' });
    const approved = confirmApproval(preview.state, preview.action.approvalId!, preview.action.snapshotHash!);
    const result = executeSubscriptionCancellation(approved.state, { actionId: preview.action.id, approvalToken: approved.token }, outcome);
    assert.equal(subscriptionSavingsEligible(result.state, result.action.id), false);
    if (outcome.startsWith('unknown')) {
      assert.throws(() => prepareSubscriptionAction(result.state, { subscriptionId: 'cloudbox', action: 'cancel' }), /RECONCILE/);
      const query = reconcileSubscriptionCancellation(result.state, result.action.id);
      assert.equal(query.action.nextChargeSuppressed, outcome === 'unknown_committed');
    }
  }
  for (const action of ['keep', 'remind', 'not_subscription'] as const) {
    const prepared = prepareSubscriptionAction(createJapanMoneyMissionFixture(), { subscriptionId: 'cloudbox', action });
    assert.equal(prepared.state.approvals.length, 0); assert.equal(prepared.action.merchantOperationId, null);
  }
});
