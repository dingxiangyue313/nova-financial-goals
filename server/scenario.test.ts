import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GoalPlanChangePreviewSchema,
  GoalScenarioPreviewSchema,
  NotificationDeliverySchema,
  WeeklyRiskSummarySchema,
} from '../shared/contracts.ts';
import { createFixture } from './fixtures.ts';
import { applyGoalPlanChange, previewGoalPlanChange, previewGoalScenario } from './scenario.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';

test('goal scenario preview is deterministic, immutable, and limited to three plans', () => {
  const state = createFixture();
  const before = structuredClone(state);
  const preview = previewGoalScenario(state, {
    targetCents: 900000,
    targetDate: '2027-01-15',
    monthlyContributionCents: 160000,
    protectedCents: 2000000,
    flexibilityWeeks: 3,
  });

  assert.deepEqual(state, before);
  assert.equal(preview.baseTwinVersion, 1);
  assert.equal(preview.assumptions.targetCents, 900000);
  assert.equal(preview.assessment.updatedAt, state.clock);
  assert.ok(preview.plans.length > 0 && preview.plans.length <= 3);
  assert.ok(preview.plans.every(plan => Number.isInteger(plan.monthlyCents)));
  assert.ok(Number.isInteger(preview.assessment.requiredMonthlyCents));
  assert.deepEqual(preview.steps.map(step => step.status), ['complete', 'complete', 'pending', 'pending']);
  assert.equal(GoalScenarioPreviewSchema.parse(preview).id, preview.id);
});

test('an explicit zero monthly contribution has no projected completion date', () => {
  const state = createFixture();
  const preview = previewGoalScenario(state, {
    targetCents: 900000,
    targetDate: '2027-01-15',
    monthlyContributionCents: 0,
    protectedCents: 2000000,
    flexibilityWeeks: 3,
  });

  assert.equal(preview.assessment.projectedDate, null);
  assert.equal(preview.assessment.status, 'at_risk');
});

const activePlanFixture = () => {
  const state = createFixture();
  state.goal = { ...state.goal, savedCents: 0, targetDate: '2026-12-31', originalDate: '2026-12-31',
    monthlyContributionCents: 200000, flexibilityWeeks: 0, selectedPlanId: 'balanced', status: 'active' };
  state.goals = [state.goal];
  return state;
};

const planDraft = (monthlyContributionCents = 180000) => ({
  targetCents: 800000, targetDate: '2026-12-31', savedCents: 0,
  protectedCents: 2000000, monthlyContributionCents, flexibilityWeeks: 0,
});

test('plan-change preview is immutable and keeps an affordable delayed user plan selectable', () => {
  const state = activePlanFixture();
  const before = structuredClone(state);
  const preview = previewGoalPlanChange(state, planDraft());

  assert.deepEqual(state, before);
  assert.equal(preview.customPlan.source, 'user');
  assert.equal(preview.customPlan.monthlyCents, 180000);
  assert.equal(preview.customPlan.projectedDate, '2027-01-14');
  assert.equal(preview.customPlan.effectiveTargetDate, '2027-01-14');
  assert.equal(preview.customPlan.delayDays, 14);
  assert.equal(preview.customPlan.selectable, true);
  assert.equal(preview.customPlan.requiresTargetDateChange, true);
  assert.ok(preview.novaPlans.length <= 3);
  assert.equal(GoalPlanChangePreviewSchema.parse(preview).baseTwinVersion, 1);
});

test('plan-change preview exposes but blocks a user amount above available monthly cashflow', () => {
  const preview = previewGoalPlanChange(activePlanFixture(), planDraft(210000));

  assert.equal(preview.customPlan.selectable, false);
  assert.ok(preview.customPlan.blockingReasons.includes('MONTHLY_CAPACITY_EXCEEDED'));
});

test('plan-change preview merges a user amount that duplicates a NOVA plan', () => {
  const preview = previewGoalPlanChange(activePlanFixture(), planDraft(200000));

  assert.equal(preview.customPlan.source, 'both');
  assert.ok(preview.customPlan.duplicatePlanId);
  assert.equal(preview.novaPlans.some(plan => plan.monthlyCents === 200000 &&
    plan.projectedDate === preview.customPlan.projectedDate), false);
});

test('plan change applies all fields atomically, preserves schedules, and audits the accepted date change', () => {
  const state = activePlanFixture();
  state.transferSchedules = [{ id: 'schedule-1', previewId: 'preview-1', goalId: state.goal.id,
    planOptionId: 'balanced', sourceAccountId: 'checking', destinationAccountId: 'goal-wallet',
    amountCents: 200000, currency: 'CNY', recurrence: 'monthly', trigger: { type: 'fixed_day', day: 26 },
    startDate: '2026-10-26', endDate: '2026-12-26', stopAtGoal: true, forecastId: 'forecast-1',
    twinVersion: 1, status: 'active', authorizationHash: 'hash', nextEvaluationAt: null,
    createdAt: '2026-09-21T12:00:00.000Z', updatedAt: '2026-09-21T12:00:00.000Z' }];
  const schedules = structuredClone(state.transferSchedules);
  const result = applyGoalPlanChange(state, { expectedTwinVersion: 1, draft: planDraft(),
    selection: { candidateId: 'custom', acceptTargetDateChange: true } });

  assert.equal(result.state.goal.targetCents, 800000);
  assert.equal(result.state.goal.savedCents, 0);
  assert.equal(result.state.goal.protectedCents, 2000000);
  assert.equal(result.state.goal.monthlyContributionCents, 180000);
  assert.equal(result.state.goal.originalDate, '2026-12-31');
  assert.equal(result.state.goal.targetDate, '2027-01-14');
  assert.equal(result.state.goal.selectedPlanId, 'custom');
  assert.equal(result.state.goal.status, 'active');
  assert.equal(result.state.twinVersion, 2);
  assert.deepEqual(result.state.transferSchedules, schedules);
  assert.equal(result.scheduleReviewRequired, true);
  assert.equal(result.state.audit.at(-1)?.action, 'goal_plan_changed');
});

test('plan change rejects stale data and an unaccepted target-date change without partial writes', () => {
  const state = activePlanFixture();
  const before = structuredClone(state);

  assert.throws(() => applyGoalPlanChange(state, { expectedTwinVersion: 2, draft: planDraft(),
    selection: { candidateId: 'custom', acceptTargetDateChange: true } }), /TWIN_VERSION_CHANGED/);
  assert.throws(() => applyGoalPlanChange(state, { expectedTwinVersion: 1, draft: planDraft(),
    selection: { candidateId: 'custom', acceptTargetDateChange: false } }), /TARGET_DATE_CHANGE_CONFIRMATION_REQUIRED/);
  assert.deepEqual(state, before);
});

for (const [targetDate, reason] of [['2026-10-25', 'GOAL_DEADLINE_PASSED'],
  ['2028-06-30', 'FORECAST_HORIZON_INCOMPLETE']] as const) {
  test(`scenario exposes ${reason} through its existing contract without throwing`, () => {
    const state = createJapanMoneyMissionFixture(); const before = structuredClone(state);
    const preview = previewGoalScenario(state, { targetCents: 800000, targetDate,
      monthlyContributionCents: 100000, protectedCents: 2000000, flexibilityWeeks: 0 });
    assert.equal(preview.assessment.projectedDate, null);
    assert.ok(preview.assessment.assumptions.includes(reason));
    assert.ok(preview.plans.every(plan => plan.status === 'infeasible'));
    assert.deepEqual(state, before);
    assert.equal(GoalScenarioPreviewSchema.parse(preview).id, preview.id);
  });
}

test('weekly summary and delivery contracts distinguish quiet summaries from urgent signals', () => {
  const summary = WeeklyRiskSummarySchema.parse({
    id: 'summary-goal-japan-2026-2026-09-21',
    goalId: 'goal-japan-2026',
    weekStart: '2026-09-21',
    weekEnd: '2026-09-27',
    patternIds: [],
    outcome: 'stable',
    title: '本周目标仍按计划推进',
    body: '没有发现需要立即处理的变化。',
    twinVersion: 1,
    ruleVersion: 'goal-aware-v1',
    status: 'available',
    dedupeKey: 'weekly:goal-japan-2026:2026-09-21',
    createdAt: '2026-09-21T00:00:00.000+08:00',
    delivery: { mode: 'summary', availableAt: '2026-09-21T00:00:00.000+08:00', urgent: false },
  });
  assert.equal(summary.delivery.urgent, false);
  assert.equal(NotificationDeliverySchema.parse(summary.delivery).mode, 'summary');
});
