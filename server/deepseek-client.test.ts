import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

test('shared DeepSeek client handles configuration, schema validation, and HTTP failures', async () => {
  const modulePath = './deepseek-client.ts';
  const client = await import(modulePath).catch(() => null);
  assert.ok(client, 'shared DeepSeek client module must exist');
  assert.equal(typeof client.requestDeepSeekJson, 'function');

  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousFetch = globalThis.fetch;
  const schema = z.object({ intent: z.literal('goal_status') });
  try {
    delete process.env.DEEPSEEK_API_KEY;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error('must not call'); };
    assert.deepEqual(await client.requestDeepSeekJson(schema, {
      messages: [{ role: 'user', content: '目标能按时完成吗？' }], maxTokens: 50,
    }), { ok: false, reason: 'DEEPSEEK_NOT_CONFIGURED' });
    assert.equal(calls, 0);

    process.env.DEEPSEEK_API_KEY = 'test-key';
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ intent: 'goal_status' }),
    } }] }), { status: 200 });
    assert.deepEqual(await client.requestDeepSeekJson(schema, {
      messages: [{ role: 'user', content: '目标能按时完成吗？' }], maxTokens: 50,
    }), { ok: true, data: { intent: 'goal_status' } });

    globalThis.fetch = async () => new Response('upstream failed', { status: 503 });
    assert.deepEqual(await client.requestDeepSeekJson(schema, {
      messages: [{ role: 'user', content: '目标能按时完成吗？' }], maxTokens: 50,
    }), { ok: false, reason: 'DEEPSEEK_HTTP_ERROR' });

    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ intent: 'unsafe_action' }),
    } }] }), { status: 200 });
    assert.deepEqual(await client.requestDeepSeekJson(schema, {
      messages: [{ role: 'user', content: '目标能按时完成吗？' }], maxTokens: 50,
    }), { ok: false, reason: 'DEEPSEEK_INVALID_OR_TIMEOUT' });
  } finally {
    process.env.DEEPSEEK_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
});
