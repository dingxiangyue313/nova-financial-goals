import test from 'node:test';
import assert from 'node:assert/strict';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { buildMoneyMissionPlans } from './money-mission-plans.ts';
import { confirmApproval, createApprovalSnapshot, stableHash, verifyAuditChain } from './governance.ts';
import * as schedules from './transfer-schedules.ts';

export function scheduleFixture() {
  let state = createJapanMoneyMissionFixture();
  const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: state.goal.targetDate, scenario: 'baseline' });
  const plan = buildMoneyMissionPlans(state, forecast)[1];
  state = { ...state, goal: { ...state.goal, selectedPlanId: plan.id, status: 'active', firstMonthContributionCents: 100000 } };
  state.goals = [state.goal];
  const input = { goalId: state.goal.id, planOptionId: plan.id, forecastId: forecast.id, twinVersion: 1,
    sourceAccountId: 'checking', destinationAccountId: 'goal-wallet', currency: 'CNY', amountCents: 100000,
    recurrence: 'monthly' as const, startDate: '2026-11-26', endDate: '2027-04-26', stopAtGoal: true,
    trigger: { type: 'salary_event' as const, accountId: 'checking', sourceKind: 'bank' as const,
      category: 'income' as const, classification: 'salary' as const, expectedAmountCents: 850000,
      toleranceBps: 1000, expectedDay: 25, windowStartDay: 23, graceEndDay: 27,
      graceEndTime: '23:59' as const, executeOffsetDays: 1, executeTime: '09:00' as const,
      missingEventPolicy: 'skip_no_catchup' as const } };
  return { state, input };
}

function prepared() {
  const { state, input } = scheduleFixture();
  const preview = schedules.simulateTransferSchedule(state, input);
  return { state: { ...state, transferSchedulePreviews: [preview] }, input, preview };
}
function approved(state: ReturnType<typeof scheduleFixture>['state'], action: string, parameters: Record<string, unknown>) {
  const approval = createApprovalSnapshot(state, action, parameters, `${state.clock}T12:05:00.000Z`);
  return confirmApproval(approval.state, approval.approval.id, approval.approval.snapshotHash);
}
function active() {
  const { state, preview } = prepared();
  const approval = approved(state, 'activate_transfer_schedule', schedules.transferScheduleApprovalParameters(preview));
  return schedules.activateTransferSchedule(approval.state, { previewId: preview.id, approvalToken: approval.token });
}

test('salary-relative preview freezes the event rule and previews three cycles without side effects', () => {
  const { state, input } = scheduleFixture(); const before = structuredClone(state);
  const preview = schedules.simulateTransferSchedule(state, input);
  assert.deepEqual(preview.trigger, input.trigger);
  assert.deepEqual(preview.occurrences.map(item => item.date), ['2026-11-26', '2026-12-26', '2027-01-26']);
  assert.ok(preview.occurrences.every(item => item.minimumBalanceCents >= 0 && !item.conflicts.length));
  assert.deepEqual(state, before);
  assert.equal(preview.precision, 'exact');
});

test('preview rejects unsupported recurrence, invalid accounts, currency and protected funds', () => {
  const { state, input } = scheduleFixture();
  for (const patch of [{ recurrence: 'weekly' }, { recurrence: 'yearly' }, { sourceAccountId: 'missing' },
    { destinationAccountId: 'missing' }, { destinationAccountId: 'checking' }, { sourceAccountId: 'emergency' },
    { destinationAccountId: 'emergency' }, { currency: 'USD' }, { amountCents: 0 }, { amountCents: 2000001 },
    { trigger: { ...input.trigger, accountId: 'emergency' } }, { endDate: '2027-07-26' }])
    assert.throws(() => schedules.simulateTransferSchedule(state, { ...input, ...patch } as typeof input));
  const protectedState = { ...state, goal: { ...state.goal, protectedCents: 4000000 } };
  assert.throws(() => schedules.simulateTransferSchedule(protectedState, input));
  const fxState = { ...state, accounts: state.accounts.map(item => item.id === 'goal-wallet' ? { ...item, currency: 'USD' } : item) };
  assert.throws(() => schedules.simulateTransferSchedule(fxState, input), /CURRENCY/);
});

test('one-time and fixed monthly triggers remain distinct from salary events', () => {
  const { state, input } = scheduleFixture();
  const once = schedules.simulateTransferSchedule(state, { ...input, recurrence: 'one_time', endDate: input.startDate,
    trigger: { type: 'fixed_day', day: 26 } });
  assert.equal(once.occurrences.length, 1);
  assert.equal(once.trigger.type, 'fixed_day');
  assert.equal(schedules.simulateTransferSchedule(state, { ...input, trigger: { type: 'fixed_day', day: 26 } }).occurrences.length, 3);
});

test('fixed dates surface same-day bill conflicts and activation cannot silently ignore them', () => {
  const { state, input } = scheduleFixture();
  const preview = schedules.simulateTransferSchedule(state, { ...input, startDate: '2026-11-01',
    trigger: { type: 'fixed_day', day: 1 } });
  assert.ok(preview.occurrences[0].conflicts.includes('rent'));
  const approval = approved({ ...state, transferSchedulePreviews: [preview] }, 'activate_transfer_schedule',
    schedules.transferScheduleApprovalParameters(preview));
  assert.throws(() => schedules.activateTransferSchedule(approval.state, { previewId: preview.id, approvalToken: approval.token }), /SCHEDULE.*CONFLICT/);
});

test('one-time first date must agree with its fixed-day rule and monthly scope cannot omit selected plan payments', () => {
  const { state, input } = scheduleFixture();
  assert.throws(() => schedules.simulateTransferSchedule(state, { ...input, recurrence: 'one_time', endDate: input.startDate,
    trigger: { type: 'fixed_day', day: 20 } }), /SCHEDULE/);
  assert.throws(() => schedules.simulateTransferSchedule(state, { ...input, startDate: '2026-12-26' }), /SCHEDULE/);
  assert.throws(() => schedules.simulateTransferSchedule(state, { ...input, endDate: '2027-03-26' }), /SCHEDULE/);
});

test('activation rechecks financial authority even when a caller leaves the Twin version unchanged', () => {
  const { state, preview } = prepared();
  const approval = approved(state, 'activate_transfer_schedule', schedules.transferScheduleApprovalParameters(preview));
  for (const next of [{ ...approval.state, accountSnapshots: [] },
    { ...approval.state, bills: approval.state.bills.map(item => item.id === 'rent' ? { ...item, amountCents: 280001 } : item) },
    { ...approval.state, goal: { ...approval.state.goal, selectedPlanId: 'custom', monthlyContributionCents: 99999 } }])
    assert.throws(() => schedules.activateTransferSchedule(next, { previewId: preview.id, approvalToken: approval.token }));
});

test('custom candidates with multiple current exact matches cannot bypass unique plan binding', () => {
  const { state, input } = scheduleFixture();
  state.goal = { ...state.goal, selectedPlanId: 'custom', targetDate: '2026-11-30', targetCents: 400000,
    monthlyContributionCents: 200000, firstMonthContributionCents: 200000 };
  state.goals = [state.goal];
  const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: state.goal.targetDate, scenario: 'baseline' });
  const plans = buildMoneyMissionPlans(state, forecast);
  assert.equal(plans.filter(plan => plan.monthlyCents === 200000 && plan.firstMonthContributionCents === 200000).length, 2);
  assert.equal(plans[0].executable, true);
  assert.throws(() => schedules.simulateTransferSchedule(state, { ...input, amountCents: 200000,
    planOptionId: plans[0].id, forecastId: forecast.id, endDate: '2026-11-26' }), /SCHEDULE_PLAN_CHANGED/);
});

test('a current goal priority conflict cannot be authorized with a previously exact selected candidate', () => {
  const { state, input } = scheduleFixture();
  state.goals.push({ ...state.goal, id: 'competing-goal', monthlyContributionCents: 500000 });
  const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: state.goal.targetDate, scenario: 'baseline' });
  const plan = buildMoneyMissionPlans(state, forecast)[1];
  assert.equal(plan.executable, false); assert.ok(plan.limitations.includes('GOAL_PRIORITY_CONFLICT'));
  state.goal.selectedPlanId = plan.id;
  assert.throws(() => schedules.simulateTransferSchedule(state, { ...input, planOptionId: plan.id, forecastId: forecast.id }), /SCHEDULE_PLAN_CHANGED/);
});

test('new schedule risk includes already authorized one-time transfers for the same goal', () => {
  const { state, input } = scheduleFixture();
  state.transferSchedules = [{ ...input, id: 'prior-once', previewId: 'prior-preview', recurrence: 'one_time',
    trigger: { type: 'fixed_day', day: 24 }, startDate: '2026-11-24', endDate: '2026-11-24', amountCents: 400000,
    status: 'active', authorizationHash: 'prior-approval', nextEvaluationAt: '2026-11-24T09:00:00+08:00',
    createdAt: '2026-10-26T12:00:00.000Z', updatedAt: '2026-10-26T12:00:00.000Z' }];
  const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: state.goal.targetDate, scenario: 'baseline' });
  const plan = buildMoneyMissionPlans(state, forecast)[1];
  state.goal.selectedPlanId = plan.id;
  assert.throws(() => schedules.simulateTransferSchedule(state, { ...input, forecastId: forecast.id, planOptionId: plan.id }), /PROTECTED_FUNDS_UNAVAILABLE/);
});

test('stale, range, forged forecast and unselected or changed plan identity cannot authorize schedules', () => {
  const { state, input } = scheduleFixture();
  for (const next of [{ ...state, twinVersion: 2 }, { ...state, clock: '2026-10-27' }, { ...state, accountSnapshots: [] },
    { ...state, goal: { ...state.goal, selectedPlanId: null } },
    { ...state, goal: { ...state.goal, selectedPlanId: 'other-plan' } },
    { ...state, goal: { ...state.goal, targetCents: 900000 } }])
    assert.throws(() => schedules.simulateTransferSchedule(next, input));
  assert.throws(() => schedules.simulateTransferSchedule(state, { ...input, forecastId: 'forged' }));
  assert.throws(() => schedules.simulateTransferSchedule(state, { ...input, planOptionId: 'forged' }));
  const custom = { ...state, goal: { ...state.goal, selectedPlanId: 'custom' } };
  assert.equal(schedules.simulateTransferSchedule(custom, input).planOptionId, input.planOptionId);
  assert.throws(() => schedules.simulateTransferSchedule({ ...custom,
    goal: { ...custom.goal, monthlyContributionCents: 99999 } }, input));
  const short = { ...custom, goal: { ...custom.goal, targetDate: '2026-11-30' } };
  assert.throws(() => schedules.simulateTransferSchedule(short, input));
});

test('activation consumes exact Approval once, stores authority and stop conditions without executing funds', () => {
  const { state, preview } = prepared();
  assert.throws(() => schedules.activateTransferSchedule(state, { previewId: preview.id, approvalToken: 'forged' }), /APPROVAL/);
  const approval = approved(state, 'activate_transfer_schedule', schedules.transferScheduleApprovalParameters(preview));
  const result = schedules.activateTransferSchedule(approval.state, { previewId: preview.id, approvalToken: approval.token });
  assert.equal(result.schedule.status, 'active');
  assert.equal(result.schedule.authorizationHash, stableHash(schedules.transferScheduleApprovalParameters(preview)));
  assert.equal(result.schedule.endDate, '2027-04-26'); assert.equal(result.schedule.stopAtGoal, true);
  assert.equal(result.schedule.nextEvaluationAt, '2026-11-23T09:00:00+08:00');
  assert.deepEqual(result.state.accounts, state.accounts); assert.deepEqual(result.state.transactions, state.transactions);
  assert.deepEqual(result.state.finance, state.finance); assert.deepEqual(result.state.transferExecutions, []);
  assert.equal(result.state.goal.savedCents, 200000);
  assert.equal(result.state.approvals.at(-1)?.status, 'consumed');
  assert.deepEqual(result.state.audit.map(event => event.action), ['permission', 'risk', 'execute', 'verify', 'audit']);
  assert.ok(result.state.audit.every(event => event.approvalId === result.state.approvals.at(-1)?.id));
  assert.ok(verifyAuditChain(result.state.audit));
  assert.equal(result.state.receipts.at(-1)?.amountCents, 0);
  assert.throws(() => schedules.activateTransferSchedule(result.state, { previewId: preview.id, approvalToken: approval.token }));
});

test('modified preview, increased amount and expanded scope require fresh approval', () => {
  const { state, preview } = prepared();
  for (const patch of [{ amountCents: 110000 }, { endDate: '2027-06-26' }, { stopAtGoal: false },
    { trigger: { type: 'fixed_day' as const, day: 26 } }, { destinationAccountId: 'checking' }]) {
    const changed = { ...preview, ...patch };
    const approval = approved(state, 'activate_transfer_schedule', schedules.transferScheduleApprovalParameters(preview));
    assert.throws(() => schedules.activateTransferSchedule({ ...approval.state, transferSchedulePreviews: [changed] },
      { previewId: preview.id, approvalToken: approval.token }));
  }
  const approval = approved(state, 'pause_transfer_schedule', schedules.transferScheduleApprovalParameters(preview));
  assert.throws(() => schedules.activateTransferSchedule(approval.state, { previewId: preview.id, approvalToken: approval.token }), /APPROVAL/);
  const expired = { ...approval.state, approvals: approval.state.approvals.map(item => ({ ...item, expiresAt: `${state.clock}T11:00:00.000Z` })) };
  assert.throws(() => schedules.activateTransferSchedule(expired, { previewId: preview.id, approvalToken: approval.token }), /APPROVAL/);
});

test('one active monthly plan per goal blocks a separately approved activation', () => {
  const { state, preview } = prepared(); const first = active();
  const duplicate = { ...state, transferSchedules: first.state.transferSchedules };
  const approval = approved(duplicate, 'activate_transfer_schedule', schedules.transferScheduleApprovalParameters(preview));
  assert.throws(() => schedules.activateTransferSchedule(approval.state, { previewId: preview.id, approvalToken: approval.token }), /SCHEDULE/);
});

test('pause and cancel require exact confirmation, replay is rejected and cancelled schedules cannot resume', () => {
  const first = active();
  assert.throws(() => schedules.pauseTransferSchedule(first.state, { scheduleId: first.schedule.id, approvalToken: 'no' }), /APPROVAL/);
  const approval = approved(first.state, 'pause_transfer_schedule', schedules.transferScheduleLifecycleParameters(first.schedule));
  const paused = schedules.pauseTransferSchedule(approval.state, { scheduleId: first.schedule.id, approvalToken: approval.token });
  assert.equal(paused.schedule.status, 'paused'); assert.equal(paused.schedule.nextEvaluationAt, null);
  assert.throws(() => schedules.pauseTransferSchedule(paused.state, { scheduleId: first.schedule.id, approvalToken: approval.token }));
  assert.throws(() => schedules.cancelTransferSchedule(paused.state, { scheduleId: first.schedule.id, approvalToken: 'no' }), /APPROVAL/);
  const cancelApproval = approved(paused.state, 'cancel_transfer_schedule', schedules.transferScheduleLifecycleParameters(paused.schedule));
  const cancelled = schedules.cancelTransferSchedule(cancelApproval.state, { scheduleId: first.schedule.id, approvalToken: cancelApproval.token });
  assert.equal(cancelled.schedule.status, 'cancelled');
  assert.throws(() => schedules.resumeTransferSchedule(cancelled.state, { scheduleId: first.schedule.id }));
  assert.deepEqual(cancelled.state.accounts, first.state.accounts);
  assert.ok(verifyAuditChain(cancelled.state.audit));
});

test('resume reuses original authority only when plan, rule, funds and current forecast remain unchanged', () => {
  const first = active();
  const approval = approved(first.state, 'pause_transfer_schedule', schedules.transferScheduleLifecycleParameters(first.schedule));
  const paused = schedules.pauseTransferSchedule(approval.state, { scheduleId: first.schedule.id, approvalToken: approval.token });
  const resumed = schedules.resumeTransferSchedule(paused.state, { scheduleId: first.schedule.id });
  assert.equal(resumed.schedule.status, 'active');
  assert.equal(resumed.schedule.authorizationHash, first.schedule.authorizationHash);
  assert.equal(resumed.state.approvals.length, paused.state.approvals.length);
  for (const patch of [{ amountCents: 100001 }, { endDate: '2027-06-26' }, { stopAtGoal: false },
    { trigger: { ...first.schedule.trigger, expectedDay: 24 } }])
    assert.throws(() => schedules.resumeTransferSchedule({ ...paused.state,
      transferSchedules: [{ ...paused.schedule, ...patch }] }, { scheduleId: first.schedule.id }));
  for (const next of [{ ...paused.state, accountSnapshots: [] }, { ...paused.state, clock: '2026-10-27' },
    { ...paused.state, goal: { ...paused.state.goal, targetCents: 900000 } },
    { ...paused.state, goal: { ...paused.state.goal, selectedPlanId: 'other' } }])
    assert.throws(() => schedules.resumeTransferSchedule(next, { scheduleId: first.schedule.id }));
});
