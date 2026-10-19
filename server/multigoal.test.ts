import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirstUseFixture, createFixture } from './fixtures.ts';
import { migrateDemoStateShape } from './store.ts';
import { runBankingTool } from './banking.ts';

test('a first-use session has no visible goals while the Japan scenario remains opt-in', () => {
  const firstUse = createFirstUseFixture();
  assert.deepEqual(firstUse.goals, []);
  assert.equal(firstUse.primaryGoalId, null);

  const demo = createFixture();
  assert.equal(demo.goals.length, 1);
  assert.equal(demo.primaryGoalId, demo.goal.id);
});

test('legacy single-goal state migrates without losing the goal', () => {
  const legacy = createFixture() as unknown as Record<string, unknown>;
  delete legacy.goals;
  delete legacy.primaryGoalId;
  const migrated = migrateDemoStateShape(legacy);
  assert.equal(migrated.goals.length, 1);
  assert.equal(migrated.goals[0].id, migrated.goal.id);
  assert.equal(migrated.primaryGoalId, migrated.goal.id);
});

test('creating at least three goals appends them and preserves the first primary goal', () => {
  const empty = createFirstUseFixture();
  const first = runBankingTool(empty, 'create_goal', {
    id: 'goal-camera', title: '相机', targetCents: 1200000, targetDate: '2027-01-15',
    protectedCents: 2000000, flexibilityWeeks: 2, monthlyContributionCents: 150000, quote: '买相机',
  }).state;
  const second = runBankingTool(first, 'create_goal', {
    id: 'goal-study', title: '留学基金', targetCents: 5000000, targetDate: '2027-09-01',
    protectedCents: 2000000, flexibilityWeeks: 4, monthlyContributionCents: 300000, quote: '留学',
  }).state;
  const third = runBankingTool(second, 'create_goal', {
    id: 'goal-home', title: '新家首付', targetCents: 12000000, targetDate: '2028-06-01',
    protectedCents: 2000000, flexibilityWeeks: 8, monthlyContributionCents: 500000, quote: '新家',
  }).state;

  assert.deepEqual(third.goals.map(goal => goal.id), ['goal-camera', 'goal-study', 'goal-home']);
  assert.equal(third.primaryGoalId, 'goal-camera');
  assert.equal(third.goal.id, 'goal-home', 'compatibility goal tracks the current planning context');
});
