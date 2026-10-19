import { AgentTurnSchema, GoalAssumptionsSchema, type AgentComponent, type AgentIntent,
  type AgentTurn, type DemoState, type GoalAssumptions, type GoalDraft } from '../shared/contracts.ts';
import { interpretAgentRequest, interpretGoal } from './agent.ts';
import { buildWeeklyRiskSummary, markActiveRiskSignal, notificationDelivery } from './risk.ts';
import { assessGoal, availableMonthly, resolveImpact } from './domain.ts';
import { runBankingTool } from './banking.ts';
import { evaluateExternalRequest } from './tools.ts';
import { verifyAuditChain } from './governance.ts';
import { previewGoalScenario } from './scenario.ts';
import {
  createAgentAction, createAgentThread, finishAgentAction, getAgentAction, getAgentMessages, getGoalDraft,
  getAgentThread, listAgentThreads, markAgentThreadRead, markAgentThreadUnread, saveAgentMessage, saveAgentTurnRecord, saveGoalDraft,
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

function assumptionsFromGoal(state: DemoState, goal = state.goal) {
  return { targetCents: goal.targetCents, targetDate: goal.targetDate,
    monthlyContributionCents: goal.monthlyContributionCents, protectedCents: goal.protectedCents,
    flexibilityWeeks: goal.flexibilityWeeks };
}

const requiredDraftFields = ['title', 'targetCents', 'targetDate'] as const;
function mergedGoalDraft(sessionId: string, threadId: string, parsed: Awaited<ReturnType<typeof interpretGoal>>['goal'],
  state: DemoState): GoalDraft {
  const previous = getGoalDraft(sessionId, threadId);
  const next: GoalDraft = {
    id: previous?.id ?? crypto.randomUUID(), threadId, goalId: previous?.goalId ?? null,
    title: parsed.title ?? previous?.title ?? null,
    targetCents: parsed.targetAmount != null ? Math.round(parsed.targetAmount * 100) : previous?.targetCents ?? null,
    targetDate: parsed.targetDate ?? previous?.targetDate ?? null,
    savedCents: parsed.savedAmount != null ? Math.round(parsed.savedAmount * 100) : previous?.savedCents ?? null,
    monthlyContributionCapCents: parsed.monthlySavings != null ? Math.round(parsed.monthlySavings * 100) : previous?.monthlyContributionCapCents ?? null,
    protectedCents: parsed.emergencyFundProtected != null ? Math.round(parsed.emergencyFundProtected * 100) : previous?.protectedCents ?? null,
    flexibilityWeeks: parsed.flexibilityWeeks ?? previous?.flexibilityWeeks ?? null,
    fieldSources: { ...(previous?.fieldSources ?? {}) }, missingRequiredFields: [], updatedAt: new Date().toISOString(),
  };
  for (const [key, present] of Object.entries({ title: parsed.title != null, targetCents: parsed.targetAmount != null,
    targetDate: parsed.targetDate != null, savedCents: parsed.savedAmount != null,
    monthlyContributionCents: parsed.monthlySavings != null, protectedCents: parsed.emergencyFundProtected != null,
    flexibilityWeeks: parsed.flexibilityWeeks != null })) if (present) next.fieldSources[key] = 'user_provided';
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

function statusComponents(sessionId: string, threadId: string, state: DemoState): AgentComponent[] {
  const assessment = assessGoal(state);
  const actions = state.goal.status === 'active' ? [] : assessment.plans.filter(item => item.status !== 'infeasible')
    .map(plan => ({ planId: plan.id, actionId: createAgentAction(sessionId, threadId, 'activate_plan',
      state.twinVersion, { planId: plan.id }).id }));
  const components: AgentComponent[] = [
    { id: componentId(), type: 'goal_progress_card', title: '当前目标进度', goal: state.goal,
      progressPercent: assessment.progressPercent },
    { id: componentId(), type: 'goal_feasibility_card', title: '目标可行性', assessment },
    { id: componentId(), type: 'assumption_editor', title: '调整目标假设',
      assumptions: assumptionsFromGoal(state), baseTwinVersion: state.twinVersion, fieldSources: {} },
    { id: componentId(), type: 'scenario_compare', title: '三种推进节奏', plans: assessment.plans, actions, selectedPlanId: state.goal.selectedPlanId },
  ];
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

export async function createAgentTurn(sessionId: string, threadId: string | null, message: string,
  state: DemoState): Promise<AgentTurn> {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 500) throw new Error('INVALID_AGENT_MESSAGE');
  const deterministicIntent = detectIntent(trimmed);
  const thread = threadId ? getAgentThread(sessionId, threadId) : createAgentThread(sessionId, { title: autoTitle(trimmed, deterministicIntent) });
  if (thread.readOnly) throw new Error('THREAD_READ_ONLY');
  if (thread.status === 'archived') throw new Error('THREAD_ARCHIVED');
  const context = getAgentMessages(sessionId, thread.id, 20).map(item => ({ role: item.role, content: item.content }));
  const previousDraft = getGoalDraft(sessionId, thread.id);
  const understood = await interpretAgentRequest(trimmed, deterministicIntent, { context,
    twin: { version: state.twinVersion, goalStatus: state.goal.status, hasImpact: Boolean(state.pendingImpact), hasMandate: Boolean(state.mandate?.active) } });
  const intent = previousDraft?.missingRequiredFields.length && understood.intent === 'clarification'
    ? 'goal_planning' : understood.intent;
  saveAgentMessage(sessionId, thread.id, { role: 'user', content: trimmed, components: [] });
  let provider: 'deepseek' | 'deterministic' = understood.provider;
  let fallbackReason: string | null = understood.fallbackReason;
  let components: AgentComponent[] = [];
  let reply = '';
  if (intent === 'goal_planning') {
    const parsed = await interpretGoal(trimmed, state.clock);
    provider = parsed.provider; fallbackReason = parsed.fallbackReason ?? fallbackReason;
    const draft = mergedGoalDraft(sessionId, thread.id, parsed.goal, state);
    if (draft.missingRequiredFields.length) {
      components = [clarificationForDraft(draft)];
      reply = '我先补齐创建计划必需的信息，再为你计算时间和方案。';
    } else {
      const savedCents = draft.savedCents ?? 0;
      const monthlyContributionCents = draft.monthlyContributionCapCents ?? availableMonthly(state);
      const protectedCents = draft.protectedCents ?? state.finance.emergencyCents;
      const flexibilityWeeks = draft.flexibilityWeeks ?? 2;
      const sources = { ...draft.fieldSources,
        savedCents: draft.savedCents == null ? 'default_assumption' as const : draft.fieldSources.savedCents,
        monthlyContributionCents: draft.monthlyContributionCapCents == null
          ? (state.dataConnections.some(item => item.status === 'connected') ? 'connected_data' as const : 'system_calculated' as const)
          : 'user_provided' as const,
        protectedCents: draft.protectedCents == null ? 'connected_data' as const : 'user_provided' as const,
        flexibilityWeeks: draft.flexibilityWeeks == null ? 'default_assumption' as const : 'user_provided' as const };
      const assumptions = { targetCents: draft.targetCents!, targetDate: draft.targetDate!, monthlyContributionCents,
        protectedCents, flexibilityWeeks };
      const goalDraft = { id: draft.goalId ?? draft.id, title: draft.title!, savedCents };
      const preview = previewGoalScenario(state, assumptions, goalDraft);
      const actions = preview.plans.filter(plan => plan.status !== 'infeasible').map(plan => ({ planId: plan.id,
        actionId: createAgentAction(sessionId, thread.id, 'apply_goal_scenario_plan', state.twinVersion,
          { assumptions, goalDraft, planId: plan.id }).id }));
      components = [{ id: componentId(), type: 'goal_input_card', title: 'NOVA 理解的目标', draftId: draft.id, fieldSources: sources,
        goal: { title: draft.title!, targetCents: draft.targetCents!, savedCents, targetDate: draft.targetDate!, protectedCents, status: 'draft' } },
      { id: componentId(), type: 'assumption_editor', title: '核对并实时试算', assumptions, baseTwinVersion: state.twinVersion, fieldSources: sources },
      { id: componentId(), type: 'goal_feasibility_card', title: '目标可行性', assessment: preview.assessment },
      { id: componentId(), type: 'scenario_compare', title: '方案比较', plans: preview.plans, actions, selectedPlanId: null }];
      reply = '信息已经完整。我根据你的表达和当前数据计算了可行性，请选择一种节奏后确认启用。';
    }
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
  if (action.status === 'consumed') {
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
    finishAgentAction(sessionId, actionId, 'cancelled', state);
    const message = saveAgentMessage(sessionId, action.threadId, { role: 'assistant', content: '已取消，本次没有修改任何数据。',
      components: [{ id: componentId(), type: 'receipt', title: '操作已取消', body: 'Financial Twin 未发生变化。', status: 'failed' }] });
    return { state, replayed: false, message, nextStep: null };
  }
  let next = state;
  let detail = '操作已完成';
  if (action.actionType === 'upsert_goal') {
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
    status: 'succeeded', operationId: next.operations.at(-1)?.operationId };
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
