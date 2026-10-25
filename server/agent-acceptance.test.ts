import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAgentRun, createAgentThread, getAgentMessages, getAgentTaskForThread,
  getState, listAgentThreads, mutateState, saveAgentMessage, saveGoalDraft,
  setMonitorSubscription, updateAgentTask } from './store.ts';
import { runAgentTask, type DecisionProvider } from './agent-runner.ts';
import { executeWorkspaceAction, prepareCandidateConfirmation } from './workspace.ts';
import { applySpendingTrendDemo } from './risk.ts';
import { tickMonitorWorker } from './monitor-worker.ts';

test('offline acceptance: investigate, revise, confirm, monitor, repair and confirm again', async () => {
  const sessionId = randomUUID();
  const threadId = createAgentThread(sessionId, { title: '旅行目标' }).id;
  const draftId = randomUUID();
  const draft = (cap: number) => ({ id: draftId, threadId, goalId: null,
    title: '日本旅行', targetCents: 800000, targetDate: '2026-12-31',
    savedCents: 0, monthlyContributionCapCents: cap, protectedCents: 2000000,
    flexibilityWeeks: null, fieldSources: { title: 'user_provided' as const,
      targetCents: 'user_provided' as const, targetDate: 'user_provided' as const,
      savedCents: 'user_provided' as const, monthlyContributionCents: 'user_provided' as const,
      protectedCents: 'user_provided' as const }, missingRequiredFields: [],
    updatedAt: new Date().toISOString() });
  const firstMessage = saveAgentMessage(sessionId, threadId, { role: 'user',
    content: '年底去日本，预算八千。先调查，不能动应急金。', components: [] });
  saveGoalDraft(sessionId, draft(100000));
  const initialTwin = getState(sessionId).twinVersion;
  const first = createAgentRun(sessionId, threadId, firstMessage.id);
  const failedCandidate: DecisionProvider = async context => {
    if (!context.toolFeedback.length) return { type: 'tool_call', tool: 'financial_overview', input: {} };
    if (context.toolFeedback.length === 1) return { type: 'tool_call', tool: 'candidate_preview',
      input: { targetCents: 800000, targetDate: '2026-12-31', monthlyContributionCents: 100000,
        protectedCents: 2000000, scenario: { kind: 'baseline' }, evidenceResultIds: [] } };
    return { type: 'finish', reason: 'no_viable_candidate' };
  };
  const failed = await runAgentTask(sessionId, threadId, first.runId, failedCandidate);
  assert.equal(failed.status, 'completed');
  assert.deepEqual(failed.recommendedResultIds, []);
  assert.match(getAgentMessages(sessionId, threadId).at(-1)!.content, /有限候选/);
  assert.equal(getState(sessionId).twinVersion, initialTwin);

  const revision = saveAgentMessage(sessionId, threadId, { role: 'user',
    content: '每月上限改为两千元，其他条件不变。', components: [] });
  saveGoalDraft(sessionId, draft(200000));
  const second = createAgentRun(sessionId, threadId, revision.id);
  const revisedCandidate: DecisionProvider = async context => context.toolFeedback.length
    ? { type: 'recommend', candidateResultIds: [String(context.toolFeedback.at(-1)!.toolResultId)], tradeoff: 'balanced' }
    : { type: 'tool_call', tool: 'candidate_preview', input: { targetCents: 800000,
      targetDate: '2026-12-31', monthlyContributionCents: 200000, protectedCents: 2000000,
      scenario: { kind: 'baseline' }, evidenceResultIds: [] } };
  const revised = await runAgentTask(sessionId, threadId, second.runId, revisedCandidate);
  assert.equal(revised.status, 'completed');
  assert.equal(revised.recommendedResultIds.length, 1);
  assert.equal(getState(sessionId).twinVersion, initialTwin);
  const prepared = prepareCandidateConfirmation(sessionId, threadId,
    revised.recommendedResultIds[0], getState(sessionId));
  assert.equal(getState(sessionId).goal.status, 'draft');
  mutateState(sessionId, old => executeWorkspaceAction(sessionId, prepared.action.id, 'confirm', old).state);
  assert.equal(getState(sessionId).goal.status, 'active');
  assert.equal(getState(sessionId).goal.monthlyContributionCents, 200000);
  const task = getAgentTaskForThread(sessionId, threadId)!;
  updateAgentTask(sessionId, task.taskId, task.taskRevision, { phase: 'completed',
    waitingReason: null, terminationReason: 'applied', pendingActionId: null,
    goalId: getState(sessionId).goal.id });
  const completed = getAgentTaskForThread(sessionId, threadId)!;
  updateAgentTask(sessionId, completed.taskId, completed.taskRevision, { constraints: {
    ...completed.constraints, latestAllowedDate: '2027-01-31' } });
  setMonitorSubscription(sessionId, threadId, true);
  tickMonitorWorker(new Date());
  const beforeRisk = getState(sessionId);
  mutateState(sessionId, old => applySpendingTrendDemo(old).state);
  assert.ok(getState(sessionId).twinVersion > beforeRisk.twinVersion);
  tickMonitorWorker(new Date());
  const repair = listAgentThreads(sessionId, true).filter(item => item.kind === 'risk')
    .flatMap(item => getAgentMessages(sessionId, item.id))
    .flatMap(item => item.components).find(item => item.type === 'candidate_recommendations');
  assert.ok(repair && repair.type === 'candidate_recommendations');
  assert.equal(getState(sessionId).goal.targetDate, '2026-12-31');
  const repairAction = prepareCandidateConfirmation(sessionId, threadId,
    repair.items[0].resultId, getState(sessionId));
  mutateState(sessionId, old => executeWorkspaceAction(sessionId, repairAction.action.id, 'confirm', old).state);
  assert.equal(getState(sessionId).goal.targetDate, repair.items[0].targetDate);
  assert.equal(getState(sessionId).finance.emergencyCents, beforeRisk.finance.emergencyCents);
});
