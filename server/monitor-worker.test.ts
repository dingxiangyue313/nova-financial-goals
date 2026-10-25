import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentRun, createAgentThread, getAgentMessages, getAgentTaskForThread, getState,
  listAgentThreads, listMonitorEvents, monitorStatus, mutateState, saveAgentMessage,
  saveGoalDraft, scheduleBonusFollowup, setMonitorSubscription, updateAgentTask,
  claimMonitorEvent, setAgentThreadStatus, resetState, deleteAgentThread } from './store.ts';
import { runAgentTask, type DecisionProvider } from './agent-runner.ts';
import { executeWorkspaceAction, prepareCandidateConfirmation } from './workspace.ts';
import { applySpendingTrendDemo } from './risk.ts';
import { tickMonitorWorker } from './monitor-worker.ts';

async function activeGoal(allowDelay = false) {
  const sessionId = randomUUID();
  const threadId = createAgentThread(sessionId, { title: '旅行规划' }).id;
  const message = saveAgentMessage(sessionId, threadId,
    { role: 'user', content: '年底日本旅行，预算八千，已存零元', components: [] });
  saveGoalDraft(sessionId, { id: randomUUID(), threadId, goalId: null, title: '日本旅行',
    targetCents: 800000, targetDate: '2026-12-31', savedCents: 0,
    monthlyContributionCapCents: 300000, protectedCents: 2000000, flexibilityWeeks: null,
    fieldSources: { title: 'user_provided', targetCents: 'user_provided', targetDate: 'user_provided',
      savedCents: 'user_provided' }, missingRequiredFields: [], updatedAt: new Date().toISOString() });
  const run = createAgentRun(sessionId, threadId, message.id);
  const decide: DecisionProvider = async context => context.toolFeedback.length
    ? { type: 'recommend', candidateResultIds: [String(context.toolFeedback.at(-1)!.toolResultId)], tradeoff: 'balanced' }
    : { type: 'tool_call', tool: 'candidate_preview', input: { targetCents: 800000,
      targetDate: '2026-12-31', monthlyContributionCents: 200000, protectedCents: 2000000,
      scenario: { kind: 'baseline' }, evidenceResultIds: [] } };
  const completed = await runAgentTask(sessionId, threadId, run.runId, decide);
  assert.equal(completed.status, 'completed');
  const prepared = prepareCandidateConfirmation(sessionId, threadId,
    completed.recommendedResultIds[0], getState(sessionId));
  mutateState(sessionId, old => executeWorkspaceAction(sessionId, prepared.action.id, 'confirm', old).state);
  const task = getAgentTaskForThread(sessionId, threadId)!;
  updateAgentTask(sessionId, task.taskId, task.taskRevision, { phase: 'completed',
    waitingReason: null, terminationReason: 'applied', pendingActionId: null, goalId: getState(sessionId).goal.id });
  if (allowDelay) {
    const revised = getAgentTaskForThread(sessionId, threadId)!;
    updateAgentTask(sessionId, revised.taskId, revised.taskRevision, { constraints: {
      ...revised.constraints, latestAllowedDate: '2027-01-31' } });
  }
  return { sessionId, threadId };
}

test('monitor stays silent until opt-in and deduplicates a material risk notification', async () => {
  const { sessionId, threadId } = await activeGoal(true);
  assert.equal(monitorStatus(sessionId, threadId).enabled, false);
  assert.equal(listMonitorEvents(sessionId).length, 0);
  setMonitorSubscription(sessionId, threadId, true);
  assert.equal(monitorStatus(sessionId, threadId).enabled, true);
  assert.ok(tickMonitorWorker(new Date()) >= 1);
  assert.equal(listMonitorEvents(sessionId)[0].status, 'done');
  const before = getState(sessionId);
  const risk = mutateState(sessionId, old => applySpendingTrendDemo(old).state);
  assert.ok(risk.twinVersion > before.twinVersion);
  assert.ok(risk.riskSignals.some(item => item.status === 'active'));
  const pending = listMonitorEvents(sessionId).filter(item => item.status === 'pending');
  assert.equal(pending.length, 1);
  tickMonitorWorker(new Date());
  const notifications = listAgentThreads(sessionId, true).filter(item => item.kind === 'risk')
    .flatMap(item => getAgentMessages(sessionId, item.id));
  assert.equal(notifications.filter(item => item.content.includes('预计目标可能延后')).length, 1);
  assert.ok(notifications.some(item => item.content.includes('依据：')));
  const repair = notifications.flatMap(item => item.components)
    .find(component => component.type === 'candidate_recommendations');
  assert.ok(repair && repair.type === 'candidate_recommendations');
  const confirmation = prepareCandidateConfirmation(sessionId, threadId,
    repair.items[0].resultId, getState(sessionId));
  assert.equal(confirmation.component.type, 'confirmation');
  assert.equal(getState(sessionId).goal.targetDate, '2026-12-31');
  tickMonitorWorker(new Date());
  assert.equal(listAgentThreads(sessionId, true).filter(item => item.kind === 'risk')
    .flatMap(item => getAgentMessages(sessionId, item.id))
    .filter(item => item.content.includes('预计目标可能延后')).length, 1);
  assert.equal(listMonitorEvents(sessionId).at(-1)?.status, 'done');
});

test('a claimed event is exclusive, stale data is discarded, and pause suppresses delivery', async () => {
  const { sessionId, threadId } = await activeGoal();
  setMonitorSubscription(sessionId, threadId, true);
  const claimed = claimMonitorEvent(new Date());
  assert.ok(claimed);
  assert.equal(claimMonitorEvent(new Date()), null);
  mutateState(sessionId, old => ({ ...old, twinVersion: old.twinVersion + 1 }));
  setMonitorSubscription(sessionId, threadId, false);
  tickMonitorWorker(new Date(Date.now() + 31_000));
  assert.equal(monitorStatus(sessionId, threadId).enabled, false);
  assert.equal(listAgentThreads(sessionId, true).filter(item => item.kind === 'risk').length, 0);
});

test('quiet hours defer material notifications and an explicit pause prevents later delivery', async () => {
  const { sessionId, threadId } = await activeGoal();
  setMonitorSubscription(sessionId, threadId, true);
  tickMonitorWorker(new Date());
  mutateState(sessionId, old => {
    const changed = applySpendingTrendDemo(old).state;
    return { ...changed, riskPreferences: { ...changed.riskPreferences,
      quietHours: { start: '00:00', end: '23:59' } } };
  });
  assert.ok(getState(sessionId).riskSignals.some(item => item.status === 'active'));
  tickMonitorWorker(new Date());
  assert.equal(listMonitorEvents(sessionId).at(-1)?.status, 'pending');
  assert.equal(listAgentThreads(sessionId, true).filter(item => item.kind === 'risk').length, 0);
  setMonitorSubscription(sessionId, threadId, false);
  tickMonitorWorker(new Date(Date.now() + 86_400_000));
  assert.equal(listAgentThreads(sessionId, true).filter(item => item.kind === 'risk').length, 0);
});

test('a risk marked for later does not create a new repair interruption', async () => {
  const { sessionId, threadId } = await activeGoal();
  setMonitorSubscription(sessionId, threadId, true);
  tickMonitorWorker(new Date());
  mutateState(sessionId, old => {
    const changed = applySpendingTrendDemo(old).state;
    return { ...changed, riskSignals: changed.riskSignals.map(item => ({ ...item, status: 'later' as const })) };
  });
  tickMonitorWorker(new Date());
  assert.equal(listMonitorEvents(sessionId).at(-1)?.status, 'done');
  assert.equal(listAgentThreads(sessionId, true).filter(item => item.kind === 'risk').length, 0);
});

test('bonus follow-up is created only by explicit scheduling and waits for demo date', async () => {
  const { sessionId, threadId } = await activeGoal();
  assert.equal(listMonitorEvents(sessionId).some(item => item.kind === 'bonus_followup'), false);
  setMonitorSubscription(sessionId, threadId, true);
  tickMonitorWorker(new Date());
  const due = scheduleBonusFollowup(sessionId, threadId);
  assert.equal(due, '2026-10-01');
  assert.equal(scheduleBonusFollowup(sessionId, threadId), due);
  assert.equal(listMonitorEvents(sessionId).filter(item => item.kind === 'bonus_followup').length, 1);
  tickMonitorWorker(new Date());
  assert.equal(listMonitorEvents(sessionId).find(item => item.kind === 'bonus_followup')?.status, 'pending');
  mutateState(sessionId, old => ({ ...old, clock: due }));
  tickMonitorWorker(new Date());
  assert.equal(listMonitorEvents(sessionId).find(item => item.kind === 'bonus_followup')?.status, 'done');
  assert.ok(getAgentMessages(sessionId, threadId).some(item => item.content.includes('未确认收入没有计入基础计划')));
});

test('an expired lease is recovered from SQLite after a worker process restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nova-monitor-restart-'));
  const environment = { ...process.env, NOVA_DB_PATH: join(directory, 'monitor.sqlite') };
  const run = (source: string) => spawnSync(process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', source],
    { cwd: process.cwd(), env: environment, encoding: 'utf8', timeout: 30_000 });
  try {
    const first = run(`
      const store = await import('./server/store.ts');
      const { createFixture } = await import('./server/fixtures.ts');
      const session = 'monitor-restart-session';
      store.mutateState(session, () => { const state = createFixture();
        const goal = { ...state.goal, status: 'active', selectedPlanId: 'balanced' };
        return { ...state, goal, goals: [goal] }; });
      const thread = store.createAgentThread(session, { title: '恢复测试' });
      const task = store.createAgentTask(session, thread.id);
      store.updateAgentTask(session, task.taskId, task.taskRevision, {
        phase: 'completed', terminationReason: 'applied', goalId: 'goal-japan-2026',
        facts: { title: '日本旅行', targetCents: 800000,
          originalTargetDate: '2026-12-15', savedCents: 350000 } });
      store.setMonitorSubscription(session, thread.id, true);
      const claimed = store.claimMonitorEvent(new Date());
      if (!claimed) throw new Error('EVENT_NOT_CLAIMED');
      process.stdout.write(JSON.stringify({ id: claimed.id, status: store.listMonitorEvents(session)[0].status }));
    `);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).status, 'leased');
    const second = run(`
      const store = await import('./server/store.ts');
      const { tickMonitorWorker } = await import('./server/monitor-worker.ts');
      tickMonitorWorker(new Date(Date.now() + 31_000));
      process.stdout.write(JSON.stringify(store.listMonitorEvents('monitor-restart-session')[0]));
    `);
    assert.equal(second.status, 0, second.stderr);
    const event = JSON.parse(second.stdout) as { id: string; status: string; attempts: number };
    assert.equal(event.id, JSON.parse(first.stdout).id);
    assert.equal(event.status, 'done');
    assert.equal(event.attempts, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('archive, demo reset and deletion invalidate monitor work', async () => {
  const archived = await activeGoal();
  setMonitorSubscription(archived.sessionId, archived.threadId, true);
  setAgentThreadStatus(archived.sessionId, archived.threadId, 'archived');
  assert.equal(monitorStatus(archived.sessionId, archived.threadId).enabled, false);
  setAgentThreadStatus(archived.sessionId, archived.threadId, 'active');
  assert.equal(monitorStatus(archived.sessionId, archived.threadId).enabled, false);
  const reset = await activeGoal();
  setMonitorSubscription(reset.sessionId, reset.threadId, true);
  resetState(reset.sessionId);
  assert.equal(monitorStatus(reset.sessionId, reset.threadId).enabled, false);
  assert.equal(listMonitorEvents(reset.sessionId).at(-1)?.status, 'stale');
  const deleted = await activeGoal();
  setMonitorSubscription(deleted.sessionId, deleted.threadId, true);
  deleteAgentThread(deleted.sessionId, deleted.threadId);
  assert.equal(listMonitorEvents(deleted.sessionId).at(-1)?.status, 'stale');
  const achieved = await activeGoal();
  setMonitorSubscription(achieved.sessionId, achieved.threadId, true);
  mutateState(achieved.sessionId, old => {
    const goal = { ...old.goal, status: 'achieved' as const };
    return { ...old, goal, goals: old.goals.map(item => item.id === goal.id ? goal : item),
      twinVersion: old.twinVersion + 1 };
  });
  assert.equal(monitorStatus(achieved.sessionId, achieved.threadId).enabled, false);
  assert.equal(getAgentTaskForThread(achieved.sessionId, achieved.threadId)?.terminationReason, 'goal_completed');
});
