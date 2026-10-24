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

test('data connection APIs persist, isolate, revoke and reset simulated sources', { timeout: 180_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nova-connectors-http-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const testSessionSecret = Array.from({ length: 48 }, (_, index) => String(index % 10)).join('');
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, PORT: String(port),
      NOVA_DB_PATH: join(directory, 'demo.sqlite'), DEEPSEEK_API_KEY: '', NODE_ENV: 'production',
      NOVA_SESSION_SECRET: testSessionSecret },
  });
  try {
    let ready = false;
    for (let i = 0; i < 180; i++) {
      try { const response = await fetch(`${base}/api/health`); if (response.ok) { ready = true; break; } }
      catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    assert.equal(ready, true);
    let cookie = '';
    async function call(path: string, method = 'GET', body?: unknown) {
      const response = await fetch(`${base}${path}`, { method,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { code: response.status, data: await response.json() };
    }

    const empty = await call('/api/data-connections');
    assert.equal(empty.code, 200);
    assert.equal((empty.data as { connections: unknown[] }).connections.length, 0);
    assert.equal((empty.data as { availableSources: unknown[] }).availableSources.length, 3);

    const connected = await call('/api/data-connections/connect', 'POST', {
      sources: ['bank', 'wechat_pay', 'alipay'],
    });
    assert.equal(connected.code, 200);
    assert.equal((connected.data as { snapshot: Snapshot }).snapshot.dataConnections.length, 3);
    assert.equal((connected.data as { result: { importedCount: number } }).result.importedCount > 0, true);
    const connectedVersion = (connected.data as { snapshot: Snapshot }).snapshot.twinVersion;

    const replay = await call('/api/data-connections/sync/ensure', 'POST');
    assert.equal((replay.data as { result: { replayed: boolean } }).result.replayed, true);
    assert.equal((replay.data as { snapshot: Snapshot }).snapshot.twinVersion, connectedVersion);

    const planId = (connected.data as { snapshot: Snapshot }).snapshot.assessment.plans.find(item => item.recommended)?.id;
    await call('/api/goals/activate', 'POST', { planId });

    const failed = await call('/api/demo/data-connections/wechat_pay/fail', 'POST');
    assert.equal((failed.data as { snapshot: Snapshot }).snapshot.dataConnections
      .find(item => item.source === 'wechat_pay')?.status, 'error');
    await call('/api/demo/clock', 'POST', { date: '2026-09-23' });
    const partial = await call('/api/data-connections/sync/ensure', 'POST');
    assert.equal((partial.data as { result: { status: string } }).result.status, 'partial');
    assert.equal((partial.data as { snapshot: Snapshot }).snapshot.riskSignals.length, 0);
    const recovered = await call('/api/data-connections/wechat_pay/retry', 'POST');
    assert.equal((recovered.data as { snapshot: Snapshot }).snapshot.dataConnections
      .find(item => item.source === 'wechat_pay')?.status, 'connected');
    assert.equal((recovered.data as { snapshot: Snapshot }).snapshot.riskSignals.length, 1);

    await call('/api/demo/reset', 'POST');
    const weeklyBase = await call('/api/data-connections/connect', 'POST', { sources: ['bank', 'wechat_pay', 'alipay'] });
    const weeklyPlan = (weeklyBase.data as { snapshot: Snapshot }).snapshot.assessment.plans.find(item => item.recommended)?.id;
    await call('/api/goals/activate', 'POST', { planId: weeklyPlan });
    await call('/api/demo/data-connections/alipay/fail', 'POST');
    await call('/api/demo/clock', 'POST', { date: '2026-09-22' });
    const weeklyPartial = await call('/api/data-connections/sync/ensure', 'POST');
    assert.equal((weeklyPartial.data as { snapshot: Snapshot }).snapshot.weeklyRiskSummaries.length, 0);
    const weeklyRecovered = await call('/api/data-connections/alipay/retry', 'POST');
    assert.equal((weeklyRecovered.data as { snapshot: Snapshot }).snapshot.weeklyRiskSummaries.length, 1);
    const weeklyReplay = await call('/api/data-connections/alipay/retry', 'POST');
    assert.equal((weeklyReplay.data as { snapshot: Snapshot }).snapshot.weeklyRiskSummaries.length, 1);

    await call('/api/demo/reset', 'POST');
    await call('/api/data-connections/connect', 'POST', { sources: ['bank', 'wechat_pay', 'alipay'] });

    const originalCookie = cookie;
    cookie = '';
    const other = await call('/api/data-connections');
    assert.equal((other.data as { connections: unknown[] }).connections.length, 0);
    cookie = originalCookie;

    const revoked = await call('/api/data-connections/wechat_pay/revoke', 'POST');
    assert.equal((revoked.data as { snapshot: Snapshot }).snapshot.dataConnections
      .find(item => item.source === 'wechat_pay')?.status, 'revoked');
    await call('/api/demo/clock', 'POST', { date: '2026-09-23' });
    const afterRevoke = await call('/api/data-connections/sync/ensure', 'POST');
    assert.equal((afterRevoke.data as { snapshot: Snapshot }).snapshot.riskSignals.length, 0);

    await call('/api/demo/reset', 'POST');
    const reset = await call('/api/data-connections');
    assert.equal((reset.data as { connections: unknown[] }).connections.length, 0);
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
