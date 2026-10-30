import assert from 'node:assert/strict';
import test from 'node:test';
import { AiSafetyControlSchema, AiSafetyPassportSchema } from '../shared/contracts.ts';
import { buildSkillSafetyPassports } from './ai-safety.ts';
import { listSkillDefinitions } from './skills/registry.ts';

test('passports exactly project the current registry without exposing authority payloads', () => {
  const definitions = listSkillDefinitions();
  const passports = buildSkillSafetyPassports();
  assert.equal(passports.length, 13);
  assert.deepEqual(passports, definitions.map(skill => ({
    skillId: skill.id, version: skill.version, release: skill.release, enabled: skill.enabled,
    riskClass: skill.riskClass, canPrepareAction: skill.canPrepareAction, canExecuteAction: false,
    allowedToolCount: skill.allowedTools.length, maxToolCalls: skill.maxToolCalls,
    timeoutMs: skill.timeoutMs, requiresEvidence: skill.requiresEvidence,
    humanReview: skill.riskClass === 'prepare_write' || skill.riskClass === 'write'
      ? 'required_before_write' : 'not_applicable', fallbackMode: 'deterministic_read_only',
  })));
  for (const passport of passports) {
    assert.equal(passport.enabled, true);
    assert.equal(passport.release, 'p0');
    assert.equal(passport.canExecuteAction, false);
    assert.equal(AiSafetyPassportSchema.safeParse(passport).success, true);
    for (const field of ['inputSchema', 'outputSchema', 'allowedTools', 'parameters', 'authorization', 'reasoning']) {
      assert.equal(AiSafetyPassportSchema.safeParse({ ...passport, [field]: {} }).success, false);
    }
    assert.equal(AiSafetyPassportSchema.safeParse({ ...passport, canExecuteAction: true }).success, false);
  }
});

test('control requires complete strict fields, ISO timestamp and deterministic availability', () => {
  const control = { mode: 'normal', activatedAt: null, reasonCode: null, modelCallsAllowed: true,
    aiWriteActionsAllowed: false, deterministicReadOnlyAvailable: true };
  assert.equal(AiSafetyControlSchema.safeParse(control).success, true);
  assert.equal(AiSafetyControlSchema.safeParse({ ...control, mode: 'safe_mode', activatedAt: '2026-10-30T00:00:00Z', reasonCode: 'manual_demo', modelCallsAllowed: false }).success, true);
  for (const patch of [{ extra: true }, { activatedAt: 'yesterday' }, { deterministicReadOnlyAvailable: false }, { mode: 'unknown' }]) {
    assert.equal(AiSafetyControlSchema.safeParse({ ...control, ...patch }).success, false);
  }
});
