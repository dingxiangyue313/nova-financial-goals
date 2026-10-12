import test from 'node:test';
import assert from 'node:assert/strict';
import { activatePlan } from './domain.ts';
import { createFixture } from './fixtures.ts';
import { bankingToolDefinitions, runBankingTool } from './banking.ts';

test('tool discovery and read tools expose the same financial twin', () => {
  const names = new Set<string>(bankingToolDefinitions.map(tool => tool.name));
  for (const name of ['get_financial_snapshot', 'forecast_cashflow', 'prepare_transfer',
    'execute_transfer', 'quote_fx', 'create_mandate', 'export_audit_report']) assert.ok(names.has(name));
  const base = createFixture();
  const snapshot = runBankingTool(base, 'get_financial_snapshot', {});
  assert.equal(snapshot.result.version, 1);
  assert.equal(snapshot.result.accounts.length, 4);
  const forecast = runBankingTool(base, 'forecast_cashflow', { horizonDays: 30 });
  assert.equal(forecast.result.safeToSpendCents, 200000);
  assert.equal(forecast.result.protectedCents, 2000000);
});

test('transfer requires an immutable approval and is idempotent', () => {
  const base = activatePlan(createFixture(), 'balanced');
  const prepared = runBankingTool(base, 'prepare_transfer', {
    sourceAccountId: 'checking', destinationAccountId: 'goal-wallet', amountCents: 30000,
  });
  const draft = prepared.result;
  const snapshot = runBankingTool(prepared.state, 'create_approval_snapshot', {
    action: 'execute_transfer', parameters: { draftId: draft.draftId, snapshotId: draft.snapshotId },
  });
  const confirmed = runBankingTool(snapshot.state, 'confirm_approval', {
    approvalId: snapshot.result.approvalId, snapshotHash: snapshot.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const executed = runBankingTool(confirmed.state, 'execute_transfer', {
    draftId: draft.draftId, snapshotId: draft.snapshotId,
    approvalToken: confirmed.result.approvalToken, idempotencyKey: 'transfer-1',
  });
  assert.equal(executed.result.status, 'succeeded');
  assert.equal(executed.state.finance.checkingCents, 470000);
  assert.equal(executed.state.accounts.find(account => account.id === 'goal-wallet')?.balanceCents, 380000);
  assert.equal(executed.state.twinVersion, 2);
  const replay = runBankingTool(executed.state, 'execute_transfer', {
    draftId: draft.draftId, snapshotId: draft.snapshotId,
    approvalToken: confirmed.result.approvalToken, idempotencyKey: 'transfer-1',
  });
  assert.equal(replay.state.finance.checkingCents, 470000);
  assert.equal(replay.result.operationId, executed.result.operationId);
});

test('transfer blocks stale twin snapshots and protected funds', () => {
  const base = activatePlan(createFixture(), 'balanced');
  const prepared = runBankingTool(base, 'prepare_transfer', {
    sourceAccountId: 'checking', destinationAccountId: 'goal-wallet', amountCents: 30000,
  });
  const changed = { ...prepared.state, twinVersion: 2 };
  assert.throws(() => runBankingTool(changed, 'execute_transfer', {
    draftId: prepared.result.draftId, snapshotId: prepared.result.snapshotId,
    approvalToken: 'missing', idempotencyKey: 'stale',
  }), /TWIN_VERSION_CHANGED/);
  assert.throws(() => runBankingTool(base, 'prepare_transfer', {
    sourceAccountId: 'emergency', destinationAccountId: 'checking', amountCents: 10000,
  }), /PROTECTED_ACCOUNT/);
});

test('FX quote expires and an approved quote can execute', () => {
  const base = createFixture();
  const quoted = runBankingTool(base, 'quote_fx', { fromCurrency: 'CNY', toCurrency: 'JPY', amountCents: 10000 });
  const prepared = runBankingTool(quoted.state, 'prepare_fx_order', {
    quoteId: quoted.result.quoteId, sourceAccountId: 'checking', destinationAccountId: 'jpy-wallet',
  });
  const approval = runBankingTool(prepared.state, 'create_approval_snapshot', {
    action: 'execute_fx_order', parameters: { draftId: prepared.result.draftId, quoteId: quoted.result.quoteId },
  });
  const confirmed = runBankingTool(approval.state, 'confirm_approval', {
    approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const executed = runBankingTool(confirmed.state, 'execute_fx_order', {
    draftId: prepared.result.draftId, quoteId: quoted.result.quoteId,
    approvalToken: confirmed.result.approvalToken, idempotencyKey: 'fx-1',
  });
  assert.equal(executed.result.status, 'succeeded');
  assert.equal(executed.state.finance.checkingCents, 490000);
  const expired = { ...quoted.state, clock: '2026-09-22' };
  assert.throws(() => runBankingTool(expired, 'prepare_fx_order', {
    quoteId: quoted.result.quoteId, sourceAccountId: 'checking', destinationAccountId: 'jpy-wallet',
  }), /FX_QUOTE_EXPIRED/);
});

test('mandate lifecycle and audit export remain verifiable', () => {
  const base = activatePlan(createFixture(), 'balanced');
  const approval = runBankingTool(base, 'create_approval_snapshot', {
    action: 'create_mandate', parameters: {
      agentId: 'travel-agent-demo', category: 'transport', maxPerOperationCents: 50000,
      totalLimitCents: 120000, expiresAt: '2026-12-31',
    },
  });
  const confirmed = runBankingTool(approval.state, 'confirm_approval', {
    approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const created = runBankingTool(confirmed.state, 'create_mandate', {
    agentId: 'travel-agent-demo', category: 'transport', maxPerOperationCents: 50000,
    totalLimitCents: 120000, expiresAt: '2026-12-31', approvalToken: confirmed.result.approvalToken,
  });
  assert.equal(created.state.mandate?.active, true);
  const updateParameters = { mandateId: created.result.mandateId, category: 'transport', maxPerOperationCents: 45000,
    totalLimitCents: 100000, expiresAt: '2026-12-20' };
  const updateApproval = runBankingTool(created.state, 'create_approval_snapshot', {
    action: 'update_mandate', parameters: updateParameters, expiresInSeconds: 300,
  });
  const updateConfirmed = runBankingTool(updateApproval.state, 'confirm_approval', {
    approvalId: updateApproval.result.approvalId, snapshotHash: updateApproval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const updated = runBankingTool(updateConfirmed.state, 'update_mandate', {
    ...updateParameters, approvalToken: updateConfirmed.result.approvalToken,
  });
  assert.equal(updated.state.mandate?.version, 2);
  const pauseApproval = runBankingTool(updated.state, 'create_approval_snapshot', {
    action: 'pause_mandate', parameters: { mandateId: created.result.mandateId }, expiresInSeconds: 300,
  });
  const pauseConfirmed = runBankingTool(pauseApproval.state, 'confirm_approval', {
    approvalId: pauseApproval.result.approvalId, snapshotHash: pauseApproval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const paused = runBankingTool(pauseConfirmed.state, 'pause_mandate', {
    mandateId: created.result.mandateId, approvalToken: pauseConfirmed.result.approvalToken,
  });
  assert.equal(paused.state.mandate?.active, false);
  assert.equal(paused.state.mandate?.version, 3);
  const report = runBankingTool(paused.state, 'export_audit_report', { format: 'json' });
  assert.equal(report.result.chainValid, true);
  assert.ok(report.result.content.includes('mandate_paused'));
});

test('goal writes share the same twin version and require explicit activation approval', () => {
  const base = createFixture();
  const created = runBankingTool(base, 'create_goal', {
    title: '冰岛旅行', targetCents: 1_200_000, targetDate: '2027-03-01', protectedCents: 2_000_000,
    quote: '我想去冰岛', flexibilityWeeks: 2,
  });
  assert.equal(created.result.twinVersion, base.twinVersion + 1);
  assert.equal(created.state.goal.status, 'draft');

  const selected = runBankingTool(created.state, 'select_goal_plan', { planId: 'balanced' });
  const approval = runBankingTool(selected.state, 'create_approval_snapshot', {
    action: 'activate_goal', parameters: { planId: 'balanced' }, expiresInSeconds: 300,
  });
  const confirmed = runBankingTool(approval.state, 'confirm_approval', {
    approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const active = runBankingTool(confirmed.state, 'activate_goal', {
    planId: 'balanced', approvalToken: confirmed.result.approvalToken,
  });
  assert.equal(active.state.goal.status, 'active');
  assert.equal(active.state.goal.selectedPlanId, 'balanced');
  assert.ok(active.state.twinVersion > selected.state.twinVersion);
});
