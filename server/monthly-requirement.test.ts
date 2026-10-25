import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMonthlyRequirement } from './domain.ts';

test('monthly requirement uses remaining goal and 30-day months rounded up', () => {
  assert.deepEqual(calculateMonthlyRequirement(800_000, 200_000, '2026-10-24', '2026-12-31'), {
    remainingCents: 600_000,
    remainingMonths: 3,
    requiredMonthlyCents: 200_000,
  });
  assert.deepEqual(calculateMonthlyRequirement(800_000, 0, '2026-10-24', '2026-12-31'), {
    remainingCents: 800_000,
    remainingMonths: 3,
    requiredMonthlyCents: 266_667,
  });
});

test('monthly requirement has a one-month minimum and no negative contribution', () => {
  assert.equal(calculateMonthlyRequirement(10_000, 0, '2026-10-24', '2026-10-24').remainingMonths, 1);
  assert.equal(calculateMonthlyRequirement(10_000, 0, '2026-10-24', '2026-10-01').requiredMonthlyCents, 10_000);
  assert.equal(calculateMonthlyRequirement(10_000, 12_000, '2026-10-24', '2026-11-30').requiredMonthlyCents, 0);
});
