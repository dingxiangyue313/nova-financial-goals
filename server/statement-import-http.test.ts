import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import type { Snapshot } from '../shared/contracts.ts';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

test('statement import APIs stay upload-gated, session-scoped and balance-safe', { timeout: 180_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nova-statement-http-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, PORT: String(port),
      NOVA_DB_PATH: join(directory, 'demo.sqlite'), DEEPSEEK_API_KEY: '', NODE_ENV: 'production', NOVA_DEMO_CONTROLS: 'true',
      NOVA_SESSION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
      NOVA_ALLOW_STATEMENT_UPLOAD: 'false' },
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
      return { code: response.status, data: await response.json() as Record<string, unknown> };
    }

    const templates = await call('/api/statement-import/templates');
    assert.equal(templates.code, 200);
    assert.equal(templates.data.uploadEnabled, false);
    const blocked = await call('/api/statement-imports/upload', 'POST', { templateId: 'nova-synthetic-v1' });
    assert.equal(blocked.code, 400);
    assert.equal(blocked.data.error, 'DATA_UPLOAD_DISABLED');

    assert.equal((await call('/api/mission/load', 'POST')).code, 200);
    const loaded = await call('/api/session');
    const before = loaded.data as Snapshot;
    assert.equal(before.finance.checkingCents, 724000);
    assert.equal(before.goal.savedCents, 200000);

    const preview = await call('/api/statement-imports/sample', 'POST', { sampleId: 'all' });
    assert.equal(preview.code, 200);
    const batch = preview.data.batch as { id: string; status: string; twinVersion: number };
    const issues = preview.data.issues as Array<{ id: string; severity: string; resolved: boolean }>;
    assert.ok(batch.id);
    assert.equal(JSON.stringify(preview.data).includes('rawDescription'), false);
    for (const issue of issues.filter(item => !item.resolved && item.severity !== 'info')) {
      const resolved = await call(`/api/statement-imports/${batch.id}/issues/${issue.id}`, 'PATCH', { value: '2026-10-07' });
      assert.ok(resolved.code === 200 || resolved.code === 400);
    }
    const current = await call(`/api/statement-imports/${batch.id}`);
    const readyBatch = current.data.batch as { id: string; status: string; revision?: number };
    const twinVersion = (preview.data.snapshot as Snapshot).twinVersion;
    if (readyBatch.status === 'ready') {
      const stale = await call(`/api/statement-imports/${batch.id}/commit`, 'POST', { expectedTwinVersion: twinVersion + 9, confirmed: true });
      assert.equal(stale.code, 400);
      assert.equal(stale.data.error, 'TWIN_VERSION_CHANGED');
      const committed = await call(`/api/statement-imports/${batch.id}/commit`, 'POST', {
        expectedTwinVersion: twinVersion, expectedBatchRevision: readyBatch.revision ?? 0, confirmed: true,
      });
      assert.equal(committed.code, 200);
      const after = committed.data as Snapshot;
      assert.equal(after.finance.checkingCents, 724000);
      assert.equal(after.goal.savedCents, 200000);
      const replay = await call(`/api/statement-imports/${batch.id}/commit`, 'POST', {
        expectedTwinVersion: after.twinVersion, confirmed: true,
      });
      assert.equal((replay.data as Snapshot).twinVersion, after.twinVersion);
      const revoked = await call(`/api/statement-imports/${batch.id}/revoke`, 'POST', {
        expectedTwinVersion: after.twinVersion, confirmed: true,
      });
      assert.equal(revoked.code, 200);
      assert.equal((revoked.data as Snapshot).finance.checkingCents, 724000);
    }

    const ownerCookie = cookie;
    cookie = '';
    const foreign = await call(`/api/statement-imports/${batch.id}`);
    assert.equal(foreign.code, 400);
    assert.equal(foreign.data.error, 'IMPORT_BATCH_NOT_FOUND');
    cookie = ownerCookie;

    const prepared = await call('/api/account-snapshots/prepare', 'POST', {
      accountId: 'checking', balanceCents: 800000, currency: 'CNY', asOf: '2026-10-26',
    });
    assert.equal(prepared.code, 200);
    assert.ok(prepared.data.actionId);
    const confirmed = await call('/api/agent/action', 'POST', { actionId: prepared.data.actionId, decision: 'confirm' });
    assert.equal(confirmed.code, 200);
    const snap = (confirmed.data as { snapshot: Snapshot }).snapshot;
    assert.equal(snap.finance.checkingCents, 800000);
    assert.equal(snap.goal.savedCents, 200000);
    const mission = await call('/api/money-mission');
    assert.equal(mission.code, 200);
    assert.ok(mission.data.stage);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
