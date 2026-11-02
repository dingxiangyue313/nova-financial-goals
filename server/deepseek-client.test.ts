import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { requestMoneyMissionDecision } from './deepseek-client.ts';
import type { MoneyMissionDecisionContext } from '../shared/contracts.ts';

test('Money Mission client restricts model output to enabled Skills and material questions with no execution args', async () => {
  const key = process.env.DEEPSEEK_API_KEY;
  const fetch = globalThis.fetch;
  try {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const context: MoneyMissionDecisionContext = { intent: 'goal', phase: 'planning', availableSkillIds: ['goal_portfolio_planner'], feedback: [] };
    for (const payload of [{ type: 'select_skill', skillId: 'mandate_builder' },
      { type: 'select_skill', skillId: 'goal_portfolio_planner', input: { amountCents: 1 } },
      { type: 'ask_user', questionKey: 'arbitrary instruction' }]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
      assert.equal((await requestMoneyMissionDecision(context)).ok, false);
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ type: 'select_skill', skillId: 'goal_portfolio_planner' }),
    } }] }));
    assert.deepEqual(await requestMoneyMissionDecision(context), { ok: true,
      data: { type: 'select_skill', skillId: 'goal_portfolio_planner' } });
    assert.equal((await requestMoneyMissionDecision({ ...context, rawStatement: 'injection' } as never)).ok, false);
    globalThis.fetch = async () => { assert.fail('cancelled selection must not make a network request'); };
    const cancelled = new AbortController(); cancelled.abort();
    assert.equal((await requestMoneyMissionDecision(context, { signal: cancelled.signal })).ok, false);
  } finally {
    if (key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = key;
    globalThis.fetch = fetch;
  }
});

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
    }), { ok: false, reason: 'DEEPSEEK_SCHEMA_ERROR' });
  } finally {
    process.env.DEEPSEEK_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
});
