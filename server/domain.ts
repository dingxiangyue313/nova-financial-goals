import type { Assessment, DemoState, Impact, Plan } from '../shared/contracts.ts';

const DAY = 86_400_000;
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.ceil((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY));
}
function roundHundredYuan(cents: number): number { return Math.ceil(cents / 10000) * 10000; }

export function availableMonthly(state: DemoState): number {
  const f = state.finance;
  return Math.max(0, f.monthlyIncomeCents - f.fixedBillsCents - f.essentialSpendingCents);
}

export function assessGoal(state: DemoState): Assessment {
  const { goal, finance, clock } = state;
  const months = Math.max(1, Math.ceil(daysBetween(clock, goal.targetDate) / 30));
  const remaining = Math.max(0, goal.targetCents - goal.savedCents);
  const required = Math.ceil(remaining / months);
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
  return { ...state, goal: { ...state.goal, status: 'active', selectedPlanId: plan.id, monthlyContributionCents: plan.monthlyCents } };
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
  const months = Math.max(1, Math.ceil(daysBetween(state.clock, state.goal.targetDate) / 30));
  const delayDays = Math.ceil(shortfall / Math.max(1, state.goal.monthlyContributionCents) * 30);
  const optionAContributionCents = roundHundredYuan(state.goal.monthlyContributionCents + shortfall / Math.max(1, months - 1));
  const impact: Impact = { id: crypto.randomUUID(), title, expenseCents, detectedAt: state.clock, shortfallCents: shortfall,
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
  return { ...state, pendingImpact: null, goal: {
    ...state.goal,
    monthlyContributionCents: decision === 'A' ? impact.optionAContributionCents : state.goal.monthlyContributionCents,
    targetDate: decision === 'B' ? impact.optionBDate : state.goal.originalDate,
  } };
}
