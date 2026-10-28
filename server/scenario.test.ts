import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GoalScenarioPreviewSchema,
  NotificationDeliverySchema,
  WeeklyRiskSummarySchema,
} from '../shared/contracts.ts';
import { createFixture } from './fixtures.ts';
import { previewGoalScenario } from './scenario.ts';
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
