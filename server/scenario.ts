import {
  GoalAssumptionsSchema,
  GoalScenarioPreviewSchema,
  type DemoState,
  type GoalAssumptions,
  type GoalScenarioPreview,
  type PlanStep,
} from '../shared/contracts.ts';
import { assessGoal } from './domain.ts';

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
