import test from 'node:test';
import assert from 'node:assert/strict';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { DemoStateSchema } from '../shared/contracts.ts';
import { createFixture, createFirstUseFixture } from './fixtures.ts';

test('Japan fixture freezes authority separately from historical evidence', () => {
  const state = createJapanMoneyMissionFixture();
  assert.equal(state.clock, '2026-10-26');
  assert.deepEqual(state.accountSnapshots.map(s => s.balanceCents), [724000, 2000000, 200000]);
  assert.equal(state.goal.targetCents, 800000);
  assert.equal(state.normalizedStatementRows.length, 186);
});
test('legacy state defaults remain additive and first-use behavior is preserved', () => {
  const raw = { ...createFixture() } as Record<string, unknown>;
  delete raw.statementImportBatches; delete raw.transferSchedules;
  const parsed = DemoStateSchema.parse(raw);
  assert.deepEqual(parsed.statementImportBatches, []);
  assert.deepEqual(parsed.transferSchedules, []);
  assert.equal(createFirstUseFixture().goals.length, 0);
});
