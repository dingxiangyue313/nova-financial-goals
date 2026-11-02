import {
  RiskRepairApplyRequestSchema,
  RiskRepairPreviewRequestSchema,
  RiskRepairPreviewSchema,
  RiskRepairReceiptSchema,
  type DemoState,
  type GoalImpactSignal,
  type GoalPlanChangeCandidate,
  type GoalPlanChangeDraft,
  type Impact,
  type RiskRepairApplyRequest,
  type RiskRepairPreview,
  type RiskRepairPreviewRequest,
  type RiskRepairReceipt,
  type RiskRepairStrategy,
} from '../shared/contracts.ts';
import { appendAuditEvent, stableHash } from './governance.ts';
import { applyGoalPlanChange, previewGoalPlanChange } from './scenario.ts';
export { invalidateGoalRisks, supersedeGoalRisks } from './risk-lifecycle.ts';

type CurrentRisk = { impact: Impact; signal: GoalImpactSignal };

function currentRisk(state: DemoState, impactId: string): CurrentRisk {
  const signal = state.riskSignals.find(item => item.impactId === impactId);
  if (!signal) throw new Error('RISK_NOT_FOUND');
  if (signal.goalId !== state.primaryGoalId || signal.goalId !== state.goal.id)
    throw new Error('RISK_REPAIR_GOAL_NOT_SUPPORTED');
  if (signal.status !== 'active' && signal.status !== 'later') throw new Error('RISK_NOT_ACTIVE');
  const impact = state.pendingImpact;
  if (!impact || impact.id !== impactId) throw new Error('RISK_NOT_ACTIVE');
  if (impact.goalId !== state.primaryGoalId || impact.goalId !== state.goal.id)
    throw new Error('RISK_REPAIR_GOAL_NOT_SUPPORTED');
  return { impact, signal };
}

function repairDraft(state: DemoState, impact: Impact, strategy: RiskRepairStrategy): GoalPlanChangeDraft {
  return {
    targetCents: state.goal.targetCents,
    targetDate: state.goal.targetDate,
    savedCents: state.goal.savedCents,
    protectedCents: state.goal.protectedCents,
    monthlyContributionCents: strategy === 'keep_target_date'
      ? Math.max(state.goal.monthlyContributionCents, impact.optionAContributionCents)
      : state.goal.monthlyContributionCents,
    flexibilityWeeks: state.goal.flexibilityWeeks,
  };
}

function keepDateCandidate(state: DemoState, candidates: GoalPlanChangeCandidate[]): GoalPlanChangeCandidate {
  const valid = candidates.filter(candidate => candidate.selectable && candidate.projectedDate
    && candidate.projectedDate <= state.goal.targetDate).sort((left, right) => left.monthlyCents - right.monthlyCents);
  if (valid[0]) return { ...valid[0], effectiveTargetDate: state.goal.targetDate,
    requiresTargetDateChange: false, delayDays: 0 };
  const fallback = candidates.sort((left, right) => left.monthlyCents - right.monthlyCents)[0];
  if (!fallback) throw new Error('PLAN_NOT_AVAILABLE');
  return { ...fallback, selectable: false, effectiveTargetDate: state.goal.targetDate,
    requiresTargetDateChange: false, blockingReasons: [...new Set([...fallback.blockingReasons,
      'KEEP_DATE_NOT_FEASIBLE'])] };
}

function changedPlan(state: DemoState, candidate: GoalPlanChangeCandidate) {
  return candidate.monthlyCents !== state.goal.monthlyContributionCents
    || candidate.effectiveTargetDate !== state.goal.targetDate;
}

export function previewRiskRepair(state: DemoState, input: RiskRepairPreviewRequest): RiskRepairPreview {
  const request = RiskRepairPreviewRequestSchema.parse(input);
  if (request.expectedTwinVersion !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
  const { impact, signal } = currentRisk(state, request.impactId);
  const draft = repairDraft(state, impact, request.strategy);
  const planPreview = previewGoalPlanChange(state, draft);
  const candidate = request.strategy === 'keep_target_date'
    ? keepDateCandidate(state, [...planPreview.novaPlans, planPreview.customPlan])
    : planPreview.customPlan;
  const activeSchedules = state.transferSchedules.filter(schedule => schedule.goalId === state.goal.id
    && ['active', 'paused'].includes(schedule.status));
  const scheduleReviewRequired = changedPlan(state, candidate) && activeSchedules.length > 0;
  const base = {
    impactId: impact.id,
    goalId: state.goal.id,
    signalId: signal.id,
    baseTwinVersion: state.twinVersion,
    strategy: request.strategy,
    draft,
    candidate,
    comparison: {
      before: {
        targetCents: state.goal.targetCents,
        savedCents: state.goal.savedCents,
        monthlyContributionCents: state.goal.monthlyContributionCents,
        targetDate: state.goal.targetDate,
        projectedDate: signal.impact.afterProjectedDate,
      },
      after: {
        targetCents: draft.targetCents,
        savedCents: draft.savedCents,
        monthlyContributionCents: candidate.monthlyCents,
        targetDate: candidate.effectiveTargetDate,
        projectedDate: candidate.projectedDate,
      },
    },
    evidence: {
      title: signal.title,
      detectedAt: impact.detectedAt,
      dataAsOf: state.finance.updatedAt,
      confidence: signal.confidence,
      transactions: signal.evidence,
    },
    protection: {
      requiredCents: draft.protectedCents,
      availableCents: state.finance.checkingCents + state.finance.emergencyCents,
      satisfied: !candidate.blockingReasons.includes('PROTECTED_FUNDS_UNAVAILABLE'),
      blockingReasons: candidate.blockingReasons.filter(reason => reason.includes('PROTECTED')),
    },
    transferSchedules: activeSchedules.map(schedule => ({
      id: schedule.id, amountCents: schedule.amountCents, status: schedule.status,
    })),
    scheduleReviewRequired,
  };
  return RiskRepairPreviewSchema.parse({ ...base, previewId: stableHash(base) });
}

export type RiskRepairApplyResult = {
  state: DemoState;
  preview: RiskRepairPreview;
  receipt: RiskRepairReceipt;
  scheduleReviewRequired: boolean;
  replayed: boolean;
};

export function applyRiskRepair(state: DemoState, input: RiskRepairApplyRequest): RiskRepairApplyResult {
  const request = RiskRepairApplyRequestSchema.parse(input);
  const requestHash = stableHash(request);
  const existing = state.riskRepairReceipts.find(receipt => receipt.idempotencyKey === request.idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash) throw new Error('IDEMPOTENCY_CONFLICT');
    return { state, preview: existing.preview, receipt: existing,
      scheduleReviewRequired: existing.scheduleReviewRequired, replayed: true };
  }
  const preview = previewRiskRepair(state, {
    impactId: request.impactId,
    expectedTwinVersion: request.expectedTwinVersion,
    strategy: request.strategy,
  });
  if (preview.previewId !== request.previewId) throw new Error('RISK_REPAIR_PREVIEW_STALE');
  if (preview.candidate.id !== request.candidateId) throw new Error('PLAN_NOT_AVAILABLE');
  if (preview.candidate.requiresTargetDateChange && !request.acceptTargetDateChange)
    throw new Error('TARGET_DATE_CHANGE_CONFIRMATION_REQUIRED');
  if (!preview.candidate.selectable) throw new Error('PLAN_NOT_AVAILABLE');
  const applied = applyGoalPlanChange(state, {
    expectedTwinVersion: request.expectedTwinVersion,
    draft: preview.draft,
    selection: { candidateId: preview.candidate.id,
      acceptTargetDateChange: request.acceptTargetDateChange },
  });
  const riskSignals = applied.state.riskSignals.map(signal => signal.impactId === request.impactId
    && (signal.status === 'active' || signal.status === 'later') ? { ...signal, status: 'resolved' as const } : signal);
  const receipt = RiskRepairReceiptSchema.parse({
    idempotencyKey: request.idempotencyKey,
    requestHash,
    impactId: request.impactId,
    previewId: preview.previewId,
    goalId: preview.goalId,
    appliedAt: `${state.clock}T12:00:00.000Z`,
    resultingTwinVersion: applied.state.twinVersion,
    scheduleReviewRequired: applied.scheduleReviewRequired,
    preview,
  });
  const resolved = appendAuditEvent({ ...applied.state, riskSignals, pendingImpact: null,
    riskRepairReceipts: [...applied.state.riskRepairReceipts, receipt] },
  'risk_repair_applied', 'succeeded', `风险 ${request.impactId} 已通过统一方案修改流程处理；转入安排保持不变。`);
  return { state: resolved, preview, receipt, scheduleReviewRequired: applied.scheduleReviewRequired,
    replayed: false };
}

function updateRiskDisposition(state: DemoState, impactId: string, status: 'later' | 'dismissed'): DemoState {
  const { signal } = currentRisk(state, impactId);
  if (status === 'later' && signal.status === 'later') return state;
  const riskSignals = state.riskSignals.map(item => item.id === signal.id ? { ...item, status } : item);
  const changed = { ...state, riskSignals,
    pendingImpact: status === 'dismissed' ? null : state.pendingImpact,
    twinVersion: state.twinVersion + 1 };
  return appendAuditEvent(changed, status === 'later' ? 'risk_repair_postponed' : 'risk_repair_dismissed',
    'succeeded', status === 'later' ? '风险已标记为稍后处理，首页不再显示紧急提醒。' : '风险提醒已忽略，历史证据保留。');
}

export function postponeRisk(state: DemoState, impactId: string): DemoState {
  return updateRiskDisposition(state, impactId, 'later');
}

export function dismissRisk(state: DemoState, impactId: string): DemoState {
  return updateRiskDisposition(state, impactId, 'dismissed');
}
