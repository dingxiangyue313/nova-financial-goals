import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runAgentReadTool } from './agent-read-tools.ts';
import { assessCandidateScenario } from './domain.ts';
import { agentActionCount, agentArtifactCounts, createAgentThread, getAgentTaskForThread,
  getState, mutateState, saveAgentMessage, saveGoalDraft, updateAgentTask } from './store.ts';

function setup(targetDate = '2026-12-31', monthlyCap = 200000,
  latestAllowedDate = targetDate) {
  const sessionId = randomUUID();
  const thread = createAgentThread(sessionId, { title: '日本旅行' });
  saveAgentMessage(sessionId, thread.id, { role: 'user', content: '年底去日本，预算八千', components: [] });
  saveGoalDraft(sessionId, { id: randomUUID(), threadId: thread.id, goalId: null,
    title: '日本旅行', targetCents: 800000, targetDate, savedCents: 0,
    monthlyContributionCapCents: monthlyCap, protectedCents: 2000000, flexibilityWeeks: null,
    fieldSources: { title: 'user_provided', targetCents: 'user_provided', targetDate: 'user_provided',
      monthlyContributionCents: 'user_provided', protectedCents: 'user_provided' },
    missingRequiredFields: [], updatedAt: new Date().toISOString() });
  const task = getAgentTaskForThread(sessionId, thread.id)!;
  if (latestAllowedDate !== targetDate) updateAgentTask(sessionId, task.taskId, task.taskRevision,
    { constraints: { ...task.constraints, latestAllowedDate } });
  return { sessionId, threadId: thread.id, targetDate };
}

function makeFailedStress(sessionId: string, threadId: string, targetDate: string,
  monthlyContributionCents: number) {
  const baseline = runAgentReadTool(sessionId, threadId, 'candidate_preview', {
    targetCents: 800000, targetDate, monthlyContributionCents, protectedCents: 2000000,
    scenario: { kind: 'baseline' }, evidenceResultIds: [],
  });
  assert.equal(baseline.status, 'ok');
  const batch = runAgentReadTool(sessionId, threadId, 'stress_test_goal_options', {
    candidateResultIds: [baseline.toolResultId],
    scenarios: [{ kind: 'missed_contribution_once', monthIndex: 1 }],
  });
  assert.equal(batch.tool, 'stress_test_goal_options');
  assert.equal(batch.output.results[0].outcome, 'fails');
  return { baseline, batch, stressResultId: batch.output.results[0].stressResultId };
}

test('repair search finds the minimum monthly increase within user limits', () => {
  const { sessionId, threadId, targetDate } = setup('2027-01-31', 250000);
  const { baseline, batch, stressResultId } = makeFailedStress(sessionId, threadId, targetDate, 180000);
  const stateBefore = getState(sessionId);
  const artifactsBefore = agentArtifactCounts(sessionId);
  const actionsBefore = agentActionCount(sessionId);
  const input = { stressTestResultId: batch.toolResultId, stressResultId };
  const result = runAgentReadTool(sessionId, threadId, 'repair_stressed_goal_option', input);
  assert.equal(result.tool, 'repair_stressed_goal_option');
  assert.equal(result.output.status, 'repair_found');
  const repair = result.output.repairs.find(item => item.kind === 'monthly_contribution_increase');
  assert.ok(repair && repair.kind === 'monthly_contribution_increase');
  assert.ok(repair.proposedMonthlyContributionCents > 180000);
  assert.ok(repair.proposedMonthlyContributionCents <= 250000);
  assert.equal(repair.increaseCents, repair.proposedMonthlyContributionCents - 180000);
  assert.equal(repair.assessment.status, 'on_track');
  assert.equal(repair.assessment.shortfallCents, 0);
  assert.ok(baseline.tool === 'candidate_preview');
  const justBelow = assessCandidateScenario(stateBefore, {
    ...baseline.output.input, monthlyContributionCents: repair.proposedMonthlyContributionCents - 1,
    scenario: { kind: 'missed_contribution_once', monthIndex: 1 },
  }, 0, [], targetDate);
  assert.ok(justBelow.shortfallCents > 0 || justBelow.bufferCents < 0 ||
    justBelow.projectedDate === null || justBelow.projectedDate > targetDate);
  assert.deepEqual(getState(sessionId), stateBefore);
  assert.deepEqual(agentArtifactCounts(sessionId), artifactsBefore);
  assert.equal(agentActionCount(sessionId), actionsBefore);
  assert.deepEqual(getAgentTaskForThread(sessionId, threadId)!.candidateRefs, [baseline.toolResultId]);
  assert.equal(runAgentReadTool(sessionId, threadId, 'repair_stressed_goal_option', input).toolResultId,
    result.toolResultId);
});

test('repair search finds the earliest allowed extension and reports bounded failure', () => {
  const scenario = setup('2026-12-31', 200000, '2027-03-31');
  const { batch, stressResultId } = makeFailedStress(scenario.sessionId, scenario.threadId,
    scenario.targetDate, 200000);
  const result = runAgentReadTool(scenario.sessionId, scenario.threadId,
    'repair_stressed_goal_option', { stressTestResultId: batch.toolResultId, stressResultId });
  assert.equal(result.tool, 'repair_stressed_goal_option');
  const repair = result.output.repairs.find(item => item.kind === 'deadline_extension');
  assert.ok(repair && repair.kind === 'deadline_extension');
  assert.ok(repair.proposedTargetDate > scenario.targetDate);
  assert.ok(repair.proposedTargetDate <= '2027-03-31');
  assert.equal(repair.assessment.shortfallCents, 0);
  const priorDate = new Date(Date.parse(`${repair.proposedTargetDate}T00:00:00Z`) - 86_400_000)
    .toISOString().slice(0, 10);
  const prior = assessCandidateScenario(getState(scenario.sessionId), {
    targetCents: 800000, targetDate: priorDate, monthlyContributionCents: 200000,
    protectedCents: 2000000, scenario: { kind: 'missed_contribution_once', monthIndex: 1 },
    evidenceResultIds: [],
  }, 0, [], '2027-03-31');
  assert.ok(prior.shortfallCents > 0 || prior.projectedDate === null ||
    prior.projectedDate > priorDate || prior.bufferCents < 0);

  const limited = setup();
  const failed = makeFailedStress(limited.sessionId, limited.threadId, limited.targetDate, 200000);
  const none = runAgentReadTool(limited.sessionId, limited.threadId, 'repair_stressed_goal_option',
    { stressTestResultId: failed.batch.toolResultId, stressResultId: failed.stressResultId });
  assert.equal(none.tool, 'repair_stressed_goal_option');
  assert.equal(none.output.status, 'none_within_constraints');
  assert.deepEqual(none.output.repairs, []);
  assert.ok(none.output.unavailableReasons.includes('NO_REPAIR_IN_SEARCH_BOUNDS'));
});

test('repair search rejects unrelated and stale pressure evidence', () => {
  const first = setup();
  const second = setup();
  const failed = makeFailedStress(first.sessionId, first.threadId, first.targetDate, 200000);
  const input = { stressTestResultId: failed.batch.toolResultId, stressResultId: failed.stressResultId };
  assert.throws(() => runAgentReadTool(second.sessionId, second.threadId,
    'repair_stressed_goal_option', input), /READ_TOOL_REPAIR_EVIDENCE_NOT_ALLOWED/);
  assert.throws(() => runAgentReadTool(first.sessionId, first.threadId,
    'repair_stressed_goal_option', { ...input, stressTestResultId: randomUUID() }),
  /READ_TOOL_REPAIR_EVIDENCE_NOT_ALLOWED/);
  const task = getAgentTaskForThread(first.sessionId, first.threadId)!;
  updateAgentTask(first.sessionId, task.taskId, task.taskRevision,
    { constraints: { ...task.constraints, monthlyContributionCapCents: 190000 } });
  assert.throws(() => runAgentReadTool(first.sessionId, first.threadId,
    'repair_stressed_goal_option', input), /READ_TOOL_REPAIR_EVIDENCE_NOT_ALLOWED/);
  mutateState(first.sessionId, state => ({ ...state, twinVersion: state.twinVersion + 1 }));
  assert.throws(() => runAgentReadTool(first.sessionId, first.threadId,
    'repair_stressed_goal_option', input), /READ_TOOL_REPAIR_EVIDENCE_NOT_ALLOWED/);
});
