import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirstUseFixture } from './fixtures.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { readMoneyMission } from './money-mission.ts';
import { snapshot } from './presentation.ts';

test('read model maps artifacts to one current stage and never leaks raw evidence', () => {
  assert.equal(readMoneyMission(createFirstUseFixture()).stage, 'goal');
  assert.deepEqual(readMoneyMission(createFirstUseFixture()).completedStages, []);
  assert.equal(readMoneyMission(createFirstUseFixture()).nextCta?.id, 'continue_mission');

  const empty = createJapanMoneyMissionFixture(false);
  const data = readMoneyMission(empty);
  assert.equal(data.stage, 'data');
  assert.deepEqual(data.completedStages, ['goal']);
  assert.equal(data.nextCta?.id, 'import_sample');

  const loaded = createJapanMoneyMissionFixture();
  const bills = readMoneyMission(loaded);
  assert.equal(bills.stage, 'subscription');
  assert.deepEqual(bills.completedStages, ['goal', 'data', 'bills']);
  assert.equal(bills.nextCta?.id, 'review_cloudbox');
  assert.equal(bills.twinVersion, loaded.twinVersion);
  assert.ok(bills.billBrief);
  assert.equal(bills.billBrief?.subscriptionCandidates[0]?.merchantId, 'cloudbox-plus');
  assert.equal(JSON.stringify(snapshot(loaded)).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(bills).includes('authorizationHash'), false);

  const cancelled = {
    ...loaded,
    subscriptionActions: [{
      id: 'cancel-verified', subscriptionId: 'cloudbox', merchantId: 'cloudbox-plus', action: 'cancel' as const,
      status: 'succeeded' as const, monthlyCents: 6800, effectiveAt: '2026-11-05', paidThrough: '2026-11-04',
      cancelledAt: '2026-10-26T12:00:00+08:00', nextChargeSuppressed: true, refundCents: 0,
      merchantOperationId: 'merchant-op', approvalId: null, snapshotHash: null, twinVersion: loaded.twinVersion,
      idempotencyKey: 'cancel-verified', receiptId: null,
    }],
  };
  const planning = readMoneyMission(cancelled);
  assert.equal(planning.stage, 'planning');
  assert.equal(planning.nextCta?.id, 'compare_plans');
  assert.ok(planning.completedStages?.includes('subscription'));

  const pendingSchedule = {
    ...cancelled,
    transferSchedules: [{
      id: 'schedule-pending', goalId: cancelled.goal.id, sourceAccountId: 'checking', destinationAccountId: 'goal-wallet',
      currency: 'CNY' as const, amountCents: 100000, frequency: 'monthly' as const, status: 'awaiting_confirmation' as const,
      trigger: {
        type: 'salary_event' as const, expectedDay: 25, executeOffsetDays: 1 as const, executeTime: '09:00' as const,
        missingEventPolicy: 'skip_no_catchup' as const, graceDay: 27 as const,
        minimumSalaryCents: 765000, maximumSalaryCents: 935000, sourceAccountId: 'checking',
      },
      createdAt: '2026-10-26T12:00:00+08:00', endDate: cancelled.goal.targetDate, forecastId: 'forecast:test',
      twinVersion: cancelled.twinVersion, authorizationHash: 'hash', approvalId: null, snapshotHash: null,
      nextEvaluationDate: cancelled.clock, targetCents: cancelled.goal.targetCents,
    }],
  };
  assert.equal(readMoneyMission(pendingSchedule).stage, 'transfer');

  const scheduled = {
    ...pendingSchedule,
    transferSchedules: [{ ...pendingSchedule.transferSchedules[0], status: 'active' as const }],
    transferExecutions: [{
      id: 'skipped', scheduleId: 'schedule-pending', periodKey: 'schedule:2026-11', operationId: null,
      status: 'skipped_missing_trigger' as const, amountCents: 100000, createdAt: '2026-11-28T00:00:00+08:00',
      reason: 'missing salary', triggerTransactionId: null,
    }],
  };
  const monitoring = readMoneyMission(scheduled);
  assert.equal(monitoring.stage, 'monitoring');
  assert.ok(monitoring.repairPreviews?.some(item => item.kind === 'pause_schedule' && item.appliesImmediately === false));
});
