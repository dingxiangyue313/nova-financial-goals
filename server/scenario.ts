import {
  GoalAssumptionsSchema,
  GoalPlanChangeDraftSchema,
  GoalPlanChangePreviewSchema,
  GoalPlanChangeRequestSchema,
  GoalScenarioPreviewSchema,
  type DemoState,
  type GoalAssumptions,
  type GoalPlanChangeCandidate,
  type GoalPlanChangeDraft,
  type GoalPlanChangePreview,
  type GoalPlanChangeRequest,
  type GoalScenarioPreview,
  type PlanStep,
} from '../shared/contracts.ts';
import { assessGoal } from './domain.ts';
import { appendAuditEvent } from './governance.ts';

function previewId(state: DemoState, assumptions: GoalAssumptions) {
  return [
    'scenario', state.goal.id, state.twinVersion, assumptions.targetCents,
    assumptions.targetDate, assumptions.monthlyContributionCents,
    assumptions.protectedCents, assumptions.flexibilityWeeks,
  ].join(':');
}

function scenarioSteps(state: DemoState): PlanStep[] {
  const selected = Boolean(state.goal.selectedPlanId);
  const active = state.goal.status === 'active';
  return [
    { id: 'goal_details', label: '目标草案', status: 'complete', detail: '目标金额和日期已整理' },
    { id: 'assumptions', label: '核对假设', status: 'complete', detail: '当前试算使用可见且可编辑的假设' },
    { id: 'plan_selection', label: '选择方案', status: selected ? 'complete' : 'pending', detail: selected ? '已选择推进节奏' : '尚未选择方案' },
    { id: 'activation', label: '激活计划', status: active ? 'complete' : 'pending', detail: active ? '计划已激活' : '确认方案后才能激活' },
  ];
}

export function previewGoalScenario(state: DemoState, input: GoalAssumptions,
  draft?: { id: string; title: string; savedCents: number }): GoalScenarioPreview {
  const assumptions = GoalAssumptionsSchema.parse(input);
  const virtualState: DemoState = {
    ...state,
    goal: {
      ...state.goal,
      ...(draft ? { id: draft.id, title: draft.title, savedCents: draft.savedCents } : {}),
      targetCents: assumptions.targetCents,
      targetDate: assumptions.targetDate,
      monthlyContributionCents: assumptions.monthlyContributionCents,
      protectedCents: assumptions.protectedCents,
      flexibilityWeeks: assumptions.flexibilityWeeks,
    },
  };
  virtualState.goals = state.goals.some(goal => goal.id === virtualState.goal.id)
    ? state.goals.map(goal => goal.id === virtualState.goal.id ? virtualState.goal : goal)
    : [...state.goals, virtualState.goal];
  const calculated = assessGoal(virtualState);
  const assessment = assumptions.monthlyContributionCents === 0
    ? { ...calculated, status: 'at_risk' as const, projectedDate: null, delayDays: 0 }
    : calculated;
  return GoalScenarioPreviewSchema.parse({
    id: previewId(state, assumptions),
    goalId: draft?.id ?? state.goal.id,
    baseTwinVersion: state.twinVersion,
    generatedAt: state.clock,
    assumptions,
    assessment,
    plans: assessment.plans.slice(0, 3),
    steps: scenarioSteps(state),
    impact: {
      protectedFundsSafe: state.finance.emergencyCents >= assumptions.protectedCents,
      safeToSpendCents: assessment.safeToSpendCents,
      projectedDate: assessment.projectedDate,
      delayDays: assessment.delayDays,
    },
  });
}

const candidateKey = (monthlyCents: number, projectedDate: string | null) =>
  `${monthlyCents}:${projectedDate ?? 'unknown'}`;

function virtualPlanState(state: DemoState, draft: GoalPlanChangeDraft): DemoState {
  const goal = { ...state.goal, ...draft, originalDate: draft.targetDate,
    selectedPlanId: null, status: 'draft' as const, firstMonthContributionCents: undefined };
  return { ...state, goal, goals: state.goals.map(item => item.id === goal.id ? goal : item) };
}

export function previewGoalPlanChange(state: DemoState, input: GoalPlanChangeDraft): GoalPlanChangePreview {
  const draft = GoalPlanChangeDraftSchema.parse(input);
  const virtual = virtualPlanState(state, draft);
  const assessment = assessGoal(virtual);
  const seen = new Set<string>();
  const novaPlans = assessment.plans.flatMap<GoalPlanChangeCandidate>(plan => {
    const key = candidateKey(plan.monthlyCents, plan.projectedDate);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...plan, source: 'nova', duplicatePlanId: null,
      effectiveTargetDate: draft.targetDate, delayDays: plan.projectedDate && plan.projectedDate > draft.targetDate
        ? Math.max(0, Math.ceil((Date.parse(`${plan.projectedDate}T00:00:00Z`) - Date.parse(`${draft.targetDate}T00:00:00Z`)) / 86_400_000)) : 0,
      selectable: plan.status !== 'infeasible', requiresTargetDateChange: false,
      blockingReasons: plan.status === 'infeasible' ? ['PLAN_NOT_AVAILABLE'] : [] }];
  });
  const customBlockingReasons: string[] = [];
  if (draft.monthlyContributionCents > assessment.availableMonthlyCents)
    customBlockingReasons.push('MONTHLY_CAPACITY_EXCEEDED');
  if (assessment.safeToSpendCents < 0) customBlockingReasons.push('FIRST_MONTH_BUFFER_NEGATIVE');
  if (state.finance.emergencyCents < draft.protectedCents)
    customBlockingReasons.push('PROTECTED_FUNDS_UNAVAILABLE');
  if (state.finance.historyMonths < 2 || !assessment.projectedDate)
    customBlockingReasons.push('INSUFFICIENT_DATA');
  for (const reason of ['GOAL_DEADLINE_PASSED', 'FORECAST_HORIZON_INCOMPLETE', 'AMBIGUOUS_SCHEDULE']) {
    if (assessment.assumptions.includes(reason)) customBlockingReasons.push(reason);
  }
  const projectedDate = assessment.projectedDate;
  const requiresTargetDateChange = Boolean(projectedDate && projectedDate > draft.targetDate);
  const duplicate = novaPlans.find(plan => candidateKey(plan.monthlyCents, plan.projectedDate) ===
    candidateKey(draft.monthlyContributionCents, projectedDate));
  const customPlan: GoalPlanChangeCandidate = {
    id: 'custom', source: duplicate ? 'both' : 'user', duplicatePlanId: duplicate?.id ?? null,
    label: '你的方案', monthlyCents: draft.monthlyContributionCents, projectedDate,
    effectiveTargetDate: requiresTargetDateChange ? projectedDate! : draft.targetDate,
    delayDays: requiresTargetDateChange ? assessment.delayDays : 0,
    safeToSpendCents: assessment.safeToSpendCents,
    status: assessment.status === 'infeasible' || assessment.status === 'insufficient_data' ? 'infeasible'
      : requiresTargetDateChange ? 'at_risk' : assessment.status,
    explanation: requiresTargetDateChange
      ? `按这个金额预计 ${projectedDate} 完成，比原目标日晚 ${assessment.delayDays} 天`
      : projectedDate ? `按当前模拟收支，预计 ${projectedDate} 完成` : '当前数据不足，暂时无法算出完成日期',
    recommended: Boolean(duplicate?.recommended), selectable: customBlockingReasons.length === 0,
    requiresTargetDateChange, blockingReasons: [...new Set(customBlockingReasons)],
  };
  return GoalPlanChangePreviewSchema.parse({
    baseTwinVersion: state.twinVersion, draft,
    novaPlans: novaPlans.filter(plan => plan.id !== duplicate?.id).slice(0, 3), customPlan,
  });
}

export function applyGoalPlanChange(state: DemoState, input: GoalPlanChangeRequest): {
  state: DemoState; preview: GoalPlanChangePreview; scheduleReviewRequired: boolean;
} {
  const request = GoalPlanChangeRequestSchema.parse(input);
  if (request.expectedTwinVersion !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
  const preview = previewGoalPlanChange(state, request.draft);
  const candidate = request.selection.candidateId === 'custom' ? preview.customPlan
    : preview.novaPlans.find(plan => plan.id === request.selection.candidateId);
  if (!candidate?.selectable) throw new Error('PLAN_NOT_AVAILABLE');
  if (candidate.requiresTargetDateChange && !request.selection.acceptTargetDateChange)
    throw new Error('TARGET_DATE_CHANGE_CONFIRMATION_REQUIRED');
  const goal = { ...state.goal, targetCents: request.draft.targetCents,
    savedCents: request.draft.savedCents, targetDate: candidate.effectiveTargetDate,
    originalDate: request.draft.targetDate, monthlyContributionCents: candidate.monthlyCents,
    firstMonthContributionCents: undefined, protectedCents: request.draft.protectedCents,
    flexibilityWeeks: request.draft.flexibilityWeeks, status: 'active' as const,
    selectedPlanId: request.selection.candidateId === 'custom' ? 'custom' : candidate.id };
  const changed = goal.targetCents !== state.goal.targetCents || goal.savedCents !== state.goal.savedCents ||
    goal.targetDate !== state.goal.targetDate || goal.monthlyContributionCents !== state.goal.monthlyContributionCents ||
    goal.protectedCents !== state.goal.protectedCents || goal.flexibilityWeeks !== state.goal.flexibilityWeeks;
  const scheduleReviewRequired = changed && state.transferSchedules.some(schedule =>
    schedule.goalId === goal.id && ['active', 'paused'].includes(schedule.status));
  const updated = { ...state, goal, goals: state.goals.map(item => item.id === goal.id ? goal : item),
    twinVersion: state.twinVersion + 1 };
  return { state: appendAuditEvent(updated, 'goal_plan_changed', 'succeeded',
    `目标方案已修改为每月 ¥${candidate.monthlyCents / 100}；未自动修改转入安排。`),
    preview, scheduleReviewRequired };
}
