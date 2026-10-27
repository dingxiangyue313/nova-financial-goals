import test from 'node:test';
import assert from 'node:assert/strict';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { buildMoneyMissionPlans } from './money-mission-plans.ts';
test('three dated plans have exact contributions, dates and distinct tradeoffs', () => {
  const state = createJapanMoneyMissionFixture();
  const forecast = buildDatedCashflowForecast(state,{ accountId: 'checking', horizonEnd: '2027-06-30',scenario:'baseline' });
  const [steady,balanced,fast] = buildMoneyMissionPlans(state,forecast);
  assert.deepEqual([steady.monthlyCents,steady.occurrences,steady.projectedDate],[75000,8,'2027-06-26']);
  assert.deepEqual([balanced.monthlyCents,balanced.occurrences,balanced.projectedDate],[100000,6,'2027-04-26']);
  assert.deepEqual([fast.upfrontCents,fast.monthlyCents,fast.occurrences,fast.projectedDate],[120000,120000,4,'2027-02-26']);
  assert.ok([steady,balanced,fast].every(p => p.executable));
});
test('missing authority and shared-money conflicts produce read-only alternatives', () => {
  const state = createJapanMoneyMissionFixture();
  const forecast = buildDatedCashflowForecast({ ...state,accountSnapshots:[] },{accountId:'checking',horizonEnd:'2027-06-30',scenario:'baseline'});
  assert.ok(buildMoneyMissionPlans(state,forecast).every(p => !p.executable));
  state.goals.push({...state.goal,id:'other',monthlyContributionCents:350000,status:'active'});
  const exact = buildDatedCashflowForecast(state,{accountId:'checking',horizonEnd:'2027-06-30',scenario:'baseline'});
  assert.ok(buildMoneyMissionPlans(state,exact).every(p => p.conflicts.length > 0 && !p.executable));
});
