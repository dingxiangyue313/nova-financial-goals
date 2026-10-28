import type { CandidateAssessment, CandidateInput, CashflowEdit, DemoState } from '../shared/contracts.ts';
import { addIsoDays, buildDatedCashflowForecast, monthDate } from './cashflow-forecast.ts';

// Adapter for the existing candidate/search/stress APIs. Legacy sessions retain
// their original contract; canonical Money Mission sessions use one dated ledger.
export function assessDatedCandidate(state: DemoState, input: CandidateInput, savedCents: number,
  constraintViolations: string[], latestAllowedDate: string): CandidateAssessment {
  const goal = { ...state.goal, savedCents, targetCents: input.targetCents, targetDate: latestAllowedDate };
  const projected = { ...state, goal, goals: state.goals.map(item => item.id === goal.id ? goal : item) };
  const horizonEnd = addIsoDays(state.clock, 366);
  const base = buildDatedCashflowForecast(projected, { accountId: 'checking', horizonEnd, scenario: 'baseline' });
  const salaries = base.events.filter(event => event.id.startsWith('salary:'));
  const dates = salaries.map(event => addIsoDays(event.date, 1));
  const overrides: Record<string, number> = {};
  if (dates[0] && input.firstMonthContributionCents !== undefined) overrides[dates[0].slice(0, 7)] = input.firstMonthContributionCents;
  const edits: CashflowEdit[] = [];
  const scenario = input.scenario;
  if (scenario.kind === 'current_month_expense') edits.push({ date: addIsoDays(state.clock, 1), label: '用户情景：额外支出', amountCents: -(scenario.amountCents ?? 0), currency: 'CNY' });
  dates.forEach((date, index) => {
    if (scenario.kind === 'missed_contribution_once' && index === scenario.monthIndex) overrides[date.slice(0, 7)] = 0;
    if (index < (scenario.startMonthIndex ?? 0)) return;
    const amount = scenario.amountCents ?? 0;
    if (scenario.kind === 'monthly_income_reduction') edits.push({ operation: 'replace', eventId: salaries[index].id, date: salaries[index].date, label: '用户情景：收入减少', amountCents: Math.max(0, salaries[index].amountCents - amount), currency: 'CNY' });
    if (scenario.kind === 'monthly_essential_spending_increase') {
      const [year, month] = date.split('-').map(Number);
      edits.push({ date: monthDate(year, month - 1, 1), label: '用户情景：必要支出增加', amountCents: -amount, currency: 'CNY' });
    }
  });
  const forecast = buildDatedCashflowForecast(projected, { accountId: 'checking', horizonEnd, scenario: 'edited', edits, contributionCents: input.monthlyContributionCents, contributionOverrides: overrides });
  const transfers = forecast.events.filter(event => event.sourceRefs.includes('preview'));
  const remaining = Math.max(0, input.targetCents - savedCents);
  let accumulated = savedCents;
  let projectedDate: string | null = remaining === 0 ? state.clock : null;
  for (const event of transfers) { accumulated -= event.amountCents; if (accumulated >= input.targetCents && projectedDate === null) projectedDate = event.date; }
  const fundedByTargetCents = transfers.filter(event => event.date <= input.targetDate).reduce((sum, event) => sum - event.amountCents, 0);
  const cyclesByTarget = dates.filter(date => date <= input.targetDate).length;
  const reserve = Math.max(0, input.protectedCents - state.finance.emergencyCents);
  const violations = [...constraintViolations];
  const buffer = (forecast.minimumBalanceCents ?? 0) - reserve;
  if (forecast.precision === 'exact' && buffer < 0) violations.push('MONTHLY_CAPACITY_EXCEEDED');
  if (scenario.kind === 'baseline' && projectedDate && projectedDate > latestAllowedDate) violations.push('PROJECTED_AFTER_ALLOWED_END');
  const dataSufficient = forecast.precision === 'exact';
  const available = Math.max(0, state.finance.monthlyIncomeCents - state.finance.fixedBillsCents - state.finance.essentialSpendingCents);
  const delayDays = projectedDate ? Math.max(0, Math.ceil((Date.parse(projectedDate) - Date.parse(input.targetDate)) / 86400000)) : 0;
  return { status: violations.length ? 'infeasible' : !dataSufficient ? 'insufficient_data' : !projectedDate || projectedDate > input.targetDate ? 'at_risk' : 'on_track',
    projectedDate: dataSufficient && !violations.length ? projectedDate : null,
    requiredMonthlyCents: Math.ceil(remaining / Math.max(1, cyclesByTarget)), availableMonthlyCents: available,
    firstMonthCapacityCents: Math.max(0, Math.min(state.finance.checkingCents - reserve, available)), bufferCents: buffer,
    fundedByTargetCents, shortfallCents: Math.max(0, remaining - fundedByTargetCents), delayDays, dataSufficient, constraintViolations: violations };
}
