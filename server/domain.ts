import type { Assessment, CandidateAssessment, CandidateInput, DemoState, Impact, Plan } from '../shared/contracts.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { buildMoneyMissionPlans, competingGoalMonthlyCents, datedMonthlyCapacity,
  forecastHasExecutionAuthority, goalContributionDates, hasDatedCashflowEvidence,
  goalForecastWindow, minimumAfterContributions } from './money-mission-plans.ts';

const DAY = 86_400_000;
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.ceil((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY));
}
export function calculateMonthlyRequirement(targetCents: number, savedCents: number, today: string, targetDate: string) {
  const remainingCents = Math.max(0, targetCents - savedCents);
  const remainingMonths = Math.max(1, Math.ceil(daysBetween(today, targetDate) / 30));
  // Money is stored in integer cents; round up so the monthly amount covers the goal.
  const requiredMonthlyCents = Math.ceil(remainingCents / remainingMonths);
  return { remainingCents, remainingMonths, requiredMonthlyCents };
}
function roundHundredYuan(cents: number): number { return Math.ceil(cents / 10000) * 10000; }

export function availableMonthly(state: DemoState): number {
  const f = state.finance;
  return Math.max(0, f.monthlyIncomeCents - f.fixedBillsCents - f.essentialSpendingCents);
}

export type CandidateMonth = { monthIndex: number; availableCents: number;
  capacityCents: number; contributedCents: number; cumulativeCents: number };

function datedCandidate(state: DemoState, input: CandidateInput, savedCents: number,
  constraintViolations: string[], latestAllowedDate: string) {
  const goal = { ...state.goal, targetCents: input.targetCents, targetDate: input.targetDate,
    savedCents, protectedCents: input.protectedCents };
  const virtual = { ...state, goal };
  const window = goalForecastWindow(state, input.targetDate);
  const baseline = buildDatedCashflowForecast(virtual, { accountId: 'checking',
    horizonEnd: window.horizonEnd, scenario: 'baseline' });
  const plans = buildMoneyMissionPlans(virtual, baseline);
  const matches = plans.filter(plan => plan.monthlyCents === input.monthlyContributionCents &&
    (input.firstMonthContributionCents === plan.firstMonthContributionCents ||
      input.firstMonthContributionCents === undefined && plan.upfrontCents === 0));
  const matching = matches.find(plan => plan.id === state.goal.selectedPlanId) ?? matches[0];
  const acceptedSelection = state.goal.selectedPlanId !== null && ['active', 'paused'].includes(state.goal.status) &&
    state.goal.savedCents < state.goal.targetCents && input.monthlyContributionCents === state.goal.monthlyContributionCents &&
    input.firstMonthContributionCents === state.goal.firstMonthContributionCents;
  const ambiguous = matches.some(plan => plan.limitations.includes('AMBIGUOUS_SCHEDULE')) ||
    acceptedSelection && matches.length === 0 && state.goal.contributionMode !== 'fixed_monthly';
  const edits: import('../shared/contracts.ts').CashflowEdit[] = [];
  const scenario = input.scenario;
  if (scenario.kind === 'current_month_expense') edits.push({ type: 'add', event: {
    id: 'candidate-expense', date: addDays(state.clock, 1), label: '假设额外支出', kind: 'purchase',
    amountCents: -(scenario.amountCents ?? 0), currency: 'CNY', sourceRefs: ['candidate-scenario'] } });
  if (scenario.kind === 'monthly_income_reduction') baseline.events.filter(event => event.kind === 'income' &&
    event.label === '工资').forEach((event, index) => {
    if (index >= (scenario.startMonthIndex ?? 0)) edits.push({ type: 'update', eventId: event.id,
      amountCents: Math.max(0, event.amountCents - (scenario.amountCents ?? 0)) });
  });
  if (scenario.kind === 'monthly_essential_spending_increase') goalContributionDates(baseline)
    .filter(date => date <= input.targetDate).forEach((date, index) => {
      if (index >= (scenario.startMonthIndex ?? 0)) edits.push({ type: 'add', event: {
        id: `candidate-essentials-${index}`, date, label: '假设必要支出增加', kind: 'purchase',
        amountCents: -(scenario.amountCents ?? 0), currency: 'CNY', sourceRefs: ['candidate-scenario'] } });
    });
  const forecast = edits.length ? buildDatedCashflowForecast(virtual, { accountId: 'checking',
    horizonEnd: window.horizonEnd, scenario: 'edited', edits }) : baseline;
  const available = datedMonthlyCapacity(forecast);
  const reserve = Math.max(0, input.protectedCents - state.finance.emergencyCents);
  const firstCapacity = Math.max(0, Math.min(available, (forecast.startingBalanceCents ?? 0) - reserve));
  const dates = goalContributionDates(forecast).filter(date => date <= input.targetDate && date <= forecast.horizonEnd);
  const upfront = input.targetDate < state.clock ? 0 : matching?.upfrontCents ?? 0;
  const planned = ambiguous ? [] : dates.map((date, index) => ({ date, amountCents: index === 0 && !upfront
    ? input.firstMonthContributionCents ?? input.monthlyContributionCents : input.monthlyContributionCents }));
  if (upfront && !ambiguous) planned.unshift({ date: state.clock, amountCents: upfront });
  let remaining = Math.max(0, input.targetCents - savedCents); let projectedDate: string | null = remaining ? null : state.clock;
  const contributions: Array<{ date: string; amountCents: number }> = [];
  const months: CandidateMonth[] = [];
  let cumulativeCents = savedCents;
  planned.forEach((item, monthIndex) => {
    const contributedCents = scenario.kind === 'missed_contribution_once' && monthIndex === scenario.monthIndex
      ? 0 : Math.min(item.amountCents, remaining);
    remaining -= contributedCents; cumulativeCents += contributedCents;
    if (contributedCents) contributions.push({ date: item.date, amountCents: contributedCents });
    if (!remaining && projectedDate === null) projectedDate = item.date;
    months.push({ monthIndex, availableCents: available, capacityCents: monthIndex ? available : firstCapacity,
      contributedCents, cumulativeCents });
  });
  const minimum = minimumAfterContributions(virtual, forecast, contributions);
  const violations = [...constraintViolations, ...window.limitations];
  if (ambiguous) violations.push('AMBIGUOUS_SCHEDULE');
  if (input.monthlyContributionCents > available) violations.push('MONTHLY_CAPACITY_EXCEEDED');
  if (minimum !== null && minimum < reserve) violations.push('PROTECTED_FUNDS_UNAVAILABLE');
  const competing = competingGoalMonthlyCents(virtual);
  if (competing && input.monthlyContributionCents + competing > available) violations.push('GOAL_PRIORITY_CONFLICT');
  if (scenario.kind === 'baseline' && projectedDate && projectedDate > latestAllowedDate)
    violations.push('PROJECTED_AFTER_ALLOWED_END');
  const dataSufficient = forecastHasExecutionAuthority(virtual, forecast) && !window.limitations.length && !ambiguous;
  const assessment: CandidateAssessment = {
    status: violations.length ? 'infeasible' : !dataSufficient ? 'insufficient_data' : projectedDate ? 'on_track' : 'at_risk',
    projectedDate: violations.length ? null : projectedDate,
    requiredMonthlyCents: Math.ceil(Math.max(0, input.targetCents - savedCents) / Math.max(1, dates.length)),
    availableMonthlyCents: available, firstMonthCapacityCents: firstCapacity,
    bufferCents: minimum === null ? 0 : minimum - reserve,
    fundedByTargetCents: Math.max(0, input.targetCents - savedCents) - remaining,
    shortfallCents: remaining, delayDays: remaining && input.monthlyContributionCents
      ? Math.ceil(remaining / input.monthlyContributionCents) * 30 : 0,
    dataSufficient, constraintViolations: violations,
  };
  return { assessment, simulation: { months, firstMonthCapacityCents: firstCapacity,
    availableMonthlyCents: available, futureContributionCents: ambiguous ? 0 : Math.min(input.monthlyContributionCents, available) } };
}

export function simulateCandidateMonths(state: DemoState, input: CandidateInput,
  savedCents: number): { months: CandidateMonth[]; firstMonthCapacityCents: number;
    availableMonthlyCents: number; futureContributionCents: number } {
  if (hasDatedCashflowEvidence(state)) return datedCandidate(state, input, savedCents, [], input.targetDate).simulation;
  const count = calculateMonthlyRequirement(input.targetCents, savedCents, state.clock, input.targetDate).remainingMonths;
  const scenario = input.scenario;
  const reserveFromChecking = Math.max(0, input.protectedCents - state.finance.emergencyCents);
  const monthlyAvailable = (index: number) => {
    const ongoing = index >= (scenario.startMonthIndex ?? 0);
    const income = scenario.kind === 'monthly_income_reduction' && ongoing
      ? Math.max(0, state.finance.monthlyIncomeCents - (scenario.amountCents ?? 0))
      : state.finance.monthlyIncomeCents;
    const essentials = scenario.kind === 'monthly_essential_spending_increase' && ongoing
      ? state.finance.essentialSpendingCents + (scenario.amountCents ?? 0)
      : state.finance.essentialSpendingCents;
    return Math.max(0, income - state.finance.fixedBillsCents - essentials);
  };
  const months: CandidateMonth[] = [];
  let cumulativeCents = savedCents;
  for (let monthIndex = 0; monthIndex < count; monthIndex++) {
    const availableCents = monthlyAvailable(monthIndex);
    const capacityCents = monthIndex === 0 ? Math.max(0, Math.min(
      availableCents - state.finance.currentMonthExpenseCents -
        (scenario.kind === 'current_month_expense' ? scenario.amountCents ?? 0 : 0),
      state.finance.checkingCents - reserveFromChecking -
        (scenario.kind === 'current_month_expense' ? scenario.amountCents ?? 0 : 0),
    )) : availableCents;
    const skipped = scenario.kind === 'missed_contribution_once' && monthIndex === scenario.monthIndex;
    const plannedCents = monthIndex === 0
      ? input.firstMonthContributionCents ?? input.monthlyContributionCents
      : input.monthlyContributionCents;
    const contributedCents = skipped ? 0 : Math.min(plannedCents, capacityCents);
    cumulativeCents += contributedCents;
    months.push({ monthIndex, availableCents, capacityCents, contributedCents, cumulativeCents });
  }
  return { months, firstMonthCapacityCents: months[0].capacityCents,
    availableMonthlyCents: months[0].availableCents,
    futureContributionCents: Math.min(input.monthlyContributionCents, monthlyAvailable(count)) };
}

export function assessCandidateScenario(state: DemoState, input: CandidateInput,
  savedCents: number, constraintViolations: string[], latestAllowedDate: string): CandidateAssessment {
  if (hasDatedCashflowEvidence(state))
    return datedCandidate(state, input, savedCents, constraintViolations, latestAllowedDate).assessment;
  const { remainingCents: remaining, remainingMonths: months, requiredMonthlyCents: required } =
    calculateMonthlyRequirement(input.targetCents, savedCents, state.clock, input.targetDate);
  const simulation = simulateCandidateMonths(state, input, savedCents);
  const available = simulation.availableMonthlyCents;
  const reserveFromChecking = Math.max(0, input.protectedCents - state.finance.emergencyCents);
  const firstMonthCapacity = simulation.firstMonthCapacityCents;
  const fundedByTarget = simulation.months.reduce((sum, month) => sum + month.contributedCents, 0);
  const shortfall = Math.max(0, remaining - fundedByTarget);
  const futureContribution = simulation.futureContributionCents;
  let delayDays = shortfall && futureContribution > 0 ? Math.ceil(shortfall / futureContribution * 30) : 0;
  const earlyDays = shortfall === 0 && futureContribution > 0
    ? Math.min(30, Math.floor((fundedByTarget - remaining) / futureContribution * 30)) : 0;
  let projectedDate = futureContribution <= 0 && remaining > 0 ? null
    : addDays(input.targetDate, delayDays - earlyDays);
  if (input.scenario.kind === 'missed_contribution_once' &&
    simulation.months.some(month => month.monthIndex < (input.scenario.monthIndex ?? 0) &&
      month.cumulativeCents >= input.targetCents)) {
    const baseline = assessCandidateScenario(state, { ...input, scenario: { kind: 'baseline' } },
      savedCents, [], latestAllowedDate);
    projectedDate = baseline.projectedDate;
    delayDays = baseline.delayDays;
  }
  const dataSufficient = state.finance.historyMonths >= 2;
  const violations = [...constraintViolations];
  if (input.monthlyContributionCents > availableMonthly(state) ||
    (input.firstMonthContributionCents ?? 0) > firstMonthCapacity) violations.push('MONTHLY_CAPACITY_EXCEEDED');
  if (reserveFromChecking > state.finance.checkingCents) violations.push('PROTECTED_FUNDS_UNAVAILABLE');
  if (input.scenario.kind === 'baseline' && projectedDate && projectedDate > latestAllowedDate)
    violations.push('PROJECTED_AFTER_ALLOWED_END');
  const status: CandidateAssessment['status'] = violations.length ? 'infeasible'
    : !dataSufficient ? 'insufficient_data'
      : !projectedDate || projectedDate > input.targetDate ? 'at_risk' : 'on_track';
  return { status, projectedDate: dataSufficient && !violations.length ? projectedDate : null,
    requiredMonthlyCents: required, availableMonthlyCents: available,
    firstMonthCapacityCents: firstMonthCapacity,
    bufferCents: input.scenario.kind === 'missed_contribution_once' && input.scenario.monthIndex === 0
      ? firstMonthCapacity : firstMonthCapacity - (input.firstMonthContributionCents ?? input.monthlyContributionCents),
    fundedByTargetCents: fundedByTarget, shortfallCents: shortfall, delayDays,
    dataSufficient, constraintViolations: violations };
}

export function assessGoal(state: DemoState): Assessment {
  const { goal, finance, clock } = state;
  if (hasDatedCashflowEvidence(state)) {
    const forecast = buildDatedCashflowForecast(state, { accountId: 'checking',
      horizonEnd: goalForecastWindow(state, goal.targetDate).horizonEnd, scenario: 'baseline' });
    const options = buildMoneyMissionPlans(state, forecast);
    const chosen = datedCandidate(state, { targetCents: goal.targetCents, targetDate: goal.targetDate,
      monthlyContributionCents: goal.monthlyContributionCents, firstMonthContributionCents: goal.firstMonthContributionCents,
      protectedCents: goal.protectedCents, scenario: { kind: 'baseline' }, evidenceResultIds: [] }, goal.savedCents,
    [], goal.targetDate).assessment;
    return { status: chosen.status,
      progressPercent: goal.targetCents ? Math.min(100, Math.round(goal.savedCents / goal.targetCents * 1000) / 10) : 0,
      requiredMonthlyCents: chosen.requiredMonthlyCents, availableMonthlyCents: chosen.availableMonthlyCents,
      projectedDate: chosen.projectedDate, delayDays: chosen.delayDays, safeToSpendCents: chosen.bufferCents,
      dataSufficiency: chosen.dataSufficient ? '基于当日权威余额与日期级模拟事件'
        : chosen.constraintViolations.length ? chosen.constraintViolations.join('；') : '缺少当日权威余额，方案仅供参考',
      assumptions: [...forecast.assumptions, ...chosen.constraintViolations], updatedAt: clock,
      plans: options.filter((option, index) => !options.slice(0, index).some(previous =>
        previous.monthlyCents === option.monthlyCents && previous.upfrontCents === option.upfrontCents &&
        previous.occurrences === option.occurrences && previous.projectedDate === option.projectedDate))
        .map((option, index) => ({ id: option.id, label: option.label, monthlyCents: option.monthlyCents,
        projectedDate: option.projectedDate, safeToSpendCents: option.minimumBalanceCents ?? 0,
        status: option.executable ? 'on_track' : 'infeasible', recommended: index === 1 && option.executable,
        explanation: option.executable ? `${option.upfrontCents ? `立即投入 ¥${option.upfrontCents / 100}，随后` : ''}每月投入 ¥${option.monthlyCents / 100}，共 ${option.occurrences} 次；执行仍需确认`
          : option.limitations.join('；') })) };
  }
  const { remainingCents: remaining, remainingMonths: months, requiredMonthlyCents: required } =
    calculateMonthlyRequirement(goal.targetCents, goal.savedCents, clock, goal.targetDate);
  const available = availableMonthly(state);
  const firstCapacity = Math.max(0, available - finance.currentMonthExpenseCents);
  const projectedFor = (monthly: number) => {
    if (monthly <= 0) return { date: null, delay: 0, safe: firstCapacity };
    const first = Math.min(monthly, firstCapacity);
    const later = Math.min(monthly, available);
    const fundedByTarget = first + later * (months - 1);
    const shortfall = Math.max(0, remaining - fundedByTarget);
    const delay = shortfall > 0 ? Math.ceil(shortfall / Math.max(1, later) * 30) : 0;
    const early = shortfall === 0 && later > 0 ? Math.min(30, Math.floor((fundedByTarget - remaining) / later * 30)) : 0;
    return { date: addDays(goal.targetDate, delay - early), delay, safe: firstCapacity - monthly };
  };
  const chosen = projectedFor(goal.monthlyContributionCents || Math.min(available, roundHundredYuan(required)));
  const status: Assessment['status'] = finance.historyMonths < 2 ? 'insufficient_data'
    : available === 0 || required > available ? 'infeasible'
    : chosen.delay > 0 ? 'at_risk' : 'on_track';
  const amounts = [Math.max(10000, roundHundredYuan(required * .8)), roundHundredYuan(required), Math.min(available, roundHundredYuan(required * 1.3))];
  const labels = ['保守方案', '平衡方案', '加速方案'];
  const ids = ['conservative', 'balanced', 'accelerated'];
  const plans: Plan[] = amounts.map((monthlyCents, i) => {
    const p = projectedFor(monthlyCents);
    const planStatus = monthlyCents > available || available === 0 ? 'infeasible' : p.delay > goal.flexibilityWeeks * 7 ? 'at_risk' : 'on_track';
    return { id: ids[i], label: labels[i], monthlyCents, projectedDate: finance.historyMonths < 2 ? null : p.date,
      safeToSpendCents: p.safe, status: planStatus, recommended: i === 1 && planStatus === 'on_track',
      explanation: planStatus === 'infeasible' ? '超过当前可用于目标的金额' : p.delay > 0 ? `按当前假设可能比目标日推迟约 ${p.delay} 天` : '按当前假设预计可在目标日前完成' };
  });
  return {
    status, progressPercent: goal.targetCents ? Math.min(100, Math.round(goal.savedCents / goal.targetCents * 1000) / 10) : 0,
    requiredMonthlyCents: required, availableMonthlyCents: available,
    projectedDate: status === 'insufficient_data' || status === 'infeasible' ? null : chosen.date,
    delayDays: chosen.delay, safeToSpendCents: chosen.safe,
    dataSufficiency: finance.historyMonths < 2 ? '模拟历史不足 2 个月，请补充数据或修改假设' : `基于近 ${finance.historyMonths} 个月模拟数据`,
    assumptions: ['收入与固定支出按近三个月模拟均值估计', '应急金严格隔离，不用于目标投入', '预计日期是估算，不是完成保证'],
    plans, updatedAt: clock,
  };
}

export function activatePlan(state: DemoState, planId: string | null): DemoState {
  if (!planId) throw new Error('PLAN_NOT_SELECTED');
  const assessment = assessGoal(state);
  const plan = assessment.plans.find(p => p.id === planId);
  if (!plan || plan.status === 'infeasible') throw new Error('PLAN_NOT_AVAILABLE');
  const dated = hasDatedCashflowEvidence(state) ? buildMoneyMissionPlans(state, buildDatedCashflowForecast(state,
    { accountId: 'checking', horizonEnd: goalForecastWindow(state, state.goal.targetDate).horizonEnd,
      scenario: 'baseline' })).find(option => option.id === plan.id) : null;
  const goal = { ...state.goal, contributionMode: undefined, status: 'active' as const, selectedPlanId: plan.id, monthlyContributionCents: plan.monthlyCents,
    ...(dated ? { firstMonthContributionCents: dated.firstMonthContributionCents } : {}) };
  return { ...state, goal, goals: state.goals.map(item => item.id === goal.id ? goal : item) };
}

export function injectExpense(state: DemoState, expenseCents: number, title: string): { state: DemoState; impact: Impact | null } {
  if (!Number.isInteger(expenseCents) || expenseCents <= 0 || expenseCents > state.finance.checkingCents) throw new Error('INVALID_EXPENSE');
  const next: DemoState = { ...state, finance: { ...state.finance, checkingCents: state.finance.checkingCents - expenseCents,
    currentMonthExpenseCents: state.finance.currentMonthExpenseCents + expenseCents } };
  const original = Math.min(state.goal.monthlyContributionCents, Math.max(0, availableMonthly(state) - state.finance.currentMonthExpenseCents));
  const current = Math.min(state.goal.monthlyContributionCents, Math.max(0, availableMonthly(next) - next.finance.currentMonthExpenseCents));
  const shortfall = Math.max(0, original - current);
  if (state.goal.status !== 'active' || shortfall === 0 || (expenseCents < 50000 && expenseCents < (state.goal.targetCents - state.goal.savedCents) * .05)) {
    return { state: next, impact: null };
  }
  const months = calculateMonthlyRequirement(state.goal.targetCents, state.goal.savedCents,
    state.clock, state.goal.targetDate).remainingMonths;
  const delayDays = Math.ceil(shortfall / Math.max(1, state.goal.monthlyContributionCents) * 30);
  const optionAContributionCents = roundHundredYuan(state.goal.monthlyContributionCents + shortfall / Math.max(1, months - 1));
  const impact: Impact = { id: crypto.randomUUID(), goalId: state.goal.id, title, expenseCents, detectedAt: state.clock, shortfallCents: shortfall,
    delayDays, optionAContributionCents, optionAAvailable: optionAContributionCents <= availableMonthly(state),
    optionBDate: addDays(state.goal.targetDate, delayDays), dismissed: false };
  next.pendingImpact = impact;
  return { state: next, impact };
}

export function resolveImpact(state: DemoState, decision: 'A' | 'B' | 'later' | 'dismiss'): DemoState {
  const impact = state.pendingImpact;
  if (!impact) throw new Error('NO_PENDING_IMPACT');
  if (decision === 'later') return state;
  if (decision === 'dismiss') return { ...state, pendingImpact: null };
  if (decision === 'A' && !impact.optionAAvailable) throw new Error('PLAN_NOT_AVAILABLE');
  const goal = {
    ...state.goal,
    monthlyContributionCents: decision === 'A' ? impact.optionAContributionCents : state.goal.monthlyContributionCents,
    targetDate: decision === 'B' ? impact.optionBDate : state.goal.originalDate,
  };
  return { ...state, pendingImpact: null, goal, goals: state.goals.map(item => item.id === goal.id ? goal : item) };
}
