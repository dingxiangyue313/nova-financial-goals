import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import type { Snapshot } from '../shared/contracts.ts';
import { signExternalRequest } from './security.ts';

const externalSecret = 'abcdef0123456789abcdef0123456789abcdef0123456789';

test('statement previews use the validated store boundary exactly once per request', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nova-preview-boundary-'));
  const port = await freePort();
  try {
    // Wrap only the designated persistence boundary; the actual SQLite write still executes.
    const script = `
      import assert from 'node:assert/strict';
      import { mock } from 'node:test';
      import { DatabaseSync } from 'node:sqlite';
      const actual = await import('./server/store.ts');
      const calls = [];
      mock.module('./server/store.ts', { namedExports: { ...actual, saveStatementImportPreview(...args) {
        const saved = actual.saveStatementImportPreview(...args); calls.push(args); return saved;
      } } });
      await import('./server/index.ts');
      const base = 'http://127.0.0.1:' + process.env.PORT;
      const initial = await fetch(base + '/api/session');
      const cookie = initial.headers.get('set-cookie').split(';')[0];
      const id = cookie.split('=')[1].split('.')[0];
      const db = new DatabaseSync(process.env.NOVA_DB_PATH);
      const version = () => db.prepare('SELECT version FROM demo_sessions WHERE id=?').get(id).version;
      const firstVersion = version();
      const sample = await fetch(base + '/api/statement-imports/sample', { method: 'POST', headers: { Cookie: cookie } });
      assert.equal(sample.status, 200); const sampleBody = await sample.json();
      assert.equal(calls.length, 1, 'sample must pass through saveStatementImportPreview');
      assert.equal(version(), firstVersion + 1, 'sample must persist once');
      assert.equal(calls[0][0], id);
      assert.equal(actual.getStatementImportBatch(id, sampleBody.batch.id).recordCount, 18);
      assert.equal(actual.getState(id).normalizedStatementRows.length, 18);
      const form = new FormData(); form.append('templateId', 'bank-csv-v1');
      form.append('file', new Blob(['date,description,amount\\n2026-08-01,Cafe,-1.00'], { type: 'text/csv' }), 'file.csv');
      const upload = await fetch(base + '/api/statement-imports/upload', { method: 'POST', headers: { Cookie: cookie }, body: form });
      assert.equal(upload.status, 200); const uploaded = await upload.json();
      assert.equal(calls.length, 2, 'upload must pass through saveStatementImportPreview');
      assert.equal(version(), firstVersion + 2, 'upload must persist once');
      assert.equal(calls[1][0], id);
      assert.deepEqual(Object.keys(calls[1][1]).sort(), ['batch', 'issues', 'rows']);
      assert.equal(actual.getStatementImportBatch(id, uploaded.batch.id).recordCount, 1);
      assert.equal(actual.getState(id).normalizedStatementRows.length, 19);
      db.close(); process.exit(0);
    `;
    const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 90_000,
      env: { ...process.env, PORT: String(port), NOVA_DB_PATH: join(directory, 'demo.sqlite'), NODE_ENV: 'production', NOVA_DEMO_CONTROLS: 'true',
        NOVA_SESSION_SECRET: externalSecret, NOVA_ALLOW_STATEMENT_UPLOAD: 'true', DEEPSEEK_API_KEY: '' },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('statement HTTP lifecycle is session isolated, governed, private and upload gated', { timeout: 180_000 }, async () => {
  for (const uploadEnabled of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), 'nova-statement-http-'));
    const port = await freePort(); const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), stdio: 'ignore',
      env: { ...process.env, PORT: String(port), NOVA_DB_PATH: join(directory, 'demo.sqlite'), DEEPSEEK_API_KEY: '', NODE_ENV: 'production', NOVA_DEMO_CONTROLS: 'true',
        NOVA_ALLOW_STATEMENT_UPLOAD: String(uploadEnabled), NOVA_SESSION_SECRET: externalSecret } });
    try {
      let ready = false;
      const readyDeadline = Date.now() + 90_000;
      while (Date.now() < readyDeadline && child.exitCode === null) {
        try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } }
        catch { await new Promise(resolve => setTimeout(resolve, 250)); }
      }
      assert.equal(ready, true, `statement server did not become ready; exit=${child.exitCode}`);
      let cookie = '';
      const call = async (path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: body === undefined ? undefined : JSON.stringify(body) });
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
        const text = await response.text();
        return { code: response.status, data: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null,
          cache: response.headers.get('cache-control') };
      };
      const templates = await call('/api/statement-import/templates');
      assert.equal(templates.code, 200); assert.equal(templates.data.templates.length, 4);
      const before = (await call('/api/session')).data;
      const beforeTwin = (await call('/api/financial-twin')).data;
      const preview = await call('/api/statement-imports/sample', 'POST', {});
      assert.equal(preview.code, 200); assert.equal(preview.data.rows.length, 18);
      assert.match(preview.cache ?? '', /no-store/);
      const batchId = preview.data.batch.id;
      assert.match(preview.data.contentHash ?? '', /^[a-f0-9]{64}$/, 'preview must identify the exact reviewed contents');
      const confirmation = { expectedTwinVersion: before.twinVersion, expectedContentHash: preview.data.contentHash };
      const originalCookie = cookie; cookie = '';
      const foreign = await call(`/api/statement-imports/${batchId}/commit`, 'POST', confirmation);
      assert.equal(foreign.code, 400); assert.equal(foreign.data.error, 'IMPORT_BATCH_NOT_FOUND');
      cookie = originalCookie;
      assert.equal((await call(`/api/statement-imports/${batchId}/commit`, 'POST', { ...confirmation, expectedTwinVersion: before.twinVersion + 1 })).code, 400);
      assert.equal((await call(`/api/statement-imports/${batchId}/commit`, 'POST', { expectedTwinVersion: before.twinVersion })).code, 400);
      const committed = await call(`/api/statement-imports/${batchId}/commit`, 'POST', confirmation);
      assert.equal(committed.code, 200);
      assert.deepEqual(committed.data.finance, before.finance);
      assert.deepEqual((await call('/api/financial-twin')).data.accounts, beforeTwin.accounts);
      assert.equal(committed.data.twinVersion, before.twinVersion + 1);
      assert.equal(JSON.stringify(committed.data).includes('normalizedStatementRows'), false);
      assert.equal(JSON.stringify(committed.data).includes('originalValues'), false);
      assert.equal((await call(`/api/statement-imports/${batchId}/commit`, 'POST', confirmation)).data.twinVersion, before.twinVersion + 1);
      const revoked = await call(`/api/statement-imports/${batchId}/revoke`, 'POST', { expectedTwinVersion: before.twinVersion + 1 });
      assert.equal(revoked.code, 200); assert.deepEqual((await call('/api/financial-twin')).data.transactions, beforeTwin.transactions);
      const thread = await call('/api/agent/threads', 'POST', { title: 'Balance' });
      const prepared = await call('/api/account-snapshots/prepare', 'POST', { threadId: thread.data.thread.id,
        accountId: 'checking', balanceCents: 123456, currency: 'CNY', asOf: before.clock });
      assert.equal(prepared.code, 200);
      const confirmed = await call('/api/agent/action', 'POST', { actionId: prepared.data.actionId, decision: 'confirm' });
      assert.equal(confirmed.code, 200); assert.equal(confirmed.data.snapshot.finance.checkingCents, 123456);
      const form = new FormData(); form.append('templateId', 'bank-csv-v1');
      form.append('file', new Blob(['date,description,amount\nbad,Cafe,wrong'], { type: 'text/csv' }), 'sample.csv');
      const upload = await fetch(`${base}/api/statement-imports/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
      const uploaded = await upload.json();
      assert.equal(upload.status, uploadEnabled ? 200 : 403);
      if (!uploadEnabled) assert.equal(uploaded.error, 'DATA_UPLOAD_DISABLED');
      else {
        assert.equal(uploaded.issues.length, 2);
        const block = await call(`/api/statement-imports/${uploaded.batch.id}/commit`, 'POST', {
          expectedTwinVersion: confirmed.data.snapshot.twinVersion, expectedContentHash: uploaded.contentHash });
        assert.equal(block.data.error, 'IMPORT_UNRESOLVED');
        let reviewed = uploaded;
        for (const issue of uploaded.issues) {
          const resolved = await call(`/api/statement-imports/${uploaded.batch.id}/issues/${issue.id}`, 'PATCH',
            { correctedValue: issue.kind === 'invalid_date' ? before.clock : -1234 });
          assert.equal(resolved.code, 200);
          reviewed = resolved.data;
        }
        const oldConfirmation = { expectedTwinVersion: confirmed.data.snapshot.twinVersion, expectedContentHash: reviewed.contentHash };
        const amountIssue = uploaded.issues.find((issue: { kind: string }) => issue.kind === 'invalid_amount');
        const correctedAgain = await call(`/api/statement-imports/${uploaded.batch.id}/issues/${amountIssue.id}`, 'PATCH', { correctedValue: -99999 });
        assert.notEqual(correctedAgain.data.contentHash, reviewed.contentHash);
        const beforeStaleCommit = (await call('/api/financial-twin')).data;
        const staleContents = await call(`/api/statement-imports/${uploaded.batch.id}/commit`, 'POST', oldConfirmation);
        assert.equal(staleContents.code, 400); assert.equal(staleContents.data.error, 'IMPORT_CONTENT_CHANGED');
        assert.deepEqual((await call('/api/financial-twin')).data, beforeStaleCommit);
        const accepted = await call(`/api/statement-imports/${uploaded.batch.id}/commit`, 'POST', {
          ...oldConfirmation, expectedContentHash: correctedAgain.data.contentHash });
        assert.equal(accepted.code, 200);
        assert.equal((await call('/api/financial-twin')).data.transactions.at(-1).amountCents, -99999);
        const oversized = new FormData(); oversized.append('file', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'text/csv' }), 'large.csv');
        const rejected = await fetch(`${base}/api/statement-imports/upload`, { method: 'POST', headers: { Cookie: cookie }, body: oversized });
        assert.equal(rejected.status, 413); assert.equal((await rejected.json()).error, 'STATEMENT_TOO_LARGE');
      }
    } finally {
      child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve));
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

test('clean HTTP demo completes goal, impact, tool and session isolation flows', { timeout: 180_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nova-http-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, PORT: String(port),
      NOVA_DB_PATH: join(directory, 'demo.sqlite'), DEEPSEEK_API_KEY: '', NODE_ENV: 'production', NOVA_DEMO_CONTROLS: 'true',
      NOVA_SESSION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
      NOVA_EXTERNAL_AGENT_SECRET: externalSecret },
  });
  try {
    let ready = false;
    for (let i = 0; i < 180; i++) {
      try { const response = await fetch(`${base}/api/health`); if (response.ok) { ready = true; break; } }
      catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    assert.equal(ready, true, 'production server must start');
    let cookie = '';
    async function call(path: string, method = 'GET', body?: unknown) {
      const response = await fetch(`${base}${path}`, { method,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { code: response.status, data: await response.json(), cacheControl: response.headers.get('cache-control') };
    }
    const initial = await call('/api/session');
    assert.equal(initial.code, 200);
    assert.equal((initial.data as Snapshot).goal.status, 'draft');
    assert.deepEqual((initial.data as Snapshot).goals, []);
    const loadedDemo = await call('/api/demo/load-japan', 'POST');
    assert.equal(loadedDemo.code, 200);
    assert.equal((loadedDemo.data as Snapshot).goals.length, 1);
    const tools = await call('/api/banking-tools');
    assert.equal(tools.code, 200);
    assert.equal(Array.isArray((tools.data as { tools: unknown[] }).tools), true);
    const twin = await call('/api/financial-twin');
    assert.equal((twin.data as { version: number }).version >= 1, true);
    assert.equal((await call('/api/goals/activate', 'POST', { planId: null })).code, 400);
    const created = await call('/api/goals', 'POST', { title: '日本旅行', targetCents: 800000,
      targetDate: '2026-12-15', protectedCents: 2000000, quote: '去日本旅行', flexibilityWeeks: 2 });
    assert.equal(created.code, 200);
    assert.equal((created.data as Snapshot).goal.selectedPlanId, null);
    const activated = await call('/api/goals/activate', 'POST', { planId: 'balanced' });
    assert.equal(activated.code, 200);
    const defaultPreferences = await call('/api/risk/preferences');
    assert.equal((defaultPreferences.data as { preferences: { amountThresholdCents: number } }).preferences.amountThresholdCents, 50000);
    const changedPreferences = await call('/api/risk/preferences', 'PATCH', { amountThresholdCents: 60000 });
    assert.equal((changedPreferences.data as { preferences: { amountThresholdCents: number } }).preferences.amountThresholdCents, 60000);
    await call('/api/risk/preferences', 'PATCH', { pausedUntil: '2026-09-22' });
    const preservedPreferences = await call('/api/risk/preferences', 'PATCH', { weeklySummaryEnabled: false });
    assert.deepEqual((preservedPreferences.data as { preferences: { amountThresholdCents: number;
      weeklySummaryEnabled: boolean; pausedUntil: string | null } }).preferences, {
      amountThresholdCents: 60000,
      goalImpactRatioThresholdBps: 500,
      weeklySummaryEnabled: false,
      quietHours: null,
      pausedUntil: '2026-09-22',
      goalOverrides: {},
    });
    await call('/api/risk/preferences', 'PATCH', { pausedUntil: null, weeklySummaryEnabled: true });
    await call('/api/risk/preferences', 'PATCH', { amountThresholdCents: 50000 });

    const weeklyDemo = await call('/api/demo/weekly-summary', 'POST');
    assert.equal(weeklyDemo.code, 200);
    assert.equal((weeklyDemo.data as Snapshot).spendingPatterns.some(pattern => pattern.category === 'subscriptions_demo'), true);
    const weekly = await call('/api/risk/summaries/ensure', 'POST');
    assert.equal(weekly.code, 200);
    assert.equal((weekly.data as { summary: { weekStart: string } }).summary.weekStart, '2026-09-21');
    const weeklyReplay = await call('/api/risk/summaries/ensure', 'POST');
    assert.equal((weeklyReplay.data as { replayed: boolean }).replayed, true);
    const summaries = await call('/api/risk/summaries');
    assert.equal((summaries.data as { summaries: unknown[] }).summaries.length, 1);

    const trend = await call('/api/demo/spending-trend', 'POST', { idempotencyKey: 'delivery-rides-september' });
    const trendSnapshot = trend.data as Snapshot;
    assert.equal(trend.code, 200);
    assert.equal(trendSnapshot.spendingPatterns.at(-1)?.currentCents, 190000);
    assert.equal(trendSnapshot.riskSignals.length, 1);
    assert.equal(trendSnapshot.riskSignals[0].decision, 'immediate_signal');
    assert.equal(trendSnapshot.riskSignals[0].impact.delayDays, 16);
    assert.equal(trendSnapshot.pendingImpact?.delayDays, 16);
    const firstTrendVersion = trendSnapshot.twinVersion;
    const trendReplay = await call('/api/demo/spending-trend', 'POST', { idempotencyKey: 'delivery-rides-september' });
    assert.equal((trendReplay.data as Snapshot).riskSignals.length, 1);
    assert.equal((trendReplay.data as Snapshot).twinVersion, firstTrendVersion);
    const signals = await call('/api/risk/signals');
    assert.equal((signals.data as { signals: unknown[] }).signals.length, 1);
    await call('/api/impact/decision', 'POST', { decision: 'dismiss' });
    const dismissedReplay = await call('/api/demo/spending-trend', 'POST', { idempotencyKey: 'delivery-rides-september' });
    assert.equal((dismissedReplay.data as Snapshot).pendingImpact, null);
    assert.equal((dismissedReplay.data as Snapshot).riskSignals[0].status, 'dismissed');

    const small = await call('/api/demo/expense', 'POST', { amountCents: 1000, title: '咖啡' });
    assert.equal((small.data as Snapshot).pendingImpact, null);
    const large = await call('/api/demo/expense', 'POST', { amountCents: 90000, title: '汽车保养' });
    assert.ok((large.data as Snapshot).pendingImpact);
    assert.equal((large.data as Snapshot).finance.emergencyCents, 2000000);
    const riskThreads = await call('/api/agent/threads?includeArchived=true');
    assert.equal((riskThreads.data as { threads: Array<{ kind: string; unread: boolean }> }).threads
      .some(thread => thread.kind === 'risk' && thread.unread), true);
    assert.equal((await call('/api/impact/decision', 'POST', { decision: 'B' })).code, 200);
    assert.equal((await call('/api/mandates', 'POST', { confirmed: true })).code, 200);
    const subject = cookie.slice('nova_demo_sid='.length).split('.')[0];
    const envelope = { agentId: 'travel-agent-demo', subject, timestamp: Date.now(), nonce: 'signed-nonce-001',
      body: { category: 'transport', amountCents: 1000, idempotencyKey: 'signed-http-1', simulateTimeout: false } };
    const signed = await fetch(`${base}/api/external-agent/request`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Cookie: cookie, 'x-nova-signature': signExternalRequest(externalSecret, envelope),
    }, body: JSON.stringify(envelope) });
    assert.equal(signed.status, 200);
    const replay = await fetch(`${base}/api/external-agent/request`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Cookie: cookie, 'x-nova-signature': signExternalRequest(externalSecret, envelope),
    }, body: JSON.stringify(envelope) });
    assert.equal(replay.status, 400);
    let askOperationId = '';
    let manualOperationId = '';
    for (const [scenario, status] of [['transport','executed'], ['shopping','ask'], ['manual_review','manual_review'], ['over_limit','blocked'], ['timeout','unknown']] as const) {
      const response = await call('/api/demo/agent-request', 'POST', { scenario });
      const operation = (response.data as Snapshot).operations.at(-1)!;
      assert.equal(operation.status, status);
      if (status === 'ask') askOperationId = operation.operationId;
      if (status === 'manual_review') manualOperationId = operation.operationId;
    }
    assert.equal((await call(`/api/operations/${manualOperationId}/approve`, 'POST', {})).code, 400);
    assert.equal((await call(`/api/operations/${askOperationId}/quick-confirm`, 'POST', {})).code, 200);
    const confirmedAsk = await call(`/api/operations/${askOperationId}`);
    assert.equal((confirmedAsk.data as { status: string }).status, 'executed');
    const after = await call('/api/session');
    assert.equal((after.data as Snapshot).audit.length > 0, true);
    assert.equal((after.data as Snapshot).auditChainValid, true);
    const activity = await call('/api/activity');
    assert.equal((activity.data as { chainValid: boolean }).chainValid, true);
    assert.equal(JSON.stringify(after.data).includes('DEEPSEEK_API_KEY'), false);
    const unauthorized = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(unauthorized.status, 401);
    const originalCookie = cookie;
    cookie = '';
    const other = await call('/api/session');
    assert.equal((other.data as Snapshot).goal.status, 'draft');
    assert.equal((other.data as Snapshot).audit.length, 0);
    assert.equal((other.data as Snapshot).riskSignals.length, 0);
    cookie = originalCookie;
    assert.equal((await call('/api/demo/reset', 'POST')).code, 200);
    assert.equal(((await call('/api/session')).data as Snapshot).audit.length, 0);

    const newThread = await call('/api/agent/threads', 'POST', { title: '日本旅行目标' });
    assert.equal(newThread.code, 200);
    const threadId = (newThread.data as { thread: { id: string } }).thread.id;
    const preview = await call('/api/agent/preview', 'POST', { threadId, twinVersion: 1, assumptions: {
      targetCents: 900000, targetDate: '2027-01-15', monthlyContributionCents: 160000,
      protectedCents: 2000000, flexibilityWeeks: 3,
    } });
    assert.equal(preview.code, 200);
    assert.equal((preview.data as { preview: { assumptions: { targetCents: number } } }).preview.assumptions.targetCents, 900000);
    assert.equal(((await call('/api/session')).data as Snapshot).goal.targetCents, 800000);
    const previewActionId = (preview.data as { actionId: string }).actionId;
    const previewApplied = await call('/api/agent/action', 'POST', { actionId: previewActionId, decision: 'confirm' });
    assert.equal((previewApplied.data as { snapshot: Snapshot }).snapshot.goal.targetCents, 900000);
    assert.equal((previewApplied.data as { snapshot: Snapshot }).snapshot.goal.status, 'active');
    const turn = await call('/api/agent/turn', 'POST', { threadId, message: '我想年底去日本旅行，预算 ¥8,000' });
    assert.equal(turn.code, 200);
    assert.match(turn.cacheControl ?? '', /no-store/);
    const turnData = turn.data as { intent: string; run: { runId: string } | null;
      components: Array<{ type: string; actions?: Array<{ actionId: string }> }> };
    assert.equal(turnData.intent, 'goal_planning');
    assert.equal(turnData.run, null);
    assert.ok(turnData.components.some(item => item.type === 'clarification'));
    assert.ok(turnData.components.some(item => item.type === 'data_connection_prompt'));
    const connectedForAgent = await call('/api/data-connections/connect', 'POST',
      { sources: ['bank', 'wechat_pay', 'alipay'] });
    assert.equal(connectedForAgent.code, 200);
    const withSavings = await call('/api/agent/turn', 'POST', { threadId, message: '已存 0 元' });
    assert.ok((withSavings.data as { run: { runId: string } | null }).run?.runId);
    let runStatus = await call(`/api/agent/threads/${threadId}/run`);
    for (let i = 0; i < 20 && (runStatus.data as { run: { status: string } }).run.status === 'running'; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      runStatus = await call(`/api/agent/threads/${threadId}/run`);
    }
    assert.match(runStatus.cacheControl ?? '', /no-store/);
    assert.equal((runStatus.data as { run: { status: string } }).run.status, 'fallback');
    const recommended = await call(`/api/agent/threads/${threadId}/messages`);
    const resultId = (recommended.data as { messages: Array<{ components: Array<{
      type: string; items?: Array<{ resultId: string }> }> }> }).messages
      .flatMap(item => item.components).find(item => item.type === 'candidate_recommendations')?.items?.[0]?.resultId;
    assert.ok(resultId);
    const selected = await call('/api/agent/candidate/select', 'POST', { threadId, resultId });
    const actionId = (selected.data as { actionId: string }).actionId;
    assert.ok(actionId);
    const action = await call('/api/agent/action', 'POST', { actionId, decision: 'confirm' });
    assert.equal(action.code, 200);
    assert.equal((action.data as { snapshot: Snapshot }).snapshot.goal.targetCents, 800000);
    const actionReplay = await call('/api/agent/action', 'POST', { actionId, decision: 'confirm' });
    assert.equal((actionReplay.data as { replayed: boolean }).replayed, true);
    const messages = await call(`/api/agent/threads/${threadId}/messages`);
    assert.ok((messages.data as { messages: unknown[] }).messages.length >= 5);
    assert.equal((await call(`/api/agent/threads/${threadId}`, 'PATCH', { title: '冬季日本旅行' })).code, 200);
    assert.equal((await call(`/api/agent/threads/${threadId}`, 'DELETE')).code, 200);
    await call('/api/demo/load-japan', 'POST');
    const reactivated = await call('/api/goals/activate', 'POST', { planId: 'balanced' });
    const activeSnapshot = reactivated.data as Snapshot;
    const planDraft = { targetCents: 800000, targetDate: '2026-12-31', savedCents: 0,
      protectedCents: 2000000, monthlyContributionCents: 180000, flexibilityWeeks: 0 };
    const planPreview = await call('/api/goals/current/plan-preview', 'POST', {
      expectedTwinVersion: activeSnapshot.twinVersion, draft: planDraft,
    });
    assert.equal(planPreview.code, 200);
    const customPlan = (planPreview.data as { customPlan: { projectedDate: string; selectable: boolean;
      requiresTargetDateChange: boolean } }).customPlan;
    assert.deepEqual(customPlan, { ...customPlan, projectedDate: '2027-01-14', selectable: true,
      requiresTargetDateChange: true });
    const declinedDate = await call('/api/goals/current/plan-change', 'POST', {
      expectedTwinVersion: activeSnapshot.twinVersion, draft: planDraft,
      selection: { candidateId: 'custom', acceptTargetDateChange: false },
    });
    assert.equal(declinedDate.code, 400);
    assert.equal((await call('/api/session')).data.goal.targetDate, activeSnapshot.goal.targetDate);
    const changedPlan = await call('/api/goals/current/plan-change', 'POST', {
      expectedTwinVersion: activeSnapshot.twinVersion, draft: planDraft,
      selection: { candidateId: 'custom', acceptTargetDateChange: true },
    });
    assert.equal(changedPlan.code, 200);
    const changedPayload = changedPlan.data as { snapshot: Snapshot; scheduleReviewRequired: boolean };
    assert.equal(changedPayload.snapshot.goal.selectedPlanId, 'custom');
    assert.equal(changedPayload.snapshot.goal.targetDate, '2027-01-14');
    assert.equal(changedPayload.snapshot.goal.monthlyContributionCents, 180000);
    assert.equal(changedPayload.scheduleReviewRequired, false);
    assert.equal((await call('/api/goals/current/plan-change', 'POST', {
      expectedTwinVersion: activeSnapshot.twinVersion, draft: planDraft,
      selection: { candidateId: 'custom', acceptTargetDateChange: true },
    })).code, 400);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
