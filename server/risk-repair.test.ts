import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DemoStateSchema,
  RiskRepairPreviewSchema,
  RiskRepairReceiptSchema,
  type DemoState,
  type RiskRepairApplyRequest,
} from '../shared/contracts.ts';
import { activatePlan } from './domain.ts';
import { runBankingTool } from './banking.ts';
import { createFixture } from './fixtures.ts';
import { applySpendingTrendDemo } from './risk.ts';
import {
  applyRiskRepair,
  dismissRisk,
  invalidateGoalRisks,
  postponeRisk,
  previewRiskRepair,
} from './risk-repair.ts';

function activeRiskFixture(): DemoState {
  return applySpendingTrendDemo(activatePlan(createFixture(), 'balanced')).state;
}

function applyRequest(state: DemoState, strategy: 'keep_target_date' | 'keep_monthly_contribution',
  idempotencyKey = `risk-repair-${strategy}`): RiskRepairApplyRequest {
  const impactId = state.pendingImpact!.id;
  const preview = previewRiskRepair(state, { impactId, expectedTwinVersion: state.twinVersion, strategy });
  return {
    impactId,
    previewId: preview.previewId,
    expectedTwinVersion: state.twinVersion,
    strategy,
    candidateId: preview.candidate.id,
    acceptTargetDateChange: preview.candidate.requiresTargetDateChange,
    idempotencyKey,
  };
}

test('risk repair preview is immutable and recomputes both strategies through plan change', () => {
  const state = activeRiskFixture();
  const before = structuredClone(state);
  const impact = state.pendingImpact!;
  const keepDate = previewRiskRepair(state, {
    impactId: impact.id, expectedTwinVersion: state.twinVersion, strategy: 'keep_target_date',
  });
  const keepMonthly = previewRiskRepair(state, {
    impactId: impact.id, expectedTwinVersion: state.twinVersion, strategy: 'keep_monthly_contribution',
  });

  assert.deepEqual(state, before);
  assert.equal(keepDate.baseTwinVersion, state.twinVersion);
  assert.equal(keepDate.comparison.before.targetDate, state.goal.targetDate);
  assert.equal(keepDate.candidate.effectiveTargetDate, state.goal.targetDate);
  assert.equal(keepDate.candidate.projectedDate! <= state.goal.targetDate, true);
  assert.equal(keepMonthly.candidate.monthlyCents, state.goal.monthlyContributionCents);
  assert.equal(keepMonthly.candidate.projectedDate, '2026-12-31');
  assert.equal(keepMonthly.candidate.effectiveTargetDate, '2026-12-31');
  assert.equal(keepMonthly.candidate.requiresTargetDateChange, true);
  assert.notEqual(keepDate.previewId, keepMonthly.previewId);
  assert.equal(RiskRepairPreviewSchema.parse(keepDate).previewId, keepDate.previewId);
});

test('risk repair atomically applies a current preview, resolves only its signal, and preserves money state', () => {
  const state = activeRiskFixture();
  const otherSignal = { ...state.riskSignals[0], id: 'other-signal', impactId: 'other-impact',
    suppressionKey: 'other-risk' };
  state.riskSignals = [...state.riskSignals, otherSignal];
  const request = applyRequest(state, 'keep_target_date');
  const accounts = structuredClone(state.accounts);
  const finance = structuredClone(state.finance);
  const schedules = structuredClone(state.transferSchedules);
  const result = applyRiskRepair(state, request);

  assert.equal(result.replayed, false);
  assert.equal(result.state.pendingImpact, null);
  assert.equal(result.state.riskSignals[0].status, 'resolved');
  assert.equal(result.state.riskSignals[1].status, 'active');
  assert.equal(result.state.twinVersion, state.twinVersion + 1);
  assert.equal(result.state.goal.targetDate, state.goal.targetDate);
  assert.equal(result.state.goal.monthlyContributionCents, result.preview.candidate.monthlyCents);
  assert.deepEqual(result.state.accounts, accounts);
  assert.deepEqual(result.state.finance, finance);
  assert.deepEqual(result.state.transferSchedules, schedules);
  assert.equal(result.state.riskRepairReceipts.length, 1);
  assert.equal(RiskRepairReceiptSchema.parse(result.receipt).idempotencyKey, request.idempotencyKey);
  assert.equal(DemoStateSchema.safeParse(result.state).success, true);
});

test('risk repair requires explicit date acceptance and leaves the source state untouched on failure', () => {
  const state = activeRiskFixture();
  const before = structuredClone(state);
  const request = applyRequest(state, 'keep_monthly_contribution');

  assert.throws(() => applyRiskRepair(state, { ...request, acceptTargetDateChange: false }),
    /TARGET_DATE_CHANGE_CONFIRMATION_REQUIRED/);
  assert.deepEqual(state, before);
});

test('risk repair preserves active transfer authority and returns a review reminder', () => {
  const state = activeRiskFixture();
  state.transferSchedules = [{ id: 'schedule-1', previewId: 'schedule-preview-1', goalId: state.goal.id,
    planOptionId: 'balanced', sourceAccountId: 'checking', destinationAccountId: 'goal-wallet',
    amountCents: state.goal.monthlyContributionCents, currency: 'CNY', recurrence: 'monthly',
    trigger: { type: 'fixed_day', day: 26 }, startDate: '2026-10-26', endDate: '2026-12-26',
    stopAtGoal: true, forecastId: 'forecast-1', twinVersion: state.twinVersion, status: 'active',
    authorizationHash: 'unchanged-authority', nextEvaluationAt: null,
    createdAt: '2026-09-21T12:00:00.000Z', updatedAt: '2026-09-21T12:00:00.000Z' }];
  const schedules = structuredClone(state.transferSchedules);
  const result = applyRiskRepair(state, applyRequest(state, 'keep_target_date'));

  assert.equal(result.scheduleReviewRequired, true);
  assert.deepEqual(result.state.transferSchedules, schedules);
  assert.equal(result.receipt.scheduleReviewRequired, true);
});

test('risk repair idempotency replays the receipt and rejects key reuse with another payload', () => {
  const state = activeRiskFixture();
  const request = applyRequest(state, 'keep_target_date', 'same-key');
  const first = applyRiskRepair(state, request);
  const replay = applyRiskRepair(first.state, request);

  assert.equal(replay.replayed, true);
  assert.equal(replay.state, first.state);
  assert.deepEqual(replay.receipt, first.receipt);
  assert.throws(() => applyRiskRepair(first.state, { ...request, strategy: 'keep_monthly_contribution' }),
    /IDEMPOTENCY_CONFLICT/);
});

test('risk repair rejects stale versions, stale signals, and non-primary goal risks', () => {
  const state = activeRiskFixture();
  const impactId = state.pendingImpact!.id;
  assert.throws(() => previewRiskRepair(state, {
    impactId, expectedTwinVersion: state.twinVersion + 1, strategy: 'keep_target_date',
  }), /TWIN_VERSION_CHANGED/);
  const stale = invalidateGoalRisks(state, state.goal.id);
  assert.equal(stale.riskSignals[0].status, 'stale');
  assert.equal(stale.pendingImpact, null);
  assert.throws(() => previewRiskRepair(stale, {
    impactId, expectedTwinVersion: stale.twinVersion, strategy: 'keep_target_date',
  }), /RISK_NOT_ACTIVE/);
  const unsupported = { ...state, pendingImpact: { ...state.pendingImpact!, goalId: 'secondary-goal' },
    riskSignals: state.riskSignals.map(signal => ({ ...signal, goalId: 'secondary-goal' })) };
  assert.throws(() => previewRiskRepair(unsupported, {
    impactId, expectedTwinVersion: unsupported.twinVersion, strategy: 'keep_target_date',
  }), /RISK_REPAIR_GOAL_NOT_SUPPORTED/);
});

test('later keeps a retrievable risk quiet while dismiss clears the current reminder', () => {
  const state = activeRiskFixture();
  const impactId = state.pendingImpact!.id;
  const later = postponeRisk(state, impactId);
  assert.equal(later.riskSignals[0].status, 'later');
  assert.equal(later.pendingImpact?.id, impactId);
  assert.equal(later.twinVersion, state.twinVersion + 1);
  const dismissed = dismissRisk(later, impactId);
  assert.equal(dismissed.riskSignals[0].status, 'dismissed');
  assert.equal(dismissed.pendingImpact, null);
  assert.equal(dismissed.twinVersion, later.twinVersion + 1);
});

test('ordinary goal writes make active and postponed risk judgments stale in the same state change', () => {
  for (const status of ['active', 'later'] as const) {
    const state = activeRiskFixture();
    state.riskSignals = state.riskSignals.map(signal => ({ ...signal, status }));
    const updated = runBankingTool(state, 'update_goal', { targetCents: state.goal.targetCents + 10000 }).state;

    assert.equal(updated.riskSignals[0].status, 'stale');
    assert.equal(updated.pendingImpact, null);
    assert.equal(updated.goal.status, 'draft');
  }
});
