import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from './fixtures.ts';
import { activatePlan, addDays, assessCandidateScenario, assessGoal, availableMonthly, simulateCandidateMonths } from './domain.ts';
import type { CandidateInput, DemoState } from '../shared/contracts.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { connectDataSources } from './data-connections.ts';

const candidate = (scenario: CandidateInput['scenario'] = { kind: 'baseline' }): CandidateInput => ({
  targetCents: 800000, targetDate: '2026-12-31', monthlyContributionCents: 200000,
  protectedCents: 2000000, scenario, evidenceResultIds: [],
});

function legacyBaseline(state: DemoState, input: CandidateInput, savedCents: number) {
  const months = Math.max(1, Math.ceil((Date.parse(`${input.targetDate}T00:00:00Z`) -
    Date.parse(`${state.clock}T00:00:00Z`)) / 86_400_000 / 30));
  const available = availableMonthly(state);
  const reserveFromChecking = Math.max(0, input.protectedCents - state.finance.emergencyCents);
  const firstCapacity = Math.max(0, Math.min(available - state.finance.currentMonthExpenseCents,
    state.finance.checkingCents - reserveFromChecking));
  const first = Math.min(input.monthlyContributionCents, firstCapacity);
  const later = Math.min(input.monthlyContributionCents, available);
  const remaining = Math.max(0, input.targetCents - savedCents);
  const funded = first + later * (months - 1);
  const shortfall = Math.max(0, remaining - funded);
  const delay = shortfall && later > 0 ? Math.ceil(shortfall / later * 30) : 0;
  const early = shortfall === 0 && later > 0
    ? Math.min(30, Math.floor((funded - remaining) / later * 30)) : 0;
  return { firstCapacity, funded, shortfall, delay,
    date: later <= 0 && remaining > 0 ? null : addDays(input.targetDate, delay - early) };
}

test('monthly simulation preserves the existing baseline calculation', () => {
  const state = createFixture();
  const cases = [
    { state, input: candidate(), saved: 0 },
    { state: { ...state, finance: { ...state.finance, currentMonthExpenseCents: 100000 } },
      input: candidate(), saved: 100000 },
    { state, input: { ...candidate(), protectedCents: 2400000 }, saved: 200000 },
    { state: { ...state, finance: { ...state.finance, monthlyIncomeCents: 1000000 } },
      input: candidate(), saved: 0 },
  ];
  for (const item of cases) {
    const before = legacyBaseline(item.state, item.input, item.saved);
    const after = assessCandidateScenario(item.state, item.input, item.saved, [], item.input.targetDate);
    assert.equal(after.firstMonthCapacityCents, before.firstCapacity);
    assert.equal(after.fundedByTargetCents, before.funded);
    assert.equal(after.shortfallCents, before.shortfall);
    assert.equal(after.delayDays, before.delay);
    assert.equal(after.projectedDate, before.date);
  }
});

test('one-time expense and sustained essential spending have distinct monthly cash flows', () => {
  const state = createFixture();
  const original = structuredClone(state);
  const oneTime = candidate({ kind: 'current_month_expense', amountCents: 100000 });
  const sustained = candidate({ kind: 'monthly_essential_spending_increase', amountCents: 100000 });
  const oneTimeMonths = simulateCandidateMonths(state, oneTime, 0).months;
  const sustainedMonths = simulateCandidateMonths(state, sustained, 0).months;
  assert.deepEqual(oneTimeMonths.map(month => month.contributedCents), [100000, 200000, 200000, 200000]);
  assert.deepEqual(sustainedMonths.map(month => month.contributedCents), [100000, 100000, 100000, 100000]);
  const oneTimeResult = assessCandidateScenario(state, oneTime, 0, [], oneTime.targetDate);
  const sustainedResult = assessCandidateScenario(state, sustained, 0, [], sustained.targetDate);
  assert.equal(oneTimeResult.status, 'at_risk');
  assert.equal(sustainedResult.status, 'at_risk');
  assert.ok(sustainedResult.shortfallCents > oneTimeResult.shortfallCents);
  assert.ok(sustainedResult.projectedDate! > oneTimeResult.projectedDate!);
  assert.deepEqual(state, original);
  const protectedInput = { ...oneTime, protectedCents: 2400000 };
  const protectedResult = assessCandidateScenario(state, protectedInput, 0, [], protectedInput.targetDate);
  assert.equal(protectedResult.firstMonthCapacityCents, 0);
});

test('income reduction start month and missed contribution month change the forecast', () => {
  const state = createFixture();
  const immediate = candidate({ kind: 'monthly_income_reduction', amountCents: 100000,
    startMonthIndex: 0 });
  const later = candidate({ kind: 'monthly_income_reduction', amountCents: 100000,
    startMonthIndex: 2 });
  assert.deepEqual(simulateCandidateMonths(state, immediate, 0).months.map(month => month.contributedCents),
    [100000, 100000, 100000, 100000]);
  assert.deepEqual(simulateCandidateMonths(state, later, 0).months.map(month => month.contributedCents),
    [200000, 200000, 100000, 100000]);
  const missedBeforeCompletion = candidate({ kind: 'missed_contribution_once', monthIndex: 1 });
  const missedAfterCompletion = candidate({ kind: 'missed_contribution_once', monthIndex: 3 });
  const missedFirst = candidate({ kind: 'missed_contribution_once', monthIndex: 0 });
  const before = assessCandidateScenario(state, missedBeforeCompletion, 300000, [], missedBeforeCompletion.targetDate);
  const after = assessCandidateScenario(state, missedAfterCompletion, 300000, [], missedAfterCompletion.targetDate);
  const baseline = assessCandidateScenario(state, candidate(), 300000, [], candidate().targetDate);
  assert.ok(before.projectedDate! > after.projectedDate!);
  assert.equal(after.projectedDate, baseline.projectedDate);
  assert.equal(after.status, 'on_track');
  assert.equal(assessCandidateScenario(state, missedFirst, 300000, [], missedFirst.targetDate).bufferCents,
    200000);
});

test('dated candidates fund only the remaining goal gap and finish on a salary-following date', () => {
  const state = createJapanMoneyMissionFixture();
  for (const [monthly, date] of [[75000, '2027-06-26'], [100000, '2027-04-26'],
    [120000, '2027-02-26']] as const) {
    const input = { ...candidate(), targetDate: state.goal.targetDate, monthlyContributionCents: monthly,
      firstMonthContributionCents: monthly };
    const result = assessCandidateScenario(state, input, 200000, [], input.targetDate);
    assert.equal(result.projectedDate, date);
    assert.equal(result.fundedByTargetCents, 600000);
    assert.equal(result.shortfallCents, 0);
  }
});

test('dated candidate execution authority requires a current authoritative balance', () => {
  const state = createJapanMoneyMissionFixture(); state.accountSnapshots = [];
  const input = { ...candidate(), targetDate: state.goal.targetDate, monthlyContributionCents: 100000 };
  const result = assessCandidateScenario(state, input, 200000, [], input.targetDate);
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.dataSufficient, false);
});

test('historical bank connections preserve a legacy goal calculation without claiming dated balance authority', () => {
  const connected = connectDataSources(createFixture(), ['bank', 'wechat_pay', 'alipay']).state;
  assert.equal(connected.accountSnapshots.length, 0);
  const result = assessGoal(connected);
  assert.equal(result.status, 'on_track');
  assert.equal(result.projectedDate, '2026-12-15');
});

test('advancing the clock cannot downgrade a dated mission missing its balance into legacy execution', () => {
  const state = createJapanMoneyMissionFixture(); state.clock = '2026-11-01'; state.accountSnapshots = [];
  assert.equal(assessGoal(state).status, 'insufficient_data');
});

test('dated candidate treats its first month as a total rather than adding the total to recurring deposits', () => {
  const state = createJapanMoneyMissionFixture(); state.clock = '2026-10-20';
  state.accountSnapshots.forEach(snapshot => { snapshot.asOf = state.clock; });
  const input = { ...candidate(), targetDate: state.goal.targetDate,
    monthlyContributionCents: 120000, firstMonthContributionCents: 240000 };
  const simulation = simulateCandidateMonths(state, input, 200000);
  assert.deepEqual(simulation.months.slice(0, 2).map(month => month.contributedCents), [120000, 120000]);
  assert.equal(simulation.months.reduce((sum, month) => sum + month.contributedCents, 0), 600000);
  const result = assessCandidateScenario(state, input, 200000, [], input.targetDate);
  assert.equal(result.status, 'on_track'); assert.equal(result.projectedDate, '2027-01-26');
});

test('a stale previously accepted ambiguous schedule cannot silently become another schedule', () => {
  const state = createJapanMoneyMissionFixture(); state.goal.targetDate = '2026-12-30';
  state.goal.status = 'active'; state.goal.monthlyContributionCents = 300000;
  state.goal.firstMonthContributionCents = 300000; state.goal.selectedPlanId = 'goal-plan-prior-version-upfront';
  state.twinVersion++;
  const result = assessGoal(state);
  assert.equal(result.status, 'infeasible'); assert.equal(result.projectedDate, null);
  assert.ok(result.assumptions.includes('AMBIGUOUS_SCHEDULE'));
  assert.ok(result.plans.every(plan => plan.status === 'infeasible'));
});

test('zero regenerated matches block accepted candidate assessment and simulation while explicit replanning still works', () => {
  const initial = createJapanMoneyMissionFixture();
  const state = activatePlan(initial, assessGoal(initial).plans[2].id);
  state.twinVersion++; state.transactions[0].date = '2026-09-27';
  const input: CandidateInput = { targetCents: state.goal.targetCents, targetDate: state.goal.targetDate,
    monthlyContributionCents: state.goal.monthlyContributionCents,
    firstMonthContributionCents: state.goal.firstMonthContributionCents,
    protectedCents: state.goal.protectedCents, scenario: { kind: 'baseline' }, evidenceResultIds: [] };
  const assessment = assessCandidateScenario(state, input, state.goal.savedCents, [], input.targetDate);
  assert.equal(assessment.status, 'infeasible'); assert.equal(assessment.projectedDate, null);
  assert.equal(assessment.dataSufficient, false);
  assert.ok(assessment.constraintViolations.includes('AMBIGUOUS_SCHEDULE'));
  assert.equal(assessment.fundedByTargetCents, 0); assert.equal(assessment.shortfallCents, 600000);
  const simulation = simulateCandidateMonths(state, input, state.goal.savedCents);
  assert.deepEqual(simulation.months, []); assert.equal(simulation.futureContributionCents, 0);
  const replan = assessCandidateScenario(state, { ...input, firstMonthContributionCents: 240000 },
    state.goal.savedCents, [], input.targetDate);
  assert.equal(replan.status, 'on_track'); assert.equal(replan.projectedDate, '2027-01-28');
});

for (const [targetDate, reason] of [['2026-10-25', 'GOAL_DEADLINE_PASSED'],
  ['2028-06-30', 'FORECAST_HORIZON_INCOMPLETE']] as const) {
  test(`dated candidate and assessment expose ${reason} instead of throwing`, () => {
    const state = createJapanMoneyMissionFixture(); state.goal.targetDate = targetDate;
    const input = { ...candidate(), targetDate, monthlyContributionCents: 100000 };
    const result = assessCandidateScenario(state, input, 200000, [], targetDate);
    assert.equal(result.projectedDate, null); assert.equal(result.dataSufficient, false);
    assert.ok(result.constraintViolations.includes(reason));
    if (targetDate < state.clock) assert.equal(result.fundedByTargetCents, 0);
    assert.doesNotThrow(() => simulateCandidateMonths(state, input, 200000));
    const goal = assessGoal(state);
    assert.equal(goal.projectedDate, null);
    assert.ok(goal.assumptions.includes(reason));
    assert.ok(goal.plans.every(plan => plan.status === 'infeasible'));
  });
}
