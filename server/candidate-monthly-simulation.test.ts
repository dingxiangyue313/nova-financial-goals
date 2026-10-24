import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from './fixtures.ts';
import { addDays, assessCandidateScenario, availableMonthly, simulateCandidateMonths } from './domain.ts';
import type { CandidateInput, DemoState } from '../shared/contracts.ts';

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
