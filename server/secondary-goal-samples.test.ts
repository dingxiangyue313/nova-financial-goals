import test from 'node:test';
import assert from 'node:assert/strict';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { addSecondaryGoalSamples } from './secondary-goal-samples.ts';
import { DemoStateSchema } from '../shared/contracts.ts';
import { verifyAuditChain } from './governance.ts';

test('secondary samples are additive, idempotent and leave balances and primary goal unchanged', () => {
  const before = createJapanMoneyMissionFixture();
  const after = addSecondaryGoalSamples(before);
  DemoStateSchema.parse(after);
  assert.equal(after.goals.length, before.goals.length + 5);
  assert.deepEqual(after.goal, before.goal);
  assert.equal(after.primaryGoalId, before.primaryGoalId);
  assert.deepEqual(after.accounts, before.accounts);
  assert.deepEqual(after.finance, before.finance);
  assert.ok(after.goals.slice(-5).every(goal => goal.savedCents > 0));
  assert.deepEqual(new Set(after.goals.slice(-5).map(goal => goal.status)), new Set(['active', 'paused', 'achieved']));
  assert.ok(verifyAuditChain(after.audit));
  assert.equal(addSecondaryGoalSamples(after), after);
});
