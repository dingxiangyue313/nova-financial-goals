import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DemoState } from '../shared/contracts.ts';
import { appendAuditEvent, stableHash } from './governance.ts';

export interface ExternalEnvelope {
  agentId: string;
  subject: string;
  timestamp: number;
  nonce: string;
  body: unknown;
}

function signedPayload(envelope: ExternalEnvelope): string {
  return stableHash({ agentId: envelope.agentId, subject: envelope.subject, timestamp: envelope.timestamp,
    nonce: envelope.nonce, bodyHash: stableHash(envelope.body) });
}

export function signExternalRequest(secret: string, envelope: ExternalEnvelope): string {
  return createHmac('sha256', secret).update(signedPayload(envelope)).digest('hex');
}

export function verifyExternalRequest(
  state: DemoState,
  secret: string,
  envelope: ExternalEnvelope,
  signature: string,
  now = Date.now(),
  expectedSubject = envelope.subject,
): { state: DemoState } {
  if (!secret || secret.length < 32) throw new Error('EXTERNAL_SECRET_INVALID');
  if (envelope.subject !== expectedSubject) throw new Error('SUBJECT_MISMATCH');
  if (!Number.isFinite(envelope.timestamp) || Math.abs(now - envelope.timestamp) > 300_000) throw new Error('STALE_TIMESTAMP');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(envelope.nonce)) throw new Error('INVALID_NONCE');
  const expected = signExternalRequest(secret, envelope);
  if (!/^[0-9a-f]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature)))
    throw new Error('INVALID_SIGNATURE');
  const nonceKey = `${envelope.agentId}:${envelope.nonce}`;
  if (state.consumedNonces.includes(nonceKey)) throw new Error('NONCE_REPLAY');
  const withNonce = { ...state, consumedNonces: [...state.consumedNonces, nonceKey] };
  return { state: appendAuditEvent(withNonce, 'external_auth', 'verified', '外部 Agent 签名、时间窗口与 Nonce 已验证') };
}

const injectionPatterns = [
  /忽略.{0,12}(?:之前|以上|系统).{0,12}(?:指令|提示)/i,
  /(?:system prompt|developer message|ignore previous|jailbreak)/i,
  /(?:api[_ -]?key|密钥|令牌).{0,12}(?:输出|显示|泄露|告诉)/i,
  /(?:输出|显示|泄露|告诉).{0,12}(?:api[_ -]?key|密钥|令牌)/i,
];

export function containsPromptInjection(text: string): boolean {
  return injectionPatterns.some(pattern => pattern.test(text));
}
