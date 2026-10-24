import { z } from 'zod';

export type DeepSeekFailure = 'DEEPSEEK_NOT_CONFIGURED' | 'DEEPSEEK_HTTP_ERROR' | 'DEEPSEEK_INVALID_OR_TIMEOUT';

export type DeepSeekMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export async function requestDeepSeekJson<T>(schema: z.ZodType<T>, options: {
  messages: DeepSeekMessage[];
  maxTokens: number;
  timeoutMs?: number;
}): Promise<{ ok: true; data: T } | { ok: false; reason: DeepSeekFailure }> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { ok: false, reason: 'DEEPSEEK_NOT_CONFIGURED' };
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        max_tokens: options.maxTokens,
        messages: options.messages,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
    });
    if (!response.ok) {
      if (process.env.NOVA_EVAL_MODEL_DIAGNOSTICS === '1') console.error('DeepSeek HTTP status', response.status);
      return { ok: false, reason: 'DEEPSEEK_HTTP_ERROR' };
    }
    const raw = await response.json();
    const content = raw?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return { ok: false, reason: 'DEEPSEEK_INVALID_OR_TIMEOUT' };
    try { return { ok: true, data: schema.parse(JSON.parse(content)) }; }
    catch (error) {
      if (process.env.NOVA_EVAL_MODEL_DIAGNOSTICS === '1') console.error('DeepSeek JSON validation',
        error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.')}:${issue.code}`) : 'parse_error');
      return { ok: false, reason: 'DEEPSEEK_INVALID_OR_TIMEOUT' };
    }
  } catch (error) {
    if (process.env.NOVA_EVAL_MODEL_DIAGNOSTICS === '1') console.error('DeepSeek request failure',
      error instanceof Error ? error.name : 'unknown');
    return { ok: false, reason: 'DEEPSEEK_INVALID_OR_TIMEOUT' };
  }
}
