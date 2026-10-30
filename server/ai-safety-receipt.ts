import { AiSafetyDecisionReceiptSchema, type AiSafetyDecisionReceipt } from '../shared/contracts.ts';
import { getAiSafetyReceiptFacts } from './store.ts';

export function buildAiSafetyDecisionReceipt(sessionId: string, runId: string): AiSafetyDecisionReceipt {
  const facts = getAiSafetyReceiptFacts(sessionId, runId);
  if (!facts) throw new Error('AI_SAFETY_RECEIPT_NOT_FOUND');
  const r = facts.run;
  const fallback = AiSafetyDecisionReceiptSchema.shape.fallbackReason.safeParse(r.reasonCode);
  return AiSafetyDecisionReceiptSchema.parse({
    runId: r.runId, status: r.status, provider: r.provider,
    fallbackReason: fallback.success ? fallback.data : null,
    skillId: null, decisionCount: r.decisionCount, toolCallCount: r.toolCallCount,
    tools: facts.tools.map(t => ({ name: t.name, status: t.status, twinVersion: t.twinVersion, evidenceIds: [t.evidenceId] })), evidenceIds: facts.tools.map(t => t.evidenceId),
    twinVersion: new Set(facts.tools.map(t => t.twinVersion)).size === 1 ? facts.tools[0].twinVersion : null,
    requiresHumanConfirmation: facts.actions.length > 0,
    confirmationStatus: facts.actions.length === 1
      ? ({ pending: 'awaiting_confirmation', consumed: 'confirmed', cancelled: 'cancelled', blocked: 'blocked' } as Record<string,string>)[String(facts.actions[0].status)] ?? 'blocked' : facts.actions.length ? 'blocked' : 'not_required',
    auditChainValid: facts.auditChainValid,
    startedAt: r.startedAt,
    completedAt: ['completed','cancelled','failed','timed_out','fallback'].includes(String(r.status)) ? r.updatedAt : null,
  });
}



