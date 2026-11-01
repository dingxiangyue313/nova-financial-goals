import { randomUUID } from 'node:crypto';
import type { AgentComponent, AgentToolResult } from '../shared/contracts.ts';
import { availableMonthly } from './domain.ts';
import { runAgentReadTool } from './agent-read-tools.ts';
import { notificationDelivery } from './risk.ts';
import { ensureImpactThread } from './workspace.ts';
import { claimMonitorEvent, createAgentThread, deferMonitorEvent,
  deliverMonitorNotification, finishMonitorEvent, getAgentTaskForThread,
  getState, monitorEventIsCurrent, monitorSubjectAlreadyDelivered, monitorThreadId,
  updateAgentTask, type MonitorEvent } from './store.ts';

const yuan = (cents: number) => `¥${(cents / 100).toLocaleString('zh-CN')}`;

function repairCandidate(event: MonitorEvent, threadId: string,
  shortfallCents: number): AgentToolResult | null {
  const state = getState(event.sessionId);
  const goal = state.goals.find(item => item.id === event.goalId);
  const task = getAgentTaskForThread(event.sessionId, threadId);
  if (!goal || !task || !task.facts.originalTargetDate || !monitorEventIsCurrent(event)) return null;
  const months = Math.max(1, Math.ceil((Date.parse(`${goal.targetDate}T00:00:00Z`)
    - Date.parse(`${state.clock}T00:00:00Z`)) / 2_592_000_000));
  const capacity = availableMonthly(state);
  const cap = task.constraints.monthlyContributionCapCents ?? capacity;
  const monthly = Math.min(cap, capacity,
    goal.monthlyContributionCents + Math.ceil(shortfallCents / months / 10000) * 10000);
  const dates = [...new Set([goal.targetDate, task.constraints.latestAllowedDate].filter(Boolean))] as string[];
  for (const targetDate of dates) {
    const result = runAgentReadTool(event.sessionId, threadId, 'candidate_preview', {
      targetCents: goal.targetCents, targetDate, monthlyContributionCents: monthly,
      protectedCents: Math.max(goal.protectedCents, state.finance.emergencyCents),
      scenario: { kind: 'baseline' }, evidenceResultIds: [],
    });
    if (!monitorEventIsCurrent(event)) return null;
    if (result.tool === 'candidate_preview' && result.status === 'ok' &&
      result.output.assessment?.dataSufficient &&
      ['on_track', 'at_risk'].includes(result.output.assessment.status)) return result;
  }
  return null;
}

export function processMonitorEvent(event: MonitorEvent, now = new Date()): void {
  if (!monitorEventIsCurrent(event)) { finishMonitorEvent(event, 'stale', now); return; }
  const state = getState(event.sessionId);
  const threadId = monitorThreadId(event);
  if (event.kind === 'transfer_outcome') {
    const delivery = notificationDelivery(state.riskPreferences, 'immediate', now);
    if (delivery.mode === 'deferred') { deferMonitorEvent(event, delivery.availableAt); return; }
    const content = `转账计划本期${event.payload.status === 'skipped_missing_trigger' ? '已跳过' : '需要核对'}：${event.payload.reason}。` +
      '未确认成功的执行不会再次扣款；缺少工资时不补扣。请核对实际工资、账户余额与保护资金，再重新试算计划。';
    deliverMonitorNotification(event, threadId, content, [{ id: randomUUID(), type: 'clarification',
      title: '核对转账计划', body: content, suggestions: ['核对工资到账', '重新试算计划'] }], null,
      `transfer:${event.payload.executionId}`);
    return;
  }
  if (event.kind === 'bonus_followup') {
    const content = '你之前选择了下个月再看奖金。请确认奖金是否到账、实际金额及来源；未确认收入没有计入基础计划。';
    deliverMonitorNotification(event, threadId, content, [{ id: randomUUID(),
      type: 'clarification', title: '核对奖金', body: content,
      suggestions: ['奖金还没到账', '我来补充实际金额'] }], null, `bonus:${event.id}`);
    return;
  }
  if (state.riskPreferences.pausedUntil && state.riskPreferences.pausedUntil >= state.clock) {
    finishMonitorEvent(event, 'done', now); return;
  }
  const signal = state.riskSignals.slice().reverse().find(item => item.goalId === event.goalId &&
    item.twinVersion <= event.twinVersion && item.status === 'active');
  const linkedSignal = state.pendingImpact && state.riskSignals.find(item =>
    item.impactId === state.pendingImpact?.id);
  const impact = state.pendingImpact?.goalId === event.goalId && !state.pendingImpact.dismissed &&
    (!linkedSignal || linkedSignal.status === 'active') ? state.pendingImpact : null;
  if (!signal && !impact) { finishMonitorEvent(event, 'done', now); return; }
  const subjectKey = signal ? `signal:${signal.id}` : `impact:${impact!.id}`;
  if (monitorSubjectAlreadyDelivered(event.sessionId, subjectKey)) {
    finishMonitorEvent(event, 'done', now); return;
  }
  const delivery = notificationDelivery(state.riskPreferences, 'immediate', now);
  if (delivery.mode === 'deferred') { deferMonitorEvent(event, delivery.availableAt); return; }
  if (!monitorEventIsCurrent(event)) { finishMonitorEvent(event, 'stale', now); return; }
  const task = getAgentTaskForThread(event.sessionId, threadId);
  const goal = state.goals.find(item => item.id === event.goalId);
  if (!task || !goal || task.facts.targetCents !== goal.targetCents ||
    task.facts.originalTargetDate !== goal.originalDate) {
    finishMonitorEvent(event, 'stale', now); return;
  }
  if (task.facts.savedCents !== goal.savedCents) updateAgentTask(event.sessionId, task.taskId,
    task.taskRevision, { facts: { ...task.facts, savedCents: goal.savedCents },
      fieldSources: { ...task.fieldSources, savedCents: { kind: 'connected_data',
        messageId: null, confirmation: 'system_verified' } } });
  runAgentReadTool(event.sessionId, threadId, 'financial_overview', {});
  if (!monitorEventIsCurrent(event)) { finishMonitorEvent(event, 'stale', now); return; }
  const transactions = runAgentReadTool(event.sessionId, threadId, 'relevant_transactions',
    { limit: 20 });
  const shortfall = signal?.impact.shortfallCents ?? impact?.shortfallCents ?? 0;
  const candidate = repairCandidate(event, threadId, shortfall);
  if (!monitorEventIsCurrent(event)) { finishMonitorEvent(event, 'stale', now); return; }
  const evidence = signal?.evidence.map(item => `${item.date} ${yuan(item.amountCents)}`).join('、')
    || (transactions.tool === 'relevant_transactions'
      ? `${transactions.output.transactions.length} 条相关模拟流水` : '当前模拟财务数据');
  const title = signal?.title ?? impact?.title ?? '目标条件变化';
  const delay = signal?.impact.delayDays ?? impact?.delayDays ?? 0;
  const body = `${title}。依据：${evidence}。预计目标可能延后 ${delay} 天，缺口约 ${yuan(shortfall)}。`;
  const next = candidate ? '已试算一项未生效的修复候选；请核对并单独确认。'
    : '当前硬约束内尚无已验证的修复候选；请调整期限或每月投入上限后重新试算。';
  const components: AgentComponent[] = [{ id: randomUUID(), type: 'goal_impact_brief',
    title: '目标变化与证据', body: `${body} ${next}`, ...(signal ? { signal } : {}) }];
  if (candidate?.tool === 'candidate_preview' && candidate.output.assessment) {
    const { input, assessment } = candidate.output;
    components.push({ id: randomUUID(), type: 'candidate_recommendations', title: '修复候选 · 待确认',
      body: `假设：${candidate.assumptions.join('；')}。${next}`, taskThreadId: threadId,
      items: [{ resultId: candidate.toolResultId, source: 'nova', selectable: true, blockingReasons: [],
        originalTargetDate: input.targetDate, delayDays: assessment.delayDays, targetCents: input.targetCents,
        targetDate: input.targetDate, monthlyContributionCents: input.monthlyContributionCents,
        protectedCents: input.protectedCents, projectedDate: assessment.projectedDate,
        bufferCents: assessment.bufferCents, status: assessment.status as 'on_track' | 'at_risk',
        tradeoff: 'balanced', explanation: `每月投入 ${yuan(input.monthlyContributionCents)}，按当前模拟数据预计 ${assessment.projectedDate ?? '暂无法确定日期'}完成；首月缓冲 ${yuan(assessment.bufferCents)}。`,
        assumptions: candidate.assumptions, gaps: candidate.gaps }] });
  }
  const notificationThread = signal ? createAgentThread(event.sessionId,
    { title: `${title} · NOVA 修复建议`, kind: 'risk', dedupeKey: `monitor:${signal.id}` })
    : ensureImpactThread(event.sessionId, state, now)
      ?? createAgentThread(event.sessionId, { title: `${title} · NOVA 修复建议`, kind: 'risk',
        dedupeKey: `monitor-impact:${impact!.id}` });
  if (notificationThread.status !== 'active' || notificationThread.readOnly) {
    finishMonitorEvent(event, 'done', now); return;
  }
  deliverMonitorNotification(event, notificationThread.id, `${body} ${next}`, components,
    candidate?.tool === 'candidate_preview' ? candidate.toolResultId : null, subjectKey);
}

export function tickMonitorWorker(now = new Date(), maxEvents = 10): number {
  let count = 0;
  for (; count < maxEvents; count++) {
    const event = claimMonitorEvent(now);
    if (!event) break;
    try { processMonitorEvent(event, now); }
    catch {
      finishMonitorEvent(event, event.attempts >= 3 ? 'dead' : 'pending', now);
    }
  }
  return count;
}
