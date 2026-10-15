import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

test('HTTP hardening adds CSP, separates sensitive limits, and redacts logs', { timeout: 30_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nova-hardening-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(join(process.cwd(), 'node_modules/.bin/tsx'), ['server/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NOVA_DB_PATH: join(directory, 'demo.sqlite'),
      DEEPSEEK_API_KEY: '',
      NODE_ENV: 'production',
      NOVA_SESSION_SECRET: Buffer.alloc(48, 7).toString('hex'),
      NOVA_EXTERNAL_AGENT_SECRET: Buffer.alloc(48, 11).toString('hex'),
      NOVA_API_RATE_LIMIT: '5',
      NOVA_SENSITIVE_RATE_LIMIT: '2',
      NOVA_LOG_LEVEL: 'info',
    },
  });
  child.stdout?.on('data', chunk => { output += chunk.toString(); });
  child.stderr?.on('data', chunk => { output += chunk.toString(); });

  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        const response = await fetch(`${base}/api/health`);
        if (response.ok) { ready = true; break; }
      } catch { /* server is still starting */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'production server must start');

    const initial = await fetch(`${base}/api/session`);
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get('x-content-type-options'), 'nosniff');
    const csp = initial.headers.get('content-security-policy') || '';
    assert.match(csp, /fonts\.googleapis\.com/);
    assert.match(csp, /images\.unsplash\.com/);
    const cookie = initial.headers.get('set-cookie')?.split(';')[0] || '';
    assert.ok(cookie);

    const sensitive = async () => fetch(`${base}/api/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Authorization: 'Bearer log-secret-token',
      },
      body: JSON.stringify({ message: '我想年底去日本旅行，预算 ¥8,000', hidden: 'log-secret-body' }),
    });
    assert.equal((await sensitive()).status, 200);
    assert.equal((await sensitive()).status, 200);
    assert.equal((await sensitive()).status, 429);

    assert.equal((await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).status, 429);

    await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(output, /"event":"http_request"/);
    assert.match(output, /"requestId":"[^"]+"/);
    assert.equal(output.includes('log-secret-token'), false);
    assert.equal(output.includes('log-secret-body'), false);
    assert.equal(output.includes('nova_demo_sid='), false);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
