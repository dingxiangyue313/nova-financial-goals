import type { AiSafetyControl } from '../shared/contracts.ts';
import { readAiSafetyControl, persistAiSafetyMode, mutateState } from './store.ts';
import { appendAuditEvent } from './governance.ts';
export type AiSafetyReasonCode = NonNullable<AiSafetyControl['reasonCode']>;
export function getAiSafetyControl(): AiSafetyControl {
  const row = readAiSafetyControl(); const allowed = row.mode === 'normal';
  return { mode: row.mode, activatedAt: row.activatedAt, reasonCode: row.reasonCode,
    modelCallsAllowed: allowed, aiWriteActionsAllowed: allowed, deterministicReadOnlyAvailable: true };
}
export function setAiSafetyMode(actorSessionId: string, input: { enabled: boolean; reasonCode: AiSafetyReasonCode }): AiSafetyControl {
  if (persistAiSafetyMode(input.enabled, input.reasonCode))
    mutateState(actorSessionId, state => appendAuditEvent(state, 'ai_safety_mode', input.enabled ? 'enabled' : 'disabled', 'AI safety control changed'));
  return getAiSafetyControl();
}
export function externalModelCallsAllowed(): boolean { return getAiSafetyControl().modelCallsAllowed; }
export function assertAiWriteAllowed(): void {
  if (!getAiSafetyControl().aiWriteActionsAllowed) throw new Error('AI_SAFE_MODE_WRITE_BLOCKED');
}
