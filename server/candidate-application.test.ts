import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAgentRun, createAgentThread, getAgentAction, getAgentTaskForThread,
  getState, mutateState, saveAgentMessage, saveGoalDraft, updateAgentTask } from './store.ts';
import { runAgentTask, type DecisionProvider } from './agent-runner.ts';
import { executeWorkspaceAction, prepareCandidateConfirmation } from './workspace.ts';
import { bankingToolDefinitions, runBankingTool } from './banking.ts';

async function preparedCandidate() {
  const sessionId = randomUUID();
  const threadId = createAgentThread(sessionId, { title: '旅行规划' }).id;
  const message = saveAgentMessage(sessionId, threadId,
    { role: 'user', content: '日本旅行，预算八千，年底完成', components: [] });
  saveGoalDraft(sessionId, { id: randomUUID(), threadId, goalId: null,
    title: '日本旅行', targetCents: 800000, targetDate: '2026-12-31', savedCents: 0,
    monthlyContributionCapCents: 200000, protectedCents: 2000000, flexibilityWeeks: null,
    fieldSources: { title: 'user_provided', targetCents: 'user_provided', targetDate: 'user_provided',
      savedCents: 'user_provided' }, missingRequiredFields: [], updatedAt: new Date().toISOString() });
  const run = createAgentRun(sessionId, threadId, message.id);
  const decide: DecisionProvider = async context => context.toolFeedback.length
    ? { type: 'recommend', candidateResultIds: [String(context.toolFeedback.at(-1)!.toolResultId)], tradeoff: 'balanced' }
    : { type: 'tool_call', tool: 'candidate_preview', input: { targetCents: 800000,
      targetDate: '2026-12-31', monthlyContributionCents: 200000, protectedCents: 2000000,
      scenario: { kind: 'baseline' }, evidenceResultIds: [] } };
  const finished = await runAgentTask(sessionId, threadId, run.runId, decide);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.recommendedResultIds.length, 1);
  return { sessionId, threadId, resultId: finished.recommendedResultIds[0] };
}

test('candidate requires a separate confirmation and applies exact custom terms once', async () => {
  const { sessionId, threadId, resultId } = await preparedCandidate();
  const before = getState(sessionId);
  const prepared = prepareCandidateConfirmation(sessionId, threadId, resultId, before);
  assert.equal(prepared.component.type, 'confirmation');
  assert.deepEqual(getState(sessionId), before);
  assert.equal(getAgentTaskForThread(sessionId, threadId)?.phase, 'awaiting_confirmation');
  let result: ReturnType<typeof executeWorkspaceAction> | undefined;
  const applied = mutateState(sessionId, old => {
    result = executeWorkspaceAction(sessionId, prepared.action.id, 'confirm', old); return result.state;
  });
  assert.equal(result?.message.components[0].type, 'receipt');
  assert.equal(applied.goal.title, '日本旅行');
  assert.equal(applied.goal.targetCents, 800000);
  assert.equal(applied.goal.targetDate, '2026-12-31');
  assert.equal(applied.goal.monthlyContributionCents, 200000);
  assert.equal(applied.goal.protectedCents, 2000000);
  assert.equal(applied.goal.status, 'active');
  assert.equal(applied.goal.selectedPlanId, 'custom');
  assert.equal(applied.primaryGoalId, applied.goal.id);
  assert.equal(applied.finance.checkingCents, before.finance.checkingCents);
  assert.equal(applied.finance.emergencyCents, before.finance.emergencyCents);
  assert.equal(applied.mandate, before.mandate);
  assert.equal(applied.operations.length, before.operations.length);
  assert.equal(applied.audit.at(-1)?.action, 'audit');
  assert.equal(getAgentAction(sessionId, prepared.action.id).status, 'consumed');
  const replay = executeWorkspaceAction(sessionId, prepared.action.id, 'confirm', getState(sessionId));
  assert.equal(replay.replayed, true);
  assert.equal(replay.state.twinVersion, applied.twinVersion);
});

test('foreign session and changed financial version cannot confirm a candidate', async () => {
  const { sessionId, threadId, resultId } = await preparedCandidate();
  assert.throws(() => prepareCandidateConfirmation(randomUUID(), threadId, resultId, getState(sessionId)));
  const prepared = prepareCandidateConfirmation(sessionId, threadId, resultId, getState(sessionId));
  assert.throws(() => executeWorkspaceAction(randomUUID(), prepared.action.id, 'confirm', getState(sessionId)),
    /AGENT_ACTION_NOT_FOUND/);
  mutateState(sessionId, old => ({ ...old, twinVersion: old.twinVersion + 1 }));
  const outcome = mutateState(sessionId, old =>
    executeWorkspaceAction(sessionId, prepared.action.id, 'confirm', old).state);
  assert.notEqual(outcome.goal.selectedPlanId, 'custom');
  assert.equal(getAgentAction(sessionId, prepared.action.id).status, 'cancelled');
});

test('a later task revision invalidates the frozen candidate action without partial writes', async () => {
  const { sessionId, threadId, resultId } = await preparedCandidate();
  const prepared = prepareCandidateConfirmation(sessionId, threadId, resultId, getState(sessionId));
  const task = getAgentTaskForThread(sessionId, threadId)!;
  updateAgentTask(sessionId, task.taskId, task.taskRevision,
    { phase: 'awaiting_user', waitingReason: 'user_choice' });
  const before = getState(sessionId);
  assert.throws(() => mutateState(sessionId, old =>
    executeWorkspaceAction(sessionId, prepared.action.id, 'confirm', old).state),
  /CANDIDATE_CONFIRMATION_STALE/);
  assert.deepEqual(getState(sessionId), before);
  assert.equal(getAgentAction(sessionId, prepared.action.id).status, 'pending');
});

test('custom candidate application is private to the governed confirmation path', () => {
  assert.equal(bankingToolDefinitions.map(item => String(item.name)).includes('apply_goal_candidate'), false);
  const state = getState(randomUUID());
  assert.throws(() => runBankingTool(state, 'apply_goal_candidate', {
    goalId: 'forged', title: '伪造目标', savedCents: 0, targetCents: 10000,
    targetDate: '2026-12-31', originalDate: '2026-12-31', monthlyContributionCents: 1000,
    protectedCents: 2000000, approvalParameters: {}, approvalToken: 'forged',
  }), /APPROVAL_TOKEN_INVALID/);
});
