import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DemoState } from '../shared/contracts.ts';

const workerMode = process.env.NOVA_TASK_TEST_CHILD;
if (workerMode) {
  let legacyState: DemoState | null = null;
  if (workerMode === 'legacy') {
    const { DatabaseSync } = await import('node:sqlite');
    const { createFirstUseFixture } = await import('./fixtures.ts');
    const database = new DatabaseSync(process.env.NOVA_DB_PATH!);
    database.exec(`CREATE TABLE demo_sessions (
      id TEXT PRIMARY KEY, state_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    )`);
    legacyState = createFirstUseFixture();
    database.prepare('INSERT INTO demo_sessions(id,state_json,version,updated_at) VALUES(?,?,0,?)')
      .run('legacy-session', JSON.stringify(legacyState), new Date().toISOString());
    database.close();
  }
  const store = await import('./store.ts');
  if (workerMode === 'legacy') {
    assert.deepEqual(store.getState('legacy-session'), legacyState);
    const thread = store.createAgentThread('legacy-session', { title: '迁移后新任务' });
    const task = store.createAgentTask('legacy-session', thread.id);
    assert.equal(task.baseTwinVersion, legacyState!.twinVersion);
    assert.deepEqual(store.getState('legacy-session'), legacyState);
  } else if (workerMode === 'seed') {
    const sessionId = randomUUID();
    const stranger = randomUUID();
    const before = store.getState(sessionId);
    const thread = store.createAgentThread(sessionId, { title: '日本旅行任务' });
    const message = store.saveAgentMessage(sessionId, thread.id,
      { role: 'user', content: '年底去日本，预算八千', components: [] });
    const draftId = randomUUID();
    const draft = { id: draftId, threadId: thread.id, goalId: null,
      title: '日本旅行', targetCents: 800000, targetDate: '2026-12-31', savedCents: null,
      monthlyContributionCapCents: 150000, protectedCents: 2000000, flexibilityWeeks: null,
      fieldSources: { title: 'user_provided', targetCents: 'user_provided', targetDate: 'user_provided',
        monthlyContributionCents: 'user_provided', protectedCents: 'user_provided' },
      missingRequiredFields: [] as Array<'title' | 'targetCents' | 'targetDate'>,
      updatedAt: new Date().toISOString() } as const;
    store.saveGoalDraft(sessionId, { ...draft, fieldSources: { ...draft.fieldSources } });
    const created = store.getAgentTaskForThread(sessionId, thread.id);
    assert.ok(created);
    assert.equal(created.goalDraftId, draftId);
    assert.equal(created.facts.originalTargetDate, '2026-12-31');
    assert.equal(created.constraints.monthlyContributionCapCents, 150000);
    assert.equal(created.fieldSources.targetCents.messageId, message.id);
    assert.equal(created.demoRunId.length > 0, true);
    assert.equal(created.baseTwinVersion, before.twinVersion);
    assert.throws(() => store.getAgentTask(stranger, created.taskId), /TASK_NOT_FOUND/);
    const awaiting = store.updateAgentTask(sessionId, created.taskId, created.taskRevision, {
      phase: 'awaiting_user', waitingReason: 'missing_information',
      constraints: { ...created.constraints, latestAllowedDate: '2027-01-14' },
      preferences: [{ key: 'fitness_spending', value: 'preserve', source: {
        kind: 'user_message', messageId: message.id, confirmation: 'user_confirmed' } }],
      unknowns: ['possible_bonus'], runRecord: { id: randomUUID(), kind: 'waiting',
        summary: '等待用户确认可延后范围', at: new Date().toISOString(), toolResultId: null },
    });
    assert.equal(awaiting.taskRevision, 1);
    assert.equal(awaiting.constraints.latestAllowedDate, '2027-01-14');
    assert.equal(awaiting.facts.originalTargetDate, '2026-12-31');
    assert.equal(awaiting.candidateTargetDate, null);
    assert.equal(awaiting.runRecords.length, 1);
    assert.throws(() => store.updateAgentTask(sessionId, created.taskId, 1,
      { candidateRefs: ['candidate-before-change'] }), /TASK_TOOL_RESULT_NOT_FOUND/);
    assert.throws(() => store.updateAgentTask(sessionId, created.taskId, 0,
      { phase: 'investigating', waitingReason: null }), /TASK_REVISION_CONFLICT/);
    assert.throws(() => store.updateAgentTask(sessionId, created.taskId, 1,
      { phase: 'verifying', waitingReason: null }), /TASK_INVALID_TRANSITION/);
    assert.throws(() => store.updateAgentTask(sessionId, created.taskId, 1,
      { constraints: { ...awaiting.constraints, latestAllowedDate: '2026-12-01' } }), /TASK_INVALID_DATE_RANGE/);
    assert.throws(() => store.updateAgentTask(sessionId, created.taskId, 1,
      { candidateTargetDate: '2027-01-15' }), /TASK_CANDIDATE_DATE_OUT_OF_RANGE/);
    assert.throws(() => store.updateAgentTask(sessionId, created.taskId, 1,
      { baseTwinVersion: before.twinVersion + 1 }), /TASK_TWIN_VERSION_MISMATCH/);
    const unrelatedThread = store.createAgentThread(sessionId, { title: '另一个任务' });
    const unrelatedMessage = store.saveAgentMessage(sessionId, unrelatedThread.id,
      { role: 'user', content: '其他目标', components: [] });
    assert.throws(() => store.updateAgentTask(sessionId, created.taskId, 1, { preferences: [{
      key: 'unrelated', value: 'ignore', source: { kind: 'user_message',
        messageId: unrelatedMessage.id, confirmation: 'user_confirmed' },
    }] }), /TASK_SOURCE_NOT_FOUND/);
    assert.equal(store.getAgentTask(sessionId, created.taskId).taskRevision, 1);
    const paused = store.pauseAgentTask(sessionId, created.taskId, 1);
    assert.equal(paused.waitingReason, 'user_paused');
    const resumed = store.resumeAgentTask(sessionId, created.taskId, 2, 'investigating');
    assert.equal(resumed.phase, 'investigating');
    store.setAgentThreadStatus(sessionId, thread.id, 'archived');
    const archived = store.getAgentTask(sessionId, created.taskId);
    assert.equal(archived.phase, 'paused');
    assert.equal(archived.waitingReason, 'thread_archived');
    assert.equal(archived.readOnly, true);
    assert.throws(() => store.updateAgentTask(sessionId, created.taskId, archived.taskRevision,
      { phase: 'investigating', waitingReason: null }), /TASK_READ_ONLY/);
    store.setAgentThreadStatus(sessionId, thread.id, 'active');
    assert.equal(store.getAgentTask(sessionId, created.taskId).readOnly, false);
    assert.equal(store.getAgentTask(sessionId, created.taskId).phase, 'paused');
    store.saveGoalDraft(sessionId, { ...draft, targetCents: 900000,
      fieldSources: { ...draft.fieldSources }, updatedAt: new Date().toISOString() });
    const revised = store.getAgentTask(sessionId, created.taskId);
    assert.equal(revised.facts.targetCents, 900000);
    assert.equal(revised.facts.originalTargetDate, '2026-12-31');
    assert.equal(revised.constraints.latestAllowedDate, '2027-01-14');
    assert.equal(revised.candidateTargetDate, null);
    assert.deepEqual(revised.candidateRefs, []);
    assert.deepEqual(store.getState(sessionId), before);
    console.log(JSON.stringify({ sessionId, threadId: thread.id, taskId: created.taskId,
      runId: created.demoRunId, revision: revised.taskRevision }));
  } else if (workerMode === 'race') {
    const { sessionId, taskId, revision, marker } = JSON.parse(process.env.NOVA_TASK_TEST_PAYLOAD ?? '{}') as {
      sessionId: string; taskId: string; revision: number; marker: string;
    };
    try {
      const result = store.updateAgentTask(sessionId, taskId, revision, { unknowns: [marker] });
      console.log(JSON.stringify({ outcome: 'updated', revision: result.taskRevision }));
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'TASK_REVISION_CONFLICT') throw error;
      console.log(JSON.stringify({ outcome: 'conflict' }));
    }
  } else if (workerMode === 'resume') {
    const { sessionId, threadId, taskId, runId, revision } = JSON.parse(process.env.NOVA_TASK_TEST_PAYLOAD ?? '{}') as {
      sessionId: string; threadId: string; taskId: string; runId: string; revision: number;
    };
    const restored = store.getAgentTask(sessionId, taskId);
    assert.equal(restored.taskRevision, revision);
    assert.equal(restored.demoRunId, runId);
    assert.equal(restored.constraints.latestAllowedDate, '2027-01-14');
    assert.equal(restored.candidateTargetDate, null);
    assert.equal(restored.preferences[0].key, 'fitness_spending');
    assert.equal(store.getGoalDraft(sessionId, threadId)?.targetCents, 900000);
    store.resetState(sessionId);
    const historical = store.getAgentTask(sessionId, taskId);
    assert.equal(historical.readOnly, true);
    assert.equal(historical.phase, 'completed');
    assert.equal(historical.terminationReason, 'demo_reset');
    assert.throws(() => store.updateAgentTask(sessionId, taskId, historical.taskRevision,
      { phase: 'investigating' }), /TASK_READ_ONLY/);
    const newThread = store.createAgentThread(sessionId, { title: '新一轮任务' });
    const current = store.createAgentTask(sessionId, newThread.id);
    assert.notEqual(current.demoRunId, runId);
    const cancelled = store.cancelAgentTask(sessionId, current.taskId, 0);
    assert.equal(cancelled.phase, 'completed');
    assert.equal(cancelled.terminationReason, 'cancelled');
    store.deleteAgentThread(sessionId, newThread.id);
    assert.throws(() => store.getAgentTask(sessionId, current.taskId), /TASK_NOT_FOUND/);
    assert.equal(store.getGoalDraft(sessionId, threadId)?.targetCents, 900000);
  } else throw new Error('UNKNOWN_TASK_TEST_MODE');
} else {
  test('AgentTask persists, isolates sessions and runs, rejects concurrent stale writes, and leaves the financial twin unchanged',
    { timeout: 120_000 }, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'nova-task-'));
      const file = join(directory, 'task.sqlite');
      const run = (mode: string, payload?: unknown) => {
        const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/agent-task.test.ts'], {
          cwd: process.cwd(), encoding: 'utf8', timeout: 45_000,
          env: { ...process.env, NOVA_DB_PATH: file, NOVA_TASK_TEST_CHILD: mode,
            NOVA_TASK_TEST_PAYLOAD: JSON.stringify(payload ?? {}) },
        });
        assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
        return result.stdout;
      };
      try {
        const seed = JSON.parse(run('seed').trim().split('\n').at(-1)!) as {
          sessionId: string; taskId: string; revision: number;
        };
        const race = (marker: string) => new Promise<{ outcome: string }>((resolve, reject) => {
          const child = spawn(process.execPath, ['--import', 'tsx', 'server/agent-task.test.ts'], {
            cwd: process.cwd(), env: { ...process.env, NOVA_DB_PATH: file, NOVA_TASK_TEST_CHILD: 'race',
              NOVA_TASK_TEST_PAYLOAD: JSON.stringify({ ...seed, marker }) },
          });
          let output = ''; let errorOutput = '';
          child.stdout.on('data', chunk => { output += String(chunk); });
          child.stderr.on('data', chunk => { errorOutput += String(chunk); });
          child.once('error', reject);
          child.once('exit', code => code === 0
            ? resolve(JSON.parse(output.trim().split('\n').at(-1)!))
            : reject(new Error(errorOutput || `Race worker exited ${code}`)));
        });
        const outcomes = await Promise.all([race('race-a'), race('race-b')]);
        assert.deepEqual(outcomes.map(item => item.outcome).sort(), ['conflict', 'updated']);
        run('resume', { ...seed, revision: seed.revision + 1 });
      } finally { rmSync(directory, { recursive: true, force: true }); }
    });
  test('task table migration preserves an existing demo state', { timeout: 45_000 }, () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova-task-migration-'));
    try {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/agent-task.test.ts'], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 35_000,
        env: { ...process.env, NOVA_DB_PATH: join(directory, 'legacy.sqlite'), NOVA_TASK_TEST_CHILD: 'legacy' },
      });
      assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
