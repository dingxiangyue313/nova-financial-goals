import type { DemoState, DatedCashflowForecast, GoalPlanOption } from '../shared/contracts.ts';
import { missionCompletionDate } from '../shared/mission.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { stableHash } from './governance.ts';

export function buildMoneyMissionPlans(state: DemoState, forecast: DatedCashflowForecast): [GoalPlanOption,GoalPlanOption,GoalPlanOption] {
  if (forecast.twinVersion !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
  const gap = Math.max(0,state.goal.targetCents-state.goal.savedCents);
  const monthlyCapacity = Math.max(0,state.finance.monthlyIncomeCents-state.finance.fixedBillsCents-state.finance.essentialSpendingCents);
  const otherCommitments = state.goals.filter(g => g.id !== state.goal.id && g.status === 'active').reduce((sum,g) => sum+g.monthlyContributionCents,0);
  const reserve = Math.max(0,state.goal.protectedCents-state.finance.emergencyCents);
  return [{ key:'steady',label:'稳健',monthly:75000,upfront:0 },{ key:'balanced',label:'平衡',monthly:100000,upfront:0 },{ key:'accelerated',label:'加速',monthly:120000,upfront:Math.min(120000,gap) }].map(option => {
    const monthly = Math.min(option.monthly,Math.max(1,gap));
    const occurrences = Math.ceil(Math.max(0,gap-option.upfront)/monthly);
    const projectedDate = missionCompletionDate(state.clock,gap,monthly,option.upfront);
    const projectedGoal = { ...state.goal, savedCents: state.goal.savedCents + option.upfront };
    const projectedState = { ...state, goal: projectedGoal, goals: state.goals.map(g => g.id === projectedGoal.id ? projectedGoal : g) };
    const dated = buildDatedCashflowForecast(projectedState,{accountId:forecast.accountId,horizonEnd:forecast.horizonEnd,scenario:'baseline',contributionCents:monthly,edits:option.upfront ? [{date:new Date(Date.parse(state.clock+'T00:00:00Z')+86400000).toISOString().slice(0,10),amountCents:-option.upfront,label:'一次性旅行金',currency:'CNY'}] : [] });
    const conflicts: string[] = [];
    if (otherCommitments + monthly > monthlyCapacity) conflicts.push('多个目标竞争同一月度资金，请先选择优先级或降低投入。');
    if (dated.minimumBalanceCents !== null && dated.minimumBalanceCents < reserve) conflicts.push('转入后可能影响保护资金。');
    if (projectedDate && projectedDate > state.goal.targetDate) conflicts.push('当前节奏晚于目标日期。');
    return {id:`plan:${stableHash([state.goal.id,state.twinVersion,option]).slice(0,24)}`,goalId:state.goal.id,label:option.label,monthlyCents:monthly,upfrontCents:option.upfront,occurrences,firstMonthContributionCents:Math.max(option.upfront,monthly),projectedDate,minimumBalanceCents:dated.minimumBalanceCents,forecastId:forecast.forecastId,twinVersion:state.twinVersion,executable:forecast.precision==='exact' && conflicts.length===0 && gap>0,conflicts,explanation:option.upfront ? '先单独确认一次性转入，再按工资到账创建月度计划。' : '每月工资实际到账后次日转入；未到账则跳过。'};
  }) as [GoalPlanOption,GoalPlanOption,GoalPlanOption];
}
