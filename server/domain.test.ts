import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from './fixtures.ts';
import { assessGoal, activatePlan, injectExpense, resolveImpact } from './domain.ts';

test('initial goal is on track but no plan is selected', () => {
  const state = createFixture();
  const result = assessGoal(state);
  assert.equal(result.status, 'on_track');
  assert.equal(state.goal.selectedPlanId, null);
  assert.equal(result.plans.length, 3);
});

test('a plan must be chosen before activation', () => {
  const state = createFixture();
  assert.throws(() => activatePlan(state, null), /PLAN_NOT_SELECTED/);
  const selected = assessGoal(state).plans[1];
  const next = activatePlan(state, selected.id);
  assert.equal(next.goal.status, 'active');
  assert.equal(next.goal.selectedPlanId, selected.id);
});

test('only an expense that changes the goal produces an impact signal', () => {
  const state = activatePlan(createFixture(), 'balanced');
  const small = injectExpense(state, 10000, '咖啡');
  assert.equal(small.impact, null);
  const large = injectExpense(state, 90000, '汽车保养');
  assert.ok(large.impact);
  assert.equal(large.state.finance.emergencyCents, state.finance.emergencyCents);
  assert.ok(large.impact!.shortfallCents > 0);
});

test('insufficient data and impossible monthly capacity are explicit states', () => {
  const original = createFixture();
  assert.equal(assessGoal({ ...original, finance: { ...original.finance, historyMonths: 1 } }).status, 'insufficient_data');
  const impossible = { ...original, finance: { ...original.finance, monthlyIncomeCents: 600000 } };
  assert.equal(assessGoal(impossible).status, 'infeasible');
  assert.throws(() => activatePlan(impossible, 'balanced'), /PLAN_NOT_AVAILABLE/);
});

test('an unaffordable catch-up option cannot be applied', () => {
  const active = activatePlan(createFixture(), 'balanced');
  const impact = injectExpense(active, 200000, '大额意外支出');
  assert.ok(impact.impact);
  assert.equal(impact.impact!.optionAAvailable, false);
  assert.throws(() => resolveImpact(impact.state, 'A'), /PLAN_NOT_AVAILABLE/);
  const delayed = resolveImpact(impact.state, 'B');
  assert.equal(delayed.goal.targetDate, impact.impact!.optionBDate);
});
