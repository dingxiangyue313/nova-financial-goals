import type {
  DemoState,
  RiskDecision,
  RiskPreferences,
  SpendingPattern,
  Transaction,
} from '../shared/contracts.ts';
import { assessGoal } from './domain.ts';

const DAY = 86_400_000;
export const RISK_RULE_VERSION = 'goal-aware-v1';
export const DEFAULT_RISK_PREFERENCES: RiskPreferences = {
  amountThresholdCents: 50000,
  goalImpactRatioThresholdBps: 500,
  weeklySummaryEnabled: true,
  quietHours: null,
  pausedUntil: null,
  goalOverrides: {},
};

function dateAt(iso: string): number { return Date.parse(`${iso}T00:00:00Z`); }
function addDays(iso: string, days: number): string {
  return new Date(dateAt(iso) + days * DAY).toISOString().slice(0, 10);
}
function daysBetween(start: string, end: string): number {
  return Math.floor((dateAt(end) - dateAt(start)) / DAY);
}
function inWindow(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}
function spendTotal(items: Transaction[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, -item.amountCents), 0);
}

export function analyzeSpendingPattern(
  transactions: Transaction[],
  category: string,
  clock: string,
  categoryConfidence = 1,
): SpendingPattern | null {
  const currentStart = addDays(clock, -29);
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -29);
  const olderEnd = addDays(previousStart, -1);
  const olderStart = addDays(olderEnd, -29);
  const categoryItems = transactions.filter(item => item.category === category && item.amountCents < 0);
  const current = categoryItems.filter(item => inWindow(item.date, currentStart, clock));
  const previous = categoryItems.filter(item => inWindow(item.date, previousStart, previousEnd));
  const older = categoryItems.filter(item => inWindow(item.date, olderStart, olderEnd));
  if (!previous.length || !older.length) return null;
  const currentCents = spendTotal(current);
  const baselineCents = Math.round((spendTotal(previous) + spendTotal(older)) / 2);
  const increaseCents = Math.max(0, currentCents - baselineCents);
  const increaseRatioBps = baselineCents > 0 ? Math.round(increaseCents / baselineCents * 10000) : 0;
  const confidence: SpendingPattern['confidence'] = categoryConfidence >= .8 ? 'high'
    : categoryConfidence >= .6 ? 'medium' : 'low';
  return {
    id: `pattern:${category}:${clock}:${currentCents}`,
    category,
    label: category === 'delivery_and_rides' ? '外卖与打车' : category,
    periodStart: currentStart,
    periodEnd: clock,
    baselineCents,
    currentCents,
    increaseCents,
    increaseRatioBps,
    transactionCount: current.length,
    evidenceTransactionIds: current.map(item => item.id),
    categoryConfidence,
    confidence,
    meetsTrendEvidence: current.length >= 3 && increaseCents >= 20000 && increaseRatioBps >= 2500,
  };
}

function preferenceForGoal(preferences: RiskPreferences, goalId: string) {
  return { ...preferences, ...(preferences.goalOverrides[goalId] || {}) };
}

export function evaluateSpendingRisk(
  state: DemoState,
  pattern: SpendingPattern,
  preferences: RiskPreferences,
): RiskDecision {
  const goalPreference = preferenceForGoal(preferences, state.goal.id);
  const remaining = Math.max(0, state.goal.targetCents - state.goal.savedCents);
  const referenceCents = Math.max(goalPreference.amountThresholdCents,
    Math.round(remaining * goalPreference.goalImpactRatioThresholdBps / 10000));
  const before = assessGoal(state);
  const afterState: DemoState = {
    ...state,
    finance: {
      ...state.finance,
      currentMonthExpenseCents: state.finance.currentMonthExpenseCents + pattern.increaseCents,
    },
  };
  const after = assessGoal(afterState);
  const firstMonthCapacityBefore = Math.max(0, before.availableMonthlyCents - state.finance.currentMonthExpenseCents);
  const firstMonthCapacityAfter = Math.max(0, after.availableMonthlyCents - afterState.finance.currentMonthExpenseCents);
  const shortfallCents = Math.max(0,
    Math.min(state.goal.monthlyContributionCents, firstMonthCapacityBefore)
      - Math.min(state.goal.monthlyContributionCents, firstMonthCapacityAfter));
  const safetyBufferAffected = state.finance.emergencyCents < state.goal.protectedCents;
  const goalImpact = {
    beforeStatus: before.status,
    afterStatus: after.status,
    beforeProjectedDate: before.projectedDate,
    afterProjectedDate: after.projectedDate,
    delayDays: after.delayDays,
    shortfallCents,
    safetyBufferAffected,
  };
  const stale = daysBetween(state.finance.updatedAt, state.clock) > 7;
  const reliable = state.finance.historyMonths >= 2 && !stale && pattern.confidence === 'high';
  const paused = Boolean(preferences.pausedUntil && preferences.pausedUntil >= state.clock);
  const materiallyPastFlexibility = after.delayDays > state.goal.flexibilityWeeks * 7;
  const immediate = state.goal.status === 'active' && reliable && pattern.meetsTrendEvidence
    && pattern.increaseCents >= referenceCents
    && (materiallyPastFlexibility || after.status === 'infeasible' || safetyBufferAffected);
  if (paused) return {
    scope: 'consumer', outcome: 'silent', reasonCode: 'PAUSED', explanation: '智能守护已暂时暂停。',
    twinVersion: state.twinVersion, ruleVersion: RISK_RULE_VERSION, patternId: pattern.id, goalImpact,
    suppressed: true,
  };
  if (immediate) return {
    scope: 'consumer', outcome: 'immediate_signal', reasonCode: 'GOAL_MATERIALLY_WORSENED',
    explanation: `累计趋势使目标预计延期约 ${after.delayDays} 天。`, twinVersion: state.twinVersion,
    ruleVersion: RISK_RULE_VERSION, patternId: pattern.id, goalImpact, suppressed: false,
  };
  if (pattern.meetsTrendEvidence && preferences.weeklySummaryEnabled) return {
    scope: 'consumer', outcome: 'weekly_summary',
    reasonCode: reliable ? 'TREND_WITHIN_TOLERANCE' : 'EVIDENCE_NOT_RELIABLE_FOR_IMMEDIATE_SIGNAL',
    explanation: reliable ? '发现支出趋势，但目标仍在可接受浮动范围内。' : '趋势证据不足以形成即时风险结论。',
    twinVersion: state.twinVersion, ruleVersion: RISK_RULE_VERSION, patternId: pattern.id, goalImpact,
    suppressed: false,
  };
  return {
    scope: 'consumer', outcome: 'silent', reasonCode: 'BELOW_TREND_THRESHOLD',
    explanation: '当前流水变化不需要打扰用户。', twinVersion: state.twinVersion,
    ruleVersion: RISK_RULE_VERSION, patternId: pattern.id, goalImpact, suppressed: false,
  };
}

export interface AgentRiskRequest {
  agentId: string;
  category: string;
  amountCents: number;
}

export function decideAgentRequest(state: DemoState, request: AgentRiskRequest): RiskDecision {
  const mandate = state.mandate;
  const base = {
    scope: 'agent' as const,
    twinVersion: state.twinVersion,
    ruleVersion: RISK_RULE_VERSION,
    patternId: null,
    goalImpact: null,
    suppressed: false,
  };
  const result = (outcome: RiskDecision['outcome'], reasonCode: string, explanation: string): RiskDecision =>
    ({ ...base, outcome, reasonCode, explanation });
  if (request.agentId !== 'travel-agent-demo' || (mandate && request.agentId !== mandate.agentId))
    return result('block', 'IDENTITY_FAILED', '外部 Agent 身份未通过验证。');
  if (state.goal.status !== 'active') return result('block', 'GOAL_NOT_ACTIVE', '目标计划尚未激活。');
  if (!mandate || !mandate.active || mandate.expiresAt < state.clock)
    return result('block', 'MANDATE_MISSING_OR_EXPIRED', '授权缺失或已过期。');
  if (request.amountCents > state.finance.checkingCents)
    return result('block', 'INSUFFICIENT_BALANCE', '模拟活期余额不足；应急金保持隔离。');
  if (request.amountCents > mandate.maxPerOperationCents
      || mandate.spentCents + request.amountCents > mandate.totalLimitCents)
    return result('block', 'MANDATE_LIMIT_EXCEEDED', '请求超出授权额度。');
  if (request.category !== mandate.category)
    return result('ask', 'PARAMETERS_REQUIRE_CONFIRMATION', '用途与授权类别不同，需要逐次确认。');
  const before = assessGoal(state);
  const after = assessGoal({ ...state, finance: { ...state.finance,
    currentMonthExpenseCents: state.finance.currentMonthExpenseCents + request.amountCents } });
  if (request.amountCents * 100 >= mandate.maxPerOperationCents * 80)
    return result('manual_review', 'NEAR_OPERATION_LIMIT', '金额达到单笔授权额度的 80%，需要人工复核。');
  if (after.delayDays > before.delayDays || after.status === 'infeasible')
    return result('manual_review', 'GOAL_WOULD_WORSEN', '额度内操作会使目标进度变差，需要人工复核。');
  return result('execute', 'MANDATE_MATCHED_AND_SAFE', '请求匹配授权，且不影响目标或安全资金。');
}
