import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { DemoState, Transaction } from '../shared/contracts.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { buildMoneyMissionPlans } from './money-mission-plans.ts';
import { activateTransferSchedule, simulateTransferSchedule, transferScheduleApprovalParameters } from './transfer-schedules.ts';
import { confirmApproval, createApprovalSnapshot, verifyAuditChain } from './governance.ts';

process.env.NOVA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'nova-transfer-worker-')), 'worker.sqlite');
const store = await import('./store.ts');
const worker = await import('./transfer-worker.ts').catch(() => null);
const due = new Date('2026-11-26T09:00:00+08:00');
const salary = (patch: Partial<Transaction> = {}): Transaction => ({ id: 'salary-nov', accountId: 'checking',
  date: '2026-11-25', title: '工资', category: 'income', amountCents: 850000,
  sourceKind: 'bank', provenance: 'connected_data', ...patch });

export function workerFixture(withSalary = true, fixedDate?:string) {
  let state = createJapanMoneyMissionFixture();
  const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: state.goal.targetDate, scenario: 'baseline' });
  const plan = buildMoneyMissionPlans(state, forecast)[1];
  state.goal = { ...state.goal, selectedPlanId: plan.id, status: 'active', firstMonthContributionCents: 100000 };
  state.goals = [state.goal];
  const preview = simulateTransferSchedule(state, { goalId: state.goal.id, planOptionId: plan.id, forecastId: forecast.id,
    twinVersion: 1, sourceAccountId: 'checking', destinationAccountId: 'goal-wallet', currency: 'CNY', amountCents: 100000,
    recurrence: fixedDate?'one_time':'monthly', startDate: fixedDate??'2026-11-26', endDate: fixedDate??'2027-04-26', stopAtGoal: true,
    trigger: fixedDate?{type:'fixed_day',day:Number(fixedDate.slice(-2))}:{ type: 'salary_event', accountId: 'checking', sourceKind: 'bank', category: 'income', classification: 'salary',
      expectedAmountCents: 850000, toleranceBps: 1000, expectedDay: 25, windowStartDay: 23, graceEndDay: 27,
      graceEndTime: '23:59', executeOffsetDays: 1, executeTime: '09:00', missingEventPolicy: 'skip_no_catchup' } });
  state.transferSchedulePreviews = [preview];
  const approval = createApprovalSnapshot(state, 'activate_transfer_schedule', transferScheduleApprovalParameters(preview), '2026-10-26T12:05:00Z');
  const confirmed = confirmApproval(approval.state, approval.approval.id, approval.approval.snapshotHash);
  const active = activateTransferSchedule(confirmed.state, { previewId: preview.id, approvalToken: confirmed.token });
  const sessionId = randomUUID();
  store.mutateState(sessionId, () => active.state);
  store.mutateState(sessionId, old => ({ ...old, clock: fixedDate??'2026-11-26',
    accountSnapshots: old.accountSnapshots.map(item => ({ ...item, asOf: fixedDate??'2026-11-26' })),
    transactions: withSalary ? [...old.transactions, salary()] : old.transactions }));
  return { sessionId, schedule: active.schedule };
}
function processDue(f: ReturnType<typeof workerFixture>, now = due) {
  assert.ok(worker, 'transfer worker must exist');
  return worker.processTransferSchedule(f.sessionId, f.schedule.id, now);
}
const change = (f: ReturnType<typeof workerFixture>, fn: (state: DemoState) => DemoState) => store.mutateState(f.sessionId, fn);

test('verified salary on 25th executes once on 26th with governance, receipt and goal credit', () => {
  const f = workerFixture(); const before = store.getState(f.sessionId);
  const first = processDue(f); const replay = processDue(f, new Date('2026-11-26T09:05:00+08:00'));
  assert.equal(first.status, 'succeeded'); assert.equal(replay.operationId, first.operationId);
  const after = store.getState(f.sessionId);
  assert.equal(after.finance.checkingCents, before.finance.checkingCents - 100000);
  assert.equal(after.accounts.find(item => item.id === 'goal-wallet')!.balanceCents, 300000);
  assert.equal(after.goal.savedCents, 300000); assert.equal(after.goals[0].savedCents, 300000);
  assert.equal(after.transferExecutions.length, 1); assert.equal(after.operations.length, 1);
  assert.equal(after.operations[0].idempotencyKey, `schedule:${f.schedule.id}:2026-11`);
  assert.equal(after.receipts.find(item => item.operationId === first.receiptOperationId)?.tool, 'execute_transfer');
  assert.deepEqual(after.audit.filter(item => item.operationId === first.operationId).slice(-5).map(item => item.action),
    ['permission', 'risk', 'execute', 'verify', 'audit']);
  assert.ok(verifyAuditChain(after.audit));
});

test('salary event offset and local 09:00 govern execution, not expected 26th', () => {
  const f = workerFixture();
  change(f, old => ({ ...old, transactions: [salary({ date: '2026-11-27' })] }));
  assert.equal(processDue(f).status, 'scheduled');
  change(f, old => ({ ...old, clock: '2026-11-28', accountSnapshots: old.accountSnapshots.map(item => ({ ...item, asOf: '2026-11-28' })) }));
  assert.equal(processDue(f, new Date('2026-11-28T08:59:59+08:00')).status, 'scheduled');
  assert.equal(processDue(f, new Date('2026-11-28T09:00:00+08:00')).status, 'succeeded');
});

test('missing salary skips at cutoff once and late salary cannot revive or catch up', () => {
  const f = workerFixture(false); const before = store.getState(f.sessionId).finance.checkingCents;
  assert.equal(processDue(f, new Date('2026-11-27T23:59:59+08:00')).status, 'scheduled');
  assert.equal(processDue(f, new Date('2026-11-28T00:00:00+08:00')).status, 'skipped_missing_trigger');
  change(f, old => ({ ...old, clock: '2026-11-30', transactions: [salary({ date: '2026-11-29' })] }));
  assert.equal(processDue(f, new Date('2026-11-30T09:00:00+08:00')).status, 'skipped_missing_trigger');
  assert.equal(worker!.tickTransferWorker(new Date('2026-11-30T09:00:00+08:00')), 0);
  assert.equal(store.getState(f.sessionId).finance.checkingCents, before);
  assert.equal(store.listMonitorEvents(f.sessionId).filter(item => item.kind === 'transfer_outcome').length, 1);
});

test('salary lookalikes, wrong source/account/category, future dates and out-of-window rows cannot debit', () => {
  for (const patch of [{ title: '工资退款' }, { title: 'salary advance' }, { sourceKind: 'alipay' as const },
    { sourceKind: undefined }, { accountId: 'goal-wallet' }, { category: 'shopping' },
    { date: '2026-11-22' }, { date: '2026-11-28' }, { date: '2026-12-25' }, { amountCents: -850000 }]) {
    const f = workerFixture(false); change(f, old => ({ ...old, transactions: [salary(patch)] }));
    assert.equal(processDue(f).status, 'scheduled', JSON.stringify(patch));
    assert.equal(store.getState(f.sessionId).operations.length, 0);
  }
});

test('inclusive frozen salary tolerance and normalized labels match deterministically by date then ID', () => {
  const f = workerFixture(); assert.ok(worker, 'transfer worker must exist');
  for (const [amount, matches] of [[764999, false], [765000, true], [935000, true], [935001, false]] as const)
    assert.equal(Boolean(worker.matchSalaryEvent(f.schedule, [salary({ amountCents: amount })])), matches);
  assert.equal(worker.matchSalaryEvent(f.schedule, [salary({ id: 'b' }), salary({ id: 'a' }),
    salary({ id: 'z', date: '2026-11-24' })])?.id, 'z');
  assert.equal(worker.matchSalaryEvent(f.schedule, [salary({ id: 'b' }), salary({ id: 'a', title: ' ＳＡＬＡＲＹ ' })])?.id, 'a');
});

test('insufficient balance, protected reserve, changed account, stale data and changed goal fail without debiting', () => {
  const mutations: Array<(state: DemoState) => DemoState> = [
    old => ({ ...old, finance: { ...old.finance, checkingCents: 99999 }, accounts: old.accounts.map(item => item.id === 'checking' ? { ...item, balanceCents: 99999 } : item) }),
    old => ({ ...old, goal: { ...old.goal, protectedCents: 2700000 } }),
    old => ({ ...old, accounts: old.accounts.map(item => item.id === 'goal-wallet' ? { ...item, protected: true } : item) }),
    old => ({ ...old, accounts: old.accounts.filter(item => item.id !== 'checking') }),
    old => ({ ...old, accountSnapshots: [] }),
    old => ({ ...old, goal: { ...old.goal, selectedPlanId: 'other-plan' } }),
    old => ({ ...old, transferSchedules: old.transferSchedules.map(item => ({ ...item, amountCents: 110000 })) }),
    old => ({ ...old, approvals: [] }),
  ];
  for (const mutation of mutations) {
    const f = workerFixture(); change(f, mutation); const before = store.getState(f.sessionId);
    assert.equal(processDue(f).status, 'failed'); assert.equal(processDue(f).status, 'failed');
    const after = store.getState(f.sessionId);
    assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.finance, before.finance);
    assert.equal(after.operations.length, 0);
    assert.equal(store.listMonitorEvents(f.sessionId).filter(item => item.kind === 'transfer_outcome').length, 1);
  }
});

test('inactive schedules cannot debit even when the salary and balance are valid', () => {
  for (const status of ['paused', 'cancelled'] as const) {
    const f = workerFixture(); change(f, old => ({ ...old, transferSchedules: [{ ...f.schedule, status, nextEvaluationAt: null }] }));
    assert.equal(processDue(f).status, 'failed'); assert.equal(store.getState(f.sessionId).operations.length, 0);
  }
});

test('target reached, target date passed and end date passed stop safely', () => {
  for (const patch of [{ savedCents: 800000 }, { targetDate: '2026-11-25' }]) {
    const f = workerFixture(); change(f, old => ({ ...old, goal: { ...old.goal, ...patch } }));
    const result = processDue(f); assert.equal(result.status, 'failed');
    assert.equal(store.getState(f.sessionId).transferSchedules[0].status, 'completed');
    assert.equal(store.getState(f.sessionId).operations.length, 0);
  }
  const f = workerFixture(); assert.equal(processDue(f, new Date('2027-05-26T09:00:00+08:00')).status, 'failed');
  assert.equal(store.getState(f.sessionId).operations.length, 0);
});

test('persisted unknown execution reconciles original receipt without resubmission or balance changes', () => {
  const f = workerFixture(); const success = processDue(f); const before = store.getState(f.sessionId);
  change(f, old => ({ ...old, transferExecutions: [{ ...success, status: 'unknown' }],
    operations: old.operations.map(item => ({ ...item, status: 'unknown' as const })) }));
  assert.equal(processDue(f).status, 'reconciled');
  assert.deepEqual(store.getState(f.sessionId).accounts, before.accounts);
  assert.equal(store.getState(f.sessionId).operations.length, 1);
  assert.equal(processDue(f).status, 'reconciled');
});

test('unknown without a verified receipt remains unknown and emits one monitor event', () => {
  const f = workerFixture(); const success = processDue(f);
  change(f, old => ({ ...old, transferExecutions: [{ ...success, status: 'unknown' }],
    operations: old.operations.map(item => ({ ...item, status: 'unknown' as const, receipt: null })),
    receipts: old.receipts.filter(item => item.operationId !== success.operationId) }));
  const before = store.getState(f.sessionId).accounts;
  assert.equal(processDue(f).status, 'unknown'); assert.equal(processDue(f).status, 'unknown');
  assert.deepEqual(store.getState(f.sessionId).accounts, before);
  assert.equal(store.listMonitorEvents(f.sessionId).filter(item => item.kind === 'transfer_outcome').length, 1);
});

test('persisted leases are exclusive, recover after expiry, and restart replay cannot duplicate execution', () => {
  const f = workerFixture(); assert.ok(worker, 'transfer worker must exist');
  const lease = store.claimTransferSchedule(f.sessionId, f.schedule.id, '2026-11', due);
  assert.ok(lease); assert.equal(store.claimTransferSchedule(f.sessionId, f.schedule.id, '2026-11', due), null);
  assert.equal(processDue(f).status, 'scheduled');
  const result = processDue(f, new Date(due.getTime() + 31000)); assert.equal(result.status, 'succeeded');
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    const store = await import('./server/store.ts');
    const worker = await import('./server/transfer-worker.ts');
    const result = worker.processTransferSchedule(${JSON.stringify(f.sessionId)}, ${JSON.stringify(f.schedule.id)}, new Date('2026-11-26T09:05:00+08:00'));
    process.stdout.write(JSON.stringify({ result, state: store.getState(${JSON.stringify(f.sessionId)}) }));
  `], { env: process.env, encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, child.stderr);
  const replay = JSON.parse(child.stdout);
  assert.equal(replay.result.operationId, result.operationId); assert.equal(replay.state.operations.length, 1);
  assert.equal(replay.state.finance.checkingCents, 624000);
});

test('bounded ticks execute only active due salary schedules and the next period uses its own key', () => {
  const f = workerFixture(); assert.ok(worker, 'transfer worker must exist');
  assert.equal(worker.tickTransferWorker(due, 0), 0);
  worker.tickTransferWorker(due, 1);
  // Other independent fixtures may be earlier in the bounded queue; directly finish this one.
  processDue(f);
  change(f, old => ({ ...old, clock: '2026-12-26', transactions: [...old.transactions, salary({ id: 'salary-dec', date: '2026-12-25' })],
    accountSnapshots: old.accountSnapshots.map(item => ({ ...item, balanceCents: old.accounts.find(account => account.id === item.accountId)!.balanceCents, asOf: '2026-12-26' })) }));
  assert.equal(processDue(f, new Date('2026-12-26T09:00:00+08:00')).status, 'succeeded');
  assert.equal(store.getState(f.sessionId).operations.length, 2);
});

test('server interval uses each session demo date', () => {
  const f = workerFixture(); assert.ok(worker);
  change(f, old => ({ ...old, clock: '2026-12-26', transactions: [salary({ date: '2026-12-24' })],
    transferSchedules: [{ ...old.transferSchedules[0], nextEvaluationAt: '2026-12-23T09:00:00+08:00' }],
    accountSnapshots: old.accountSnapshots.map(item => ({ ...item, asOf: '2026-12-26' })) }));
  worker.tickTransferWorker(undefined, 100);
  assert.equal(store.getState(f.sessionId).operations.length, 1);
});

test('rejected execution preserves cancelled lifecycle status', () => {
  const cancelled = workerFixture();
  change(cancelled, old => ({ ...old, transferSchedules: [{ ...cancelled.schedule, status: 'cancelled', nextEvaluationAt: null }] }));
  processDue(cancelled);
  assert.equal(store.getState(cancelled.sessionId).transferSchedules[0].status, 'cancelled');
});

test('salary matcher cannot widen an originally narrower authorized tolerance', () => {
  const f = workerFixture(); assert.ok(worker);
  const schedule = { ...f.schedule, trigger: { ...f.schedule.trigger, toleranceBps: 0 } };
  assert.equal(worker.matchSalaryEvent(schedule, [salary({ amountCents: 765000 })]), null);
});

test('new bill conflicts that exhaust the current authoritative cashflow stop the scheduled debit', () => {
  const f = workerFixture();
  change(f, old => ({ ...old, bills: old.bills.map(item => item.id === 'rent' ? { ...item, amountCents: 3000000 } : item) }));
  const before = store.getState(f.sessionId).accounts;
  assert.equal(processDue(f).status, 'failed');
  assert.deepEqual(store.getState(f.sessionId).accounts, before);
});

test('waiting schedules advance their evaluation so a bounded interval cannot starve later schedules', () => {
  const f = workerFixture(false);
  assert.equal(processDue(f).status, 'scheduled');
  assert.ok(Date.parse(store.getState(f.sessionId).transferSchedules[0].nextEvaluationAt!) > due.getTime());
});

test('a positive pre-debit minimum below the transfer amount cannot authorize a negative post-debit cashflow', () => {
  const f = workerFixture();
  change(f, old => ({ ...old, finance: { ...old.finance, checkingCents: 474000 },
    accounts: old.accounts.map(item => item.id === 'checking' ? { ...item, balanceCents: 474000 } : item),
    accountSnapshots: old.accountSnapshots.map(item => item.accountId === 'checking' ? { ...item, balanceCents: 474000 } : item) }));
  const before = store.getState(f.sessionId);
  const forecast = buildDatedCashflowForecast(before, { accountId: 'checking', horizonEnd: before.goal.targetDate, scenario: 'baseline' });
  assert.equal(forecast.minimumBalanceCents, 67200);
  const result = processDue(f);
  assert.equal(result.status, 'failed'); assert.equal(result.reason, 'SCHEDULE_CASHFLOW_UNSAFE');
  const after = store.getState(f.sessionId);
  assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.finance, before.finance);
  assert.deepEqual(after.goal, before.goal); assert.deepEqual(after.goals, before.goals);
  assert.deepEqual(after.accountSnapshots, before.accountSnapshots);
  assert.equal(after.operations.length, 0);
  assert.equal(store.listMonitorEvents(f.sessionId).filter(item => item.kind === 'transfer_outcome').length, 1);
});

test('a post-debit minimum exactly at zero remains executable and includes the transfer once', () => {
  const f = workerFixture();
  change(f, old => ({ ...old, finance: { ...old.finance, checkingCents: 506800 },
    accounts: old.accounts.map(item => item.id === 'checking' ? { ...item, balanceCents: 506800 } : item),
    accountSnapshots: old.accountSnapshots.map(item => item.accountId === 'checking' ? { ...item, balanceCents: 506800 } : item) }));
  assert.equal(processDue(f).status, 'succeeded');
  const after = store.getState(f.sessionId);
  assert.equal(after.finance.checkingCents, 406800); assert.equal(after.goal.savedCents, 300000);
  assert.equal(buildDatedCashflowForecast(after, { accountId: 'checking', horizonEnd: after.goal.targetDate,
    scenario: 'baseline' }).minimumBalanceCents, 0);
});

test('cross-month reconciliation selects unresolved December rather than a prior successful November and replays once', () => {
  const f = workerFixture(); const november = processDue(f);
  change(f, old => ({ ...old, clock: '2026-12-26', transactions: [...old.transactions, salary({ id: 'salary-dec', date: '2026-12-25' })],
    accountSnapshots: old.accountSnapshots.map(item => ({ ...item, asOf: '2026-12-26' })) }));
  const december = processDue(f, new Date('2026-12-26T09:00:00+08:00'));
  assert.equal(december.status, 'succeeded');
  const receipt = store.getState(f.sessionId).receipts.find(item => item.operationId === december.operationId)!;
  change(f, old => ({ ...old, clock: '2027-01-26',
    transferExecutions: old.transferExecutions.map(item => item.id === december.id ? { ...item, status: 'unknown' as const } : item),
    transferSchedules: [{ ...old.transferSchedules[0], status: 'paused', nextEvaluationAt: null }],
    operations: old.operations.map(item => item.operationId === december.operationId ? { ...item, status: 'unknown' as const, receipt: null } : item),
    receipts: old.receipts.filter(item => item.operationId !== december.operationId) }));
  const before = store.getState(f.sessionId);
  const january = new Date('2027-01-26T09:00:00+08:00');
  const pending = processDue(f, january);
  assert.equal(pending.period, '2026-12'); assert.equal(pending.operationId, december.operationId);
  assert.equal(pending.status, 'unknown'); assert.equal(processDue(f, january).status, 'unknown');
  change(f, old => ({ ...old, receipts: [...old.receipts, receipt], operations: old.operations.map(item =>
    item.operationId === december.operationId ? { ...item, receipt } : item) }));
  const reconciled = processDue(f, january);
  assert.equal(reconciled.status, 'reconciled'); assert.equal(reconciled.period, '2026-12');
  assert.equal(reconciled.operationId, december.operationId);
  const final = store.getState(f.sessionId);
  assert.deepEqual(processDue(f, january), reconciled);
  assert.deepEqual(store.getState(f.sessionId), final);
  assert.deepEqual(final.accounts, before.accounts); assert.deepEqual(final.goal, before.goal);
  assert.equal(final.operations.length, 2);
  assert.equal(final.transferExecutions.find(item => item.id === november.id)?.status, 'succeeded');
  assert.equal(store.listMonitorEvents(f.sessionId).filter(item => item.kind === 'transfer_outcome').length, 1);
});

test('first-period salary on the 23rd cannot execute on the 24th before the authorized start date', () => {
  const f = workerFixture();
  change(f, old => ({ ...old, clock: '2026-11-24', transactions: [salary({ date: '2026-11-23' })],
    accountSnapshots: old.accountSnapshots.map(item => ({ ...item, asOf: '2026-11-24' })) }));
  const before = store.getState(f.sessionId);
  const early = new Date('2026-11-24T09:00:00+08:00');
  const result = processDue(f, early);
  assert.equal(result.status, 'failed'); assert.equal(result.reason, 'SCHEDULE_EXECUTION_OUT_OF_SCOPE');
  assert.equal(processDue(f, early).status, 'failed');
  const after = store.getState(f.sessionId);
  assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.goal, before.goal);
  assert.deepEqual(after.finance, before.finance); assert.equal(after.operations.length, 0);
  assert.equal(store.listMonitorEvents(f.sessionId).filter(item => item.kind === 'transfer_outcome').length, 1);
});

 test('fixed one-time date executes at 09:00 without a salary event, conserves funds and never repeats',()=>{
 const f=workerFixture(false,'2026-11-20'),before=store.getState(f.sessionId);
 assert.equal(processDue(f,new Date('2026-11-20T08:59:00+08:00')).status,'scheduled');
 const result=processDue(f,new Date('2026-11-20T09:00:00+08:00'));assert.equal(result.status,'succeeded');assert.equal(result.triggerTransactionId,null);
 const after=store.getState(f.sessionId);assert.equal(after.finance.checkingCents,before.finance.checkingCents-100000);assert.equal(after.goal.savedCents,before.goal.savedCents+100000);
 assert.equal(processDue(f,new Date('2026-11-21T10:00:00+08:00')).operationId,result.operationId);assert.equal(store.getState(f.sessionId).transferExecutions.length,1);
 });
 test('fixed one-time insufficiency and missed date never wait for salary or catch up',()=>{
 const f=workerFixture(false,'2026-11-20');change(f,s=>({...s,finance:{...s.finance,checkingCents:50000},accounts:s.accounts.map(a=>a.id==='checking'?{...a,balanceCents:50000}:a)}));
 assert.equal(processDue(f,new Date('2026-11-20T09:00:00+08:00')).status,'failed');assert.equal(store.getState(f.sessionId).finance.checkingCents,50000);
 const missed=workerFixture(false,'2026-11-20'),before=store.getState(missed.sessionId);assert.equal(processDue(missed,new Date('2026-11-21T09:00:00+08:00')).reason,'SCHEDULE_STOP_CONDITION');assert.deepEqual(store.getState(missed.sessionId).accounts,before.accounts);
 });
