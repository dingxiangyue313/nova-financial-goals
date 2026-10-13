import { AgentTurnSchema, DemoStateSchema, type AgentComponent, type AgentIntent,
  type AgentTurn, type DemoState } from '../shared/contracts.ts';
import { interpretAgentRequest, interpretGoal } from './agent.ts';
import { markActiveRiskSignal } from './risk.ts';
import { assessGoal, resolveImpact } from './domain.ts';
import { runBankingTool } from './banking.ts';
import { evaluateExternalRequest } from './tools.ts';
import { verifyAuditChain } from './governance.ts';
import {
  createAgentAction, createAgentThread, finishAgentAction, getAgentAction, getAgentMessages,
  getAgentThread, listAgentThreads, markAgentThreadRead, saveAgentMessage, saveAgentTurnRecord,
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

function confirmation(sessionId: string, threadId: string, state: DemoState, actionType: string,
  payload: Record<string, unknown>, title: string, body: string, label: string, destructive = false): AgentComponent {
  const action = createAgentAction(sessionId, threadId, actionType, state.twinVersion, payload);
  return { id: componentId(), type: 'confirmation', title, body, tone: destructive ? 'danger' : 'warning',
    action: { actionId: action.id, label, destructive } };
}

function statusComponents(sessionId: string, threadId: string, state: DemoState): AgentComponent[] {
  const assessment = assessGoal(state);
  const components: AgentComponent[] = [goalSummary(state),
    { id: componentId(), type: 'feasibility', title: '目标可行性', assessment },
    { id: componentId(), type: 'plan_compare', title: '三种推进节奏', plans: assessment.plans }];
  if (state.goal.status !== 'active') {
    for (const plan of assessment.plans.filter(item => item.status !== 'infeasible')) components.push(confirmation(
      sessionId, threadId, state, 'activate_plan', { planId: plan.id }, `选择${plan.label}`,
      `${yuan(plan.monthlyCents)}/月；${plan.explanation}。确认后将激活模拟计划，不会自动扣款。`,
      `确认${plan.label}`));
  }
  return components;
}

function impactComponents(sessionId: string, threadId: string, state: DemoState): AgentComponent[] {
  if (!state.pendingImpact) return [{ id: componentId(), type: 'explanation', title: '目前没有显著影响',
    body: '当前没有需要处理的目标风险。小额波动会保持安静。', tone: 'good' }];
  const impact = state.pendingImpact;
  const components: AgentComponent[] = [];
  const signal = state.riskSignals.find(item => item.status === 'active' || item.status === 'later');
  const pattern = signal && state.spendingPatterns.find(item => item.id === signal.patternId);
  if (signal && pattern) components.push({ id: componentId(), type: 'risk_signal',
    title: signal.title, signal, pattern, protectedCents: state.finance.emergencyCents });
  components.push({ id: componentId(), type: 'impact_summary',
    title: `${impact.title}可能影响目标`, impact, protectedCents: state.finance.emergencyCents });
  if (impact.optionAAvailable) components.push(confirmation(sessionId, threadId, state, 'resolve_impact', { decision: 'A' },
    '方案 A · 保持目标日期', `将月存调整为 ${yuan(impact.optionAContributionCents)}，应急金保持隔离。`, '确认方案 A'));
  components.push(confirmation(sessionId, threadId, state, 'resolve_impact', { decision: 'B' },
    '方案 B · 调整目标日期', `保持当前月存，目标日期调整到 ${impact.optionBDate}。`, '确认方案 B'));
  components.push(confirmation(sessionId, threadId, state, 'resolve_impact', { decision: 'later' },
    '稍后处理', '保留这条风险会话，不修改目标。', '稍后处理'));
  components.push(confirmation(sessionId, threadId, state, 'resolve_impact', { decision: 'dismiss' },
    '忽略本次提示', '隐藏当前信号；底层事实不变前不会重复提醒。', '忽略本次提示'));
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
  const scenarios = [
    ['transport', '交通请求 · Execute', '¥300，在授权范围内'],
    ['shopping', '购物请求 · Ask', '¥200，用途与授权类别不同'],
    ['manual_review', '高额请求 · Manual Review', '¥400，接近单笔上限'],
    ['over_limit', '超限请求 · Block', '¥2,000，超过授权额度'],
  ] as const;
  return scenarios.map(([scenario, title, body]) => confirmation(sessionId, threadId, state,
    'simulate_agent_request', { scenario }, title, body, `确认发起${title.split(' · ')[1]}`));
}

export async function createAgentTurn(sessionId: string, threadId: string | null, message: string,
  state: DemoState): Promise<AgentTurn> {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 500) throw new Error('INVALID_AGENT_MESSAGE');
  const deterministicIntent = detectIntent(trimmed);
  const thread = threadId ? getAgentThread(sessionId, threadId) : createAgentThread(sessionId, { title: autoTitle(trimmed, deterministicIntent) });
  if (thread.readOnly) throw new Error('THREAD_READ_ONLY');
  if (thread.status === 'archived') throw new Error('THREAD_ARCHIVED');
  const context = getAgentMessages(sessionId, thread.id, 20).map(item => ({ role: item.role, content: item.content }));
  const understood = await interpretAgentRequest(trimmed, deterministicIntent, { context,
    twin: { version: state.twinVersion, goalStatus: state.goal.status, hasImpact: Boolean(state.pendingImpact), hasMandate: Boolean(state.mandate?.active) } });
  const intent = understood.intent;
  saveAgentMessage(sessionId, thread.id, { role: 'user', content: trimmed, components: [] });
  let provider: 'deepseek' | 'deterministic' = understood.provider;
  let fallbackReason: string | null = understood.fallbackReason;
  let components: AgentComponent[] = [];
  let reply = '';
  if (intent === 'goal_planning') {
    const parsed = await interpretGoal(trimmed, state.clock);
    provider = parsed.provider; fallbackReason = parsed.notice ?? fallbackReason;
    const draft = {
      title: parsed.goal.title && parsed.goal.title !== '我的新目标' ? parsed.goal.title : state.goal.title,
      targetCents: parsed.goal.targetAmount ? Math.round(parsed.goal.targetAmount * 100) : state.goal.targetCents,
      targetDate: parsed.goal.targetDate ?? state.goal.targetDate,
      protectedCents: parsed.goal.emergencyFundProtected ? Math.round(parsed.goal.emergencyFundProtected * 100) : state.goal.protectedCents,
    };
    components = [goalSummary(state, draft), confirmation(sessionId, thread.id, state, 'upsert_goal', draft,
      '确认目标草案', `${draft.title} · ${yuan(draft.targetCents)} · 目标日 ${draft.targetDate}。确认后再比较可行方案。`, '确认保存目标草案')];
    reply = '我把目标整理成了可核对的草案。金额和日期由服务端固定后才会写入。';
  } else if (intent === 'goal_status') {
    components = statusComponents(sessionId, thread.id, state); reply = '这是基于同一份 Financial Twin 计算的进度和方案。';
  } else if (intent === 'goal_impact') {
    components = impactComponents(sessionId, thread.id, state); reply = state.pendingImpact
      ? '我检查了这笔变化对目标的传导，应急金没有被动用。' : '目前没有需要打扰你的显著目标变化。';
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
    suggestedPrompts: ['目标现在能按时完成吗？', '这笔 ¥900 支出会影响目标吗？', '允许旅行 Agent 在 ¥500 内订票'] });
}

export function executeWorkspaceAction(sessionId: string, actionId: string, decision: 'confirm' | 'cancel',
  state: DemoState): { state: DemoState; replayed: boolean; message: ReturnType<typeof saveAgentMessage> } {
  const action = getAgentAction(sessionId, actionId);
  if (action.status === 'consumed') {
    const result = DemoStateSchema.parse(action.result);
    const previous = getAgentMessages(sessionId, action.threadId).at(-1);
    return { state: result, replayed: true, message: previous! };
  }
  if (action.status !== 'pending') throw new Error('AGENT_ACTION_NOT_PENDING');
  if (Date.parse(action.expiresAt) < Date.now() || state.twinVersion !== action.twinVersion) {
    const code = Date.parse(action.expiresAt) < Date.now() ? 'AGENT_ACTION_EXPIRED' : 'TWIN_VERSION_CHANGED';
    finishAgentAction(sessionId, actionId, 'cancelled', state);
    const message = saveAgentMessage(sessionId, action.threadId, { role: 'assistant', content: '数据已经变化，请重新生成并核对操作。',
      components: [{ id: componentId(), type: 'error_recovery', title: '需要重新计算',
        body: 'NOVA 已停止旧操作，没有写入任何数据。请再次描述任务以使用最新 Financial Twin。', code }] });
    return { state, replayed: false, message };
  }
  if (decision === 'cancel') {
    finishAgentAction(sessionId, actionId, 'cancelled', state);
    const message = saveAgentMessage(sessionId, action.threadId, { role: 'assistant', content: '已取消，本次没有修改任何数据。',
      components: [{ id: componentId(), type: 'receipt', title: '操作已取消', body: 'Financial Twin 未发生变化。', status: 'failed' }] });
    return { state, replayed: false, message };
  }
  let next = state;
  let detail = '操作已完成';
  if (action.actionType === 'upsert_goal') {
    next = runBankingTool(state, 'create_goal', { ...action.payload, flexibilityWeeks: state.goal.flexibilityWeeks,
      quote: '由 NOVA 对话工作台创建' }).state;
    detail = '目标草案已保存，请继续选择推进方案。';
  } else if (action.actionType === 'activate_plan') {
    const planId = String(action.payload.planId);
    const selected = runBankingTool(state, 'select_goal_plan', { planId });
    const approval = runBankingTool(selected.state, 'create_approval_snapshot', { action: 'activate_goal', parameters: { planId }, expiresInSeconds: 300 });
    const confirmed = runBankingTool(approval.state, 'confirm_approval', { approvalId: approval.result.approvalId,
      snapshotHash: approval.result.snapshotHash, confirmed: true }, { userConfirmed: true });
    next = runBankingTool(confirmed.state, 'activate_goal', { planId, approvalToken: confirmed.result.approvalToken }).state;
    detail = '目标计划已激活，不会自动扣款。';
  } else if (action.actionType === 'resolve_impact') {
    const decision = String(action.payload.decision) as 'A' | 'B' | 'later' | 'dismiss';
    next = markActiveRiskSignal(resolveImpact(state, decision), decision, state.pendingImpact?.id);
    detail = decision === 'later' ? '已保留风险会话，稍后可继续处理。'
      : decision === 'dismiss' ? '已忽略本次提示；事实不变前不会重复提醒。'
      : `已应用目标影响方案 ${decision}。`;
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
  } else throw new Error('UNKNOWN_AGENT_ACTION');
  const receipt: AgentComponent = { id: componentId(), type: 'receipt', title: 'NOVA 操作凭证', body: detail,
    status: 'succeeded', operationId: next.operations.at(-1)?.operationId };
  let followups: AgentComponent[] = [];
  if (action.actionType === 'upsert_goal') followups = statusComponents(sessionId, action.threadId, next);
  if (action.actionType === 'create_mandate') followups = externalRequestComponents(sessionId, action.threadId, next);
  if (action.actionType === 'simulate_agent_request') followups = [{ id: componentId(), type: 'audit_summary',
    title: '治理与审计', body: '请求已按固定安全链路记录，可在执行记录中导出证据。', chainValid: verifyAuditChain(next.audit) }];
  const message = saveAgentMessage(sessionId, action.threadId, { role: 'assistant', content: detail, components: [receipt, ...followups] });
  finishAgentAction(sessionId, actionId, 'consumed', next);
  return { state: next, replayed: false, message };
}

export function ensureImpactThread(sessionId: string, state: DemoState) {
  if (!state.pendingImpact || state.pendingImpact.dismissed) return null;
  const thread = createAgentThread(sessionId, { title: `${state.pendingImpact.title}影响目标`, kind: 'risk',
    unread: true, dedupeKey: `impact:${state.pendingImpact.id}` });
  if (!getAgentMessages(sessionId, thread.id).length) saveAgentMessage(sessionId, thread.id, { role: 'assistant',
    content: 'NOVA 检测到一次显著变化，已计算它对目标的影响。', components: impactComponents(sessionId, thread.id, state) });
  return thread;
}

export function workspaceOverview(sessionId: string) {
  return { threads: listAgentThreads(sessionId, true) };
}
