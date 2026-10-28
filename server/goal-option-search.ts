import type { AgentTask, CandidateAssessment, CandidateInput, DemoState } from '../shared/contracts.ts';
import { assessCandidateScenario, availableMonthly } from './domain.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { buildMoneyMissionPlans, goalForecastWindow, hasDatedCashflowEvidence } from './money-mission-plans.ts';

export type SearchObjective = 'lower_monthly' | 'earlier' | 'higher_buffer' | 'balanced';
export type SearchOption = { monthlyContributionCents: number;
  firstMonthContributionCents?: number; assessment: CandidateAssessment };
export type GoalOptionSearch = {
  status: 'options_found' | 'none_within_constraints' | 'insufficient_data';
  searchedRangeCents: { min: number; max: number };
  evaluatedCount: number;
  options: SearchOption[];
  excluded: Array<{ reason: 'same_date_higher_monthly' | 'negative_first_month_buffer'; count: number }>;
  gaps: string[];
};

export function searchGoalOptions(state: DemoState, task: AgentTask,
  objective: SearchObjective = 'balanced', maxResults = 3): GoalOptionSearch {
  const goal = task.facts;
  const protectedCents = Math.max(task.constraints.protectedCents ?? 0, state.finance.emergencyCents);
  const reserveFromChecking = Math.max(0, protectedCents - state.finance.emergencyCents);
  const firstMonthCapacity = Math.max(0, Math.min(availableMonthly(state) - state.finance.currentMonthExpenseCents,
    state.finance.checkingCents - reserveFromChecking));
  const monthlyLimit = Math.max(0, Math.min(task.constraints.monthlyContributionCapCents ?? availableMonthly(state),
    availableMonthly(state)));
  const upper = Math.min(monthlyLimit, firstMonthCapacity);
  const base = { searchedRangeCents: { min: 0, max: upper }, evaluatedCount: 0,
    options: [] as SearchOption[], excluded: [] as GoalOptionSearch['excluded'], gaps: [] as string[] };
  if (!goal.title || goal.targetCents === null || !goal.originalTargetDate || goal.savedCents === null)
    return { ...base, status: 'insufficient_data', gaps: ['目标、日期或已存金额尚未确认'] };
  if (!hasDatedCashflowEvidence(state) && state.finance.historyMonths < 2)
    return { ...base, status: 'insufficient_data', gaps: ['模拟历史不足 2 个月'] };
  if (goal.originalTargetDate < state.clock)
    return { ...base, status: 'none_within_constraints', gaps: ['GOAL_DEADLINE_PASSED', '目标日期已经早于当前模拟日期'] };

  if (hasDatedCashflowEvidence(state)) {
    const selectedGoal = { ...state.goal, id: task.goalId ?? task.goalDraftId ?? state.goal.id,
      title: goal.title, targetCents: goal.targetCents, savedCents: goal.savedCents,
      targetDate: goal.originalTargetDate, protectedCents };
    const virtual = { ...state, goal: selectedGoal, goals: state.goals.some(item => item.id === selectedGoal.id)
      ? state.goals.map(item => item.id === selectedGoal.id ? selectedGoal : item) : [...state.goals, selectedGoal] };
    const forecast = buildDatedCashflowForecast(virtual, { accountId: 'checking',
      horizonEnd: goalForecastWindow(state, goal.originalTargetDate).horizonEnd, scenario: 'baseline' });
    const plans = buildMoneyMissionPlans(virtual, forecast);
    const gaps = [...new Set(plans.flatMap(plan => plan.limitations.filter(value =>
      ['AUTHORITATIVE_BALANCE_REQUIRED', 'GOAL_PRIORITY_CONFLICT', 'PROTECTED_FUNDS_UNAVAILABLE',
        'MONTHLY_CAPACITY_EXCEEDED', 'FORECAST_HORIZON_INCOMPLETE', 'GOAL_DEADLINE_PASSED',
        'AMBIGUOUS_SCHEDULE'].includes(value))))];
    // The legacy frozen candidate carries monthly and first-month amounts, but no plan ID or upfront discriminator.
    const eligible = plans.filter((plan, index) => !plans.slice(0, index).some(previous =>
      previous.monthlyCents === plan.monthlyCents && previous.firstMonthContributionCents === plan.firstMonthContributionCents))
      .filter(plan => plan.monthlyCents <= (task.constraints.monthlyContributionCapCents ?? Infinity) &&
      plan.firstMonthContributionCents <= (task.constraints.monthlyContributionCapCents ?? Infinity) &&
      !plan.limitations.some(value => ['GOAL_PRIORITY_CONFLICT', 'PROTECTED_FUNDS_UNAVAILABLE',
        'MONTHLY_CAPACITY_EXCEEDED', 'FORECAST_HORIZON_INCOMPLETE', 'GOAL_DEADLINE_PASSED',
        'AMBIGUOUS_SCHEDULE'].includes(value)));
    if (objective === 'earlier') eligible.sort((a, b) => a.projectedDate.localeCompare(b.projectedDate));
    const options = eligible.slice(0, Math.min(3, Math.max(1, maxResults))).map(plan => {
      const input: CandidateInput = { targetCents: goal.targetCents!, targetDate: goal.originalTargetDate!,
        monthlyContributionCents: plan.monthlyCents, firstMonthContributionCents: plan.firstMonthContributionCents,
        protectedCents, scenario: { kind: 'baseline' }, evidenceResultIds: [] };
      return { monthlyContributionCents: plan.monthlyCents, firstMonthContributionCents: plan.firstMonthContributionCents,
        assessment: assessCandidateScenario(virtual, input, goal.savedCents!, [], goal.originalTargetDate!) };
    });
    return { status: gaps.includes('AUTHORITATIVE_BALANCE_REQUIRED') || gaps.includes('FORECAST_HORIZON_INCOMPLETE') ? 'insufficient_data'
      : options.length ? 'options_found' : 'none_within_constraints',
    searchedRangeCents: { min: options.length ? Math.min(...options.map(option => option.monthlyContributionCents)) : 0,
      max: options.length ? Math.max(...options.map(option => option.monthlyContributionCents)) : 0 },
    evaluatedCount: plans.length, options, excluded: [], gaps };
  }

  const cache = new Map<number, CandidateAssessment>();
  const evaluate = (monthly: number) => {
    const existing = cache.get(monthly);
    if (existing) return existing;
    const input: CandidateInput = { targetCents: goal.targetCents!, targetDate: goal.originalTargetDate!,
      monthlyContributionCents: monthly, protectedCents, scenario: { kind: 'baseline' }, evidenceResultIds: [] };
    const result = assessCandidateScenario(state, input, goal.savedCents!, [], goal.originalTargetDate!);
    cache.set(monthly, result);
    return result;
  };
  const isEligible = (monthly: number) => {
    const result = evaluate(monthly);
    return result.status === 'on_track' && result.bufferCents >= 0;
  };
  if (!isEligible(upper)) {
    const negative = monthlyLimit > upper ? 1 : 0;
    return { ...base, status: 'none_within_constraints', evaluatedCount: cache.size,
      excluded: negative ? [{ reason: 'negative_first_month_buffer', count: negative }] : [],
      gaps: ['当前固定月存与首月可投入范围内，没有按时完成的方案'] };
  }

  let lo = 0;
  let hi = upper;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (isEligible(mid)) hi = mid;
    else lo = mid + 1;
  }
  const minimum = lo;
  // Offer real spending choices, not cent-level changes that move the estimate by days.
  // Round the input first, then run the full assessment on that rounded amount.
  const roundedMinimum = Math.ceil(minimum / 10000) * 10000;
  const roundedUpper = Math.floor(upper / 10000) * 10000;
  const middle = Math.round((roundedMinimum + roundedUpper) / 20000) * 10000;
  const candidateAmounts = roundedUpper - roundedMinimum < 30000
    ? [roundedUpper] : [roundedMinimum, middle, roundedUpper];
  const distinct = candidateAmounts
    .filter(amount => amount <= upper && isEligible(amount))
    .filter((amount, index, values) => values.indexOf(amount) === index)
    .filter((amount, index, values) => index === 0 || amount - values[index - 1] >= 30000);
  const selected = (objective === 'earlier' ? distinct.reverse() : distinct)
    .slice(0, Math.min(3, Math.max(1, maxResults)));
  const options: SearchOption[] = selected.map(monthlyContributionCents => ({ monthlyContributionCents,
    assessment: evaluate(monthlyContributionCents) }));
  // A lower first deposit is a distinct cash-flow choice when it still reaches the date.
  if (options.length === 1 && roundedUpper >= 50000) {
    const firstMonthContributionCents = roundedUpper - 50000;
    const input: CandidateInput = { targetCents: goal.targetCents, targetDate: goal.originalTargetDate,
      monthlyContributionCents: roundedUpper, firstMonthContributionCents,
      protectedCents, scenario: { kind: 'baseline' }, evidenceResultIds: [] };
    const assessment = assessCandidateScenario(state, input, goal.savedCents, [], goal.originalTargetDate);
    if (assessment.status === 'on_track' && assessment.bufferCents >= 0)
      options.unshift({ monthlyContributionCents: roundedUpper, firstMonthContributionCents, assessment });
  }
  if (!options.length) return { ...base, status: 'none_within_constraints', evaluatedCount: cache.size,
    gaps: ['当前上限内找不到按整百元存、又能按时完成的方案；可以自定义月存查看预计日期'] };
  return { status: 'options_found', searchedRangeCents: { min: minimum, max: upper },
    evaluatedCount: cache.size, options,
    excluded: [
      ...(upper > minimum && roundedUpper < upper ? [{ reason: 'same_date_higher_monthly' as const, count: upper - roundedUpper }] : []),
      ...(monthlyLimit > upper ? [{ reason: 'negative_first_month_buffer' as const, count: monthlyLimit - upper }] : []),
    ], gaps: [] };
}
