import test from 'node:test';
import assert from 'node:assert/strict';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { simulateTransferSchedule, activateTransferSchedule, prepareScheduleLifecycle, applyScheduleLifecycle } from './transfer-schedules.ts';
import { confirmApproval } from './governance.ts';
test('salary-relative preview freezes event rules, three cycles and original authorization', () => {
  const state = createJapanMoneyMissionFixture(); const forecast = buildDatedCashflowForecast(state,{accountId:'checking',horizonEnd:'2027-06-30',scenario:'baseline'});
  const simulated = simulateTransferSchedule(state,{goalId:state.goal.id,sourceAccountId:'checking',destinationAccountId:'goal-wallet',amountCents:100000,frequency:'monthly',forecastId:forecast.forecastId!});
  assert.equal(simulated.preview.trigger.type,'salary_event'); assert.equal(simulated.preview.cycles.length,3);
  assert.equal(simulated.preview.trigger.minimumSalaryCents,765000); assert.equal(simulated.preview.trigger.maximumSalaryCents,935000);
  const approved = confirmApproval(simulated.state,simulated.preview.approvalId!,simulated.preview.snapshotHash!);
  const activated = activateTransferSchedule(approved.state,{scheduleId:simulated.preview.id,approvalToken:approved.token});
  assert.equal(activated.state.finance.checkingCents,724000); assert.equal(activated.schedule.status,'active');
  assert.throws(() => simulateTransferSchedule(activated.state,{goalId:state.goal.id,sourceAccountId:'checking',destinationAccountId:'goal-wallet',amountCents:100000,frequency:'monthly',forecastId:forecast.forecastId!}), /ALREADY_ACTIVE|STALE/);
  const pause = prepareScheduleLifecycle(activated.state,activated.schedule.id,'pause');
  const pauseApproval = confirmApproval(pause.state,pause.approval.id,pause.approval.snapshotHash);
  assert.equal(applyScheduleLifecycle(pauseApproval.state,activated.schedule.id,'pause',pauseApproval.token).schedule.status,'paused');
});
