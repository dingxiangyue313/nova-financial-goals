import { assertAiWriteAllowed } from './ai-safety-control.ts';
import { z } from 'zod';
import { applyConfirmedAccountSnapshot } from './account-snapshots.ts';
import { AgentTurnSchema, GoalAssumptionsSchema, type AgentComponent, type AgentIntent,
  type AgentTurn, type DemoState, type GoalAssumptions, type GoalDraft, type TransferScheduleInput } from '../shared/contracts.ts';
import { interpretAgentRequest } from './agent.ts';
import { understandGoalMessage, type Understanding } from './understanding.ts';
import { buildWeeklyRiskSummary, notificationDelivery } from './risk.ts';
import { assessGoal, availableMonthly } from './domain.ts';
import { runBankingTool } from './banking.ts';
import { SubscriptionCancellationParametersSchema } from '../shared/contracts.ts';
import { persistSubscriptionDecision, subscriptionCancellationParameters } from './subscription-service.ts';
import { activateTransferSchedule, getTransferScheduleStatus, transferScheduleApprovalParameters,
  transferScheduleLifecycleParameters } from './transfer-schedules.ts';
import { evaluateExternalRequest } from './tools.ts';
import { stableHash, verifyAuditChain } from './governance.ts';
import { previewGoalScenario } from './scenario.ts';
import { explainExpenseImpact, understandExpenseQuestion } from './expense-impact-answer.ts';
import {
  createAgentAction, createAgentThread, finishAgentAction, getAgentAction, getAgentMessages, getGoalDraft,
  cancelActiveAgentRunForThread, getAgentTaskForThread, getAgentToolResult, getLatestAgentRunForThread,
  monitorRecommendationIsCurrent, updateAgentTask, cancelAgentTask,
  getAgentThread, listAgentThreads, markAgentThreadRead,
  markAgentThreadUnread, saveAgentMessage, saveAgentTurnRecord, saveGoalDraft,
} from './store.ts';

const yuan = (value: number) => `¥${(value / 100).toLocaleString('zh-CN')}`;
const componentId = () => crypto.randomUUID();

function detectIntent(message: string): AgentIntent {
  if (/(执行|Execute|Ask|Block|人工复核|外部.*请求|Agent 请求)/i.test(message)) return 'external_agent_request';
  if (/(授权|允许.*Agent|限额|订票)/i.test(message)) return 'mandate_management';
  if (/(影响|支出|延期|汽车保养)/i.test(message)) return 'goal_impact';
  if (/(进度|可行|方案|按时|计划怎么样)/i.test(message)) return 'goal_status';
  if (/(目标|预算|旅行|旅游|存.*¥|买房|学费|相机|开店)/i.test(message)) return 'goal_planning';
  return 'clarification';
}

function autoTitle(message: string, intent: AgentIntent) {
  if (intent === 'goal_impact') return '目标影响分析';
  if (intent === 'mandate_management') return '旅行 Agent 授权';
  if (intent === 'external_agent_request') return '外部 Agent 请求';
  return message.trim().replace(/\s+/g, ' ').slice(0, 22) || '新的目标任务';
}

function goalSummary(state: DemoState, overrides: Partial<DemoState['goal']> = {}): AgentComponent {
  const goal = { ...state.goal, ...overrides };
  return { id: componentId(), type: 'goal_summary', title: 'NOVA 理解的目标', goal: {
    title: goal.title, targetCents: goal.targetCents, savedCents: goal.savedCents,
    targetDate: goal.targetDate, protectedCents: goal.protectedCents, status: goal.status,
  } };
}

const requiredDraftFields = ['title', 'targetCents', 'targetDate'] as const;
function mergedGoalDraft(sessionId: string, threadId: string, parsed: Understanding): GoalDraft {
  const previous = getGoalDraft(sessionId, threadId);
  const next: GoalDraft = {
    id: previous?.id ?? crypto.randomUUID(), threadId, goalId: previous?.goalId ?? null,
    title: previous?.title ?? null, targetCents: previous?.targetCents ?? null,
    targetDate: previous?.targetDate ?? null, savedCents: previous?.savedCents ?? null,
    monthlyContributionCapCents: previous?.monthlyContributionCapCents ?? null,
    protectedCents: previous?.protectedCents ?? null, flexibilityWeeks: previous?.flexibilityWeeks ?? null,
    fieldSources: { ...(previous?.fieldSources ?? {}) }, missingRequiredFields: [], updatedAt: new Date().toISOString(),
  };
  for (const field of ['title', 'targetCents', 'targetDate', 'savedCents', 'monthlyContributionCapCents', 'protectedCents'] as const) {
    const change = parsed.changes[field];
    if (!change) continue;
    (next as unknown as Record<string, unknown>)[field] = change.op === 'clear' ? null : change.value;
    const sourceKey = field === 'monthlyContributionCapCents' ? 'monthlyContributionCents' : field;
    if (change.op === 'clear') delete next.fieldSources[sourceKey];
    else next.fieldSources[sourceKey] = 'user_provided';
  }
  next.missingRequiredFields = requiredDraftFields.filter(field => next[field] == null);
  return saveGoalDraft(sessionId, next);
}

function clarificationForDraft(draft: GoalDraft): AgentComponent {
  const labels = { title: '这个计划是为了什么', targetCents: '一共需要多少钱', targetDate: '希望什么时候完成' } as const;
  const missing = draft.missingRequiredFields.map(field => labels[field]);
  return { id: componentId(), type: 'clarification', title: '还需要一点信息',
    body: `请告诉我${missing.join('、')}。信息完整后我再生成试算，不会先套用演示数据。`,
    suggestions: draft.missingRequiredFields.includes('targetCents')
      ? ['预算 ¥8,000', '需要 ¥12,000'] : draft.missingRequiredFields.includes('targetDate')
        ? ['12 月 15 日前', '今年年底前'] : ['去日本旅行', '买一台相机'] };
}

function confirmation(sessionId: string, threadId: string, state: DemoState, actionType: string,
  payload: Record<string, unknown>, title: string, body: string, label: string, destructive = false): AgentComponent {
  const action = createAgentAction(sessionId, threadId, actionType, state.twinVersion, payload);
  return { id: componentId(), type: 'confirmation', title, body, tone: destructive ? 'danger' : 'warning',
    action: { actionId: action.id, label, destructive } };
}

export function prepareSubscriptionConfirmation(sessionId: string, threadId: string, subscriptionId: string, state: DemoState) {
  getAgentThread(sessionId, threadId);
  const prepared = runBankingTool(state, 'prepare_subscription_action', { subscriptionId, action: 'cancel' });
  const preview = prepared.result;
  const action = createAgentAction(sessionId, threadId, 'confirm_subscription_cancellation', state.twinVersion,
    { subscriptionActionId: preview.action.id, parameters: preview.approvalParameters });
  const component: Extract<AgentComponent, { type: 'confirmation' }> = {
    id: componentId(), type: 'confirmation', title: '核对并取消自动续费', body: preview.consequences.join(' '),
    tone: 'warning', action: { actionId: action.id, label: `确认停止每月 ${yuan(preview.action.monthlyCents)} 续费`, destructive: true } };
  return { state: prepared.state, actionId: action.id, preview, component };
}

export function prepareTransferScheduleConfirmation(sessionId: string, threadId: string, state: DemoState,
  request: { action: 'activate'; input: TransferScheduleInput } | { action: 'activate'; previewId: string }
    | { action: 'pause' | 'cancel'; scheduleId: string }) {
  const thread = getAgentThread(sessionId, threadId);
  if (thread.readOnly || thread.status !== 'active') throw new Error('THREAD_READ_ONLY');
  let next = state;
  let payload: Record<string, unknown>;
  let body: string;
  if (request.action === 'activate') {
    const preview = 'input' in request ? (() => {
      const prepared = runBankingTool(state, 'prepare_recurring_transfer', request.input);
      next = prepared.state; return prepared.result.preview;
    })() : state.transferSchedulePreviews.find(item => item.id === request.previewId);
    if (!preview) throw new Error('SCHEDULE_PREVIEW_NOT_FOUND');
    payload = { previewId: preview.id, parameters: transferScheduleApprovalParameters(preview) };
    const source = state.accounts.find(item => item.id === preview.sourceAccountId)?.label;
    const destination = state.accounts.find(item => item.id === preview.destinationAccountId)?.label;
    const rule = preview.trigger.type === 'salary_event'
      ? `预计每月 ${preview.trigger.expectedDay} 日银行工资 ${yuan(preview.trigger.expectedAmountCents)} ±${preview.trigger.toleranceBps / 100}%，` +
        `在 ${preview.trigger.windowStartDay}—${preview.trigger.graceEndDay} 日验证工资实际到账后 ${preview.trigger.executeOffsetDays} 天 09:00 转入；` +
        `${preview.trigger.graceEndDay} 日 23:59 前缺少工资时跳过，不补扣`
      : preview.recurrence === 'one_time' ? `固定 ${preview.startDate} 09:00` : `固定每月 ${preview.trigger.day} 日 09:00`;
    body = `${source} → ${destination}，${yuan(preview.amountCents)} ${preview.currency}；${preview.recurrence === 'monthly' ? '每月' : '一次性'}，` +
      `首次预计 ${preview.startDate}，${rule}。结束日期 ${preview.endDate}，目标达成即停止，费用 ¥0。` +
      `预计最低余额 ${yuan(Math.min(...preview.occurrences.map((item: { minimumBalanceCents: number }) => item.minimumBalanceCents)))}，` +
      '应急金保持隔离。创建仅安排后续模拟转入，首笔尚未执行。';
  } else {
    const schedule = getTransferScheduleStatus(state, request.scheduleId);
    if (request.action === 'pause' ? schedule.status !== 'active' : !['active', 'paused'].includes(schedule.status))
      throw new Error('SCHEDULE_INVALID_STATUS');
    payload = { scheduleId: schedule.id, parameters: transferScheduleLifecycleParameters(schedule) };
    body = `确认${request.action === 'pause' ? '暂停' : '取消'} ${yuan(schedule.amountCents)} 的模拟转账计划。后续不会执行，已完成的转入不会撤回。`;
  }
  const action = createAgentAction(sessionId, threadId, `${request.action}_transfer_schedule`, state.twinVersion, payload);
  const component: Extract<AgentComponent, { type: 'confirmation' }> = { id: componentId(), type: 'confirmation',
    title: '核对模拟转账安排', body, tone: 'warning',
    action: { actionId: action.id, label: `确认${request.action === 'activate' ? '创建' : request.action === 'pause' ? '暂停' : '取消'}计划`,
      destructive: request.action === 'cancel' } };
  return { state: next, actionId: action.id, component };
}

function statusComponents(sessionId: string, threadId: string, state: DemoState): AgentComponent[] {
  const assessment = assessGoal(state);
  const actions = state.goal.status === 'active' ? [] : assessment.plans.filter(item => item.status !== 'infeasible')
    .map(plan => ({ planId: plan.id, actionId: createAgentAction(sessionId, threadId, 'activate_plan',
      state.twinVersion, { planId: plan.id }).id }));
  const components: AgentComponent[] = [
    { id: componentId(), type: 'goal_progress_card', title: '当前目标进度', goal: state.goal,
      progressPercent: assessment.progressPercent },
    { id: componentId(), type: 'goal_feasibility_card', title: '目标可行性', assessment },
    { id: componentId(), type: 'scenario_compare', title: '三种推进节奏',
      plans: assessment.plans, actions, selectedPlanId: state.goal.selectedPlanId },
    { id: componentId(), type: 'explanation', title: '需要其他方案？',
      body: '告诉 NOVA 你希望调整的预算、日期或每月投入上限，它会重新核算可选方案。', tone: 'neutral' },
  ];
  return components;
}

function impactComponents(sessionId: string, threadId: string, state: DemoState): AgentComponent[] {
  if (!state.pendingImpact) return [{ id: componentId(), type: 'explanation', title: '目前没有显著影响',
    body: '当前没有需要处理的目标风险。小额波动会保持安静。', tone: 'good' }];
  const impact = state.pendingImpact;
  const components: AgentComponent[] = [];
  const signal = state.riskSignals.find(item => item.impactId === impact.id);
  const pattern = signal && state.spendingPatterns.find(item => item.id === signal.patternId);
  if (signal && pattern) components.push({ id: componentId(), type: 'risk_signal',
    title: signal.title, signal, pattern, protectedCents: state.finance.emergencyCents });
  components.push({ id: componentId(), type: 'impact_summary',
    title: `${impact.title}可能影响目标`, impact, protectedCents: state.finance.emergencyCents });
  components.push({ id: componentId(), type: 'risk_repair_entry', impactId: impact.id,
    title: '查看调整方案', body: '进入统一风险修复页，服务端会重新核算 A/B 方案；这里不会直接修改目标。' });
  return components;
}

function mandateComponents(sessionId: string, threadId: string, state: DemoState): AgentComponent[] {
  const data = state.mandate ? { agentId: state.mandate.agentId, category: state.mandate.category,
    maxPerOperationCents: state.mandate.maxPerOperationCents, totalLimitCents: state.mandate.totalLimitCents,
    expiresAt: state.mandate.expiresAt, active: state.mandate.active }
    : { agentId: 'travel-agent-demo', category: 'transport', maxPerOperationCents: 50000,
      totalLimitCents: 120000, expiresAt: '2026-12-31', active: false };
  const components: AgentComponent[] = [{ id: componentId(), type: 'mandate_preview', title: '旅行 Agent 授权范围', mandate: data }];
  if (!state.mandate?.active) components.push(confirmation(sessionId, threadId, state, 'create_mandate', data,
    '创建限定授权', '仅允许已验证的旅行 Agent 在交通类别与额度内提出模拟请求。', '确认创建授权'));
  return components;
}

function externalRequestComponents(sessionId: string, threadId: string, state: DemoState): AgentComponent[] {
  if (!state.mandate?.active) return [...mandateComponents(sessionId, threadId, state),
    { id: componentId(), type: 'explanation', title: '需要先创建授权', body: '外部 Agent 不能自行授权或确认请求。', tone: 'warning' }];
  const options = [
    { id: 'execute' as const, label: '可直接执行', detail: '交通费 ¥300，符合授权且不影响目标' },
    { id: 'ask' as const, label: '需要确认', detail: '购物 ¥200，用途与授权类别不同' },
    { id: 'manual_review' as const, label: '设备验证', detail: '交通费 ¥400，接近单笔限额' },
    { id: 'block' as const, label: '直接拦截', detail: '交通费 ¥2,000，超过授权额度' },
  ];
  const action = createAgentAction(sessionId, threadId, 'simulate_agent_request_batch', state.twinVersion,
    { allowed: options.map(option => option.id) });
  return [{ id: componentId(), type: 'agent_request_batch', title: '验证授权是否符合预期',
    body: '选择要演示的判断结果，NOVA 会为每一项生成独立请求；一项失败不会影响其他项。',
    options, action: { actionId: action.id, label: '发起所选模拟请求' } }];
}

export function prepareCandidateConfirmation(sessionId: string, threadId: string, resultId: string,
  state: DemoState, saveMessage = true) {
  const thread = getAgentThread(sessionId, threadId);
  const task = getAgentTaskForThread(sessionId, threadId);
  const run = getLatestAgentRunForThread(sessionId, threadId);
  if (thread.readOnly || thread.status !== 'active' || !task || task.readOnly ||
    !['awaiting_user', 'awaiting_confirmation', 'monitoring'].includes(task.phase) ||
    !((run && ['completed', 'fallback'].includes(run.status) &&
      run.recommendedResultIds.includes(resultId)) ||
      monitorRecommendationIsCurrent(sessionId, threadId, resultId, state.twinVersion)) ||
    !task.candidateRefs.includes(resultId))
    throw new Error('CANDIDATE_NOT_CURRENT');
  const result = getAgentToolResult(sessionId, threadId, resultId);
  if (result.tool !== 'candidate_preview' || result.status !== 'ok' ||
    result.twinVersion !== state.twinVersion || result.taskId !== task.taskId ||
    result.demoRunId !== task.demoRunId || !result.output.assessment?.dataSufficient ||
    !['on_track', 'at_risk'].includes(result.output.assessment.status) ||
    result.output.input.scenario.kind !== 'baseline') throw new Error('CANDIDATE_NOT_APPLICABLE');
  const input = result.output.input;
  const frozen = { goalId: task.goalId ?? task.goalDraftId ?? task.taskId,
    title: task.facts.title!, savedCents: task.facts.savedCents!,
    originalDate: task.facts.originalTargetDate!, targetCents: input.targetCents,
    targetDate: input.targetDate, monthlyContributionCents: input.monthlyContributionCents,
    firstMonthContributionCents: input.firstMonthContributionCents,
    protectedCents: input.protectedCents };
  if (!frozen.title || frozen.savedCents === null || !frozen.originalDate)
    throw new Error('CANDIDATE_GOAL_INCOMPLETE');
  const candidateHash = stableHash({ resultId, input: result.output.input,
    assessment: result.output.assessment, twinVersion: state.twinVersion });
  const action = createAgentAction(sessionId, threadId, 'apply_verified_candidate', state.twinVersion,
    { taskId: task.taskId, expectedTaskRevision: task.taskRevision + 1,
      demoRunId: task.demoRunId, resultId, candidateHash, frozen });
  updateAgentTask(sessionId, task.taskId, task.taskRevision, {
    phase: 'awaiting_confirmation', waitingReason: 'approval', pendingActionId: action.id });
  const dateChange = frozen.targetDate > frozen.originalDate
    ? `本次同时将目标日期从 ${frozen.originalDate} 调整为 ${frozen.targetDate}（延后 ${Math.ceil((Date.parse(frozen.targetDate) - Date.parse(frozen.originalDate)) / 86400000)} 天）。` : '';
  const body = `目标 ${frozen.title}：${yuan(frozen.targetCents)}，日期 ${frozen.targetDate}，${frozen.firstMonthContributionCents === undefined ? '' : `首月投入 ${yuan(frozen.firstMonthContributionCents)}，之后`}每月投入 ${yuan(frozen.monthlyContributionCents)}，保护资金 ${yuan(frozen.protectedCents)}。${dateChange}确认后激活目标计划；不会自动扣款或创建授权。`;
  const component: AgentComponent = { id: componentId(), type: 'confirmation', title: '核对并激活候选方案',
    body, tone: 'warning', action: { actionId: action.id, label: '确认激活', destructive: false } };
  const message = saveMessage ? saveAgentMessage(sessionId, threadId, { role: 'assistant',
    content: '请核对这项已验证候选的正式变更。', components: [component] }) : null;
  return { action, component, message };
}

export async function createAgentTurn(sessionId: string, threadId: string | null, message: string,
  state: DemoState): Promise<AgentTurn> {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 500) throw new Error('INVALID_AGENT_MESSAGE');
  const deterministicIntent = detectIntent(trimmed);
  const thread = threadId ? getAgentThread(sessionId, threadId) : createAgentThread(sessionId, { title: autoTitle(trimmed, deterministicIntent) });
  if (thread.readOnly) throw new Error('THREAD_READ_ONLY');
  if (thread.status === 'archived') throw new Error('THREAD_ARCHIVED');
  cancelActiveAgentRunForThread(sessionId, thread.id);
  const context = getAgentMessages(sessionId, thread.id, 20).map(item => ({ role: item.role, content: item.content }));
  const previousDraft = getGoalDraft(sessionId, thread.id);
  const priorTask = getAgentTaskForThread(sessionId, thread.id);
  const understood = await interpretAgentRequest(trimmed, deterministicIntent, { context,
    twin: { version: state.twinVersion, goalStatus: state.goal.status, hasImpact: Boolean(state.pendingImpact), hasMandate: Boolean(state.mandate?.active) } });
  const intent = understood.intent !== 'rejected_prompt_injection' && priorTask &&
    priorTask.phase !== 'completed' && priorTask.phase !== 'failed' &&
    !['mandate_management', 'external_agent_request'].includes(understood.intent) &&
    !(understood.intent === 'goal_impact' && /影响|意外支出|额外支出|突然支出|花了|消费了|保养|延期/.test(trimmed))
    ? 'goal_planning' : previousDraft?.missingRequiredFields.length && understood.intent === 'clarification'
      ? 'goal_planning' : understood.intent;
  const userMessage = saveAgentMessage(sessionId, thread.id, { role: 'user', content: trimmed, components: [] });
  let provider: 'deepseek' | 'deterministic' = understood.provider;
  let fallbackReason: string | null = understood.fallbackReason;
  let components: AgentComponent[] = [];
  let reply = '';
  if (intent === 'goal_planning') {
    const parsed = await understandGoalMessage(trimmed, state.clock, priorTask, context);
    provider = parsed.provider; fallbackReason = parsed.fallbackReason ?? fallbackReason;
    if (parsed.kind === 'cancel' && priorTask) {
      cancelAgentTask(sessionId, priorTask.taskId, priorTask.taskRevision);
      components = [{ id: componentId(), type: 'explanation', title: '任务已取消', body: '这项规划已停止，正式财务状态没有变化。', tone: 'warning' }];
      reply = '已取消这项规划。';
    } else if (parsed.kind === 'reject') {
      if (priorTask) updateAgentTask(sessionId, priorTask.taskId, priorTask.taskRevision,
        { phase: 'awaiting_user', waitingReason: 'user_choice', candidateRefs: [], candidateTargetDate: null, pendingActionId: null });
      components = [{ id: componentId(), type: 'clarification', title: '重新选择方向', body: '你希望调整哪一项条件？', suggestions: ['调整预算', '调整日期'] }];
      reply = '已记下你不接受当前方案。';
    } else if (parsed.kind === 'select') {
      const recommended = getLatestAgentRunForThread(sessionId, thread.id)?.recommendedResultIds ?? [];
      if (recommended.length === 1) {
        const prepared = prepareCandidateConfirmation(sessionId, thread.id, recommended[0], state, false);
        components = [prepared.component];
        reply = '已定位到唯一候选。请核对并明确确认后再激活。';
      } else {
        components = [{ id: componentId(), type: 'clarification', title: '确认候选',
          body: '目前没有唯一且有效的推荐候选。请在候选卡片中选择具体方案。', suggestions: ['查看方案'] }];
        reply = '我还不能确定你指的是哪个方案。';
      }
    } else if (parsed.kind === 'ask' && !Object.keys(parsed.changes).length) {
      components = [{ id: componentId(), type: 'clarification', title: '继续规划',
        body: parsed.ambiguity ?? '你想了解目标的哪一部分？', suggestions: [] }];
      reply = '请告诉我你想核对的部分。';
    } else {
    const draft = mergedGoalDraft(sessionId, thread.id, parsed);
    const task = getAgentTaskForThread(sessionId, thread.id)!;
    const source = { kind: 'user_message' as const, messageId: userMessage.id, confirmation: 'unconfirmed' as const };
    const sourceFields = { ...task.fieldSources };
    for (const [field, change] of Object.entries(parsed.changes)) {
      const key = field === 'monthlyContributionCapCents' ? 'monthlyContributionCents' : field;
      if (change.op === 'clear') delete sourceFields[key];
      else sourceFields[key] = source;
    }
    const constraints = { ...task.constraints };
    if (parsed.changes.latestAllowedDate) constraints.latestAllowedDate = parsed.changes.latestAllowedDate.op === 'clear'
      ? null : String(parsed.changes.latestAllowedDate.value);
    if (parsed.changes.preserveEssentialSpending) constraints.preserveEssentialSpending =
      parsed.changes.preserveEssentialSpending.op === 'clear' ? null : Boolean(parsed.changes.preserveEssentialSpending.value);
    const preferences = [...task.preferences.filter(item => !parsed.preferences.includes(item.value)),
      ...parsed.preferences.map(value => ({ key: 'spending_preference', value, source }))];
    if (parsed.changes.monthlyContributionCapCents) {
      const change = parsed.changes.monthlyContributionCapCents;
      for (let index = preferences.length - 1; index >= 0; index--) {
        if (preferences[index].key === 'preferred_monthly_cents') preferences.splice(index, 1);
      }
      if (change.op === 'set') preferences.push({ key: 'preferred_monthly_cents', value: String(change.value), source });
    }
    const unknowns = [...new Set([...task.unknowns.filter(key => !['title', 'targetCents', 'targetDate'].includes(key)),
      ...draft.missingRequiredFields, ...parsed.unknowns])];
    const needsSavedAmount = !draft.missingRequiredFields.length && draft.savedCents === null;
    const needsConnection = !draft.missingRequiredFields.length &&
      !state.dataConnections.some(item => item.status === 'connected');
    const needsHistory = !draft.missingRequiredFields.length && !needsSavedAmount && state.finance.historyMonths < 2;
    const needsClarification = Boolean(draft.missingRequiredFields.length || parsed.ambiguity ||
      needsConnection || needsSavedAmount || needsHistory);
    updateAgentTask(sessionId, task.taskId, task.taskRevision, { constraints, fieldSources: sourceFields,
      preferences, unknowns, phase: needsClarification ? 'awaiting_user' : 'understanding',
      waitingReason: needsClarification ? 'missing_information' : null });
    if (parsed.ambiguity || draft.missingRequiredFields.length) {
      components = [clarificationForDraft(draft)];
      if (parsed.ambiguity) components = [{ id: componentId(), type: 'clarification', title: '需要确认',
        body: parsed.ambiguity, suggestions: [] }];
      reply = '我先确认这一处信息，再继续计算。';
    } else {
      const savedCents = draft.savedCents ?? 0;
      const protectedCents = draft.protectedCents ?? state.finance.emergencyCents;
      const sources = { ...draft.fieldSources,
        savedCents: draft.savedCents == null ? 'default_assumption' as const : draft.fieldSources.savedCents,
        monthlyContributionCents: draft.monthlyContributionCapCents == null
          ? (state.dataConnections.some(item => item.status === 'connected') ? 'connected_data' as const : 'system_calculated' as const)
          : 'user_provided' as const,
        protectedCents: draft.protectedCents == null ? 'connected_data' as const : 'user_provided' as const,
        flexibilityWeeks: draft.flexibilityWeeks == null ? 'default_assumption' as const : 'user_provided' as const };
      components = [{ id: componentId(), type: 'goal_input_card', title: 'NOVA 理解的目标', draftId: draft.id, fieldSources: sources,
        goal: { title: draft.title!, targetCents: draft.targetCents!, savedCents, targetDate: draft.targetDate!, protectedCents, status: 'draft' } },
      ];
      if (needsConnection) {
        components.push({ id: componentId(), type: 'data_connection_prompt', title: '连接模拟数据后再核算',
          body: '目标金额和日期已经记下。先选择要连接的模拟来源，NOVA 才能根据余额与流水核对现金流；连接不会授权扣款。连接后会回到这个任务继续计算。',
          threadId: thread.id });
        if (needsSavedAmount) components.push({ id: componentId(), type: 'clarification',
          title: '请确认已存金额',
          body: '这个目标目前已经存了多少？可以先回复金额，也可以先连接模拟数据；NOVA 不会把总预算当成已存款。',
          suggestions: ['已存 0 元', '已存 ¥3,500'] });
        reply = needsSavedAmount
          ? '我先记下目标。请连接模拟数据，并确认已存金额，再核算可选的存钱节奏。'
          : '我先记下目标。请连接模拟数据，再核算可选的存钱节奏。';
      } else if (needsSavedAmount) {
        components.push({ id: componentId(), type: 'clarification', title: '请确认已存金额',
          body: '你目前为这个目标存了多少？如果还没有存款，请回复“已存 0 元”。确认后 NOVA 会核算可选方案。',
          suggestions: ['已存 0 元', '已存 ¥3,500'] });
        reply = '目标金额和日期已记录。还需要你确认当前已存金额，才能给出有依据的候选。';
      } else if (needsHistory) {
        components.push({ id: componentId(), type: 'clarification', title: '需要模拟流水依据',
          body: '当前模拟历史不足 2 个月。请先在“模拟数据”中载入演示场景或连接模拟来源，再回复“重新试算”。',
          suggestions: ['重新试算'] });
        reply = '目标条件已记录；模拟历史不足，暂不能给出已验证的候选。';
      } else reply = '信息已齐全。NOVA 正在核算不同月存节奏；结果出来后，你可以比较并选择方案。';
    }
    }
  } else if (intent === 'goal_status') {
    components = statusComponents(sessionId, thread.id, state); reply = '这是基于同一份 Financial Twin 计算的进度和方案。';
  } else if (intent === 'goal_impact') {
    const question = await understandExpenseQuestion(trimmed);
    if (question.amountCents !== null && state.goals.length && state.goal.status === 'active') {
      const answer = await explainExpenseImpact(state, question.amountCents, question.mode);
      components = [answer.component]; provider = answer.provider;
      reply = '我按当前模拟数据做了只读对比，结果在下面。';
    } else if (question.amountCents !== null && !state.goals.length) {
      reply = '现在还不能判断这笔支出会不会影响目标。';
      components = [{ id: componentId(), type: 'clarification', title: '先确定目标',
        body: `我理解你说的是 ${yuan(question.amountCents)} 支出，但当前会话没有目标金额和日期。先创建目标或载入模拟演示，我再只读比较支出前后的可存金额与完成日期；这次提问不会记账。`,
        suggestions: ['我想创建一个财务目标'] }];
    } else if (question.amountCents !== null) {
      reply = '可以先算这笔支出的影响，但目前还没有启用的月存计划。';
      components = [{ id: componentId(), type: 'clarification', title: '先选定月存节奏',
        body: `已识别 ${yuan(question.amountCents)} 支出。请先选择并确认目标方案，随后我会比较支出前后的当月可存金额与预计完成日期；不会因为提问而记录支出。`,
        suggestions: ['查看目标方案'] }];
    } else {
      components = impactComponents(sessionId, thread.id, state); reply = state.pendingImpact
        ? '我检查了已记录变化对目标的影响，应急金没有被动用。'
        : '这条消息没有明确支出金额。请告诉我金额，我会只读试算；当前也没有待处理的显著风险提醒。';
    }
  } else if (intent === 'mandate_management') {
    components = mandateComponents(sessionId, thread.id, state); reply = '授权只限定模拟 Agent、用途、单笔额度、累计额度和有效期。';
  } else if (intent === 'external_agent_request') {
    components = externalRequestComponents(sessionId, thread.id, state); reply = '每个请求都要经过 Permission、Risk、Execute、Verify 和 Audit。';
  } else if (intent === 'rejected_prompt_injection') {
    components = [{ id: componentId(), type: 'error_recovery', title: '已阻止无关指令',
      body: '请只描述目标、目标影响或授权范围。模型没有收到这条内容。', code: 'PROMPT_INJECTION_DETECTED' }];
    reply = '这条内容包含与财务任务无关的指令，我没有执行或转发。';
  } else {
    components = [{ id: componentId(), type: 'clarification', title: '我可以怎样帮你？',
      body: '请描述目标、目标风险，或希望授予外部 Agent 的范围。',
      suggestions: ['我想年底去日本旅行，预算 ¥8,000', '这笔 ¥900 支出会影响目标吗？', '允许旅行 Agent 在 ¥500 内订票'] }];
    reply = understood.explanation || '我还不能确定你要完成哪类财务任务。';
  }
  const assistant = saveAgentMessage(sessionId, thread.id, { role: 'assistant', content: reply, components });
  markAgentThreadRead(sessionId, thread.id);
  const turnId = crypto.randomUUID();
  saveAgentTurnRecord(sessionId, { id: turnId, threadId: thread.id, intent, provider, fallbackReason,
    twinVersion: state.twinVersion, components });
  return AgentTurnSchema.parse({ id: turnId, thread: getAgentThread(sessionId, thread.id), intent,
    provider, fallbackReason, twinVersion: state.twinVersion, message: assistant, components,
    canvasComponents: components,
    suggestedPrompts: ['目标现在能按时完成吗？', '这笔 ¥900 支出会影响目标吗？', '允许旅行 Agent 在 ¥500 内订票'] });
}

export function createScenarioPreview(sessionId: string, threadId: string, input: GoalAssumptions,
  state: DemoState) {
  const thread = getAgentThread(sessionId, threadId);
  if (thread.readOnly) throw new Error('THREAD_READ_ONLY');
  if (thread.status === 'archived') throw new Error('THREAD_ARCHIVED');
  const assumptions = GoalAssumptionsSchema.parse(input);
  const draftComponent = getAgentMessages(sessionId, threadId).flatMap(message => message.components).reverse()
    .find(component => component.type === 'goal_input_card');
  const goalDraft = draftComponent?.type === 'goal_input_card' ? {
    id: draftComponent.draftId ?? state.goal.id, title: draftComponent.goal.title,
    savedCents: draftComponent.goal.savedCents,
  } : { id: state.goal.id, title: state.goal.title, savedCents: state.goal.savedCents };
  const preview = previewGoalScenario(state, assumptions, goalDraft);
  const actions = preview.plans.filter(plan => plan.status !== 'infeasible').map(plan => ({ planId: plan.id,
    actionId: createAgentAction(sessionId, threadId, 'apply_goal_scenario_plan', state.twinVersion,
      { assumptions, goalDraft, planId: plan.id }).id }));
  const components: AgentComponent[] = [
    { id: componentId(), type: 'assumption_editor', title: '核对并实时试算', assumptions,
      baseTwinVersion: state.twinVersion, fieldSources: {} },
    { id: componentId(), type: 'goal_feasibility_card', title: '实时试算结果', assessment: preview.assessment },
    { id: componentId(), type: 'scenario_compare', title: '方案比较', plans: preview.plans, actions, selectedPlanId: null },
  ];
  return { preview, components, actionId: actions[0]?.actionId ?? null };
}

export function executeWorkspaceAction(sessionId: string, actionId: string, decision: 'confirm' | 'cancel',
  state: DemoState, selection: string[] = []): { state: DemoState; replayed: boolean; message: ReturnType<typeof saveAgentMessage>;
    nextStep: 'connect_data' | null } {
  const action = getAgentAction(sessionId, actionId);
  if (action.status === 'consumed' || ((action.actionType === 'confirm_subscription_cancellation' || action.actionType.endsWith('_transfer_schedule'))
    && action.status === 'cancelled' && action.result && typeof action.result === 'object' && 'messageId' in action.result)) {
    const messages = getAgentMessages(sessionId, action.threadId);
    const messageId = action.result && typeof action.result === 'object' && 'messageId' in action.result
      ? String((action.result as { messageId: unknown }).messageId) : null;
    const previous = messages.find(message => message.id === messageId) ?? messages.at(-1);
    if (!previous) throw new Error('AGENT_ACTION_RESULT_NOT_FOUND');
    const requiresConnection = ['upsert_goal', 'apply_goal_scenario', 'apply_goal_scenario_plan'].includes(action.actionType)
      && !state.dataConnections.some(item => item.status === 'connected');
    return { state, replayed: true, message: previous, nextStep: requiresConnection ? 'connect_data' : null };
  }
  if (action.status !== 'pending') throw new Error('AGENT_ACTION_NOT_PENDING');
  if (Date.parse(action.expiresAt) < Date.now() || state.twinVersion !== action.twinVersion) {
    const code = Date.parse(action.expiresAt) < Date.now() ? 'AGENT_ACTION_EXPIRED' : 'TWIN_VERSION_CHANGED';
    finishAgentAction(sessionId, actionId, 'cancelled', state);
    const message = saveAgentMessage(sessionId, action.threadId, { role: 'assistant', content: '数据已经变化，请重新生成并核对操作。',
      components: [{ id: componentId(), type: 'error_recovery', title: '需要重新计算',
        body: 'NOVA 已停止旧操作，没有写入任何数据。请再次描述任务以使用最新 Financial Twin。', code }] });
    return { state, replayed: false, message, nextStep: null };
  }
  if (decision === 'cancel') {
    const subscriptionDenial = action.actionType === 'confirm_subscription_cancellation';
    if (subscriptionDenial) {
      const subscriptionActionId = String(action.payload.subscriptionActionId);
      const previous = state.subscriptionActions.find(item => item.id === subscriptionActionId);
      if (!previous) throw new Error('SUBSCRIPTION_ACTION_NOT_FOUND');
      state = persistSubscriptionDecision(state, { ...previous, status: 'cancelled',
        updatedAt: `${state.clock}T12:00:00.000Z` }, action.id);
    }
    const message = saveAgentMessage(sessionId, action.threadId, { role: 'assistant',
      content: subscriptionDenial ? '已撤回取消请求并记录你的决定。续费和资金保持不变。' : '已取消，本次没有修改任何数据。',
      components: [{ id: componentId(), type: 'receipt', title: '操作已取消',
        body: subscriptionDenial ? '没有向商户提交取消请求，已保存本次拒绝取消的决定。' : 'Financial Twin 未发生变化。', status: 'failed' }] });
    finishAgentAction(sessionId, actionId, 'cancelled', subscriptionDenial || action.actionType.endsWith('_transfer_schedule') ? { messageId: message.id } : state);
    return { state, replayed: false, message, nextStep: null };
  }
  assertAiWriteAllowed();
  let next = state;
  let detail = '操作已完成';
  let receiptStatus: 'succeeded' | 'failed' | 'unknown' = 'succeeded';
  let receiptOperationId: string | undefined;
  if (['activate_transfer_schedule', 'pause_transfer_schedule', 'cancel_transfer_schedule'].includes(action.actionType)) {
    const payload = z.object({ previewId: z.string().optional(), scheduleId: z.string().optional(),
      parameters: z.record(z.string(), z.unknown()) }).strict().parse(action.payload);
    const current = action.actionType === 'activate_transfer_schedule'
      ? state.transferSchedulePreviews.find(item => item.id === payload.previewId)
      : getTransferScheduleStatus(state, String(payload.scheduleId));
    if (!current || stableHash(payload.parameters) !== stableHash('previewId' in current
      ? transferScheduleLifecycleParameters(current) : transferScheduleApprovalParameters(current)))
      throw new Error('SCHEDULE_AUTHORITY_CHANGED');
    const approval = runBankingTool(state, 'create_approval_snapshot', { action: action.actionType,
      parameters: payload.parameters, expiresInSeconds: 300 });
    const confirmed = runBankingTool(approval.state, 'confirm_approval', { approvalId: approval.result.approvalId,
      snapshotHash: approval.result.snapshotHash, confirmed: true }, { userConfirmed: true });
    if (action.actionType === 'activate_transfer_schedule')
      next = activateTransferSchedule(confirmed.state, { previewId: String(payload.previewId), approvalToken: confirmed.result.approvalToken }).state;
    else next = runBankingTool(confirmed.state, action.actionType as 'pause_transfer_schedule' | 'cancel_transfer_schedule',
      { scheduleId: payload.scheduleId, approvalToken: confirmed.result.approvalToken }).state;
    receiptOperationId = next.receipts.at(-1)?.operationId;
    detail = action.actionType === 'activate_transfer_schedule' ? '模拟转账计划已创建；首笔尚未执行。'
      : action.actionType === 'pause_transfer_schedule' ? '模拟转账计划已暂停。' : '模拟转账计划已取消。';
  } else if (action.actionType === 'confirm_subscription_cancellation') {
    const payload = z.object({ subscriptionActionId: z.string().min(1),
      parameters: SubscriptionCancellationParametersSchema }).strict().parse(action.payload);
    const cancellation = state.subscriptionActions.find(item => item.id === payload.subscriptionActionId);
    if (!cancellation || cancellation.status !== 'awaiting_confirmation'
      || stableHash(payload.parameters) !== stableHash(subscriptionCancellationParameters(cancellation)))
      throw new Error('SUBSCRIPTION_ACTION_CHANGED');
    const approval = runBankingTool(state, 'create_approval_snapshot', {
      action: 'execute_subscription_cancellation', parameters: payload.parameters, expiresInSeconds: 300 });
    const confirmed = runBankingTool(approval.state, 'confirm_approval', { approvalId: approval.result.approvalId,
      snapshotHash: approval.result.snapshotHash, confirmed: true }, { userConfirmed: true });
    const result = runBankingTool(confirmed.state, 'execute_subscription_cancellation', {
      actionId: cancellation.id, approvalToken: confirmed.result.approvalToken });
    next = result.state;
    receiptOperationId = result.result.receipt?.operationId;
    receiptStatus = result.result.action.status === 'succeeded' ? 'succeeded'
      : result.result.action.status === 'unknown' ? 'unknown' : 'failed';
    detail = receiptStatus === 'succeeded'
      ? `已确认停止每月 ${yuan(cancellation.monthlyCents)} 自动续费。不退款，服务可使用至 ${cancellation.paidThrough}，${cancellation.effectiveAt} 起不再续费。`
      : receiptStatus === 'unknown' ? '当前无法确认是否取消成功。预计续费保持不变，请先查询商户状态，不要重复提交。'
        : result.result.action.status === 'requires_merchant' ? '需要前往商户处理。尚未停止续费，也未计入节省。'
          : '商户未能取消续费。预计续费保持不变，可核对状态后重新准备。';
  } else if (action.actionType === 'confirm_account_snapshot') {
    next = applyConfirmedAccountSnapshot(state, action);
    detail = '模拟账户余额已按确认快照更新；目标储蓄保持不变。';
  } else if (action.actionType === 'apply_verified_candidate') {
    const payload = z.object({ taskId: z.string().uuid(), expectedTaskRevision: z.number().int(),
      demoRunId: z.string().uuid(), resultId: z.string().uuid(), candidateHash: z.string(),
      frozen: z.object({ goalId: z.string(), title: z.string(), savedCents: z.number().int().nonnegative(),
        originalDate: z.iso.date(), targetCents: z.number().int().positive(), targetDate: z.iso.date(),
        monthlyContributionCents: z.number().int().nonnegative(),
        firstMonthContributionCents: z.number().int().nonnegative().optional(),
        protectedCents: z.number().int().nonnegative() }).strict() }).strict().parse(action.payload);
    const task = getAgentTaskForThread(sessionId, action.threadId);
    const result = getAgentToolResult(sessionId, action.threadId, payload.resultId);
    if (!task || task.taskId !== payload.taskId || task.demoRunId !== payload.demoRunId ||
      task.taskRevision !== payload.expectedTaskRevision || task.pendingActionId !== action.id ||
      task.phase !== 'awaiting_confirmation' || result.tool !== 'candidate_preview' ||
      result.status !== 'ok' || result.twinVersion !== state.twinVersion ||
      result.taskId !== task.taskId || !task.candidateRefs.includes(payload.resultId) ||
      stableHash({ resultId: payload.resultId, input: result.output.input,
        assessment: result.output.assessment, twinVersion: state.twinVersion }) !== payload.candidateHash)
      throw new Error('CANDIDATE_CONFIRMATION_STALE');
    const { input } = result.output;
    if (input.scenario.kind !== 'baseline' || input.targetCents !== payload.frozen.targetCents ||
      input.targetDate !== payload.frozen.targetDate ||
      input.monthlyContributionCents !== payload.frozen.monthlyContributionCents ||
      input.firstMonthContributionCents !== payload.frozen.firstMonthContributionCents ||
      input.protectedCents !== payload.frozen.protectedCents ||
      task.facts.title !== payload.frozen.title || task.facts.savedCents !== payload.frozen.savedCents ||
      task.facts.originalTargetDate !== payload.frozen.originalDate)
      throw new Error('CANDIDATE_PARAMETERS_CHANGED');
    const approvalParameters = { actionId: action.id, taskId: task.taskId,
      taskRevision: task.taskRevision, candidateHash: payload.candidateHash,
      twinVersion: state.twinVersion, idempotencyKey: action.idempotencyKey, frozen: payload.frozen };
    const approved = runBankingTool(state, 'create_approval_snapshot', {
      action: 'apply_goal_candidate', parameters: approvalParameters, expiresInSeconds: 300 });
    const confirmed = runBankingTool(approved.state, 'confirm_approval', {
      approvalId: approved.result.approvalId, snapshotHash: approved.result.snapshotHash, confirmed: true },
    { userConfirmed: true });
    next = runBankingTool(confirmed.state, 'apply_goal_candidate', {
      ...payload.frozen, approvalParameters, approvalToken: confirmed.result.approvalToken }).state;
    const goal = next.goal;
    for (const [key, value] of Object.entries(payload.frozen)) {
      const actual = key === 'goalId' ? goal.id : goal[key as keyof typeof goal];
      if (actual !== value) throw new Error('CANDIDATE_VERIFY_MISMATCH');
    }
    if (goal.status !== 'active' || goal.selectedPlanId !== 'custom' ||
      next.finance.checkingCents !== state.finance.checkingCents ||
      next.finance.emergencyCents !== state.finance.emergencyCents ||
      next.mandate !== state.mandate) throw new Error('CANDIDATE_VERIFY_MISMATCH');
    detail = '自定义候选已激活；正式目标与确认内容逐项一致，未扣款或创建授权。';
  } else if (action.actionType === 'upsert_goal') {
    next = runBankingTool(state, 'create_goal', { ...action.payload, flexibilityWeeks: state.goal.flexibilityWeeks,
      quote: '由 NOVA 对话工作台创建' }).state;
    detail = '目标草案已保存，请继续选择推进方案。';
  } else if (action.actionType === 'apply_goal_scenario' || action.actionType === 'apply_goal_scenario_plan') {
    const envelope = action.payload.assumptions ? action.payload : { assumptions: action.payload, goalDraft: null };
    const assumptions = GoalAssumptionsSchema.parse(envelope.assumptions);
    const goalDraft = envelope.goalDraft && typeof envelope.goalDraft === 'object'
      ? envelope.goalDraft as { id: string; title: string; savedCents: number } : null;
    next = goalDraft && goalDraft.id !== state.goal.id
      ? runBankingTool(state, 'create_goal', { id: goalDraft.id, title: goalDraft.title,
        targetCents: assumptions.targetCents, targetDate: assumptions.targetDate,
        protectedCents: assumptions.protectedCents, flexibilityWeeks: assumptions.flexibilityWeeks,
        monthlyContributionCents: assumptions.monthlyContributionCents,
        quote: '由 NOVA What-if 工作台创建' }).state
      : runBankingTool(state, 'update_goal', assumptions).state;
    if (action.actionType === 'apply_goal_scenario_plan') {
      const planId = String(action.payload.planId);
      const selected = runBankingTool(next, 'select_goal_plan', { planId });
      const approval = runBankingTool(selected.state, 'create_approval_snapshot', {
        action: 'activate_goal', parameters: { planId }, expiresInSeconds: 300 });
      const confirmed = runBankingTool(approval.state, 'confirm_approval', { approvalId: approval.result.approvalId,
        snapshotHash: approval.result.snapshotHash, confirmed: true }, { userConfirmed: true });
      next = runBankingTool(confirmed.state, 'activate_goal', { planId, approvalToken: confirmed.result.approvalToken }).state;
      detail = '目标假设和所选方案已启用，不会自动扣款。';
    } else detail = '目标假设已应用，方案需要重新选择后才能激活。';
  } else if (action.actionType === 'activate_plan') {
    const planId = String(action.payload.planId);
    const selected = runBankingTool(state, 'select_goal_plan', { planId });
    const approval = runBankingTool(selected.state, 'create_approval_snapshot', { action: 'activate_goal', parameters: { planId }, expiresInSeconds: 300 });
    const confirmed = runBankingTool(approval.state, 'confirm_approval', { approvalId: approval.result.approvalId,
      snapshotHash: approval.result.snapshotHash, confirmed: true }, { userConfirmed: true });
    next = runBankingTool(confirmed.state, 'activate_goal', { planId, approvalToken: confirmed.result.approvalToken }).state;
    detail = '目标计划已激活，不会自动扣款。';
  } else if (action.actionType === 'resolve_impact') {
    throw new Error('RISK_REPAIR_PREVIEW_REQUIRED');
  } else if (action.actionType === 'create_mandate') {
    const parameters = { agentId: String(action.payload.agentId), category: String(action.payload.category),
      maxPerOperationCents: Number(action.payload.maxPerOperationCents), totalLimitCents: Number(action.payload.totalLimitCents),
      expiresAt: String(action.payload.expiresAt) };
    const approval = runBankingTool(state, 'create_approval_snapshot', { action: 'create_mandate', parameters, expiresInSeconds: 300 });
    const confirmed = runBankingTool(approval.state, 'confirm_approval', { approvalId: approval.result.approvalId,
      snapshotHash: approval.result.snapshotHash, confirmed: true }, { userConfirmed: true });
    next = runBankingTool(confirmed.state, 'create_mandate', { ...parameters, approvalToken: confirmed.result.approvalToken }).state;
    detail = '限定授权已创建，外部 Agent 仍不能自行确认请求。';
  } else if (action.actionType === 'simulate_agent_request') {
    const scenario = String(action.payload.scenario);
    const request = { agentId: 'travel-agent-demo', category: scenario === 'shopping' ? 'shopping' : 'transport',
      amountCents: scenario === 'over_limit' ? 200000 : scenario === 'manual_review' ? 40000 : scenario === 'shopping' ? 20000 : 30000,
      idempotencyKey: action.idempotencyKey };
    const outcome = evaluateExternalRequest(state, request);
    next = outcome.state; detail = `${outcome.operation.status.toUpperCase()} · ${outcome.operation.reason}`;
  } else if (action.actionType === 'simulate_agent_request_batch') {
    const allowed = new Set(Array.isArray(action.payload.allowed) ? action.payload.allowed.map(String) : []);
    const selected = [...new Set(selection.map(String))];
    if (!selected.length || selected.some(item => !allowed.has(item))) throw new Error('INVALID_AGENT_BATCH_SELECTION');
    const scenarioMap: Record<string, { category: string; amountCents: number }> = {
      execute: { category: 'transport', amountCents: 30000 }, ask: { category: 'shopping', amountCents: 20000 },
      manual_review: { category: 'transport', amountCents: 40000 }, block: { category: 'transport', amountCents: 200000 },
    };
    const outcomes: string[] = [];
    for (const item of selected) {
      const scenario = scenarioMap[item];
      const outcome = evaluateExternalRequest(next, { agentId: 'travel-agent-demo', ...scenario,
        idempotencyKey: `${action.idempotencyKey}:${item}` });
      next = outcome.state;
      outcomes.push(`${item}: ${outcome.operation.status}`);
    }
    detail = `已生成 ${selected.length} 个独立请求（${outcomes.join('；')}）`;
  } else throw new Error('UNKNOWN_AGENT_ACTION');
  const receipt: AgentComponent = { id: componentId(), type: 'receipt', title: 'NOVA 操作凭证', body: detail,
    status: receiptStatus, operationId: receiptOperationId ?? (action.actionType === 'apply_verified_candidate'
      ? undefined : next.operations.length > state.operations.length ? next.operations.at(-1)?.operationId : undefined) };
  let followups: AgentComponent[] = [];
  const requiresConnection = ['upsert_goal', 'apply_goal_scenario', 'apply_goal_scenario_plan'].includes(action.actionType)
    && !next.dataConnections.some(item => item.status === 'connected');
  if (requiresConnection) followups = [{ id: componentId(), type: 'explanation',
    title: '连接模拟数据后再计算',
    body: '先选择要读取的模拟银行卡、微信支付和支付宝来源。NOVA 只读取余额与近 90 天流水，不获得扣款或转账权限。',
    tone: 'neutral' }];
  else if (action.actionType === 'upsert_goal' || action.actionType === 'apply_goal_scenario' || action.actionType === 'apply_goal_scenario_plan')
    followups = statusComponents(sessionId, action.threadId, next);
  if (action.actionType === 'create_mandate') followups = externalRequestComponents(sessionId, action.threadId, next);
  if (action.actionType === 'apply_verified_candidate') followups = [{ id: componentId(),
    type: 'monitoring_opt_in', title: '持续关注这个目标',
    body: '仅在你启用后，服务进程会根据模拟数据变化检查目标；关闭服务时不会后台运行。',
    taskThreadId: action.threadId, goalId: next.goal.id, enabled: false }];
  if (action.actionType === 'simulate_agent_request' || action.actionType === 'simulate_agent_request_batch') followups = [{ id: componentId(), type: 'audit_summary',
    title: '治理与审计', body: '请求已按固定安全链路记录，可在执行记录中导出证据。', chainValid: verifyAuditChain(next.audit) }];
  const message = saveAgentMessage(sessionId, action.threadId, { role: 'assistant', content: detail, components: [receipt, ...followups] });
  finishAgentAction(sessionId, actionId, 'consumed', { messageId: message.id });
  return { state: next, replayed: false, message, nextStep: requiresConnection ? 'connect_data' : null };
}

export function ensureImpactThread(sessionId: string, state: DemoState, now = new Date()) {
  if (!state.pendingImpact || state.pendingImpact.dismissed) return null;
  const delivery = notificationDelivery(state.riskPreferences, 'immediate', now);
  let thread = createAgentThread(sessionId, { title: `${state.pendingImpact.title}影响目标`, kind: 'risk',
    unread: delivery.mode === 'immediate', dedupeKey: `impact:${state.pendingImpact.id}` });
  if (delivery.mode === 'immediate' && !thread.unread) thread = markAgentThreadUnread(sessionId, thread.id);
  if (!getAgentMessages(sessionId, thread.id).length) saveAgentMessage(sessionId, thread.id, { role: 'assistant',
    content: 'NOVA 检测到一次显著变化，已计算它对目标的影响。', components: impactComponents(sessionId, thread.id, state) });
  return thread;
}

export function ensureWeeklyRiskSummary(sessionId: string, state: DemoState) {
  const summary = buildWeeklyRiskSummary(state);
  if (!summary) return { state, summary: null, thread: null, replayed: false };
  const existing = state.weeklyRiskSummaries.find(item => item.dedupeKey === summary.dedupeKey);
  if (existing) {
    const thread = listAgentThreads(sessionId, true).find(item => item.kind === 'summary'
      && item.title.includes(existing.weekStart)) ?? null;
    return { state, summary: existing, thread, replayed: true };
  }
  const thread = createAgentThread(sessionId, { title: `每周摘要 · ${summary.weekStart}`, kind: 'summary',
    unread: false, dedupeKey: summary.dedupeKey });
  saveAgentMessage(sessionId, thread.id, { role: 'assistant', content: summary.body, components: [{
    id: componentId(), type: 'goal_impact_brief', title: summary.title, body: summary.body, summary,
  }, { id: componentId(), type: 'notification_preference_card', title: '智能守护通知偏好',
    preferences: state.riskPreferences, goalId: state.goal.id }] });
  return { state: { ...state, weeklyRiskSummaries: [...state.weeklyRiskSummaries, summary] },
    summary, thread, replayed: false };
}

export function workspaceOverview(sessionId: string) {
  return { threads: listAgentThreads(sessionId, true) };
}


