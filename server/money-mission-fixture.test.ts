import test from 'node:test';
import assert from 'node:assert/strict';
import * as contracts from '../shared/contracts.ts';
import { createFixture, createFirstUseFixture } from './fixtures.ts';
import { snapshot } from './presentation.ts';

async function missionFixture() {
  const module = await import('./money-mission-fixture.ts').catch(error => {
    assert.fail(`Money Mission fixture must exist: ${error.code}`);
  });
  return module.createJapanMoneyMissionFixture();
}

test('Japan Money Mission freezes authoritative balances and scenario facts', async () => {
  const state = await missionFixture();
  assert.equal(state.clock, '2026-10-26');
  assert.deepEqual(state.accounts.map(x => [x.id, x.balanceCents]), [
    ['checking', 724000], ['emergency', 2000000], ['goal-wallet', 200000],
  ]);
  assert.equal(state.finance.checkingCents, 724000);
  assert.equal(state.finance.emergencyCents, 2000000);
  assert.equal(state.finance.monthlyIncomeCents, 850000);
  assert.equal(state.goal.targetCents, 800000);
  assert.equal(state.goal.savedCents, 200000);
  assert.equal(state.goal.targetDate, '2027-06-30');
  assert.equal(state.goal.protectedCents, 2000000);
  assert.equal(state.accounts.find(x => x.id === 'emergency')?.protected, true);
  assert.deepEqual(state.bills.map(x => [x.id, x.dueDate, x.amountCents]), [
    ['rent', '2026-11-01', 280000], ['daily-purchase', '2026-11-08', 30000],
    ['utilities', '2026-11-10', 42000], ['transport', '2026-11-15', 20000],
    ['insurance', '2026-11-18', 28000],
  ]);
  assert.deepEqual(state.subscriptions, [{ id: 'cloudbox-plus', title: 'CloudBox Plus',
    monthlyCents: 6800, nextChargeDate: '2026-11-05', status: 'active' }]);
  assert.deepEqual(state.transactions.find(x => x.id === 'salary-2026-10'), {
    id: 'salary-2026-10', accountId: 'checking', date: '2026-10-25', title: '工资',
    category: 'income', amountCents: 850000, sourceKind: 'bank', provenance: 'connected_data',
  });
  assert.equal(state.accountSnapshots.find(x => x.accountId === 'checking')?.balanceCents, 724000);
  assert.equal(contracts.DemoStateSchema.safeParse(state).success, true);
  state.accounts[0].balanceCents = 0;
  assert.equal((await missionFixture()).accounts[0].balanceCents, 724000);
});

const artifactKeys = [
  'accountSnapshots', 'statementImportBatches', 'importIssues', 'normalizedStatementRows',
  'evidenceRefs', 'billBriefs', 'subscriptionActions', 'datedCashflowForecasts',
  'goalPlanOptions', 'transferSchedulePreviews', 'transferSchedules', 'transferExecutions', 'handoffCasePacks',
] as const;

test('legacy stored states receive empty Money Mission collections', () => {
  const legacy: Record<string, unknown> = structuredClone(createFixture());
  for (const key of artifactKeys) delete legacy[key];
  const parsed = contracts.DemoStateSchema.parse(legacy);
  for (const key of artifactKeys) assert.deepEqual(parsed[key], [], key);
  assert.equal(createFixture().clock, '2026-09-21');
  assert.equal(createFixture().goal.savedCents, 350000);
  assert.deepEqual(createFirstUseFixture().goals, []);
  assert.equal(createFirstUseFixture().primaryGoalId, null);
});

test('every Money Mission artifact exports a runtime schema', () => {
  for (const name of ['AccountSnapshot', 'StatementImportBatch', 'ImportIssue', 'NormalizedStatementRow',
    'EvidenceRef', 'BillBrief', 'SubscriptionAction', 'DatedCashflowForecast', 'GoalPlanOption',
    'TransferSchedulePreview', 'TransferSchedule', 'TransferExecution', 'MoneyMissionReadModel',
    'HandoffCasePack', 'SkillId', 'SkillDefinition']) {
    assert.ok(contracts[`${name}Schema` as keyof typeof contracts], `${name}Schema`);
  }
});

test('import batches require identity, coverage and reconciliation counts', () => {
  assert.ok(contracts.StatementImportBatchSchema);
  const batch = { id: 'batch-1', templateId: 'bank-csv-v1', format: 'csv', sourceKind: 'bank',
    accountId: 'checking', coverageStart: '2026-08-01', coverageEnd: '2026-10-26',
    recordCount: 10, importedCount: 8, excludedCount: 1, reviewCount: 1, issueIds: ['issue-1'],
    createdAt: '2026-10-26T12:00:00+08:00', committedAt: null, status: 'preview' };
  for (const status of ['preview', 'needs_review', 'ready', 'committed', 'revoked', 'failed'])
    assert.equal(contracts.StatementImportBatchSchema.safeParse({ ...batch, status }).success, true);
  for (const key of ['id', 'templateId', 'format', 'coverageStart', 'coverageEnd', 'recordCount',
    'importedCount', 'excludedCount', 'reviewCount', 'issueIds', 'createdAt', 'committedAt']) {
    const incomplete = { ...batch };
    delete incomplete[key as keyof typeof incomplete];
    assert.equal(contracts.StatementImportBatchSchema.safeParse(incomplete).success, false, key);
  }
  assert.equal(contracts.StatementImportBatchSchema.safeParse({ ...batch, status: 'success' }).success, false);
  assert.equal(contracts.StatementImportBatchSchema.safeParse({ ...batch, coverageEnd: '2026-07-31' }).success, false);
});

test('issues preserve corrections and evidence distinguishes claim types', () => {
  assert.ok(contracts.ImportIssueSchema);
  const issue = { id: 'issue-1', batchId: 'batch-1', rowId: 'row-1', field: 'date',
    originalValue: '26/10/2026', correctedValue: '2026-10-26', severity: 'review', kind: 'invalid_date' };
  for (const kind of ['invalid_date', 'invalid_amount', 'missing_field', 'duplicate', 'refund_match', 'internal_transfer', 'low_confidence'])
    for (const severity of ['blocking', 'review', 'info'])
      assert.equal(contracts.ImportIssueSchema.safeParse({ ...issue, kind, severity }).success, true);
  assert.deepEqual(contracts.ImportIssueSchema.parse(issue), issue);
  assert.equal(contracts.ImportIssueSchema.safeParse({ ...issue, correctedValue: null }).success, true);
  const evidence = { id: 'evidence-1', claimType: 'fact', sourceKind: 'transaction', sourceId: 'row-1',
    dataAsOf: '2026-10-26', label: '工资', confidence: 1 };
  for (const claimType of ['fact', 'assumption', 'prediction', 'limitation'])
    assert.equal(contracts.EvidenceRefSchema.safeParse({ ...evidence, claimType }).success, true);
  assert.equal(contracts.EvidenceRefSchema.safeParse({ ...evidence, confidence: 1.1 }).success, false);
  assert.equal(contracts.EvidenceRefSchema.safeParse({ ...evidence, claimType: 'guess' }).success, false);
});

test('lifecycle contracts admit recovery states and reject unsupported recurrence', () => {
  assert.ok(contracts.SubscriptionActionSchema);
  assert.deepEqual(contracts.SubscriptionActionSchema.shape.status.options, ['prepared', 'awaiting_confirmation',
    'executing', 'succeeded', 'failed', 'requires_merchant', 'unknown', 'reconciled', 'cancelled']);
  assert.deepEqual(contracts.DatedCashflowForecastSchema.shape.precision.options, ['exact', 'range', 'insufficient_balance']);
  assert.deepEqual(contracts.TransferScheduleSchema.shape.status.options, ['draft', 'simulated', 'awaiting_confirmation',
    'active', 'paused', 'completed', 'failed', 'cancelled']);
  assert.deepEqual(contracts.TransferExecutionSchema.shape.status.options, ['scheduled', 'succeeded', 'failed', 'unknown',
    'skipped_missing_trigger', 'reconciled']);
  assert.deepEqual(contracts.TransferScheduleSchema.shape.recurrence.options, ['one_time', 'monthly']);
  assert.equal(contracts.TransferScheduleSchema.shape.recurrence.safeParse('weekly').success, false);
  assert.equal(contracts.TransferScheduleSchema.shape.trigger.safeParse({ type: 'cron' }).success, false);
});

test('only exact forecasts can identify executable predictions', () => {
  assert.ok(contracts.DatedCashflowForecastSchema);
  const forecast = { id: 'forecast-1', accountId: 'checking', currency: 'CNY', twinVersion: 1,
    dataAsOf: '2026-10-26', horizonStart: '2026-10-26', horizonEnd: '2026-11-30', scenario: 'baseline',
    precision: 'exact', executableForecastId: 'forecast-1', startingBalanceCents: 724000,
    minimumBalanceCents: 317200, minimumBalanceDate: '2026-11-18', events: [], dailyBalances: [],
    evidenceRefs: [], assumptions: [], limitations: [], createdAt: '2026-10-26T12:00:00+08:00' };
  assert.equal(contracts.DatedCashflowForecastSchema.safeParse(forecast).success, true);
  for (const precision of ['range', 'insufficient_balance']) {
    assert.equal(contracts.DatedCashflowForecastSchema.safeParse({ ...forecast, precision }).success, false);
    assert.equal(contracts.DatedCashflowForecastSchema.safeParse({ ...forecast, precision,
      executableForecastId: null, startingBalanceCents: null, minimumBalanceCents: null, minimumBalanceDate: null }).success, true);
  }
});

test('Skills freeze thirteen identities and keep execution unavailable', () => {
  assert.ok(contracts.SkillIdSchema);
  assert.deepEqual(contracts.SkillIdSchema.options, ['statement_ingestion_and_reconciliation', 'bill_and_subscription_investigator',
    'dated_cashflow_forecast', 'goal_portfolio_planner', 'transfer_and_savings_executor', 'mandate_builder',
    'external_agent_request_inbox', 'outcome_monitor_and_replanner', 'financial_explanation_and_provenance', 'human_handoff_case_pack', 'recipient_and_split_coordinator', 'investment_lifecycle_manager', 'card_lifecycle_manager']);
  const skill = { name: 'mandate_builder', version: '1.0.0', description: 'Prepare a mandate',
    riskClass: 'prepare_write', inputSchema: {}, outputSchema: {}, allowedTools: [], maxToolCalls: 3,
    timeoutMs: 1000, requiresEvidence: true, canPrepareAction: true, canExecuteAction: false,
    enabled: false, release: 'p1_stretch' };
  for (const name of ['mandate_builder', 'external_agent_request_inbox']) {
    assert.equal(contracts.SkillDefinitionSchema.safeParse({ ...skill, name }).success, true);
    assert.equal(contracts.SkillDefinitionSchema.safeParse({ ...skill, name, enabled: true }).success, true);
    assert.equal(contracts.SkillDefinitionSchema.safeParse({ ...skill, name, release: 'p0' }).success, true);
  }
  assert.equal(contracts.SkillDefinitionSchema.safeParse({ ...skill, canExecuteAction: true }).success, false);
});

test('snapshot defaults remain compatible and public artifacts strip raw data and tokens', async () => {
  const legacy = contracts.SnapshotSchema.parse(snapshot(createFixture()));
  for (const key of artifactKeys.filter(key => key !== 'normalizedStatementRows' && key !== 'importIssues'))
    assert.deepEqual(legacy[key], [], key);
  const state = await missionFixture();
  const publicView = contracts.SnapshotSchema.parse({ ...snapshot(state), accountSnapshots: state.accountSnapshots.map(x => ({ ...x,
    token: 'private-token', rawFile: 'private-file' })), normalizedStatementRows: [{ rawDescription: 'private-statement' }],
    moneyMission: null });
  const serialized = JSON.stringify(publicView);
  for (const secret of ['private-token', 'private-file', 'private-statement']) assert.equal(serialized.includes(secret), false);
});
