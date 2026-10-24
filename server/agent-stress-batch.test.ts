import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runAgentReadTool } from './agent-read-tools.ts';
import { agentActionCount, agentArtifactCounts, createAgentThread, getAgentTaskForThread,
  getAgentToolResult, getState, mutateState, saveAgentMessage, saveGoalDraft,
  updateAgentTask } from './store.ts';

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
  return { sessionId, threadId: thread.id };
}

function baseline(sessionId: string, threadId: string, monthlyContributionCents = 200000,
  protectedCents = 2000000) {
  return runAgentReadTool(sessionId, threadId, 'candidate_preview', {
    targetCents: 800000, targetDate: '2026-12-31', monthlyContributionCents,
    protectedCents, scenario: { kind: 'baseline' }, evidenceResultIds: [],
  });
}

const scenarios = [
  { kind: 'current_month_expense', amountCents: 100000 },
  { kind: 'missed_contribution_once', monthIndex: 1 },
];

test('batch stress stores bounded hypotheses and linked read-only evidence', () => {
  const { sessionId, threadId } = setup();
  const a = baseline(sessionId, threadId);
  const b = baseline(sessionId, threadId, 200000, 2100000);
  assert.equal(b.status, 'ok');
  const stateBefore = getState(sessionId);
  const artifactsBefore = agentArtifactCounts(sessionId);
  const actionsBefore = agentActionCount(sessionId);
  const input = { candidateResultIds: [a.toolResultId, b.toolResultId], scenarios };
  assert.deepEqual(getAgentTaskForThread(sessionId, threadId)!.candidateRefs, input.candidateResultIds);
  const result = runAgentReadTool(sessionId, threadId, 'stress_test_goal_options', input);
  assert.equal(result.tool, 'stress_test_goal_options');
  assert.equal(result.output.scenarioBasis, 'bounded_hypothesis');
  assert.equal(result.output.results.length, 4);
  assert.equal(result.twinVersion, stateBefore.twinVersion);
  assert.equal(result.dataAsOf, stateBefore.finance.updatedAt);
  assert.ok(result.output.results.some(item => item.outcome === 'fails'));
  for (const row of result.output.results) {
    assert.ok(input.candidateResultIds.includes(row.baselineResultId));
    assert.ok(result.sourceEntities.some(item => item.kind === 'tool_result' && item.id === row.stressResultId));
    const stress = getAgentToolResult(sessionId, threadId, row.stressResultId);
    assert.equal(stress.tool, 'candidate_preview');
    assert.equal(stress.taskId, result.taskId);
    assert.equal(stress.demoRunId, result.demoRunId);
    assert.equal(stress.twinVersion, result.twinVersion);
    assert.ok(stress.sourceEntities.some(item => item.kind === 'tool_result' && item.id === row.baselineResultId));
  }
  const task = getAgentTaskForThread(sessionId, threadId)!;
  assert.deepEqual(task.candidateRefs, input.candidateResultIds);
  assert.ok(task.evidenceRefs.includes(result.toolResultId));
  const replay = runAgentReadTool(sessionId, threadId, 'stress_test_goal_options', input);
  assert.equal(replay.toolResultId, result.toolResultId);
  assert.deepEqual(getState(sessionId), stateBefore);
  assert.deepEqual(agentArtifactCounts(sessionId), artifactsBefore);
  assert.equal(agentActionCount(sessionId), actionsBefore);
});

test('batch stress rejects foreign, invalidated, and nonbaseline candidate references', () => {
  const first = setup();
  const other = setup();
  const candidate = baseline(first.sessionId, first.threadId);
  const input = { candidateResultIds: [candidate.toolResultId], scenarios: [scenarios[0]] };
  assert.throws(() => runAgentReadTool(other.sessionId, other.threadId,
    'stress_test_goal_options', input), /READ_TOOL_STRESS_CANDIDATE_NOT_ALLOWED/);
  const stressed = runAgentReadTool(first.sessionId, first.threadId, 'candidate_preview', {
    targetCents: 800000, targetDate: '2026-12-31', monthlyContributionCents: 200000,
    protectedCents: 2000000, scenario: scenarios[0], evidenceResultIds: [],
  });
  assert.throws(() => runAgentReadTool(first.sessionId, first.threadId,
    'stress_test_goal_options', { ...input, candidateResultIds: [stressed.toolResultId] }),
  /READ_TOOL_STRESS_CANDIDATE_NOT_ALLOWED/);
  const task = getAgentTaskForThread(first.sessionId, first.threadId)!;
  updateAgentTask(first.sessionId, task.taskId, task.taskRevision,
    { constraints: { ...task.constraints, monthlyContributionCapCents: 190000 } });
  assert.throws(() => runAgentReadTool(first.sessionId, first.threadId,
    'stress_test_goal_options', input), /READ_TOOL_STRESS_CANDIDATE_NOT_ALLOWED/);
  const fresh = baseline(first.sessionId, first.threadId, 190000);
  mutateState(first.sessionId, state => ({ ...state, twinVersion: state.twinVersion + 1 }));
  assert.throws(() => runAgentReadTool(first.sessionId, first.threadId, 'stress_test_goal_options',
    { ...input, candidateResultIds: [fresh.toolResultId] }), /READ_TOOL_STRESS_CANDIDATE_NOT_ALLOWED/);
});

test('batch stress validates all scenarios before saving partial results', () => {
  const { sessionId, threadId } = setup();
  const candidate = baseline(sessionId, threadId);
  const refsBefore = getAgentTaskForThread(sessionId, threadId)!.evidenceRefs;
  assert.throws(() => runAgentReadTool(sessionId, threadId, 'stress_test_goal_options', {
    candidateResultIds: [candidate.toolResultId], scenarios: [scenarios[0],
      { kind: 'missed_contribution_once', monthIndex: 99 }],
  }), /READ_TOOL_INVALID_SCENARIO/);
  assert.deepEqual(getAgentTaskForThread(sessionId, threadId)!.evidenceRefs, refsBefore);
  assert.throws(() => runAgentReadTool(sessionId, threadId, 'stress_test_goal_options', {
    candidateResultIds: [candidate.toolResultId], scenarios: [{ kind: 'probability', amountCents: 10000 }],
  }), /READ_TOOL_INVALID_INPUT/);
  assert.throws(() => runAgentReadTool(sessionId, threadId, 'stress_test_goal_options', {
    candidateResultIds: [candidate.toolResultId, candidate.toolResultId], scenarios: [scenarios[0]],
  }), /READ_TOOL_STRESS_DUPLICATE/);
  assert.throws(() => runAgentReadTool(sessionId, threadId, 'stress_test_goal_options', {
    candidateResultIds: [candidate.toolResultId],
    scenarios: [{ kind: 'monthly_income_reduction', amountCents: getState(sessionId).finance.monthlyIncomeCents + 1 }],
  }), /READ_TOOL_STRESS_AMOUNT_OUT_OF_RANGE/);
});
