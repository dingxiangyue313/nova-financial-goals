import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCandidateScenario } from './domain.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import type { CandidateInput } from '../shared/contracts.ts';

test('canonical candidate APIs share dated completion and require authoritative balance', () => {
  const state = createJapanMoneyMissionFixture();
  const input = { targetCents: 800000, targetDate: '2027-06-30', monthlyContributionCents: 100000, protectedCents: 2000000, scenario: { kind: 'baseline' }, evidenceResultIds: [] } as CandidateInput;
  const baseline = assessCandidateScenario(state, input, 200000, [], input.targetDate);
  assert.equal(baseline.projectedDate, '2027-04-26');
  const missed = assessCandidateScenario(state, { ...input, scenario: { kind: 'missed_contribution_once', monthIndex: 0 } }, 200000, [], input.targetDate);
  assert.equal(missed.projectedDate, '2027-05-26');
  const missing = assessCandidateScenario({ ...state, accountSnapshots: [] }, input, 200000, [], input.targetDate);
  assert.equal(missing.dataSufficient, false);
  assert.equal(missing.projectedDate, null);
});
