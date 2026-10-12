import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from './fixtures.ts';
import {
  appendAuditEvent,
  confirmApproval,
  consumeApproval,
  createApprovalSnapshot,
  financialTwin,
  verifyAuditChain,
} from './governance.ts';
import { artifactCounts, mutateState, resetState, storedAuditChain } from './store.ts';

test('financial twin exposes one versioned source for balances and goals', () => {
  const twin = financialTwin(createFixture());
  assert.equal(twin.version, 1);
  assert.equal(twin.accounts.find(account => account.id === 'checking')?.balanceCents, 500000);
  assert.equal(twin.accounts.find(account => account.id === 'emergency')?.protected, true);
  assert.equal(twin.goals[0].id, 'goal-japan-2026');
  assert.equal(twin.snapshotId, 'twin-1-2026-09-21');
});

test('approval snapshot binds exact parameters and consumes its token once', () => {
  const base = createFixture();
  const created = createApprovalSnapshot(base, 'activate_goal', {
    goalId: base.goal.id,
    planId: 'balanced',
    twinVersion: 1,
  }, '2026-09-22T00:00:00.000Z');
  const confirmed = confirmApproval(created.state, created.approval.id, created.approval.snapshotHash);
  const consumed = consumeApproval(confirmed.state, confirmed.token, 'activate_goal', {
    goalId: base.goal.id,
    planId: 'balanced',
    twinVersion: 1,
  });
  assert.equal(consumed.approvals[0].status, 'consumed');
  assert.throws(() => consumeApproval(consumed, confirmed.token, 'activate_goal', {
    goalId: base.goal.id,
    planId: 'balanced',
    twinVersion: 1,
  }), /APPROVAL_TOKEN_INVALID/);
  assert.throws(() => consumeApproval(confirmed.state, confirmed.token, 'activate_goal', {
    goalId: base.goal.id,
    planId: 'accelerated',
    twinVersion: 1,
  }), /APPROVAL_PARAMETERS_CHANGED/);
});

test('approval becomes invalid when the financial twin version changes', () => {
  const base = createFixture();
  const created = createApprovalSnapshot(base, 'activate_goal', {
    goalId: base.goal.id,
    planId: 'balanced',
    twinVersion: 1,
  }, '2026-09-22T00:00:00.000Z');
  const confirmed = confirmApproval(created.state, created.approval.id, created.approval.snapshotHash);
  assert.throws(() => consumeApproval({ ...confirmed.state, twinVersion: 2 }, confirmed.token,
    'activate_goal', { goalId: base.goal.id, planId: 'balanced', twinVersion: 1 }), /TWIN_VERSION_CHANGED/);
});

test('approval rejects expired snapshots and wrong actions', () => {
  const base = createFixture();
  const expired = createApprovalSnapshot(base, 'activate_goal', { planId: 'balanced' }, '2026-09-21T11:59:59.000Z');
  assert.throws(() => confirmApproval(expired.state, expired.approval.id, expired.approval.snapshotHash), /APPROVAL_EXPIRED/);
  const valid = createApprovalSnapshot(base, 'activate_goal', { planId: 'balanced' }, '2026-09-21T12:05:00.000Z');
  const confirmed = confirmApproval(valid.state, valid.approval.id, valid.approval.snapshotHash);
  assert.throws(() => consumeApproval(confirmed.state, confirmed.token, 'execute_transfer', { planId: 'balanced' }), /APPROVAL_PARAMETERS_CHANGED/);
});

test('audit events form a hash chain and tampering is detectable', () => {
  const first = appendAuditEvent(createFixture(), 'approval_viewed', 'pending', 'approval-1');
  const second = appendAuditEvent(first, 'approval_confirmed', 'approved', 'approval-1');
  assert.equal(second.audit.length, 2);
  assert.equal(second.audit[1].previousHash, second.audit[0].eventHash);
  assert.equal(verifyAuditChain(second.audit), true);
  const tampered = second.audit.map((event, index) => index === 0 ? { ...event, detail: 'changed' } : event);
  assert.equal(verifyAuditChain(tampered), false);
});

test('approval and nonce artifacts persist in dedicated session tables', () => {
  const sessionId = `governance-${crypto.randomUUID()}`;
  resetState(sessionId);
  mutateState(sessionId, state => {
    const created = createApprovalSnapshot(state, 'activate_goal', {
      goalId: state.goal.id, planId: 'balanced', twinVersion: state.twinVersion,
    }, '2026-09-22T00:00:00.000Z');
    return appendAuditEvent({ ...created.state, consumedNonces: ['nonce-1234567890'] }, 'persistence_check', 'ok', '证据链持久化');
  });
  assert.deepEqual(artifactCounts(sessionId), { approvals: 1, nonces: 1, operations: 0, receipts: 0 });
  const events = storedAuditChain(sessionId);
  assert.equal(events[0].sequence, 1);
  assert.equal(events[0].previousHash, 'GENESIS');
  assert.match(events[0].eventHash, /^[0-9a-f]{64}$/);
});
