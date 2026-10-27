import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';

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
