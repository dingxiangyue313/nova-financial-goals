import { randomUUID } from 'node:crypto';
import type { AgentComponent } from '../shared/contracts.ts';
import { runAgentReadTool } from './agent-read-tools.ts';
import { notificationDelivery } from './risk.ts';
import { ensureImpactThread } from './workspace.ts';
import { claimMonitorEvent, createAgentThread, deferMonitorEvent,
  deliverMonitorNotification, finishMonitorEvent, getAgentTaskForThread,
  getState, monitorEventIsCurrent, monitorSubjectAlreadyDelivered, monitorThreadId,
  updateAgentTask, type MonitorEvent } from './store.ts';

const yuan = (cents: number) => `¥${(cents / 100).toLocaleString('zh-CN')}`;

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
  const evidence = signal?.evidence.map(item => `${item.date} ${yuan(item.amountCents)}`).join('、')
    || (transactions.tool === 'relevant_transactions'
      ? `${transactions.output.transactions.length} 条相关模拟流水` : '当前模拟财务数据');
  const title = signal?.title ?? impact?.title ?? '目标条件变化';
  const delay = signal?.impact.delayDays ?? impact?.delayDays ?? 0;
  const body = `${title}。依据：${evidence}。预计目标可能延后 ${delay} 天，缺口约 ${yuan(shortfall)}。`;
  const next = '请进入统一调整页核验两种方案；NOVA 会在那里重新计算，当前会话不会直接修改计划。';
  const components: AgentComponent[] = [{ id: randomUUID(), type: 'goal_impact_brief',
    title: '目标变化与证据', body: `${body} ${next}`, ...(signal ? { signal } : {}) }];
  if (state.pendingImpact) components.push({ id: randomUUID(), type: 'risk_repair_entry',
    title: '查看调整方案', body: next, impactId: state.pendingImpact.id });
  const notificationThread = signal ? createAgentThread(event.sessionId,
    { title: `${title} · NOVA 修复建议`, kind: 'risk', dedupeKey: `monitor:${signal.id}` })
    : ensureImpactThread(event.sessionId, state, now)
      ?? createAgentThread(event.sessionId, { title: `${title} · NOVA 修复建议`, kind: 'risk',
        dedupeKey: `monitor-impact:${impact!.id}` });
  if (notificationThread.status !== 'active' || notificationThread.readOnly) {
    finishMonitorEvent(event, 'done', now); return;
  }
  deliverMonitorNotification(event, notificationThread.id, `${body} ${next}`, components, null, subjectKey);
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
