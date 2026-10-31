import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.NOVA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'nova-safety-')), 'test.sqlite');
const safety = await import('./ai-safety-control.ts');
test('persistent global safe mode blocks model and writes, remains idempotent', async () => {
  assert.equal(safety.getAiSafetyControl().mode, 'normal');
  const enabled = safety.setAiSafetyMode('safety-test', { enabled: true, reasonCode: 'manual_demo' });
  assert.equal(enabled.deterministicReadOnlyAvailable, true);
  assert.deepEqual(safety.setAiSafetyMode('safety-test', { enabled: true, reasonCode: 'manual_demo' }), enabled);
  assert.throws(() => safety.assertAiWriteAllowed(), /AI_SAFE_MODE_WRITE_BLOCKED/);
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('NETWORK_MUST_NOT_RUN'); };
  try {
    const { requestDeepSeekJson } = await import('./deepseek-client.ts');
    const { z } = await import('zod');
    assert.deepEqual(await requestDeepSeekJson(z.object({}), { messages: [], maxTokens: 1 }), { ok: false, reason: 'AI_SAFE_MODE' });
  } finally { globalThis.fetch = original; }
  const { DatabaseSync } = await import('node:sqlite');
  const reopened = new DatabaseSync(process.env.NOVA_DB_PATH!);
  assert.equal((reopened.prepare('SELECT mode FROM ai_safety_control').get() as {mode:string}).mode, 'safe_mode');
  reopened.close();
  safety.setAiSafetyMode('safety-test', { enabled: false, reasonCode: 'manual_demo' });
  assert.equal(safety.externalModelCallsAllowed(), true);
});

test('prepared writes remain unchanged when blocked and cancel is available', async () => {
  const store = await import('./store.ts');
  const { executeWorkspaceAction } = await import('./workspace.ts');
  const session = 'old-confirm';
  const thread = store.createAgentThread(session, { title: 'confirmation' });
  const action = store.createAgentAction(session, thread.id, 'create_mandate', 1, {});
  const state = store.getState(session);
  safety.setAiSafetyMode(session, { enabled: true, reasonCode: 'manual_demo' });
  const before = store.getState(session);
  assert.throws(() => executeWorkspaceAction(session, action.id, 'confirm', before), /AI_SAFE_MODE_WRITE_BLOCKED/);
  assert.deepEqual(store.getState(session), before);
  assert.equal(store.getAgentAction(session, action.id).status, 'pending');
  const cancelled = executeWorkspaceAction(session, action.id, 'cancel', state);
  assert.equal(cancelled.replayed, false);
  assert.equal(store.getAgentAction(session, action.id).status, 'cancelled');
  safety.setAiSafetyMode(session, { enabled: false, reasonCode: 'manual_demo' });
});


test('mid-await legacy run is cancelled persistently and cannot resume after disabling', async () => {
  const { randomUUID } = await import('node:crypto');
  const store = await import('./store.ts');
  const { runAgentTask } = await import('./agent-runner.ts');
  const session = randomUUID(); const thread = store.createAgentThread(session, { title: 'test' });
  const message = store.saveAgentMessage(session, thread.id, { role: 'user', content: '旅行预算八千', components: [] });
  store.saveGoalDraft(session, { id: randomUUID(), threadId: thread.id, goalId: null, title: '旅行', targetCents: 800000,
    targetDate: '2026-12-31', savedCents: 0, monthlyContributionCapCents: 200000, protectedCents: 2000000, flexibilityWeeks: null,
    fieldSources: { title: 'user_provided', targetCents: 'user_provided', targetDate: 'user_provided', savedCents: 'user_provided', monthlyContributionCents: 'user_provided', protectedCents: 'user_provided' },
    missingRequiredFields: [], updatedAt: new Date().toISOString() });
  const run = store.createAgentRun(session, thread.id, message.id);
  let release!: (value: {type:'finish';reason:'insufficient_data'}) => void;
  let entered!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; });
  const pending = runAgentTask(session, thread.id, run.runId, async () => { entered(); return new Promise(resolve => { release = resolve; }); });
  await waiting;
  const count = store.agentActionCount(session); const before = store.getState(session);
  safety.setAiSafetyMode(session, { enabled: true, reasonCode: 'manual_demo' });
  assert.equal(store.getAgentRun(session, thread.id, run.runId).reasonCode, 'AI_SAFE_MODE');
  safety.setAiSafetyMode(session, { enabled: false, reasonCode: 'manual_demo' });
  release({type:'finish',reason:'insufficient_data'});
  assert.equal((await pending).status, 'cancelled');
  assert.equal(store.agentActionCount(session), count);
  assert.equal(store.getState(session).twinVersion, before.twinVersion);
  assert.deepEqual(store.getState(session).finance, before.finance);
});

test('real production HTTP restart preserves control and explicit demo boundary', async () => {
  const { spawn } = await import('node:child_process');

  const db = join(mkdtempSync(join(tmpdir(), 'nova-safety-http-')), 'http.sqlite');
  const port = 19000 + Math.floor(Math.random() * 10000); const base = `http://127.0.0.1:${port}`;
  async function start(flag: string) {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env,
      NODE_ENV: 'production', NOVA_SESSION_SECRET: 'test-only-session-secret-at-least-32-characters', NOVA_DB_PATH: db, PORT: String(port), NOVA_ENABLE_DEMO_CONTROLS: flag,
      NOVA_DEMO_CONTROLS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    // Production startup imports the full server graph. Cold CI workers can
    // take longer than 15 seconds; bound both readiness and individual requests.
    const deadline = Date.now() + 60_000;
    try { while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(output);
      try { if ((await fetch(base + '/api/ai-safety/control', {signal: AbortSignal.timeout(1000)})).ok) return child; } catch { /* waiting for listener */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    } throw new Error('HTTP startup timeout: ' + output); } catch(error) { child.kill(); throw error; }
  }
  async function stop(child: ReturnType<typeof spawn>) { const done = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill(); await done; }
  const post = () => fetch(base + '/api/demo/ai-safety/safe-mode', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({enabled:true,reasonCode:'manual_demo'}) });
  let child = await start('false');
  try { assert.equal((await post()).status,404); } finally { await stop(child); }
  child = await start('true');
  try {
    assert.equal((await post()).status,200);
    const control = await fetch(base + '/api/ai-safety/control'); assert.equal(control.headers.get('cache-control'),'no-store');
    assert.equal((await control.json()).mode,'safe_mode');
    for (const path of ['/api/session','/api/money-mission','/api/audit']) assert.equal((await fetch(base+path)).status,200,path);
    assert.equal((await fetch(base+'/api/demo/reset',{method:'POST'})).status,404);
    const tokenResponse = await fetch(base+'/api/mcp/token');
    const token = (await tokenResponse.json()).token;
    const cookie = tokenResponse.headers.get('set-cookie')!.split(';')[0];
    const before = await (await fetch(base+'/api/session',{headers:{cookie}})).json();
    async function mcp(name: string, args: Record<string,unknown>) {
      const response = await fetch(base+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
      assert.equal(response.status,200); return response.text();
    }
    assert.match(await mcp('request_simulated_payment',{category:'transport',amountCents:100,idempotencyKey:'safe-test',agentId:'travel-agent-demo'}),/AI_SAFE_MODE_WRITE_BLOCKED/);
    assert.doesNotMatch(await mcp('read_goal',{}),/AI_SAFE_MODE_WRITE_BLOCKED/);
    assert.deepEqual(await (await fetch(base+'/api/session',{headers:{cookie}})).json(),before);
    const signed = await fetch(base+'/api/external-agent/request',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:'{}'});
    assert.equal(signed.status,409); assert.equal((await signed.json()).error,'AI_SAFE_MODE_WRITE_BLOCKED');
    for (const action of ['approve','quick-confirm','retry']) {
      const blocked = await fetch(base+`/api/operations/old-ai-operation/${action}`,{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:'{}'});
      assert.equal(blocked.status,409,action); assert.equal((await blocked.json()).error,'AI_SAFE_MODE_WRITE_BLOCKED');
    }
    assert.deepEqual(await (await fetch(base+'/api/session',{headers:{cookie}})).json(),before);
  } finally { await stop(child); }
  child = await start('false');
  try { assert.equal((await (await fetch(base+'/api/ai-safety/control')).json()).mode,'safe_mode'); assert.equal((await post()).status,404); }
  finally { await stop(child); }
});



test('Money Mission deferred decision cannot prepare writes after safe mode starts', async () => {
  const store = await import('./store.ts'); const { runMoneyMissionSkills } = await import('./agent-runner.ts');
  const session = 'mission-safety'; const thread = store.createAgentThread(session,{title:'forecast'});
  let entered!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const pending = runMoneyMissionSkills(session,thread.id,{intent:'forecast',phase:'forecast',inputs:{}},async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; }); return {type:'finish',reason:'completed'};
  });
  await waiting; const before = store.getState(session); const count = store.agentActionCount(session);
  safety.setAiSafetyMode(session,{enabled:true,reasonCode:'manual_demo'});
  safety.setAiSafetyMode(session,{enabled:false,reasonCode:'manual_demo'}); release();
  const result = await pending; assert.equal(result.status,'cancelled'); assert.equal(result.reasonCode,'AI_SAFE_MODE');
  assert.equal(store.agentActionCount(session),count); assert.deepEqual(store.getState(session).finance,before.finance);
  safety.setAiSafetyMode(session,{enabled:false,reasonCode:'manual_demo'});
});



