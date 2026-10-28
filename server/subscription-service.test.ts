import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoStateSchema, ReceiptSchema, SubscriptionActionPreviewSchema, type DemoState } from '../shared/contracts.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { confirmApproval, createApprovalSnapshot, verifyAuditChain } from './governance.ts';
import { executeSubscriptionCancellation, prepareSubscriptionAction, reconcileSubscriptionCancellation,
  subscriptionSavingsEligible } from './subscription-service.ts';

function fixture(behavior = 'succeeded'): DemoState {
  return DemoStateSchema.parse({ ...createJapanMoneyMissionFixture(), subscriptionMerchants: [{
    subscriptionId: 'cloudbox-plus', merchantId: 'cloudbox-plus', monthlyCents: 6800,
    paidThrough: '2026-11-04', effectiveAt: '2026-11-05', renewalEnabled: true,
    cancellationBehavior: behavior, status: 'active', operationId: null, cancelledAt: null,
  }] });
}
function approved(behavior = 'succeeded') {
  const base = fixture(behavior);
  const preview = prepareSubscriptionAction(base, { subscriptionId: 'cloudbox-plus', action: 'cancel' });
  const prepared = { ...base, subscriptionActions: [preview.action] };
  const created = createApprovalSnapshot(prepared, 'execute_subscription_cancellation',
    preview.approvalParameters!, '2026-10-26T12:05:00.000Z');
  const confirmation = confirmApproval(created.state, created.approval.id, created.approval.snapshotHash);
  return { state: confirmation.state, input: { actionId: preview.action.id, approvalToken: confirmation.token }, preview };
}

test('cancellation preview binds exact frozen terms and changes no merchant or forecast', () => {
  const base = fixture(); const before = structuredClone(base);
  const preview = prepareSubscriptionAction(base, { subscriptionId: 'cloudbox-plus', action: 'cancel' });
  assert.ok(SubscriptionActionPreviewSchema.safeParse(preview).success);
  assert.equal(preview.action.status, 'awaiting_confirmation');
  assert.equal(preview.action.nextChargeSuppressed, false);
  assert.deepEqual(preview.approvalParameters, { subscriptionId: 'cloudbox-plus', merchantId: 'cloudbox-plus',
    monthlyCents: 6800, paidThrough: '2026-11-04', effectiveAt: '2026-11-05', twinVersion: 1,
    actionHash: preview.action.actionHash });
  assert.equal(preview.verifiedMonthlySavingsCents, 0);
  assert.equal(preview.potentialMonthlySavingsCents, 6800);
  assert.match(preview.consequences.join(' '), /2026-11-04/);
  assert.match(preview.consequences.join(' '), /不退款/);
  assert.deepEqual(base, before);
});

test('keep, renewal reminder and not-subscription choices never reach the merchant simulator', () => {
  for (const action of ['keep', 'remind', 'not_subscription'] as const) {
    const base = fixture(); const before = structuredClone(base);
    const preview = prepareSubscriptionAction(base, { subscriptionId: 'cloudbox-plus', action });
    assert.equal(preview.action.status, 'succeeded');
    assert.equal(preview.action.nextChargeSuppressed, false);
    assert.equal(preview.approvalParameters, null);
    assert.equal(preview.verifiedMonthlySavingsCents, 0);
    assert.equal(preview.action.reminderAt, action === 'remind' ? '2026-11-04' : null);
    assert.throws(() => executeSubscriptionCancellation({ ...base, subscriptionActions: [preview.action] },
      { actionId: preview.action.id, approvalToken: 'missing' }), /SUBSCRIPTION_NOT_CANCELLATION/);
    assert.deepEqual(base, before);
  }
});

test('rejecting the subscription classification prevents further cancellation preparation', () => {
  const base = fixture();
  const rejected = prepareSubscriptionAction(base, { subscriptionId: 'cloudbox-plus', action: 'not_subscription' });
  assert.throws(() => prepareSubscriptionAction({ ...base, subscriptionActions: [rejected.action] },
    { subscriptionId: 'cloudbox-plus', action: 'cancel' }), /SUBSCRIPTION_CLASSIFICATION_REJECTED/);
});

test('rejecting a classification also blocks an earlier pending cancellation', () => {
  const { state, input } = approved();
  const rejected = prepareSubscriptionAction(state, { subscriptionId: 'cloudbox-plus', action: 'not_subscription' });
  assert.throws(() => executeSubscriptionCancellation({ ...state,
    subscriptionActions: [...state.subscriptionActions, rejected.action] }, input), /SUBSCRIPTION_CLASSIFICATION_REJECTED/);
});

test('verified CloudBox cancellation suppresses only future renewal with a merchant-backed receipt', () => {
  const { state, input } = approved(); const before = structuredClone(state);
  const result = executeSubscriptionCancellation(state, input);
  assert.equal(result.action.status, 'succeeded');
  assert.equal(result.action.paidThrough, '2026-11-04');
  assert.equal(result.action.effectiveAt, '2026-11-05');
  assert.equal(result.action.nextChargeSuppressed, true);
  assert.equal(result.action.refundCents, 0);
  assert.equal(result.state.subscriptionMerchants[0].renewalEnabled, false);
  assert.equal(result.state.subscriptions[0].status, 'cancelled');
  assert.equal(subscriptionSavingsEligible(result.state, result.action.id), true);
  assert.equal(result.state.finance.checkingCents, 724000);
  assert.equal(result.state.goal.savedCents, 200000);
  assert.deepEqual(result.state.transactions, state.transactions);
  assert.deepEqual(result.state.bills, state.bills);
  assert.equal(result.state.approvals[0].status, 'consumed');
  assert.equal(result.state.twinVersion, 2);
  assert.equal(result.receipt?.merchantOperationId, result.action.merchantOperationId);
  assert.equal(result.receipt?.cancelledAt, '2026-10-26T12:00:00.000Z');
  assert.equal(result.receipt?.nextChargeSuppressed, true);
  assert.equal(result.receipt?.paidThrough, '2026-11-04');
  assert.equal(result.receipt?.effectiveAt, '2026-11-05');
  assert.equal(result.receipt?.refundCents, 0);
  assert.ok(ReceiptSchema.safeParse(result.receipt).success);
  assert.deepEqual(result.state.audit.map(event => event.action), ['permission', 'risk', 'execute', 'verify', 'audit']);
  assert.ok(verifyAuditChain(result.state.audit));
  assert.deepEqual(state, before);
});

test('replayed cancellation returns the original result without duplicate merchant operation, receipt or audit', () => {
  const { state, input } = approved(); const result = executeSubscriptionCancellation(state, input);
  const replay = executeSubscriptionCancellation(result.state, input);
  assert.deepEqual(replay, result);
  assert.equal(replay.state.receipts.length, 1);
  assert.throws(() => executeSubscriptionCancellation(result.state, { ...input, approvalToken: 'someone-else' }),
    /APPROVAL_TOKEN_INVALID/);
  assert.throws(() => prepareSubscriptionAction(result.state, { subscriptionId: 'cloudbox-plus', action: 'cancel' }),
    /SUBSCRIPTION_ALREADY_CANCELLED/);
});

test('stale approvals and every changed bound cancellation term fail before merchant execution', () => {
  const { state, input } = approved();
  assert.throws(() => executeSubscriptionCancellation({ ...state, twinVersion: 2 }, input), /TWIN_VERSION_CHANGED/);
  assert.throws(() => executeSubscriptionCancellation(state, { ...input, approvalToken: 'missing' }), /APPROVAL_TOKEN_INVALID/);
  assert.throws(() => executeSubscriptionCancellation({ ...state, clock: '2026-10-27' }, input), /APPROVAL_EXPIRED/);
  for (const change of [{ subscriptionId: 'different' }, { merchantId: 'different' }, { monthlyCents: 6900 },
    { effectiveAt: '2026-11-06' }, { paidThrough: '2026-11-03' }, { twinVersion: 2 }, { actionHash: 'tampered' }]) {
    const altered = { ...state, subscriptionActions: state.subscriptionActions.map(a => ({ ...a, ...change })) };
    assert.throws(() => executeSubscriptionCancellation(altered, input));
  }
  assert.equal(state.subscriptionMerchants[0].operationId, null);
  assert.equal(state.approvals[0].status, 'confirmed');
});

test('merchant term changes are rejected even when the Twin version was not bumped', () => {
  const { state, input } = approved();
  for (const change of [{ monthlyCents: 6900 }, { paidThrough: '2026-11-03' }, { effectiveAt: '2026-11-06' },
    { merchantId: 'other' }]) {
    assert.throws(() => executeSubscriptionCancellation({ ...state,
      subscriptionMerchants: state.subscriptionMerchants.map(m => ({ ...m, ...change })) }, input),
    /SUBSCRIPTION_TERMS_CHANGED/);
  }
});

test('failed and merchant-only responses retain renewal, consume approval, and never count savings', () => {
  for (const behavior of ['failed', 'requires_merchant']) {
    const { state, input } = approved(behavior); const result = executeSubscriptionCancellation(state, input);
    assert.equal(result.action.status, behavior);
    assert.equal(result.action.nextChargeSuppressed, false);
    assert.equal(result.receipt, null);
    assert.equal(result.state.subscriptions[0].status, 'active');
    assert.equal(result.state.subscriptionMerchants[0].renewalEnabled, true);
    assert.equal(result.state.approvals[0].status, 'consumed');
    assert.equal(subscriptionSavingsEligible(result.state, result.action.id), false);
    assert.deepEqual(executeSubscriptionCancellation(result.state, input), result);
  }
});

test('unknown cancellation retains forecast charge until status query reconciles merchant success', () => {
  const { state, input } = approved('unknown'); const result = executeSubscriptionCancellation(state, input);
  assert.equal(result.action.status, 'unknown');
  assert.equal(result.action.nextChargeSuppressed, false);
  assert.equal(result.state.subscriptions[0].status, 'active');
  assert.equal(result.receipt, null);
  assert.equal(subscriptionSavingsEligible(result.state, result.action.id), false);
  assert.throws(() => executeSubscriptionCancellation(result.state, input), /SUBSCRIPTION_STATUS_REQUIRED/);
  assert.throws(() => prepareSubscriptionAction(result.state, { subscriptionId: 'cloudbox-plus', action: 'cancel' }),
    /SUBSCRIPTION_STATUS_REQUIRED/);
  const reconciled = reconcileSubscriptionCancellation(result.state, result.action.id);
  assert.equal(reconciled.action.status, 'reconciled');
  assert.equal(reconciled.action.nextChargeSuppressed, true);
  assert.equal(reconciled.action.merchantOperationId, result.action.merchantOperationId);
  assert.equal(reconciled.state.subscriptions[0].status, 'cancelled');
  assert.equal(subscriptionSavingsEligible(reconciled.state, result.action.id), true);
  assert.equal(reconciled.state.receipts.length, 1);
  assert.deepEqual(reconcileSubscriptionCancellation(reconciled.state, result.action.id), reconciled);
  assert.equal(executeSubscriptionCancellation(reconciled.state, input).receipt?.operationId,
    reconciled.state.receipts[0].operationId);
  assert.ok(verifyAuditChain(reconciled.state.audit));
});

test('a pending merchant status cannot manufacture success or authorize a duplicate cancellation', () => {
  const { state, input } = approved('pending'); const result = executeSubscriptionCancellation(state, input);
  const queried = reconcileSubscriptionCancellation(result.state, result.action.id);
  assert.equal(queried.action.status, 'unknown');
  assert.equal(subscriptionSavingsEligible(queried.state, queried.action.id), false);
  assert.equal(queried.state.receipts.length, 0);
  assert.throws(() => executeSubscriptionCancellation(queried.state, input), /SUBSCRIPTION_STATUS_REQUIRED/);
  assert.deepEqual(reconcileSubscriptionCancellation(queried.state, queried.action.id), queried);
});

test('a status query resolving unknown to failure permits a new independently approved attempt', () => {
  const { state, input } = approved('pending'); const uncertain = executeSubscriptionCancellation(state, input);
  const settled = { ...uncertain.state, subscriptionMerchants: uncertain.state.subscriptionMerchants.map(m =>
    ({ ...m, status: 'failed' as const, cancellationBehavior: 'succeeded' as const })) };
  const queried = reconcileSubscriptionCancellation(settled, uncertain.action.id);
  assert.equal(queried.action.status, 'failed');
  assert.equal(queried.state.receipts.length, 0);
  const preview = prepareSubscriptionAction(queried.state, { subscriptionId: 'cloudbox-plus', action: 'cancel' });
  const prepared = { ...queried.state, subscriptionActions: [...queried.state.subscriptionActions, preview.action] };
  assert.throws(() => executeSubscriptionCancellation(prepared, { actionId: preview.action.id,
    approvalToken: input.approvalToken }), /APPROVAL_TOKEN_INVALID/);
  const created = createApprovalSnapshot(prepared, 'execute_subscription_cancellation', preview.approvalParameters!,
    '2026-10-26T12:05:00.000Z');
  const confirmed = confirmApproval(created.state, created.approval.id, created.approval.snapshotHash);
  const retried = executeSubscriptionCancellation(confirmed.state, { actionId: preview.action.id, approvalToken: confirmed.token });
  assert.equal(retried.action.status, 'succeeded');
  assert.notEqual(retried.action.merchantOperationId, uncertain.action.merchantOperationId);
  assert.equal(retried.state.receipts.length, 1);
});

test('verified action flags alone never override merchant authority or a changed amount', () => {
  const { state, input } = approved(); const result = executeSubscriptionCancellation(state, input);
  assert.equal(subscriptionSavingsEligible({ ...result.state, subscriptionMerchants: [] }, result.action.id), false);
  assert.equal(subscriptionSavingsEligible({ ...result.state, subscriptionMerchants:
    result.state.subscriptionMerchants.map(m => ({ ...m, renewalEnabled: true })) }, result.action.id), false);
  assert.equal(subscriptionSavingsEligible({ ...result.state, subscriptions:
    result.state.subscriptions.map(s => ({ ...s, monthlyCents: 7800 })) }, result.action.id), false);
});

for (const status of ['cancelled', 'failed', 'requires_merchant'] as const) {
  test(`reconciliation to ${status} links verification and audit to the original governed operation without duplicate evidence`, () => {
    const { state, input } = approved(status === 'cancelled' ? 'unknown' : 'pending');
    const uncertain = executeSubscriptionCancellation(state, input);
    const settled = { ...uncertain.state, subscriptionMerchants: uncertain.state.subscriptionMerchants.map(merchant =>
      ({ ...merchant, status })) };
    const result = reconcileSubscriptionCancellation(settled, uncertain.action.id);
    const verification = result.state.audit.slice(uncertain.state.audit.length);
    assert.deepEqual(verification.map(event => event.action), ['verify', 'audit']);
    assert.equal(verification[0].outcome, status === 'cancelled' ? 'reconciled' : status);
    assert.ok(result.state.audit.every(event => event.operationId === uncertain.action.merchantOperationId
      && event.requestId === uncertain.action.id && event.approvalId === state.approvals[0].id));
    assert.equal(result.state.audit.filter(event => event.action === 'permission').length, 1);
    assert.equal(result.state.audit.filter(event => event.action === 'risk').length, 1);
    assert.equal(result.state.audit.filter(event => event.action === 'execute').length, 1);
    assert.equal(result.state.approvals[0].status, 'consumed');
    assert.deepEqual(result.state.subscriptionMerchants, settled.subscriptionMerchants);
    assert.ok(verifyAuditChain(result.state.audit));
    assert.deepEqual(reconcileSubscriptionCancellation(result.state, uncertain.action.id), result);
    assert.deepEqual(executeSubscriptionCancellation(result.state, input).state, result.state);
    assert.equal(result.state.receipts.length, status === 'cancelled' ? 1 : 0);
  });
}
