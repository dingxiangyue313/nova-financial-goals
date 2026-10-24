import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runAgentReadTool } from './agent-read-tools.ts';
import { agentActionCount, agentArtifactCounts, createAgentThread, getAgentTaskForThread, getAgentToolResult,
  getState, mutateState, saveAgentMessage, saveAgentToolResult, saveGoalDraft, updateAgentTask } from './store.ts';

function setup() {
  const sessionId = randomUUID();
  const thread = createAgentThread(sessionId, { title: '日本旅行' });
  saveAgentMessage(sessionId, thread.id, { role: 'user', content: '年底去日本，预算八千', components: [] });
  saveGoalDraft(sessionId, { id: randomUUID(), threadId: thread.id, goalId: null,
    title: '日本旅行', targetCents: 800000, targetDate: '2026-12-31', savedCents: 0,
    monthlyContributionCapCents: 200000, protectedCents: 2000000, flexibilityWeeks: null,
    fieldSources: { title: 'user_provided', targetCents: 'user_provided', targetDate: 'user_provided',
      monthlyContributionCents: 'user_provided', protectedCents: 'user_provided' },
    missingRequiredFields: [], updatedAt: new Date().toISOString() });
  const task = getAgentTaskForThread(sessionId, thread.id)!;
  updateAgentTask(sessionId, task.taskId, task.taskRevision,
    { constraints: { ...task.constraints, latestAllowedDate: '2027-01-31' } });
  return { sessionId, threadId: thread.id };
}

function candidate(monthlyContributionCents: number, overrides: Record<string, unknown> = {}) {
  return { targetCents: 800000, targetDate: '2026-12-31', monthlyContributionCents,
    protectedCents: 2000000, scenario: { kind: 'baseline' }, evidenceResultIds: [], ...overrides };
}

test('read tools return scoped evidence and candidate-specific results without changing the twin', () => {
  const { sessionId, threadId } = setup();
  const before = getState(sessionId);
  const actionsBefore = agentArtifactCounts(sessionId);
  const actionCount = agentActionCount(sessionId);
  const overview = runAgentReadTool(sessionId, threadId, 'financial_overview', {});
  assert.equal(overview.tool, 'financial_overview');
  assert.equal(overview.twinVersion, before.twinVersion);
  assert.ok(overview.sourceEntities.some(item => item.kind === 'account'));
  const bills = runAgentReadTool(sessionId, threadId, 'essential_bills', {});
  assert.equal(bills.tool, 'essential_bills');
  const transactions = runAgentReadTool(sessionId, threadId, 'relevant_transactions', { limit: 5 });
  assert.equal(transactions.tool, 'relevant_transactions');
  const sufficiency = runAgentReadTool(sessionId, threadId, 'data_sufficiency', {});
  assert.equal(sufficiency.status, 'ok');
  const first = runAgentReadTool(sessionId, threadId, 'candidate_preview',
    candidate(200000, { evidenceResultIds: [overview.toolResultId, sufficiency.toolResultId] }));
  const second = runAgentReadTool(sessionId, threadId, 'candidate_preview', candidate(180000));
  assert.equal(first.status, 'ok');
  assert.equal(second.status, 'ok');
  assert.equal(first.tool, 'candidate_preview');
  assert.equal(second.tool, 'candidate_preview');
  assert.equal(first.output.assessment?.status, 'on_track');
  assert.equal(second.output.assessment?.status, 'at_risk');
  assert.notEqual(first.output.assessment?.projectedDate, second.output.assessment?.projectedDate);
  assert.ok(first.sourceEntities.some(item => item.id === overview.toolResultId));
  const replay = runAgentReadTool(sessionId, threadId, 'candidate_preview', candidate(180000));
  assert.equal(replay.toolResultId, second.toolResultId);
  const task = getAgentTaskForThread(sessionId, threadId)!;
  assert.equal(task.candidateRefs.length, 2);
  assert.equal(getAgentToolResult(sessionId, threadId, first.toolResultId).toolResultId, first.toolResultId);
  assert.deepEqual(getState(sessionId), before);
  assert.deepEqual(agentArtifactCounts(sessionId), actionsBefore);
  assert.equal(agentActionCount(sessionId), actionCount);
});

test('changed constraints and twin versions invalidate candidate references', () => {
  const { sessionId, threadId } = setup();
  runAgentReadTool(sessionId, threadId, 'candidate_preview', candidate(200000));
  let task = getAgentTaskForThread(sessionId, threadId)!;
  assert.equal(task.candidateRefs.length, 1);
  updateAgentTask(sessionId, task.taskId, task.taskRevision,
    { constraints: { ...task.constraints, monthlyContributionCapCents: 190000 } });
  task = getAgentTaskForThread(sessionId, threadId)!;
  assert.deepEqual(task.candidateRefs, []);
  runAgentReadTool(sessionId, threadId, 'candidate_preview', candidate(190000));
  assert.equal(getAgentTaskForThread(sessionId, threadId)?.candidateRefs.length, 1);
  mutateState(sessionId, state => ({ ...state, twinVersion: state.twinVersion + 1 }));
  runAgentReadTool(sessionId, threadId, 'financial_overview', {});
  task = getAgentTaskForThread(sessionId, threadId)!;
  assert.deepEqual(task.candidateRefs, []);
  assert.equal(task.baseTwinVersion, getState(sessionId).twinVersion);
});

test('candidate constraints, protected funds and supported stress change authoritative results', () => {
  const { sessionId, threadId } = setup();
  const baseline = runAgentReadTool(sessionId, threadId, 'candidate_preview', candidate(200000));
  const reserve = runAgentReadTool(sessionId, threadId, 'candidate_preview',
    candidate(200000, { protectedCents: 2400000 }));
  const shock = runAgentReadTool(sessionId, threadId, 'candidate_preview',
    candidate(200000, { scenario: { kind: 'current_month_expense', amountCents: 100000 } }));
  const essentials = runAgentReadTool(sessionId, threadId, 'candidate_preview',
    candidate(200000, { scenario: { kind: 'monthly_essential_spending_increase',
      amountCents: 100000, startMonthIndex: 1 } }));
  const missed = runAgentReadTool(sessionId, threadId, 'candidate_preview',
    candidate(200000, { scenario: { kind: 'missed_contribution_once', monthIndex: 1 } }));
  assert.equal(baseline.tool, 'candidate_preview');
  assert.equal(reserve.tool, 'candidate_preview');
  assert.equal(shock.tool, 'candidate_preview');
  assert.equal(essentials.tool, 'candidate_preview');
  assert.equal(missed.tool, 'candidate_preview');
  assert.equal(essentials.output.previewId, null);
  assert.equal(missed.output.previewId, null);
  assert.equal(essentials.output.assessment?.status, 'at_risk');
  assert.equal(missed.output.assessment?.status, 'at_risk');
  assert.ok(getAgentTaskForThread(sessionId, threadId)?.evidenceRefs.includes(essentials.toolResultId));
  assert.ok(!getAgentTaskForThread(sessionId, threadId)?.candidateRefs.includes(missed.toolResultId));
  assert.equal(baseline.output.assessment?.firstMonthCapacityCents, 200000);
  assert.equal(reserve.output.assessment?.firstMonthCapacityCents, 100000);
  assert.equal(shock.output.assessment?.firstMonthCapacityCents, 100000);
  assert.equal(reserve.output.assessment?.status, 'at_risk');
  const monthly = runAgentReadTool(sessionId, threadId, 'candidate_preview', candidate(250000));
  assert.equal(monthly.status, 'constraint_violation');
  assert.ok(monthly.tool === 'candidate_preview' && monthly.output.assessment?.constraintViolations.includes('USER_MONTHLY_CAP_EXCEEDED'));
  const date = runAgentReadTool(sessionId, threadId, 'candidate_preview',
    candidate(200000, { targetDate: '2027-02-01' }));
  assert.equal(date.status, 'constraint_violation');
  const protectedCut = runAgentReadTool(sessionId, threadId, 'candidate_preview',
    candidate(200000, { protectedCents: 1000000 }));
  assert.equal(protectedCut.status, 'constraint_violation');
  const unsupported = runAgentReadTool(sessionId, threadId, 'candidate_preview',
    candidate(200000, { scenario: { kind: 'fx_change', amountCents: 10000 } }));
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.tool === 'candidate_preview' && unsupported.output.assessment, null);
  assert.throws(() => runAgentReadTool(sessionId, threadId, 'candidate_preview',
    candidate(200000, { scenario: { kind: 'missed_contribution_once' } })), /READ_TOOL_INVALID_SCENARIO/);
  assert.throws(() => runAgentReadTool(sessionId, threadId, 'candidate_preview',
    candidate(200000, { scenario: { kind: 'missed_contribution_once', monthIndex: 99 } })),
  /READ_TOOL_INVALID_SCENARIO/);
  assert.throws(() => runAgentReadTool(sessionId, threadId, 'candidate_preview',
    candidate(200000, { scenario: { kind: 'monthly_essential_spending_increase', amountCents: 100000,
      monthIndex: 1 } })), /READ_TOOL_INVALID_SCENARIO/);
});

test('invalid inputs and cross-session evidence are rejected; thin history gives no guarantee', () => {
  const one = setup();
  const two = setup();
  const evidence = runAgentReadTool(one.sessionId, one.threadId, 'financial_overview', {});
  assert.throws(() => saveAgentToolResult(one.sessionId, { ...evidence,
    toolResultId: randomUUID(), sourceEntities: [{ kind: 'account', id: 'forged-account' }] }, 'forged'),
  /TASK_TOOL_SOURCE_NOT_FOUND/);
  assert.throws(() => runAgentReadTool(two.sessionId, two.threadId, 'candidate_preview',
    candidate(200000, { evidenceResultIds: [evidence.toolResultId] })), /TASK_TOOL_RESULT_NOT_FOUND/);
  assert.throws(() => getAgentToolResult(two.sessionId, two.threadId, evidence.toolResultId), /TASK_TOOL_RESULT_NOT_FOUND/);
  assert.throws(() => runAgentReadTool(one.sessionId, one.threadId, 'activate_goal', {}), /READ_TOOL_NOT_ALLOWED/);
  assert.throws(() => runAgentReadTool(one.sessionId, one.threadId, 'candidate_preview',
    { ...candidate(200000), sessionId: two.sessionId }), /READ_TOOL_INVALID_INPUT/);
  assert.throws(() => runAgentReadTool(one.sessionId, one.threadId, 'candidate_preview',
    candidate(200000, { targetDate: '2027-02-30' })), /READ_TOOL_INVALID_INPUT/);
  const current = getState(one.sessionId);
  mutateState(one.sessionId, state => ({ ...state, finance: { ...state.finance, historyMonths: 1 },
    twinVersion: state.twinVersion + 1 }));
  const result = runAgentReadTool(one.sessionId, one.threadId, 'candidate_preview', candidate(200000));
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.tool === 'candidate_preview' && result.output.assessment?.projectedDate, null);
  assert.equal(getState(one.sessionId).finance.checkingCents, current.finance.checkingCents);
});

test('goal option search returns only distinct, first-month executable verified candidates', () => {
  const { sessionId, threadId } = setup();
  const before = getState(sessionId);
  const first = runAgentReadTool(sessionId, threadId, 'search_goal_options', {});
  assert.equal(first.tool, 'search_goal_options');
  assert.equal(first.status, 'ok');
  assert.ok(first.output.candidateResultIds.length >= 1);
  const candidates = first.output.candidateResultIds.map(id => getAgentToolResult(sessionId, threadId, id));
  const dates = candidates.map(item => item.tool === 'candidate_preview' ? item.output.assessment?.projectedDate : null);
  assert.equal(new Set(dates).size, dates.length);
  assert.ok(candidates.every(item => item.tool === 'candidate_preview' && item.status === 'ok' &&
    item.output.assessment?.status === 'on_track' && item.output.assessment.bufferCents >= 0));
  assert.deepEqual(getState(sessionId), before);
  const replay = runAgentReadTool(sessionId, threadId, 'search_goal_options', {});
  assert.equal(replay.toolResultId, first.toolResultId);
  assert.throws(() => runAgentReadTool(sessionId, threadId, 'search_goal_options',
    { maxResults: 5 }), /READ_TOOL_INVALID_INPUT/);
});

test('a narrow deadline offers rounded fixed and first-month-light plans instead of near duplicates', () => {
  const { sessionId, threadId } = setup();
  const task = getAgentTaskForThread(sessionId, threadId)!;
  updateAgentTask(sessionId, task.taskId, task.taskRevision, {
    facts: { ...task.facts, savedCents: 50000 },
    constraints: { ...task.constraints, latestAllowedDate: '2026-12-31' },
  });
  const search = runAgentReadTool(sessionId, threadId, 'search_goal_options', {});
  assert.equal(search.tool, 'search_goal_options');
  const candidates = search.output.candidateResultIds.map(id => getAgentToolResult(sessionId, threadId, id));
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every(item => item.tool === 'candidate_preview' && item.status === 'ok' &&
    item.output.input.monthlyContributionCents === 200000));
  assert.deepEqual(candidates.map(item => item.tool === 'candidate_preview'
    ? item.output.input.firstMonthContributionCents : undefined), [150000, undefined]);
});

test('goal option search reports limited impossibility and insufficient history without candidates', () => {
  const { sessionId, threadId } = setup();
  mutateState(sessionId, old => ({ ...old, finance: { ...old.finance, checkingCents: 50000 },
    twinVersion: old.twinVersion + 1 }));
  const noOption = runAgentReadTool(sessionId, threadId, 'search_goal_options', {});
  assert.equal(noOption.tool, 'search_goal_options');
  assert.deepEqual(noOption.output.candidateResultIds, []);
  assert.ok(noOption.output.excluded.some(item => item.reason === 'negative_first_month_buffer'));
  mutateState(sessionId, old => ({ ...old, finance: { ...old.finance, historyMonths: 1 },
    twinVersion: old.twinVersion + 1 }));
  const insufficient = runAgentReadTool(sessionId, threadId, 'search_goal_options', {});
  assert.equal(insufficient.status, 'insufficient_data');
  assert.equal(insufficient.tool === 'search_goal_options' && insufficient.output.candidateResultIds.length, 0);
});
