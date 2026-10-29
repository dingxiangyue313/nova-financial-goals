import { randomUUID } from 'node:crypto';
import {protectedCheckingReserve} from './financial-constraints.ts';
import { TransferScheduleInputSchema, type DemoState, type Transaction, type TransferExecution,
  type TransferSchedule, type TransferScheduleInput } from '../shared/contracts.ts';
import { runBankingTool } from './banking.ts';
import { appendAuditEvent, createApprovalSnapshot, stableHash } from './governance.ts';
import { transferScheduleApprovalParameters } from './transfer-schedules.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { forecastHasExecutionAuthority } from './money-mission-plans.ts';
import { claimTransferSchedule, commitTransferSchedule, dueTransferSchedules, getState,
  getTransferScheduleAuthority, transferScheduleAuthority } from './store.ts';

const localDate = (now: Date) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const periodOf = (schedule: TransferSchedule) => (schedule.nextEvaluationAt ?? schedule.startDate).slice(0, 7);
const parameters = (schedule: DemoState['transferSchedulePreviews'][number] | TransferSchedule) => TransferScheduleInputSchema.parse(Object.fromEntries(
  Object.keys(TransferScheduleInputSchema.shape).map(key => [key, schedule[key as keyof TransferScheduleInput]])));

/** Titles are normalized classification labels, never substring matches against descriptions.
 * The current transaction contract stores posting dates, so same-day ties use the ID. */
export function matchSalaryEvent(schedule: TransferSchedule, transactions: Transaction[]): Transaction | null {
  if (schedule.trigger.type !== 'salary_event') return null;
  const period = periodOf(schedule);
  const trigger = schedule.trigger;
  const tolerance = Math.min(1000, trigger.toleranceBps);
  return transactions.filter(item => item.accountId === 'checking' && item.sourceKind === 'bank' &&
    item.category === 'income' && ['工资', 'salary'].includes(item.title.normalize('NFKC').trim().toLowerCase()) &&
    item.amountCents >= 765000 && item.amountCents <= 935000 && item.date.slice(0, 7) === period &&
    Math.abs(item.amountCents - trigger.expectedAmountCents) * 10000 <= trigger.expectedAmountCents * tolerance &&
    Number(item.date.slice(8, 10)) >= 23 && Number(item.date.slice(8, 10)) <= 27)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? null;
}

function requireAuthority(sessionId: string, state: DemoState, schedule: TransferSchedule) {
  if (schedule.status !== 'active' || state.goal.status !== 'active' || schedule.goalId !== state.goal.id)
    throw new Error('SCHEDULE_NOT_ACTIVE');
  const preview = state.transferSchedulePreviews.find(item => item.id === schedule.previewId);
  const original = state.approvals.find(item => item.status === 'consumed' && item.action === 'activate_transfer_schedule' &&
    stableHash(item.parameters) === schedule.authorizationHash);
  if (!preview || !original || schedule.authorizationHash !== stableHash(transferScheduleApprovalParameters(preview)) ||
    stableHash(parameters(schedule)) !== stableHash(parameters(preview)) ||
    schedule.authorityContextHash !== preview.authorityContextHash ||
    stableHash(getTransferScheduleAuthority(sessionId, schedule.id)) !== stableHash(transferScheduleAuthority(state, schedule)))
    throw new Error('SCHEDULE_AUTHORITY_CHANGED');
  const trigger = schedule.trigger;
  if (trigger.type !== 'salary_event' || trigger.accountId !== 'checking' || schedule.sourceAccountId !== 'checking' ||
    trigger.expectedAmountCents !== 850000 || trigger.toleranceBps > 1000 || trigger.windowStartDay !== 23 ||
    trigger.graceEndDay !== 27 || trigger.executeOffsetDays !== 1 || !schedule.stopAtGoal)
    throw new Error('SCHEDULE_SALARY_RULE_INVALID');
  return original;
}

function saveOutcome(state: DemoState, schedule: TransferSchedule, execution: TransferExecution, now: Date,
  stop?: TransferSchedule['status']): { state: DemoState; execution: TransferExecution } {
  let nextEvaluationAt = schedule.nextEvaluationAt;
  let status = stop ?? schedule.status;
  if (execution.status !== 'scheduled') {
    const [year, month] = execution.period.split('-').map(Number);
    const nextPeriod = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
    nextEvaluationAt = `${nextPeriod}-23T09:00:00+08:00`;
    if ((execution.status === 'unknown' || execution.status === 'failed') && schedule.status === 'active') status = stop ?? 'paused';
    if (schedule.recurrence === 'one_time' || nextPeriod > (schedule.endDate ?? state.goal.targetDate).slice(0, 7) ||
      state.goal.savedCents >= state.goal.targetCents) status = 'completed';
    if (status !== 'active') nextEvaluationAt = null;
  } else nextEvaluationAt = execution.scheduledAt ?? new Date(now.getTime() + 5000).toISOString();
  return { execution, state: { ...state,
    transferExecutions: [...state.transferExecutions.filter(item => item.id !== execution.id), execution],
    transferSchedules: state.transferSchedules.map(item => item.id === schedule.id ? { ...item, status, nextEvaluationAt,
      updatedAt: now.toISOString() } : item) } };
}

function evaluate(sessionId: string, state: DemoState, scheduleId: string, period: string, now: Date) {
  const schedule = state.transferSchedules.find(item => item.id === scheduleId)!;
  const existing = state.transferExecutions.find(item => item.scheduleId === scheduleId && item.period === period);
  const at = now.toISOString();
  let execution: TransferExecution = existing ?? { id: `schedule:${schedule.id}:${period}`, scheduleId, period,
    status: 'scheduled', amountCents: schedule.amountCents, currency: schedule.currency, operationId: null,
    triggerTransactionId: null, scheduledAt: null, executedAt: null, receiptOperationId: null,
    reason: null, createdAt: at, updatedAt: at };
  const keyedOperation = state.operations.find(item => item.idempotencyKey === execution.id);
  if (existing?.status === 'unknown' || keyedOperation) {
    const operation = keyedOperation ?? state.operations.find(item => item.operationId === execution.operationId);
    const receipt = state.receipts.find(item => item.operationId === operation?.operationId && item.tool === 'execute_transfer' &&
      item.status === 'succeeded' && item.amountCents === execution.amountCents && item.currency === execution.currency);
    // Query the original operation only. An unknown provider result never authorizes resubmission.
    const reconciled = Boolean(receipt && operation?.receipt && operation.receipt.operationId === receipt.operationId);
    execution = { ...execution, status: reconciled ? 'reconciled' : 'unknown', operationId: operation?.operationId ?? execution.operationId,
      receiptOperationId: receipt?.operationId ?? null, reason: reconciled ? 'ORIGINAL_RECEIPT_VERIFIED' : 'RECONCILIATION_REQUIRED', updatedAt: at };
    return saveOutcome(appendAuditEvent(state, 'verify', reconciled ? 'confirmed' : 'unknown', execution.reason!,
      { operationId: operation?.operationId }), schedule, execution, now);
  }
  try {
    const date = localDate(now);
    if (state.goal.savedCents >= state.goal.targetCents || state.goal.status === 'achieved' ||
      date > state.goal.targetDate || date > (schedule.endDate ?? state.goal.targetDate)) {
      execution = { ...execution, status: 'failed', reason: 'SCHEDULE_STOP_CONDITION', updatedAt: at };
      return saveOutcome(appendAuditEvent(state, 'risk', 'stopped', execution.reason!), schedule, execution, now, 'completed');
    }
    const original = requireAuthority(sessionId, state, schedule);
    const candidate = matchSalaryEvent({ ...schedule, nextEvaluationAt: `${period}-23T09:00:00+08:00` },
      state.transactions.filter(item => item.date <= date && item.date <= state.clock));
    const cutoff = new Date(`${period}-28T00:00:00+08:00`);
    if ((!candidate && now >= cutoff) || date.slice(0, 7) > period) {
      execution = { ...execution, status: 'skipped_missing_trigger', reason: 'SALARY_MISSING_SKIP_NO_CATCHUP', updatedAt: at };
      return saveOutcome(appendAuditEvent(state, 'risk', 'skipped', execution.reason!, { approvalId: original.id }), schedule, execution, now);
    }
    if (!candidate) return saveOutcome(state, schedule, execution, now);
    const dueAt = `${shift(candidate.date, 1)}T09:00:00+08:00`;
    execution = { ...execution, triggerTransactionId: candidate.id, scheduledAt: dueAt, updatedAt: at };
    const executionDate = dueAt.slice(0, 10);
    if (executionDate < schedule.startDate || executionDate > (schedule.endDate ?? state.goal.targetDate))
      throw new Error('SCHEDULE_EXECUTION_OUT_OF_SCOPE');
    if (now < new Date(dueAt)) return saveOutcome(state, schedule, execution, now);
    const source = state.accounts.find(item => item.id === schedule.sourceAccountId);
    const destination = state.accounts.find(item => item.id === schedule.destinationAccountId);
    if (!source || !destination || source.type !== 'checking' || destination.type !== 'goal' || source.protected ||
      destination.protected || source.currency !== schedule.currency || destination.currency !== schedule.currency)
      throw new Error('SCHEDULE_ACCOUNT_CHANGED');
    if (Math.min(source.balanceCents, state.finance.checkingCents) < schedule.amountCents) throw new Error('INSUFFICIENT_BALANCE');
    if (source.balanceCents - schedule.amountCents < protectedCheckingReserve(state))
      throw new Error('PROTECTED_FUNDS_UNAVAILABLE');
    if (state.clock !== date || ![source, destination].every(account => state.accountSnapshots.some(item =>
      item.accountId === account.id && item.asOf === date && item.currency === account.currency &&
      item.balanceCents === account.balanceCents && item.twinVersion <= state.twinVersion &&
      ['simulated_connection', 'bank'].includes(item.sourceKind)))) throw new Error('AUTHORITATIVE_BALANCE_REQUIRED');
    // The dated ledger excludes today, so derive a hypothetical post-debit state from the
    // current authoritative balances. Include both this debit and its goal credit exactly once.
    // No account, snapshot or savings mutation is persisted unless the governed execution succeeds.
    const postDebitGoal = { ...state.goal, savedCents: state.goal.savedCents + schedule.amountCents };
    const delta = (accountId: string) => accountId === source.id ? -schedule.amountCents
      : accountId === destination.id ? schedule.amountCents : 0;
    const postDebit = { ...state, goal: postDebitGoal,
      goals: state.goals.map(item => item.id === postDebitGoal.id ? postDebitGoal : item),
      finance: { ...state.finance, checkingCents: state.finance.checkingCents - schedule.amountCents },
      accounts: state.accounts.map(item => ({ ...item, balanceCents: item.balanceCents + delta(item.id) })),
      accountSnapshots: state.accountSnapshots.map(item => item.asOf === date
        ? { ...item, balanceCents: item.balanceCents + delta(item.accountId) } : item) };
    const forecast = buildDatedCashflowForecast(postDebit, { accountId: source.id, horizonEnd: state.goal.targetDate, scenario: 'baseline' });
    if (!forecastHasExecutionAuthority(postDebit, forecast) || forecast.minimumBalanceCents === null ||
      forecast.minimumBalanceCents < protectedCheckingReserve(state))
      throw new Error('SCHEDULE_CASHFLOW_UNSAFE');
    let next = runBankingTool(state, 'prepare_transfer', { sourceAccountId: source.id,
      destinationAccountId: destination.id, amountCents: schedule.amountCents }).state;
    const draft = next.toolRecords.at(-1)!;
    const parameters = { draftId: draft.id, snapshotId: draft.data.snapshotId };
    // Derive this exact child permission from the already consumed recurring authorization.
    // This is delegation within the original scope, not a new user confirmation.
    const derived = createApprovalSnapshot(next, 'execute_transfer', parameters, `${date}T23:59:59.999Z`);
    const token = randomUUID();
    next = { ...derived.state, approvals: derived.state.approvals.map(item => item.id === derived.approval.id
      ? { ...item, status: 'confirmed' as const, token } : item) };
    next = appendAuditEvent(next, 'permission', 'delegated', '原始计划授权覆盖本期固定参数；未请求新的用户确认',
      { approvalId: original.id, requestId: execution.id });
    if (!runBankingTool(next, 'permission_check', { action: 'execute_transfer', parameters, approvalToken: token }).result.allowed ||
      !runBankingTool(next, 'risk_check', { sourceAccountId: source.id, amountCents: schedule.amountCents,
        snapshotId: parameters.snapshotId }).result.allowed) throw new Error('TRANSFER_GOVERNANCE_DENIED');
    const result = runBankingTool(next, 'execute_transfer', { ...parameters, approvalToken: token, idempotencyKey: execution.id });
    next = result.state;
    const operationId = String(result.result.operationId);
    const verified = runBankingTool(next, 'get_operation_status', { operationId }).result;
    if (verified.status !== 'executed' || !next.receipts.some(item => item.operationId === operationId) ||
      next.accounts.find(item => item.id === source.id)?.balanceCents !== source.balanceCents - schedule.amountCents ||
      next.accounts.find(item => item.id === destination.id)?.balanceCents !== destination.balanceCents + schedule.amountCents)
      throw new Error('TRANSFER_VERIFICATION_FAILED');
    const goal = { ...next.goal, savedCents: next.goal.savedCents + schedule.amountCents };
    next = { ...next, goal, goals: next.goals.map(item => item.id === goal.id ? goal : item),
      // Current snapshots reflect the verified simulated ledger change, never an estimated salary credit.
      accountSnapshots: next.accountSnapshots.map(item => item.asOf === date ? { ...item,
        balanceCents: next.accounts.find(account => account.id === item.accountId)?.balanceCents ?? item.balanceCents,
        twinVersion: next.twinVersion } : item) };
    execution = { ...execution, status: 'succeeded', operationId, receiptOperationId: operationId, executedAt: at, updatedAt: at };
    return saveOutcome(next, schedule, execution, now);
  } catch (error) {
    execution = { ...execution, status: 'failed', reason: error instanceof Error ? error.message : 'TRANSFER_FAILED', updatedAt: at };
    let next = state;
    for (const [action, outcome] of [['permission', 'checked'], ['risk', 'failed'], ['execute', 'not_executed'],
      ['verify', 'no_debit'], ['audit', 'recorded']]) next = appendAuditEvent(next, action, outcome, execution.reason!);
    return saveOutcome(next, schedule, execution, now);
  }
}

export function processTransferSchedule(sessionId: string, scheduleId: string, now = new Date()): TransferExecution {
  const state = getState(sessionId);
  const schedule = state.transferSchedules.find(item => item.id === scheduleId);
  if (!schedule) throw new Error('SCHEDULE_NOT_FOUND');
  const currentPeriod = localDate(now).slice(0, 7);
  const executions = state.transferExecutions.filter(item => item.scheduleId === scheduleId)
    .sort((a, b) => b.period.localeCompare(a.period) || b.id.localeCompare(a.id));
  // An unresolved original operation takes precedence over the calendar and lifecycle cursor.
  // Unknown pauses clear nextEvaluationAt, which cannot identify the period to reconcile.
  const unresolved = [...executions].reverse().find(item => item.status === 'unknown' ||
    (item.status !== 'reconciled' && state.operations.some(operation => operation.status === 'unknown' &&
      operation.idempotencyKey === `schedule:${scheduleId}:${item.period}`)));
  const replay = unresolved ?? executions.find(item => item.period === currentPeriod) ??
    (schedule.nextEvaluationAt === null ? executions[0] : undefined);
  if (replay && !unresolved && !['scheduled', 'unknown'].includes(replay.status)) return replay;
  const period = replay?.period ?? periodOf(schedule);
  const token = claimTransferSchedule(sessionId, scheduleId, period, now);
  if (!token) return replay ?? { id: `schedule:${scheduleId}:${period}`, scheduleId, period, status: 'scheduled',
    amountCents: schedule.amountCents, currency: schedule.currency, operationId: null, triggerTransactionId: null,
    scheduledAt: null, executedAt: null, receiptOperationId: null, reason: 'SCHEDULE_LEASE_BUSY',
    createdAt: now.toISOString(), updatedAt: now.toISOString() };
  return commitTransferSchedule(sessionId, scheduleId, period, token, now,
    fresh => evaluate(sessionId, fresh, scheduleId, period, now));
}

export function tickTransferWorker(now?: Date, maxSchedules = 10): number {
  let count = 0;
  const time = new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 23);
  for (const { sessionId, scheduleId } of dueTransferSchedules(now, maxSchedules)) {
    const state = getState(sessionId);
    // Wall-clock interval follows the explicit demo date; explicit test/API clocks retain their time.
    const evaluation = now ?? new Date(`${state.clock}T${time}+08:00`);
    processTransferSchedule(sessionId, scheduleId, evaluation); count++;
  }
  return count;
}
