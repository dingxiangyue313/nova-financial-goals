import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyAccountSnapshot, prepareAccountSnapshot } from './account-snapshots.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { createAgentThread, getState, mutateState } from './store.ts';
import { executeWorkspaceAction } from './workspace.ts';

test('confirmed balance snapshot changes only the specified eligible account', () => {
  const state = createJapanMoneyMissionFixture();
  const next = applyAccountSnapshot(state, { accountId: 'checking', balanceCents: 800000, currency: 'CNY', asOf: state.clock });
  assert.equal(next.finance.checkingCents, 800000); assert.equal(next.goal.savedCents, 200000);
  assert.equal(next.finance.emergencyCents, 2000000); assert.equal(next.approvals.at(-1)!.status, 'consumed');
  assert.throws(() => applyAccountSnapshot(state, { accountId: 'goal-wallet', balanceCents: 90000, currency: 'CNY', asOf: state.clock }), /CHECKING_ONLY/);
  assert.throws(() => applyAccountSnapshot(state, { accountId: 'checking', balanceCents: 800000, currency: 'CNY', asOf: '2028-01-01' }), /FUTURE/);
});

test('snapshot confirmation is version-bound, cancellable and safe to replay', () => {
  const sessionId = randomUUID();
  const input = { accountId: 'checking', balanceCents: 800000, currency: 'CNY' as const, asOf: '2026-10-26' };
  mutateState(sessionId, () => createJapanMoneyMissionFixture());
  const thread = createAgentThread(sessionId, { title: '确认账户余额', kind: 'task' });
  const cancelledPrep = prepareAccountSnapshot(sessionId, thread.id, input, getState(sessionId));
  const cancelled = executeWorkspaceAction(sessionId, cancelledPrep.actionId, 'cancel', getState(sessionId));
  assert.equal(cancelled.state.finance.checkingCents, 724000);
  assert.equal(cancelled.state.goal.savedCents, 200000);

  const stalePrep = prepareAccountSnapshot(sessionId, thread.id, input, getState(sessionId));
  mutateState(sessionId, old => ({ ...old, twinVersion: old.twinVersion + 1 }));
  const stale = executeWorkspaceAction(sessionId, stalePrep.actionId, 'confirm', getState(sessionId));
  assert.equal(stale.state.finance.checkingCents, 724000);
  assert.equal(stale.state.accountSnapshots.filter(item => item.source === 'user_confirmed').length, 0);

  const ready = getState(sessionId);
  const fresh = prepareAccountSnapshot(sessionId, thread.id, input, ready);
  const applied = executeWorkspaceAction(sessionId, fresh.actionId, 'confirm', ready);
  assert.equal(applied.state.finance.checkingCents, 800000);
  assert.equal(applied.state.goal.savedCents, 200000);
  mutateState(sessionId, () => applied.state);
  const replay = executeWorkspaceAction(sessionId, fresh.actionId, 'confirm', getState(sessionId));
  assert.equal(replay.replayed, true);
  assert.equal(replay.state.finance.checkingCents, 800000);
});
