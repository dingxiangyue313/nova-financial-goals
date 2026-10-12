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

test('clean HTTP demo completes goal, impact, tool and session isolation flows', { timeout: 30_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nova-http-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(join(process.cwd(), 'node_modules/.bin/tsx'), ['server/index.ts'], {
    cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, PORT: String(port),
      NOVA_DB_PATH: join(directory, 'demo.sqlite'), DEEPSEEK_API_KEY: '', NODE_ENV: 'production',
      NOVA_SESSION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef' },
  });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { const response = await fetch(`${base}/api/health`); if (response.ok) { ready = true; break; } }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.equal(ready, true, 'production server must start');
    let cookie = '';
    async function call(path: string, method = 'GET', body?: unknown) {
      const response = await fetch(`${base}${path}`, { method,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { code: response.status, data: await response.json() };
    }
    const initial = await call('/api/session');
    assert.equal(initial.code, 200);
    assert.equal((initial.data as Snapshot).goal.status, 'draft');
    assert.equal((await call('/api/goals/activate', 'POST', { planId: null })).code, 400);
    const created = await call('/api/goals', 'POST', { title: '日本旅行', targetCents: 800000,
      targetDate: '2026-12-15', protectedCents: 2000000, quote: '去日本旅行', flexibilityWeeks: 2 });
    assert.equal(created.code, 200);
    assert.equal((created.data as Snapshot).goal.selectedPlanId, null);
    assert.equal((await call('/api/goals/activate', 'POST', { planId: 'balanced' })).code, 200);
    const small = await call('/api/demo/expense', 'POST', { amountCents: 1000, title: '咖啡' });
    assert.equal((small.data as Snapshot).pendingImpact, null);
    const large = await call('/api/demo/expense', 'POST', { amountCents: 90000, title: '汽车保养' });
    assert.ok((large.data as Snapshot).pendingImpact);
    assert.equal((large.data as Snapshot).finance.emergencyCents, 2000000);
    assert.equal((await call('/api/impact/decision', 'POST', { decision: 'B' })).code, 200);
    assert.equal((await call('/api/mandates', 'POST', { confirmed: true })).code, 200);
    for (const [scenario, status] of [['transport','executed'], ['shopping','ask'], ['over_limit','blocked'], ['timeout','unknown']] as const) {
      const response = await call('/api/demo/agent-request', 'POST', { scenario });
      assert.equal((response.data as Snapshot).operations.at(-1)?.status, status);
    }
    const after = await call('/api/session');
    assert.equal((after.data as Snapshot).audit.length > 0, true);
    assert.equal(JSON.stringify(after.data).includes('DEEPSEEK_API_KEY'), false);
    const unauthorized = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(unauthorized.status, 401);
    const originalCookie = cookie;
    cookie = '';
    const other = await call('/api/session');
    assert.equal((other.data as Snapshot).goal.status, 'draft');
    assert.equal((other.data as Snapshot).audit.length, 0);
    cookie = originalCookie;
    assert.equal((await call('/api/demo/reset', 'POST')).code, 200);
    assert.equal(((await call('/api/session')).data as Snapshot).audit.length, 0);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
