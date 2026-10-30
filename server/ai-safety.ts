import { AiSafetyPassportSchema, type AiSafetyPassport } from '../shared/contracts.ts';
import { listSkillDefinitions } from './skills/registry.ts';

/** Public metadata only; the registry remains the sole permission authority. */
export function buildSkillSafetyPassports(): AiSafetyPassport[] {
  return listSkillDefinitions().map(skill => AiSafetyPassportSchema.parse({
    skillId: skill.id,
    version: skill.version,
    release: skill.release,
    enabled: skill.enabled,
    riskClass: skill.riskClass,
    canPrepareAction: skill.canPrepareAction,
    canExecuteAction: false,
    allowedToolCount: skill.allowedTools.length,
    maxToolCalls: skill.maxToolCalls,
    timeoutMs: skill.timeoutMs,
    requiresEvidence: skill.requiresEvidence,
    humanReview: skill.riskClass === 'prepare_write' || skill.riskClass === 'write'
      ? 'required_before_write' : 'not_applicable',
    fallbackMode: 'deterministic_read_only',
  }));
}
