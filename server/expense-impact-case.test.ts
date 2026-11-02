import test from 'node:test';
import assert from 'node:assert/strict';
import { expenseImpactCase } from './expense-impact-case.ts';

test('isolated expense example always produces an evidenced goal delay and executable repair choice', () => {
  const example = expenseImpactCase();
  assert.equal(example.snapshot.goal.status, 'active');
  assert.equal(example.snapshot.pendingImpact?.expenseCents, 90000);
  const a = example.previews.keep_target_date;
  const b = example.previews.keep_monthly_contribution;
  assert.ok(b.candidate.delayDays > 0);
  assert.ok(b.candidate.projectedDate! > b.comparison.before.targetDate);
  assert.equal(b.evidence.transactions.reduce((sum, entry) => sum + entry.amountCents, 0), 90000);
  assert.equal(a.candidate.selectable, true);
  assert.ok(a.candidate.projectedDate! <= a.comparison.before.targetDate);
  assert.equal(a.protection.satisfied, true);
});
