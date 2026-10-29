import type {
  DemoState,
  GoalImpactSignal,
  Impact,
  RiskDecision,
  RiskPreferences,
  SpendingPattern,
  Transaction,
  NotificationDelivery,
  WeeklyRiskSummary,
} from '../shared/contracts.ts';
import { assessGoal } from './domain.ts';
import {protectedCheckingReserve} from './financial-constraints.ts';

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

export function shanghaiWeek(clock: string) {
  // Noon UTC stays on the same civil date in Shanghai and avoids the previous-day UTC boundary.
  const weekday = new Date(`${clock}T12:00:00.000Z`).getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  const weekStart = addDays(clock, -daysFromMonday);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}

function inQuietHours(value: string, quiet: NonNullable<RiskPreferences['quietHours']>) {
  return quiet.start <= quiet.end
    ? value >= quiet.start && value < quiet.end
    : value >= quiet.start || value < quiet.end;
}

function quietRelease(now: Date, end: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const [hour, minute] = end.split(':').map(Number);
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const endMinutes = hour * 60 + minute;
  const nextDay = endMinutes <= currentMinutes ? 1 : 0;
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + nextDay,
    hour - 8, minute)).toISOString();
}

export function notificationDelivery(preferences: RiskPreferences, kind: 'summary' | 'immediate',
  now = new Date()): NotificationDelivery {
  const availableAt = now.toISOString();
  if (kind === 'summary') return { mode: 'summary', availableAt, urgent: false };
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit',
    hour12: false }).format(now);
  if (preferences.quietHours && inQuietHours(time, preferences.quietHours))
    return { mode: 'deferred', availableAt: quietRelease(now, preferences.quietHours.end), urgent: true };
  return { mode: 'immediate', availableAt, urgent: true };
}

export function buildWeeklyRiskSummary(state: DemoState): WeeklyRiskSummary | null {
  if (state.goal.status !== 'active' || !state.riskPreferences.weeklySummaryEnabled
      || Boolean(state.riskPreferences.pausedUntil && state.riskPreferences.pausedUntil >= state.clock)) return null;
  const { weekStart, weekEnd } = shanghaiWeek(state.clock);
  if (state.riskSignals.some(signal => signal.goalId === state.goal.id
      && (signal.status === 'active' || signal.status === 'later'))) return null;
  const immediatePatternIds = new Set(state.riskSignals.map(signal => signal.patternId));
  const patterns = state.spendingPatterns.filter(pattern => pattern.periodEnd >= weekStart
    && pattern.periodEnd <= weekEnd && pattern.meetsTrendEvidence && !immediatePatternIds.has(pattern.id));
  const watch = patterns.length > 0;
  return {
    id: `summary:${state.goal.id}:${weekStart}`,
    goalId: state.goal.id,
    weekStart,
    weekEnd,
    patternIds: patterns.map(pattern => pattern.id),
    outcome: watch ? 'watch' : 'stable',
    title: watch ? `${state.goal.title} · 本周趋势摘要` : `${state.goal.title} · 本周按计划推进`,
    body: watch
      ? `${patterns.map(pattern => pattern.label).join('、')}出现持续趋势，但尚未使目标越过即时提醒边界。`
      : '本周没有发现需要打扰你的显著变化，目标仍按当前计划推进。',
    twinVersion: state.twinVersion,
    ruleVersion: RISK_RULE_VERSION,
    status: 'available',
    dedupeKey: `weekly:${state.goal.id}:${weekStart}`,
    createdAt: `${state.clock}T09:00:00+08:00`,
    delivery: notificationDelivery(state.riskPreferences, 'summary', new Date(`${state.clock}T01:00:00.000Z`)),
  };
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

export function evaluateOneOffExpenseRisk(state: DemoState, amountCents: number): RiskDecision {
  const before = assessGoal(state);
  const after = assessGoal({ ...state, finance: { ...state.finance,
    currentMonthExpenseCents: state.finance.currentMonthExpenseCents + amountCents } });
  const remaining = Math.max(0, state.goal.targetCents - state.goal.savedCents);
  const preferences = preferenceForGoal(state.riskPreferences, state.goal.id);
  const referenceCents = Math.max(preferences.amountThresholdCents,
    Math.round(remaining * preferences.goalImpactRatioThresholdBps / 10000));
  const goalImpact = {
    beforeStatus: before.status, afterStatus: after.status,
    beforeProjectedDate: before.projectedDate, afterProjectedDate: after.projectedDate,
    delayDays: after.delayDays,
    shortfallCents: Math.max(0, state.goal.monthlyContributionCents
      - Math.max(0, before.availableMonthlyCents - state.finance.currentMonthExpenseCents - amountCents)),
    safetyBufferAffected: state.finance.emergencyCents < state.goal.protectedCents,
  };
  const reliable = state.finance.historyMonths >= 2 && daysBetween(state.finance.updatedAt, state.clock) <= 7;
  const immediate = state.goal.status === 'active' && reliable && amountCents >= referenceCents
    && ((before.status !== after.status && (after.status === 'at_risk' || after.status === 'infeasible'))
      || after.delayDays > state.goal.flexibilityWeeks * 7 || after.status === 'infeasible'
      || goalImpact.safetyBufferAffected);
  if (immediate) return { scope: 'consumer', outcome: 'immediate_signal', reasonCode: 'ONE_OFF_GOAL_IMPACT',
    explanation: `这笔支出使目标预计延期约 ${after.delayDays} 天。`, twinVersion: state.twinVersion,
    ruleVersion: RISK_RULE_VERSION, patternId: null, goalImpact, suppressed: false };
  if (amountCents >= referenceCents && preferences.weeklySummaryEnabled)
    return { scope: 'consumer', outcome: 'weekly_summary', reasonCode: 'ONE_OFF_WITHIN_TOLERANCE',
      explanation: '这笔支出在当前目标的可接受浮动范围内。', twinVersion: state.twinVersion,
      ruleVersion: RISK_RULE_VERSION, patternId: null, goalImpact, suppressed: false };
  return { scope: 'consumer', outcome: 'silent', reasonCode: 'ONE_OFF_BELOW_REFERENCE',
    explanation: '这笔支出不需要打扰用户。', twinVersion: state.twinVersion,
    ruleVersion: RISK_RULE_VERSION, patternId: null, goalImpact, suppressed: false };
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
  if(state.finance.checkingCents-request.amountCents<protectedCheckingReserve(state))
    return result('block','PROTECTED_FUNDS_UNAVAILABLE','这笔支出会触碰其他目标同样要求保留的保护底线。');
  if(state.financialServices.goalContracts.find(c=>c.goalId===(mandate.goalId??state.goal.id))?.allowPayments===false)
    return result('block','GOAL_PAYMENT_NOT_ALLOWED','此目标约束不允许新付款，需要明确修改后再核对。');
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

const demoTransactions: Transaction[] = [
  { id: 'trend-old-1', accountId: 'checking', date: '2026-06-28', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -30000 },
  { id: 'trend-old-2', accountId: 'checking', date: '2026-07-12', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -30000 },
  { id: 'trend-previous-1', accountId: 'checking', date: '2026-07-28', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -30000 },
  { id: 'trend-previous-2', accountId: 'checking', date: '2026-08-12', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -30000 },
  { id: 'trend-current-1', accountId: 'checking', date: '2026-08-25', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -40000 },
  { id: 'trend-current-2', accountId: 'checking', date: '2026-09-02', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -40000 },
  { id: 'trend-current-3', accountId: 'checking', date: '2026-09-09', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -40000 },
  { id: 'trend-current-4', accountId: 'checking', date: '2026-09-15', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -35000 },
  { id: 'trend-current-5', accountId: 'checking', date: '2026-09-21', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -35000 },
].map((item): Transaction => ({ ...item, sourceKind: 'wechat_pay', provenance: 'connected_data' }));

const weeklyDemoTransactions: Transaction[] = [
  { id: 'weekly-old-1', accountId: 'checking', date: '2026-06-28', title: '数字订阅', category: 'subscriptions_demo', amountCents: -10000 },
  { id: 'weekly-old-2', accountId: 'checking', date: '2026-07-12', title: '数字订阅', category: 'subscriptions_demo', amountCents: -10000 },
  { id: 'weekly-previous-1', accountId: 'checking', date: '2026-07-28', title: '数字订阅', category: 'subscriptions_demo', amountCents: -10000 },
  { id: 'weekly-previous-2', accountId: 'checking', date: '2026-08-12', title: '数字订阅', category: 'subscriptions_demo', amountCents: -10000 },
  { id: 'weekly-current-1', accountId: 'checking', date: '2026-09-02', title: '数字订阅', category: 'subscriptions_demo', amountCents: -20000 },
  { id: 'weekly-current-2', accountId: 'checking', date: '2026-09-09', title: '数字订阅', category: 'subscriptions_demo', amountCents: -20000 },
  { id: 'weekly-current-3', accountId: 'checking', date: '2026-09-21', title: '数字订阅', category: 'subscriptions_demo', amountCents: -20000 },
].map((item): Transaction => ({ ...item, sourceKind: 'alipay', provenance: 'connected_data' }));

function roundHundredYuan(cents: number): number { return Math.ceil(cents / 10000) * 10000; }

export function applySpendingTrendDemo(state: DemoState): {
  state: DemoState;
  decision: RiskDecision | null;
  replayed: boolean;
} {
  const suppressionKey = `spending-trend:${state.goal.id}:delivery_and_rides:2026-09`;
  if (state.riskSignals.some(signal => signal.suppressionKey === suppressionKey))
    return { state, decision: null, replayed: true };
  const knownIds = new Set(state.transactions.map(item => item.id));
  if (demoTransactions.every(item => knownIds.has(item.id)))
    return { state, decision: null, replayed: true };
  const transactions = [...demoTransactions.filter(item => !knownIds.has(item.id)), ...state.transactions];
  const pattern = analyzeSpendingPattern(transactions, 'delivery_and_rides', state.clock);
  if (!pattern) throw new Error('RISK_EVIDENCE_INCOMPLETE');
  const decision = evaluateSpendingRisk(state, pattern, state.riskPreferences);
  const spendingPatterns = [...state.spendingPatterns.filter(item => item.id !== pattern.id), pattern];
  const currentSpend = pattern.currentCents;
  const finance = {
    ...state.finance,
    checkingCents: Math.max(0, state.finance.checkingCents - currentSpend),
    currentMonthExpenseCents: state.finance.currentMonthExpenseCents + pattern.increaseCents,
    updatedAt: state.clock,
  };
  const common: DemoState = {
    ...state,
    finance,
    accounts: state.accounts.map(item => item.id === 'checking'
      ? { ...item, balanceCents: finance.checkingCents } : item),
    transactions,
    spendingPatterns,
    twinVersion: state.twinVersion + 1,
  };
  if (decision.outcome !== 'immediate_signal')
    return { state: common, decision, replayed: false };
  const impactData = decision.goalImpact!;
  const months = Math.max(1, Math.ceil(daysBetween(state.clock, state.goal.targetDate) / 30));
  const optionAContributionCents = roundHundredYuan(state.goal.monthlyContributionCents
    + impactData.shortfallCents / Math.max(1, months - 1));
  const impact: Impact = {
    id: crypto.randomUUID(), goalId: state.goal.id,
    title: '外卖与打车持续上升',
    expenseCents: pattern.increaseCents,
    detectedAt: state.clock,
    shortfallCents: impactData.shortfallCents,
    delayDays: impactData.delayDays,
    optionAContributionCents,
    optionAAvailable: optionAContributionCents <= assessGoal(state).availableMonthlyCents,
    optionBDate: addDays(state.goal.targetDate, impactData.delayDays),
    dismissed: false,
  };
  const signal: GoalImpactSignal = {
    id: crypto.randomUUID(), goalId: state.goal.id, patternId: pattern.id, impactId: impact.id, createdAt: state.clock,
    title: '外卖与打车支出趋势影响日本旅行', decision: decision.outcome,
    evidence: pattern.evidenceTransactionIds.map(transactionId => {
      const item = transactions.find(transaction => transaction.id === transactionId)!;
      return { transactionId, date: item.date, amountCents: Math.max(0, -item.amountCents), sourceKind: item.sourceKind };
    }),
    confidence: pattern.confidence, ruleVersion: RISK_RULE_VERSION, twinVersion: state.twinVersion + 1,
    impact: impactData, status: 'active', suppressionKey,
  };
  const next: DemoState = {
    ...common,
    riskSignals: [...state.riskSignals, signal],
    weeklyRiskSummaries: state.weeklyRiskSummaries.map(summary => summary.goalId === state.goal.id
      && summary.status === 'available' ? { ...summary, status: 'dismissed' as const } : summary),
    pendingImpact: impact,
  };
  return { state: next, decision, replayed: false };
}

export function applyWeeklySummaryDemo(state: DemoState): {
  state: DemoState; decision: RiskDecision | null; replayed: boolean;
} {
  const knownIds = new Set(state.transactions.map(item => item.id));
  if (weeklyDemoTransactions.every(item => knownIds.has(item.id)))
    return { state, decision: null, replayed: true };
  const transactions = [...weeklyDemoTransactions.filter(item => !knownIds.has(item.id)), ...state.transactions];
  const pattern = analyzeSpendingPattern(transactions, 'subscriptions_demo', state.clock);
  if (!pattern) throw new Error('RISK_EVIDENCE_INCOMPLETE');
  const decision = evaluateSpendingRisk(state, pattern, state.riskPreferences);
  if (decision.outcome === 'immediate_signal') throw new Error('WEEKLY_DEMO_BECAME_MATERIAL');
  return { state: { ...state,
    transactions, spendingPatterns: [...state.spendingPatterns.filter(item => item.id !== pattern.id), pattern],
    twinVersion: state.twinVersion + 1 }, decision, replayed: false };
}

export function markActiveRiskSignal(state: DemoState, decision: 'A' | 'B' | 'later' | 'dismiss', impactId?: string): DemoState {
  const status: GoalImpactSignal['status'] = decision === 'later' ? 'later'
    : decision === 'dismiss' ? 'dismissed' : 'resolved';
  let changed = false;
  const riskSignals = state.riskSignals.map(signal => {
    if (signal.status !== 'active' && signal.status !== 'later') return signal;
    if (impactId && signal.impactId !== impactId) return signal;
    changed = true;
    return { ...signal, status };
  });
  return changed ? { ...state, riskSignals } : state;
}
