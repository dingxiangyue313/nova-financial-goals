import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAgentRun, createAgentThread, getAgentMessages, getAgentRun, getAgentTaskForThread,
  getState, agentActionCount, saveAgentMessage, saveGoalDraft } from './store.ts';
import { runAgentTask, stopAgentRun, type DecisionProvider } from './agent-runner.ts';
import { createAgentTurn } from './workspace.ts';

function setup(deadlineMs = 45_000, monthlyCapCents = 200000,
  userMessage = '年底去日本，预算八千') {
  const sessionId = randomUUID();
  const thread = createAgentThread(sessionId, { title: '旅行规划' });
  const message = saveAgentMessage(sessionId, thread.id,
    { role: 'user', content: userMessage, components: [] });
  saveGoalDraft(sessionId, { id: randomUUID(), threadId: thread.id, goalId: null,
    title: '日本旅行', targetCents: 800000, targetDate: '2026-12-31', savedCents: 0,
    monthlyContributionCapCents: monthlyCapCents, protectedCents: 2000000, flexibilityWeeks: null,
    fieldSources: { title: 'user_provided', targetCents: 'user_provided', targetDate: 'user_provided',
      savedCents: 'user_provided', monthlyContributionCents: 'user_provided', protectedCents: 'user_provided' },
    missingRequiredFields: [], updatedAt: new Date().toISOString() });
  const run = createAgentRun(sessionId, thread.id, message.id, deadlineMs);
  return { sessionId, threadId: thread.id, messageId: message.id, run };
}
const candidate = (monthlyContributionCents: number) => ({ targetCents: 800000,
  targetDate: '2026-12-31', monthlyContributionCents, protectedCents: 2000000,
  scenario: { kind: 'baseline' }, evidenceResultIds: [] });

test('scripted decisions inspect failure, revise candidate and recommend only verified result', async () => {
  const { sessionId, threadId, run } = setup();
  const before = getState(sessionId);
  const actions = agentActionCount(sessionId);
  const observed: string[] = [];
  const decide: DecisionProvider = async context => {
    const last = context.toolFeedback.at(-1);
    if (!last) return { type: 'tool_call', tool: 'financial_overview', input: {} };
    if (last.tool === 'financial_overview') return { type: 'tool_call', tool: 'candidate_preview', input: candidate(100000) };
    if (last.tool === 'candidate_preview' && last.status === 'constraint_violation') {
      observed.push(String(last.errorCode));
      return { type: 'tool_call', tool: 'candidate_preview', input: candidate(200000) };
    }
    assert.equal(last.status, 'ok');
    return { type: 'recommend', candidateResultIds: [String(last.toolResultId)], tradeoff: 'balanced' };
  };
  const finished = await runAgentTask(sessionId, threadId, run.runId, decide);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.decisionCount, 4);
  assert.equal(finished.toolCallCount, 3);
  assert.equal(finished.recommendedResultIds.length, 1);
  assert.ok(observed.includes('PROJECTED_AFTER_ALLOWED_END'));
  assert.deepEqual(finished.steps.filter(step => step.kind === 'tool_completed').map(step => step.summary),
    ['financial_overview：ok', 'candidate_preview：constraint_violation', 'candidate_preview：ok']);
  const reply = getAgentMessages(sessionId, threadId).at(-1)!;
  const card = reply.components.find(item => item.type === 'candidate_recommendations');
  assert.ok(card && card.type === 'candidate_recommendations');
  assert.equal(card.items[0].monthlyContributionCents, 200000);
  assert.equal(card.items[0].resultId, finished.recommendedResultIds[0]);
  assert.equal(getAgentTaskForThread(sessionId, threadId)?.waitingReason, 'user_choice');
  assert.deepEqual(getState(sessionId), before);
  assert.equal(agentActionCount(sessionId), actions);
  assert.deepEqual(createAgentRun(sessionId, threadId, run.triggeringMessageId), finished);
});

test('changed financial result changes scripted next step; no global impossibility claim', async () => {
  const { sessionId, threadId, run } = setup();
  const decide: DecisionProvider = async context => {
    const last = context.toolFeedback.at(-1);
    if (!last) return { type: 'tool_call', tool: 'financial_overview', input: {} };
    if (last.tool === 'financial_overview') {
      const overview = last.overview as { availableMonthlyCents: number };
      return overview.availableMonthlyCents < 150000
        ? { type: 'finish', reason: 'no_viable_candidate' }
        : { type: 'tool_call', tool: 'candidate_preview', input: candidate(200000) };
    }
    return { type: 'recommend', candidateResultIds: [String(last.toolResultId)], tradeoff: 'balanced' };
  };
  const normal = await runAgentTask(sessionId, threadId, run.runId, decide);
  assert.equal(normal.status, 'completed');
  assert.equal(normal.recommendedResultIds.length, 1);
  const second = setup();
  const state = getState(second.sessionId);
  // Changing the simulated financial state before this run changes the next scripted decision.
  const { mutateState } = await import('./store.ts');
  mutateState(second.sessionId, old => ({ ...old, finance: { ...old.finance, monthlyIncomeCents: 750000 },
    twinVersion: old.twinVersion + 1 }));
  const limited = await runAgentTask(second.sessionId, second.threadId, second.run.runId, decide);
  assert.equal(limited.status, 'completed');
  assert.deepEqual(limited.recommendedResultIds, []);
  assert.match(getAgentMessages(second.sessionId, second.threadId).at(-1)!.content, /有限候选/);
  assert.equal(state.finance.monthlyIncomeCents, 900000);
});

test('cancel and new user input stop a pending model decision before any stale tool call', async () => {
  const first = setup();
  let release!: (decision: Awaited<ReturnType<DecisionProvider>>) => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const decide: DecisionProvider = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const active = runAgentTask(first.sessionId, first.threadId, first.run.runId, decide);
  await waiting;
  stopAgentRun(first.sessionId, first.threadId, first.run.runId);
  release({ type: 'tool_call', tool: 'financial_overview', input: {} });
  assert.equal((await active).status, 'cancelled');
  assert.equal(getAgentRun(first.sessionId, first.threadId, first.run.runId).toolCallCount, 0);
  const second = setup();
  let releaseSecond!: (decision: Awaited<ReturnType<DecisionProvider>>) => void;
  let enteredSecond!: () => void;
  const waitingSecond = new Promise<void>(resolve => { enteredSecond = resolve; });
  const activeSecond = runAgentTask(second.sessionId, second.threadId, second.run.runId,
    () => { enteredSecond(); return new Promise(resolve => { releaseSecond = resolve; }); });
  await waitingSecond;
  await createAgentTurn(second.sessionId, second.threadId, '预算改九千', getState(second.sessionId));
  releaseSecond({ type: 'tool_call', tool: 'financial_overview', input: {} });
  assert.equal((await activeSecond).status, 'cancelled');
  assert.equal(getAgentTaskForThread(second.sessionId, second.threadId)?.facts.targetCents, 900000);
});

test('one runner claims a task; timeout, invalid tools and repeated reads terminate', async () => {
  const concurrent = setup();
  let calls = 0;
  const decide: DecisionProvider = async () => { calls++; return { type: 'ask_user', question: '请确认已存金额。' }; };
  const outcomes = await Promise.all([
    runAgentTask(concurrent.sessionId, concurrent.threadId, concurrent.run.runId, decide),
    runAgentTask(concurrent.sessionId, concurrent.threadId, concurrent.run.runId, decide),
  ]);
  assert.equal(calls, 1);
  assert.ok(outcomes.some(item => item.status === 'awaiting_user'));
  const timed = setup(1);
  await new Promise(resolve => setTimeout(resolve, 5));
  const timedOut = await runAgentTask(timed.sessionId, timed.threadId, timed.run.runId,
    async () => ({ type: 'tool_call', tool: 'financial_overview', input: {} }));
  assert.equal(timedOut.status, 'timed_out');
  assert.equal(timedOut.toolCallCount, 0);
  const invalid = setup();
  const invalidRun = await runAgentTask(invalid.sessionId, invalid.threadId, invalid.run.runId,
    async () => ({ type: 'tool_call', tool: 'pay_money', input: {} }));
  assert.equal(invalidRun.status, 'failed');
  assert.equal(invalidRun.reasonCode, 'AGENT_RUN_INVALID_TOOL');
  const malformed = setup();
  const recovered = await runAgentTask(malformed.sessionId, malformed.threadId, malformed.run.runId,
    async () => ({ type: 'tool_call', tool: 'search_goal_options', input: { maxResults: 99 } }));
  assert.equal(recovered.status, 'fallback');
  assert.equal(recovered.reasonCode, 'AGENT_RUN_INVALID_TOOL_INPUT');
  assert.ok(recovered.steps.some(step => step.summary.startsWith('search_goal_options：ok')));
  const repeat = setup();
  const repeated = await runAgentTask(repeat.sessionId, repeat.threadId, repeat.run.runId,
    async () => ({ type: 'tool_call', tool: 'financial_overview', input: {} }));
  assert.equal(repeated.status, 'failed');
  assert.equal(repeated.reasonCode, 'AGENT_RUN_NO_PROGRESS');
});

test('model outage uses labelled deterministic fallback with only verified evidence', async () => {
  const { sessionId, threadId, run } = setup();
  const finished = await runAgentTask(sessionId, threadId, run.runId,
    async () => ({ failure: 'DEEPSEEK_NOT_CONFIGURED' }));
  assert.equal(finished.status, 'fallback');
  assert.equal(finished.provider, 'deterministic');
  assert.equal(finished.reasonCode, 'DEEPSEEK_NOT_CONFIGURED');
  assert.ok(finished.steps.some(step => step.summary.includes('search_goal_options')));
  const reply = getAgentMessages(sessionId, threadId).at(-1)!;
  assert.match(reply.content, /模拟数据核算/);
  const card = reply.components.find(item => item.type === 'candidate_recommendations');
  assert.ok(card && card.type === 'candidate_recommendations');
  assert.match(card.body, /存钱节奏/);
  assert.ok(card.items.every(item => item.monthlyContributionCents % 10000 === 0));
});

test('fallback offers distinct verified monthly options when capacity allows', async () => {
  const { sessionId, threadId, run } = setup(45_000, 400000);
  const { mutateState } = await import('./store.ts');
  mutateState(sessionId, old => ({ ...old, finance: { ...old.finance, monthlyIncomeCents: 1100000 },
    twinVersion: old.twinVersion + 1 }));
  const finished = await runAgentTask(sessionId, threadId, run.runId,
    async () => ({ failure: 'DEEPSEEK_NOT_CONFIGURED' }));
  const card = getAgentMessages(sessionId, threadId).at(-1)!.components
    .find(item => item.type === 'candidate_recommendations');
  assert.ok(card && card.type === 'candidate_recommendations');
  assert.equal(card.items.length, 3);
  assert.equal(new Set(card.items.map(item => item.monthlyContributionCents)).size, 3);
  assert.deepEqual(card.items.map(item => item.resultId), finished.recommendedResultIds);
  assert.ok(card.items.every(item => item.status === 'on_track' && item.explanation.length > 80));
});

test('scripted agent searches options and recommends only returned result IDs', async () => {
  const { sessionId, threadId, run } = setup(45_000, 400000);
  const { mutateState } = await import('./store.ts');
  mutateState(sessionId, old => ({ ...old, finance: { ...old.finance, monthlyIncomeCents: 1100000 },
    twinVersion: old.twinVersion + 1 }));
  const finished = await runAgentTask(sessionId, threadId, run.runId, async context => {
    if (context.toolCallCount === 0) return { type: 'tool_call', tool: 'financial_overview', input: {} };
    if (context.toolCallCount === 1) return { type: 'tool_call', tool: 'data_sufficiency', input: {} };
    if (context.toolCallCount === 2) return { type: 'tool_call', tool: 'search_goal_options',
      input: { objective: 'lower_monthly', maxResults: 3 } };
    const search = context.toolFeedback.at(-1)?.search as { candidateResultIds: string[] };
    return { type: 'recommend', candidateResultIds: search.candidateResultIds, tradeoff: 'lower_monthly' };
  });
  assert.equal(finished.status, 'completed');
  assert.equal(finished.toolCallCount, 3);
  assert.ok(finished.recommendedResultIds.length >= 1);
  const card = getAgentMessages(sessionId, threadId).at(-1)!.components
    .find(item => item.type === 'candidate_recommendations');
  assert.ok(card && card.type === 'candidate_recommendations');
  assert.deepEqual(card.items.map(item => item.resultId), finished.recommendedResultIds);
  assert.equal(new Set(card.items.map(item => item.projectedDate)).size, card.items.length);
});

test('agent selects a stress hypothesis, repairs failed cases, and shows grounded results', async () => {
  const { sessionId, threadId, run } = setup(45_000, 200000, '如果漏存一次会怎样？');
  const before = getState(sessionId);
  const actions = agentActionCount(sessionId);
  const finished = await runAgentTask(sessionId, threadId, run.runId, async context => {
    if (!context.toolFeedback.some(item => item.tool === 'financial_overview'))
      return { type: 'tool_call', tool: 'financial_overview', input: {} };
    if (!context.toolFeedback.some(item => item.tool === 'data_sufficiency'))
      return { type: 'tool_call', tool: 'data_sufficiency', input: {} };
    const search = context.toolFeedback.find(item => item.tool === 'search_goal_options');
    if (!search) return { type: 'tool_call', tool: 'search_goal_options', input: {} };
    const candidateResultIds = (search.search as { candidateResultIds: string[] }).candidateResultIds;
    if (!context.toolFeedback.some(item => item.tool === 'stress_test_goal_options'))
      return { type: 'tool_call', tool: 'stress_test_goal_options', input: {
        candidateResultIds, scenarios: [{ kind: 'missed_contribution_once', monthIndex: 1 }],
      } };
    return { type: 'recommend', candidateResultIds, tradeoff: 'balanced' };
  });
  assert.equal(finished.status, 'completed');
  assert.ok(finished.steps.some(step => step.summary.startsWith('stress_test_goal_options：ok')));
  assert.ok(finished.steps.some(step => step.summary.startsWith('repair_stressed_goal_option：ok')));
  const message = getAgentMessages(sessionId, threadId).at(-1)!;
  const stress = message.components.find(item => item.type === 'stress_analysis');
  assert.ok(stress && stress.type === 'stress_analysis');
  assert.equal(stress.items.length, 1);
  assert.equal(stress.items[0].outcome, 'fails');
  assert.match(stress.items[0].explanation, /首月可投入额度|资金缺口/);
  assert.match(stress.items[0].repairText, /未生效|没有找到单项调整/);
  const candidates = message.components.find(item => item.type === 'candidate_recommendations');
  assert.ok(candidates && candidates.type === 'candidate_recommendations');
  assert.deepEqual(finished.recommendedResultIds, candidates.items.map(item => item.resultId));
  assert.deepEqual(getState(sessionId), before);
  assert.equal(agentActionCount(sessionId), actions);
});

test('completed stress evidence survives a decision budget limit as labelled fallback', async () => {
  const { sessionId, threadId, run } = setup(45_000, 200000, '如果漏存一次会怎样？');
  const finished = await runAgentTask(sessionId, threadId, run.runId, async context => {
    if (!context.toolFeedback.some(item => item.tool === 'financial_overview'))
      return { type: 'tool_call', tool: 'financial_overview', input: {} };
    if (!context.toolFeedback.some(item => item.tool === 'data_sufficiency'))
      return { type: 'tool_call', tool: 'data_sufficiency', input: {} };
    const search = context.toolFeedback.find(item => item.tool === 'search_goal_options');
    if (!search) return { type: 'tool_call', tool: 'search_goal_options', input: {} };
    return { type: 'tool_call', tool: 'stress_test_goal_options', input: {
      candidateResultIds: (search.search as { candidateResultIds: string[] }).candidateResultIds,
      scenarios: [{ kind: 'missed_contribution_once', monthIndex: 1 }],
    } };
  }, { maxDecisions: 4 });
  assert.equal(finished.status, 'fallback');
  assert.equal(finished.reasonCode, 'AGENT_RUN_BUDGET_EXHAUSTED');
  const reply = getAgentMessages(sessionId, threadId).at(-1)!;
  assert.match(reply.content, /模型未完成最后推荐/);
  assert.ok(reply.components.some(item => item.type === 'stress_analysis'));
  assert.ok(reply.components.some(item => item.type === 'candidate_recommendations'));
});

test('fabricated candidate references are rejected and a finish requires actual investigation', async () => {
  const invalid = setup();
  const reference = randomUUID();
  const first = await runAgentTask(invalid.sessionId, invalid.threadId, invalid.run.runId,
    async () => ({ type: 'recommend', candidateResultIds: [reference], tradeoff: 'balanced' }));
  assert.equal(first.status, 'failed');
  assert.equal(first.reasonCode, 'AGENT_RUN_INVALID_RECOMMENDATION');
  assert.deepEqual(first.recommendedResultIds, []);
  const empty = setup();
  const second = await runAgentTask(empty.sessionId, empty.threadId, empty.run.runId,
    async () => ({ type: 'finish', reason: 'no_viable_candidate' }));
  assert.equal(second.status, 'failed');
  assert.equal(second.reasonCode, 'AGENT_RUN_NO_EVIDENCE');
  assert.match(getAgentMessages(empty.sessionId, empty.threadId).at(-1)!.content, /没有完成必要的只读调查/);
});
