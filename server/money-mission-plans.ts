import { createHash } from 'node:crypto';
import { GoalPlanOptionSchema, type DatedCashflowForecast, type DemoState,
  type GoalPlanOption } from '../shared/contracts.ts';

const dayAfter = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/** Goal deadlines may be outside the ledger's supported window; keep that limitation explicit. */
export function goalForecastWindow(state: DemoState, deadline: string): { horizonEnd: string; limitations: string[] } {
  const maximum = new Date(Date.parse(`${state.clock}T00:00:00Z`) + 366 * 86400000).toISOString().slice(0, 10);
  return deadline < state.clock ? { horizonEnd: state.clock, limitations: ['GOAL_DEADLINE_PASSED'] }
    : deadline > maximum ? { horizonEnd: maximum, limitations: ['FORECAST_HORIZON_INCOMPLETE'] }
      : { horizonEnd: deadline, limitations: [] };
}

type Contribution = { date: string; amountCents: number };
/** First month means the calendar month containing the first actual contribution, not just its first deposit. */
function firstContributionMonthTotal(contributions: Contribution[]): number {
  const month = contributions.filter(item => item.amountCents > 0).map(item => item.date).sort()[0]?.slice(0, 7);
  return contributions.filter(item => item.date.slice(0, 7) === month)
    .reduce((sum, item) => sum + item.amountCents, 0);
}

/** Old connectors add historical bank rows beside an untyped current payroll. That history does not migrate a legacy goal. */
export function hasDatedCashflowEvidence(state: DemoState): boolean {
  const salaries = state.transactions.filter(item => item.accountId === 'checking' && item.date <= state.clock &&
    item.category === 'income' && item.title === '工资' && item.amountCents > 0);
  const latestSalaryDate = salaries.map(item => item.date).sort().at(-1);
  return state.accountSnapshots.length > 0 || state.datedCashflowForecasts.length > 0 ||
    salaries.some(item => item.date === latestSalaryDate && item.sourceKind === 'bank');
}

export function goalContributionDates(forecast: DatedCashflowForecast): string[] {
  return [...new Set(forecast.events.filter(event => event.kind === 'income' && event.label === '工资')
    .map(event => dayAfter(event.date)))].sort();
}

export function datedMonthlyCapacity(forecast: DatedCashflowForecast): number {
  const months = new Map<string, { income: number; spending: number }>();
  for (const event of forecast.events) {
    const key = event.date.slice(0, 7); const month = months.get(key) ?? { income: 0, spending: 0 };
    if (event.amountCents > 0) month.income += event.amountCents;
    else if (event.kind !== 'transfer') month.spending -= event.amountCents;
    months.set(key, month);
  }
  const capacities = [...months.values()].filter(month => month.income > 0)
    .map(month => Math.max(0, month.income - month.spending));
  return capacities.length ? Math.min(...capacities) : 0;
}

export function competingGoalMonthlyCents(state: DemoState): number {
  return state.goals.filter(goal => goal.id !== state.goal.id && goal.status === 'active' &&
    goal.savedCents < goal.targetCents).reduce((sum, goal) => sum + goal.monthlyContributionCents, 0);
}

/** Replay the same ordered ledger with one alternative's transfers, never all three alternatives together. */
export function minimumAfterContributions(state: DemoState, forecast: DatedCashflowForecast,
  contributions: Contribution[]): number | null {
  if (forecast.precision !== 'exact' || forecast.startingBalanceCents === null) return null;
  const ownSchedules = new Set(state.transferSchedules.filter(schedule => schedule.goalId === state.goal.id)
    .map(schedule => schedule.id));
  const events = forecast.events.filter(event => event.kind !== 'transfer' ||
    !event.sourceRefs.some(ref => ownSchedules.has(ref)));
  const ledger = [...events, ...contributions.map((item, index) => ({ date: item.date,
    amountCents: -item.amountCents, priority: 40, id: `plan-contribution-${index}` }))]
    .sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority || a.id.localeCompare(b.id));
  let balance = forecast.startingBalanceCents; let minimum = balance;
  for (const event of ledger) { balance += event.amountCents; minimum = Math.min(minimum, balance); }
  return minimum;
}

export function forecastHasExecutionAuthority(state: DemoState, forecast: DatedCashflowForecast): boolean {
  const account = state.accounts.find(item => item.id === forecast.accountId);
  return forecast.precision === 'exact' && forecast.executableForecastId === forecast.id &&
    forecast.twinVersion === state.twinVersion && forecast.horizonStart === state.clock &&
    forecast.dataAsOf === state.clock && account?.type === 'checking' && !account.protected &&
    account.currency === forecast.currency && account.balanceCents === forecast.startingBalanceCents &&
    state.accountSnapshots.some(snapshot => snapshot.accountId === account.id && snapshot.asOf === state.clock &&
      snapshot.twinVersion <= state.twinVersion && snapshot.balanceCents === account.balanceCents &&
      snapshot.currency === account.currency);
}

export function buildMoneyMissionPlans(state: DemoState, forecast: DatedCashflowForecast):
  [GoalPlanOption, GoalPlanOption, GoalPlanOption] {
  const remaining = Math.max(0, state.goal.targetCents - state.goal.savedCents);
  const dates = goalContributionDates(forecast).filter(date => date <= state.goal.targetDate && date <= forecast.horizonEnd);
  const count = Math.max(1, dates.length);
  const variants = [
    { label: '稳健方案', occurrences: count, upfrontParts: 0 },
    { label: '平衡方案', occurrences: Math.max(1, Math.ceil(count * 3 / 4)), upfrontParts: 0 },
    { label: '加速方案', occurrences: Math.max(1, Math.floor(count / 2)), upfrontParts: 1 },
  ];
  const capacity = datedMonthlyCapacity(forecast);
  const competing = competingGoalMonthlyCents(state);
  const reserve = Math.max(0, state.goal.protectedCents - state.finance.emergencyCents);
  const funding = variants.map(variant => {
    const monthlyCents = Math.floor(remaining / (variant.occurrences + variant.upfrontParts));
    const upfrontCents = remaining - monthlyCents * variant.occurrences;
    const contributions = dates.slice(0, variant.occurrences).map(date => ({ date, amountCents: monthlyCents }));
    if (upfrontCents) contributions.unshift({ date: state.clock, amountCents: upfrontCents });
    return { ...variant, monthlyCents, upfrontCents, contributions,
      firstMonthContributionCents: firstContributionMonthTotal(contributions) };
  });
  const plans = funding.map(variant => {
    const { monthlyCents, upfrontCents, contributions, firstMonthContributionCents } = variant;
    const minimumBalanceCents = minimumAfterContributions(state, forecast, contributions);
    const limitations = [...forecast.limitations, ...goalForecastWindow(state, state.goal.targetDate).limitations];
    if (!forecastHasExecutionAuthority(state, forecast)) limitations.push('AUTHORITATIVE_BALANCE_REQUIRED');
    if (dates.length < variant.occurrences || forecast.horizonEnd < state.goal.targetDate)
      limitations.push('FORECAST_HORIZON_INCOMPLETE');
    if (minimumBalanceCents !== null && minimumBalanceCents < reserve) limitations.push('PROTECTED_FUNDS_UNAVAILABLE');
    if (monthlyCents > capacity) limitations.push('MONTHLY_CAPACITY_EXCEEDED');
    if (competing && monthlyCents + competing > capacity) limitations.push('GOAL_PRIORITY_CONFLICT');
    if (funding.some(other => other.monthlyCents === monthlyCents &&
      other.firstMonthContributionCents === firstMonthContributionCents &&
      (other.upfrontCents !== upfrontCents || other.occurrences !== variant.occurrences)))
      limitations.push('AMBIGUOUS_SCHEDULE');
    const blockers = ['AUTHORITATIVE_BALANCE_REQUIRED', 'FORECAST_HORIZON_INCOMPLETE',
      'GOAL_DEADLINE_PASSED', 'AMBIGUOUS_SCHEDULE', 'PROTECTED_FUNDS_UNAVAILABLE',
      'MONTHLY_CAPACITY_EXCEEDED', 'GOAL_PRIORITY_CONFLICT'];
    const content = { goalId: state.goal.id, forecastId: forecast.id, twinVersion: state.twinVersion,
      label: variant.label, monthlyCents, upfrontCents,
      firstMonthContributionCents, occurrences: variant.occurrences,
      projectedDate: dates[variant.occurrences - 1] ?? state.goal.targetDate, minimumBalanceCents,
      executable: remaining > 0 && !limitations.some(value => blockers.includes(value)),
      evidenceRefs: [...new Set([forecast.id, ...forecast.evidenceRefs])].sort(),
      assumptions: [...forecast.assumptions, '各方案互为替代，不叠加分配资金；已存金额只抵扣一次',
        '首月投入为首次实际投入所在自然月内的一次性投入与定期投入合计',
        '一次性投入与后续月存分别计数；预计工资到账次日转入，实际执行仍须确认与验证'], limitations };
    return GoalPlanOptionSchema.parse({ id: `goal-plan-${createHash('sha256').update(JSON.stringify(content)).digest('hex')}`,
      ...content });
  });
  return [plans[0], plans[1], plans[2]];
}
