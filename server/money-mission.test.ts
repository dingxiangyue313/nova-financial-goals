import test from 'node:test';
import assert from 'node:assert/strict';
import { MoneyMissionReadModelSchema, type DemoState } from '../shared/contracts.ts';
import { createFirstUseFixture, createFixture } from './fixtures.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { buildMoneyMissionPlans } from './money-mission-plans.ts';
import { connectDataSources } from './data-connections.ts';
import { moneyMissionReadModel } from './money-mission.ts';

function artifacts() {
  const state = createJapanMoneyMissionFixture();
  const timestamp = '2026-10-26T12:00:00+08:00';
  state.statementImportBatches = [{ id: 'batch', templateId: 'bank-csv-v1', format: 'csv', sourceKind: 'bank',
    accountId: 'checking', status: 'committed', coverageStart: '2026-08-01', coverageEnd: state.clock,
    recordCount: 3, importedCount: 3, excludedCount: 0, reviewCount: 0, issueIds: [], createdAt: timestamp,
    committedAt: timestamp }];
  state.billBriefs = [{ id: 'brief', periodStart: '2026-10-01', periodEnd: state.clock, dataAsOf: state.clock,
    twinVersion: 1, totalExpenseCents: 6800, categories: [], changes: [], claims: [], limitations: [],
    subscriptionCandidates: [{ subscriptionId: 'cloudbox-plus', merchantId: 'cloudbox-plus', label: 'CloudBox Plus',
      monthlyCents: 6800, nextChargeDate: '2026-11-05', confidence: 1, sourceRefs: ['evidence'] }], createdAt: timestamp }];
  state.subscriptionActions = [{ id: 'decision', subscriptionId: 'cloudbox-plus', merchantId: 'cloudbox-plus',
    action: 'keep', status: 'succeeded', monthlyCents: 6800, paidThrough: '2026-11-04', effectiveAt: '2026-11-05',
    nextChargeSuppressed: false, refundCents: 0, twinVersion: 1, actionHash: 'hash', merchantOperationId: null,
    receiptOperationId: null, evidenceRefs: ['evidence'], createdAt: timestamp, updatedAt: timestamp }];
  const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: state.goal.targetDate,
    scenario: 'baseline' });
  state.datedCashflowForecasts = [forecast];
  state.goalPlanOptions = buildMoneyMissionPlans(state, forecast);
  state.goal = { ...state.goal, selectedPlanId: state.goalPlanOptions[1].id, status: 'active' };
  state.goals = [state.goal];
  state.transferSchedules = [{ id: 'schedule', previewId: 'preview', goalId: state.goal.id,
    planOptionId: state.goal.selectedPlanId, sourceAccountId: 'checking', destinationAccountId: 'goal-wallet',
    amountCents: 100000, currency: 'CNY', recurrence: 'monthly', trigger: { type: 'fixed_day', day: 26 },
    startDate: '2026-11-26', endDate: '2027-04-26', stopAtGoal: true, forecastId: forecast.id, twinVersion: 1,
    status: 'active', authorizationHash: 'hash', nextEvaluationAt: timestamp, createdAt: timestamp, updatedAt: timestamp }];
  return state;
}

test('artifact gates expose exactly one current stage, stable next action and revisitable completed stages', () => {
  const full = artifacts();
  const cases: [string, DemoState, string[]][] = [
    ['goal', createFirstUseFixture(), []],
    ['data', { ...full, statementImportBatches: [], billBriefs: [], subscriptionActions: [], goalPlanOptions: [], transferSchedules: [] }, ['goal']],
    ['bill', { ...full, billBriefs: [], subscriptionActions: [], goalPlanOptions: [], transferSchedules: [] }, ['goal', 'data']],
    ['subscription', { ...full, subscriptionActions: [], goalPlanOptions: [], transferSchedules: [] }, ['goal', 'data', 'bill']],
    ['plan', { ...full, goal: { ...full.goal, selectedPlanId: null }, goals: [{ ...full.goal, selectedPlanId: null }], transferSchedules: [] }, ['goal', 'data', 'bill', 'subscription']],
    ['transfer', { ...full, transferSchedules: [] }, ['goal', 'data', 'bill', 'subscription', 'plan']],
    ['monitoring', full, ['goal', 'data', 'bill', 'subscription', 'plan', 'transfer']],
  ];
  for (const [stage, state, completed] of cases) {
    const before = structuredClone(state);
    const model = moneyMissionReadModel(state);
    assert.equal(model.currentStage, stage);
    assert.deepEqual(model.completedStages, completed);
    assert.equal(model.nextAction?.id, stage);
    assert.ok(model.nextAction?.label);
    assert.deepEqual(moneyMissionReadModel(state), model);
    assert.ok(MoneyMissionReadModelSchema.safeParse(model).success);
    assert.deepEqual(state, before);
  }
});

test('failed or unknown actions and draft schedules never masquerade as completion', () => {
  for (const status of ['prepared', 'awaiting_confirmation', 'executing', 'unknown', 'failed', 'requires_merchant'] as const) {
    const state = artifacts(); state.subscriptionActions[0].status = status;
    assert.equal(moneyMissionReadModel(state).currentStage, 'subscription', status);
  }
  for (const status of ['draft', 'simulated', 'awaiting_confirmation', 'failed', 'cancelled'] as const) {
    const state = artifacts(); state.transferSchedules[0].status = status;
    assert.equal(moneyMissionReadModel(state).currentStage, 'transfer', status);
  }
  const state = artifacts(); state.statementImportBatches[0].status = 'revoked';
  assert.equal(moneyMissionReadModel(state).currentStage, 'data');
});

test('declining cancellation is a completed choice, while unverified cancellation never completes the stage', () => {
  const state = artifacts();
  state.subscriptionActions[0].action = 'cancel';
  assert.equal(moneyMissionReadModel(state).currentStage, 'subscription');
  state.subscriptionActions[0].status = 'cancelled';
  assert.equal(moneyMissionReadModel(state).currentStage, 'monitoring');
});

test('no subscription candidates can proceed, but every identified candidate needs a resolved decision', () => {
  const state = artifacts(); state.billBriefs[0].subscriptionCandidates = []; state.subscriptionActions = [];
  assert.equal(moneyMissionReadModel(state).currentStage, 'monitoring');
  state.billBriefs[0].subscriptionCandidates = [{ subscriptionId: null, merchantId: 'unverified', label: '待核对订阅',
    monthlyCents: 1000, nextChargeDate: null, confidence: 0.5, sourceRefs: ['evidence'] }];
  assert.equal(moneyMissionReadModel(state).currentStage, 'subscription');
});

test('legacy collections and a missing primary goal safely start at goal or data', () => {
  const legacy = createFixture() as Partial<DemoState>;
  for (const key of ['statementImportBatches', 'billBriefs', 'subscriptionActions', 'datedCashflowForecasts',
    'goalPlanOptions', 'transferSchedules', 'transferExecutions', 'evidenceRefs'] as const) delete legacy[key];
  assert.equal(moneyMissionReadModel(legacy as DemoState).currentStage, 'data');
  assert.equal(moneyMissionReadModel({ ...legacy, goals: [], primaryGoalId: null } as DemoState).currentStage, 'goal');
});

test('a legacy connection needs Money Mission balance evidence before leaving the data stage', () => {
  const legacy = connectDataSources(createFixture(), ['bank']).state;
  assert.equal(moneyMissionReadModel(legacy).currentStage, 'data');
  const current = createJapanMoneyMissionFixture();
  current.dataConnections = legacy.dataConnections;
  assert.equal(moneyMissionReadModel(current).currentStage, 'bill');
});

test('read model excludes private artifacts, unknown nested fields and raw transaction descriptions', () => {
  const state = artifacts();
  const privateValue = 'PRIVATE-RAW-APPROVAL-TOKEN';
  Object.assign(state, { rawFile: privateValue, buffer: privateValue, parserDiagnostics: privateValue,
    approvals: [{ token: privateValue }], subscriptionMerchants: [{ operationId: privateValue }],
    normalizedStatementRows: [{ title: privateValue }], importIssues: [{ originalValue: privateValue }] });
  Object.assign(state.billBriefs[0], { rawDescription: privateValue });
  Object.assign(state.transferSchedules[0], { approvalToken: privateValue });
  state.datedCashflowForecasts[0].events[0].label = privateValue;
  const model = moneyMissionReadModel(state);
  assert.equal(JSON.stringify(model).includes(privateValue), false);
  assert.equal(model.billBrief?.totalExpenseCents, 6800);
  assert.equal(model.transferSchedule?.amountCents, 100000);
});

test('artifacts of another goal cannot select a plan, schedule, forecast or execution', () => {
  const state = artifacts();
  state.goalPlanOptions = state.goalPlanOptions.map(option => ({ ...option, goalId: 'other-goal' }));
  state.transferSchedules[0].goalId = 'other-goal';
  const model = moneyMissionReadModel(state);
  assert.equal(model.currentStage, 'plan');
  assert.deepEqual(model.planOptions, []);
  assert.equal(model.forecast, null);
  assert.equal(model.transferSchedule, null);
  assert.deepEqual(model.transferExecutions, []);
});

test('selected subscription action excludes private merchant, operation and session identifiers', () => {
  const state = artifacts();
  const privateValue = 'PRIVATE-MERCHANT-OPERATION-SESSION';
  Object.assign(state.subscriptionActions[0], { merchantId: privateValue, merchantOperationId: privateValue,
    receiptOperationId: privateValue, actionHash: privateValue, sessionId: privateValue });
  const model = moneyMissionReadModel(state);
  assert.equal(model.subscriptionAction?.id, 'decision');
  assert.equal(model.subscriptionAction?.monthlyCents, 6800);
  assert.equal(JSON.stringify(model).includes(privateValue), false);
  // The shared public boundary must also sanitize a caller-supplied private artifact.
  const parsed = MoneyMissionReadModelSchema.parse({ ...model, subscriptionAction: state.subscriptionActions[0] });
  assert.equal(JSON.stringify(parsed).includes(privateValue), false);
});

test('selected execution excludes private operation, receipt, transaction and session identifiers', () => {
  const state = artifacts();
  const privateValue = 'PRIVATE-EXECUTION-OPERATION-SESSION';
  const timestamp = '2026-11-26T09:00:00+08:00';
  state.transferExecutions = [{ id: 'public-execution', scheduleId: 'schedule', period: '2026-11',
    status: 'succeeded', amountCents: 100000, currency: 'CNY', operationId: privateValue,
    triggerTransactionId: privateValue, receiptOperationId: privateValue, scheduledAt: timestamp,
    executedAt: timestamp, reason: null, createdAt: timestamp, updatedAt: timestamp }];
  Object.assign(state.transferExecutions[0], { sessionId: privateValue, merchantOperationId: privateValue });
  const model = moneyMissionReadModel(state);
  assert.equal(model.transferExecutions.length, 1);
  assert.equal(model.transferExecutions[0].id, 'public-execution');
  assert.equal(model.transferExecutions[0].status, 'succeeded');
  assert.equal(model.transferExecutions[0].amountCents, 100000);
  assert.equal(JSON.stringify(model).includes(privateValue), false);
  const parsed = MoneyMissionReadModelSchema.parse({ ...model, transferExecutions: state.transferExecutions });
  assert.equal(JSON.stringify(parsed).includes(privateValue), false);
});

for (const [goalStatus, scheduleStatus] of [['paused', 'paused'], ['achieved', 'completed']] as const) {
  test(`${goalStatus} goal with ${scheduleStatus} schedule retains completed progress and monitoring CTA`, () => {
    const state = artifacts();
    state.goal.status = goalStatus;
    state.transferSchedules[0].status = scheduleStatus;
    const model = moneyMissionReadModel(state);
    assert.equal(model.currentStage, 'monitoring');
    assert.deepEqual(model.completedStages, ['goal', 'data', 'bill', 'subscription', 'plan', 'transfer']);
    assert.deepEqual(model.nextAction, { id: 'monitoring', label: '查看持续守护' });
    assert.deepEqual(moneyMissionReadModel(state).nextAction, model.nextAction);
    assert.equal(model.transferSchedule?.status, scheduleStatus);
  });
}

test('draft goal does not turn a selected comparison into an accepted plan', () => {
  const state = artifacts();
  state.goal.status = 'draft';
  const model = moneyMissionReadModel(state);
  assert.equal(model.currentStage, 'plan');
  assert.deepEqual(model.completedStages, ['goal', 'data', 'bill', 'subscription']);
  assert.deepEqual(model.nextAction, { id: 'plan', label: '比较目标方案' });
});

test('new comparisons retain the accepted plan, its forecast and completed transfer progress', () => {
  const state = artifacts();
  const acceptedPlanId = state.goal.selectedPlanId;
  const acceptedForecastId = state.goalPlanOptions[1].forecastId;
  state.datedCashflowForecasts.push({ ...state.datedCashflowForecasts[0], id: 'new-forecast' });
  state.goalPlanOptions.push(...[1, 2, 3].map(index => ({ ...state.goalPlanOptions[0],
    id: `comparison-${index}`, forecastId: 'new-forecast' })));
  const model = moneyMissionReadModel(state);
  assert.equal(model.currentStage, 'monitoring');
  assert.deepEqual(model.completedStages, ['goal', 'data', 'bill', 'subscription', 'plan', 'transfer']);
  assert.deepEqual(model.nextAction, { id: 'monitoring', label: '查看持续守护' });
  assert.equal(model.planOptions.length, 3);
  assert.ok(model.planOptions.some(option => option.id === acceptedPlanId));
  assert.deepEqual(model.planOptions.filter(option => option.id !== acceptedPlanId).map(option => option.id),
    ['comparison-2', 'comparison-3']);
  assert.equal(model.forecast?.id, acceptedForecastId);
  assert.equal(model.transferSchedule?.id, 'schedule');
});
