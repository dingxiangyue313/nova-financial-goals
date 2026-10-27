import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { simulateTransferSchedule } from './transfer-schedules.ts';

test('previews preserve other goals, fixed dates, authorized ceilings and completed periods', () => {
  const state = createJapanMoneyMissionFixture();
  const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: state.goal.targetDate, scenario: 'baseline' });
  const prepared = simulateTransferSchedule(state, { goalId: state.goal.id, sourceAccountId: 'checking', destinationAccountId: 'goal-wallet', amountCents: 100000, frequency: 'monthly', forecastId: forecast.forecastId!, triggerType: 'fixed_day', fixedDay: 10 });
  const otherGoal = { ...state.goal, id: 'other-goal', targetCents: 250000, savedCents: 200000 };
  state.goals.push(otherGoal);
  const schedule = { ...prepared.preview, id: 'other-schedule', goalId: otherGoal.id, status: 'active' as const, targetCents: 250000 };
  state.transferSchedules.push(schedule);
  const preview = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: '2027-01-30', scenario: 'baseline', contributionCents: 75000 });
  const otherEvents = preview.events.filter(event => event.sourceRefs.includes(schedule.id));
  assert.equal(otherEvents.length, 1);
  assert.equal(otherEvents[0].date, '2026-11-10');
  assert.equal(otherEvents[0].amountCents, -50000);
  assert.ok(preview.events.some(event => event.sourceRefs.includes('preview')));
  state.transferExecutions.push({ id: 'done', scheduleId: schedule.id, periodKey: `schedule:${schedule.id}:2026-11`, operationId: 'done-op', status: 'succeeded', amountCents: 50000, createdAt: '2026-11-10T01:00:00Z', reason: 'done', triggerTransactionId: null });
  const replay = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: '2026-11-30', scenario: 'baseline' });
  assert.equal(replay.events.some(event => event.sourceRefs.includes(schedule.id)), false);
});

test('dated cashflow uses authoritative balance and exact frozen bill dates', () => {
  const state = createJapanMoneyMissionFixture();
  const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: '2026-11-26', scenario: 'baseline' });
  assert.equal(forecast.precision, 'exact'); assert.equal(forecast.minimumBalanceCents, 317200);
  assert.equal(forecast.minimumBalanceDate, '2026-11-18');
  assert.equal(forecast.events.find(e => e.label === '工资')!.amountCents, 850000);
  assert.equal(forecast.events.filter(e => e.label === '应急金').length, 0);
  const missing = buildDatedCashflowForecast({ ...state, accountSnapshots: [] }, { accountId: 'checking', horizonEnd: '2026-11-26', scenario: 'baseline' });
  assert.equal(missing.precision, 'insufficient_balance'); assert.equal(missing.forecastId, null);
});
test('verified cancellation, edited income dates and stress change the event ledger', () => {
  const state = createJapanMoneyMissionFixture();
  state.subscriptionActions.push({ id: 'cancel-verified', subscriptionId: 'cloudbox', merchantId: 'cloudbox-plus', action: 'cancel', status: 'succeeded', monthlyCents: 6800, effectiveAt: '2026-11-05', paidThrough: '2026-11-04', cancelledAt: '2026-10-26T12:00:00+08:00', nextChargeSuppressed: true, refundCents: 0, merchantOperationId: 'merchant-op', approvalId: null, snapshotHash: null, twinVersion: 1, idempotencyKey: 'cancel-verified', receiptId: null });
  const input = { accountId: 'checking', horizonEnd: '2026-11-30', scenario: 'baseline' as const };
  assert.equal(buildDatedCashflowForecast(state,input).minimumBalanceCents, 324000);
  assert.equal(buildDatedCashflowForecast(state,{ ...input, scenario: 'stress' }).minimumBalanceCents, 274000);
  const edited = buildDatedCashflowForecast(state,{ ...input, scenario: 'edited', edits: [{ eventId: 'salary:2026-11', operation: 'replace', date: '2026-11-28', label: '延迟工资', amountCents: 850000, currency: 'CNY' }] });
  assert.equal(edited.events.find(e => e.id === 'salary:2026-11')!.date,'2026-11-28');
  assert.throws(() => buildDatedCashflowForecast(state,{ ...input, scenario: 'edited', edits: [{ date: '2026-11-01',label:'FX',amountCents:100,currency:'JPY' }] }), /CURRENCY/);
});
