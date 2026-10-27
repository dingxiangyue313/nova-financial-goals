import test from 'node:test';
import assert from 'node:assert/strict';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { prepareAccountSnapshot } from './account-snapshots.ts';
import { executeWorkspaceAction } from './workspace.ts';
import { createAgentThread, getAgentAction, mutateState } from './store.ts';
import { parseStatementBuffer } from './statement-parser.ts';
import { previewStatementImport, commitStatementImport } from './statement-import.ts';
import { verifyAuditChain } from './governance.ts';

function setup() {
  const id = crypto.randomUUID(); const state = mutateState(id, () => createJapanMoneyMissionFixture());
  const thread = createAgentThread(id, { title: 'Snapshot confirmation' });
  const input = { accountId: 'checking', balanceCents: 800000, currency: 'CNY' as const, asOf: '2026-10-26' };
  return { id, state, thread, input };
}

test('statement text mentioning balance never creates or changes an account snapshot', async () => {
  const state = createJapanMoneyMissionFixture();
  const parsed = await parseStatementBuffer({ buffer: Buffer.from('date,description,amount\n2026-10-26,balance 999999,999999'),
    fileName: 'balance.csv', mimeType: 'text/csv', templateId: 'bank-csv-v1' });
  const preview = previewStatementImport(state, parsed);
  const committed = commitStatementImport(preview.state, preview.batch.id, 1, preview.contentHash);
  assert.deepEqual(committed.accountSnapshots, state.accountSnapshots);
  assert.deepEqual(committed.accounts, state.accounts);
});

test('confirmed snapshot updates only the named simulated checking account and is replay safe', () => {
  const { id, state, thread, input } = setup();
  const prepared = prepareAccountSnapshot(id, thread.id, input, state);
  assert.equal(getAgentAction(id, prepared.actionId).actionType, 'confirm_account_snapshot');
  assert.equal(state.finance.checkingCents, 724000);
  const result = executeWorkspaceAction(id, prepared.actionId, 'confirm', state);
  assert.equal(result.state.finance.checkingCents, 800000);
  assert.equal(result.state.accounts[0].balanceCents, 800000);
  assert.deepEqual(result.state.accounts.slice(1), state.accounts.slice(1));
  assert.deepEqual(result.state.goal, state.goal);
  assert.equal(result.state.twinVersion, 2);
  assert.equal(result.state.accountSnapshots.at(-1)?.sourceKind, 'user_confirmed');
  assert.equal(result.state.accountSnapshots.at(-1)?.balanceCents, 800000);
  assert.equal(verifyAuditChain(result.state.audit), true);
  assert.deepEqual(result.state.audit.slice(-5).map(x => x.action), ['permission', 'risk', 'execute', 'verify', 'audit']);
  const replay = executeWorkspaceAction(id, prepared.actionId, 'confirm', result.state);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.state, result.state);
});

test('cancelling and stale Twin confirmations leave account authority unchanged', () => {
  const { id, state, thread, input } = setup();
  const cancel = prepareAccountSnapshot(id, thread.id, input, state);
  assert.deepEqual(executeWorkspaceAction(id, cancel.actionId, 'cancel', state).state, state);
  assert.throws(() => executeWorkspaceAction(id, cancel.actionId, 'confirm', state), /AGENT_ACTION_NOT_PENDING/);
  const stale = prepareAccountSnapshot(id, thread.id, input, state);
  const changed = { ...state, twinVersion: 2 };
  const result = executeWorkspaceAction(id, stale.actionId, 'confirm', changed);
  assert.deepEqual(result.state, changed);
  assert.equal(getAgentAction(id, stale.actionId).status, 'cancelled');
});

test('snapshot preparation rejects goal wallet changes, malformed money and foreign threads/actions', () => {
  const { id, state, thread, input } = setup(); const foreign = setup();
  assert.throws(() => prepareAccountSnapshot(id, thread.id, { ...input, accountId: 'goal-wallet' }, state), /ACCOUNT_SNAPSHOT_GOAL_WALLET/);
  assert.throws(() => prepareAccountSnapshot(id, thread.id, { ...input, balanceCents: 1.5 }, state));
  assert.throws(() => prepareAccountSnapshot(id, foreign.thread.id, input, state), /THREAD_NOT_FOUND/);
  const action = prepareAccountSnapshot(id, thread.id, input, state);
  assert.throws(() => executeWorkspaceAction(foreign.id, action.actionId, 'confirm', foreign.state), /AGENT_ACTION_NOT_FOUND/);
});
