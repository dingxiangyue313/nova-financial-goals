import test from 'node:test';
import assert from 'node:assert/strict';
import { expiredGoalQuestion, safeGoalQuestion } from './goal-clarification.ts';

const task = { facts: { title: '韩国旅游', targetCents: 400000, savedCents: 0, originalTargetDate: '2026-08-01' },
  constraints: { latestAllowedDate: '2026-08-01', monthlyContributionCapCents: null, protectedCents: 2000000, preserveEssentialSpending: true } };
test('past date asks for a specific correction using the business clock and preserves facts', () => {
  const before = structuredClone(task);
  const question = expiredGoalQuestion(task, '2026-09-21');
  assert.match(question!, /2026-08-01.*2026-09-21/);
  assert.match(question!, /希望改到哪一天/);
  assert.deepEqual(task, before);
  assert.equal(expiredGoalQuestion({...task, constraints: {...task.constraints, latestAllowedDate: '2027-08-01'}}, '2026-09-21'), null);
});
test('numeric model questions retain the missing field without copying unverified numbers', () => {
  const future = {...task, constraints: {...task.constraints, latestAllowedDate: '2027-08-01'}};
  assert.match(safeGoalQuestion(future, '2026-09-21', '您是要在2027年8月完成吗？'), /具体日期/);
  assert.match(safeGoalQuestion(future, '2026-09-21', '每月最多投入¥5000吗？'), /每月最多/);
  assert.doesNotMatch(safeGoalQuestion(future, '2026-09-21', '每月最多投入¥5000吗？'), /5000|关键信息/);
});
