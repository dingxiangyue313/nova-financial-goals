import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TransferScheduleInputSchema, TransferSchedulePreviewSchema, TransferScheduleSchema,
  type DemoState, type TransferSchedule, type TransferScheduleInput, type TransferSchedulePreview } from '../shared/contracts.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { buildMoneyMissionPlans, forecastHasExecutionAuthority, minimumAfterContributions } from './money-mission-plans.ts';
import { appendAuditEvent, consumeApproval, stableHash } from './governance.ts';

export const TransferScheduleActivationSchema = z.object({ previewId: z.string().min(1), approvalToken: z.string().min(1) }).strict();
export const TransferScheduleLifecycleSchema = z.object({ scheduleId: z.string().min(1), approvalToken: z.string().min(1) }).strict();
const at = (state: DemoState) => `${state.clock}T12:00:00.000Z`;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const parameters = (value: TransferScheduleInput) => TransferScheduleInputSchema.parse(Object.fromEntries(
  Object.keys(TransferScheduleInputSchema.shape).map(key => [key, value[key as keyof TransferScheduleInput]])));

/** Control-plane changes do not alter the frozen financial authority; every financial input does. */
function contextHash(state: DemoState): string {
  const goal = (item: DemoState['goal']) => ({ id: item.id, savedCents: item.savedCents,
    targetCents: item.targetCents, targetDate: item.targetDate, protectedCents: item.protectedCents,
    monthlyContributionCents: item.monthlyContributionCents, firstMonthContributionCents: item.firstMonthContributionCents,
    selectedPlanId: item.selectedPlanId });
  return stableHash({ clock: state.clock, goal: goal(state.goal), goals: state.goals.map(goal), finance: state.finance,
    ...(state.financialServices.goalContracts.length?{goalContracts:state.financialServices.goalContracts}:{}),
    accounts: state.accounts, snapshots: state.accountSnapshots, transactions: state.transactions,
    bills: state.bills, subscriptions: state.subscriptions, subscriptionActions: state.subscriptionActions,
    receipts: state.receipts.filter(item => !item.tool.includes('transfer_schedule')) });
}

export function transferScheduleApprovalParameters(preview: TransferSchedulePreview): Record<string, unknown> {
  return { previewId: preview.id, ...parameters(preview), authorityContextHash: preview.authorityContextHash,
    occurrences: preview.occurrences, feesCents: 0 };
}

export function transferScheduleLifecycleParameters(schedule: TransferSchedule): Record<string, unknown> {
  return { scheduleId: schedule.id, authorizationHash: schedule.authorizationHash, status: schedule.status,
    parametersHash: stableHash(parameters(schedule)) };
}

export function getTransferScheduleStatus(state: DemoState, scheduleId: string): TransferSchedule {
  const schedule = state.transferSchedules.find(item => item.id === scheduleId);
  if (!schedule) throw new Error('SCHEDULE_NOT_FOUND');
  return schedule;
}

function monthlyDates(input: TransferScheduleInput): string[] {
  const cursor = new Date(`${input.startDate.slice(0, 7)}-01T00:00:00Z`);
  const dates: string[] = [];
  while (cursor.toISOString().slice(0, 10) <= input.endDate!) {
    const year = cursor.getUTCFullYear(); const month = cursor.getUTCMonth();
    const day = input.trigger.type === 'fixed_day' ? input.trigger.day : input.trigger.expectedDay;
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    let date = new Date(Date.UTC(year, month, Math.min(day, last))).toISOString().slice(0, 10);
    if (input.trigger.type === 'salary_event') date = shift(date, input.trigger.executeOffsetDays);
    if (date >= input.startDate && date <= input.endDate!) dates.push(date);
    cursor.setUTCMonth(month + 1);
  }
  return dates;
}

export function simulateTransferSchedule(state: DemoState, raw: TransferScheduleInput): TransferSchedulePreview {
  const input = TransferScheduleInputSchema.parse(raw);
  if (input.twinVersion !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
  if (input.goalId !== state.goal.id || !state.goal.selectedPlanId || !['active', 'paused'].includes(state.goal.status))
    throw new Error('SCHEDULE_PLAN_NOT_SELECTED');
  const source = state.accounts.find(item => item.id === input.sourceAccountId);
  const destination = state.accounts.find(item => item.id === input.destinationAccountId);
  if (!source || !destination) throw new Error('ACCOUNT_NOT_FOUND');
  if (source.protected || destination.protected || source.type === 'emergency' || destination.type === 'emergency')
    throw new Error('PROTECTED_ACCOUNT');
  if (source.id === destination.id || source.type !== 'checking' || destination.type !== 'goal')
    throw new Error('SCHEDULE_INVALID_ACCOUNTS');
  if (source.currency !== input.currency || destination.currency !== input.currency) throw new Error('CURRENCY_MISMATCH');
  if (!input.endDate || input.startDate <= state.clock || input.endDate < input.startDate ||
    input.endDate > state.goal.targetDate || !input.stopAtGoal) throw new Error('SCHEDULE_INVALID_SCOPE');
  if (input.trigger.type === 'salary_event') {
    const trigger = input.trigger;
    const salary = state.transactions.filter(item => item.accountId === source.id && item.sourceKind === 'bank' &&
      item.category === 'income' && item.title === '工资' && item.amountCents > 0 && item.date <= state.clock)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!salary || trigger.accountId !== source.id || trigger.expectedAmountCents !== state.finance.monthlyIncomeCents ||
      trigger.expectedDay !== Number(salary.date.slice(-2)) || trigger.executeOffsetDays !== 1 ||
      trigger.toleranceBps > 1000 || trigger.windowStartDay !== 23 || trigger.graceEndDay !== 27)
      throw new Error('SCHEDULE_SALARY_RULE_INVALID');
  }
  const forecast = buildDatedCashflowForecast(state, { accountId: source.id, horizonEnd: state.goal.targetDate, scenario: 'baseline' });
  if (!forecastHasExecutionAuthority(state, forecast) || forecast.id !== input.forecastId)
    throw new Error('SCHEDULE_FORECAST_STALE');
  const plans = buildMoneyMissionPlans(state, forecast);
  const selected = state.goal.selectedPlanId;
  const exactSelection = plans.filter(item => item.id === selected);
  const resolved = exactSelection.length ? exactSelection : ['custom', 'conservative', 'balanced', 'accelerated'].includes(selected)
    ? plans.filter(item => item.monthlyCents === state.goal.monthlyContributionCents &&
      item.firstMonthContributionCents === state.goal.firstMonthContributionCents) : [];
  if (resolved.length !== 1 || !resolved[0].executable || resolved[0].id !== input.planOptionId)
    throw new Error('SCHEDULE_PLAN_CHANGED');
  const plan = resolved[0];
  if (input.amountCents !== (input.recurrence === 'one_time' && plan.upfrontCents ? plan.upfrontCents : plan.monthlyCents) ||
    input.endDate > plan.projectedDate&&!(input.recurrence==='monthly'&&input.trigger.type==='fixed_day')) throw new Error('SCHEDULE_PLAN_SCOPE_CHANGED');
  const dates = input.recurrence === 'one_time' ? [input.startDate] : monthlyDates(input);
  if (!dates.length || dates[0] !== input.startDate || (input.recurrence === 'monthly' && dates.length !== plan.occurrences) ||
    (input.recurrence === 'one_time' && monthlyDates({ ...input, endDate: input.startDate })[0] !== input.startDate))
    throw new Error('SCHEDULE_INVALID_SCOPE');
  const contributions = dates.map(date => ({ date, amountCents: input.amountCents }));
  const conflicts = (date: string) => [...new Set(forecast.events.filter(event => event.date === date &&
    event.amountCents < 0 && ['bill', 'subscription', 'purchase'].includes(event.kind)).flatMap(event => event.sourceRefs))].sort();
  // Plan comparison replaces a goal's alternatives; schedule creation adds to its existing commitments.
  const minimum = minimumAfterContributions({ ...state, transferSchedules: [] }, forecast, contributions);
  const reserve = Math.max(0, state.goal.protectedCents - state.finance.emergencyCents);
  if (minimum === null || minimum < reserve) throw new Error('PROTECTED_FUNDS_UNAVAILABLE');
  const content = { ...input, precision: 'exact' as const, authorityContextHash: contextHash(state),
    occurrences: contributions.slice(0, 3).map(item => ({ ...item, minimumBalanceCents: minimum, conflicts: conflicts(item.date) })),
    evidenceRefs: [...new Set([forecast.id, plan.id, ...forecast.evidenceRefs])].sort(),
    limitations: [...forecast.limitations, ...(dates.some(date => conflicts(date).length) ? ['SCHEDULE_BILL_CONFLICT'] : []),
      input.trigger.type==='salary_event'?'预览为预计日期；工资须实际验证，缺失时跳过且不补扣；创建计划不执行首笔转账':'按用户指定日期09:00核对余额与授权后执行；不足时不透支，不自动等待工资或补扣；创建时不转账'],
    createdAt: at(state) };
  return TransferSchedulePreviewSchema.parse({ id: `schedule-preview-${stableHash(content)}`, ...content });
}

function nextEvaluation(schedule: TransferScheduleInput): string {
  const date = schedule.trigger.type === 'salary_event'
    ? `${schedule.startDate.slice(0, 7)}-${String(schedule.trigger.windowStartDay).padStart(2, '0')}` : schedule.startDate;
  return `${date}T09:00:00+08:00`;
}

function commitLifecycle(state: DemoState, schedule: TransferSchedule, tool: string, detail: string,
  approvalId: string): { state: DemoState; schedule: TransferSchedule } {
  const operationId = randomUUID();
  const twinVersion = state.twinVersion + 1;
  let next: DemoState = { ...state, twinVersion, transferSchedules: state.transferSchedules.some(item => item.id === schedule.id)
    ? state.transferSchedules.map(item => item.id === schedule.id ? schedule : item) : [...state.transferSchedules, schedule],
    receipts: [...state.receipts, { operationId, tool, status: 'succeeded', amountCents: 0,
      currency: schedule.currency, executedAt: at(state), twinVersion }] };
  for (const [action, outcome, text] of [['permission', 'checked', '固定参数与原始 Approval 已验证'],
    ['risk', 'checked', '账户、预测、保护资金、计划范围与重放检查通过'],
    ['execute', schedule.status, detail], ['verify', 'confirmed', '计划状态已核对；未执行资金划转'],
    ['audit', 'recorded', '计划操作凭证已记录']] as const)
    next = appendAuditEvent(next, action, outcome, text, { operationId, approvalId });
  return { state: next, schedule };
}

function requireSingleMonthly(state: DemoState, input: TransferScheduleInput, except?: string) {
  if (input.recurrence === 'monthly' && state.transferSchedules.some(item => item.id !== except &&
    item.goalId === input.goalId && item.recurrence === 'monthly' && item.status === 'active'))
    throw new Error('SCHEDULE_MONTHLY_ALREADY_ACTIVE');
}

export function activateTransferSchedule(state: DemoState, raw: z.infer<typeof TransferScheduleActivationSchema>) {
  const input = TransferScheduleActivationSchema.parse(raw);
  const preview = state.transferSchedulePreviews.find(item => item.id === input.previewId);
  if (!preview) throw new Error('SCHEDULE_PREVIEW_NOT_FOUND');
  if (state.transferSchedules.some(item => item.previewId === preview.id)) throw new Error('SCHEDULE_PREVIEW_CONSUMED');
  const next = consumeApproval(state, input.approvalToken, 'activate_transfer_schedule', transferScheduleApprovalParameters(preview));
  requireSingleMonthly(state, preview);
  const current = simulateTransferSchedule(state, parameters(preview));
  if (stableHash(current) !== stableHash(preview)) throw new Error('SCHEDULE_PREVIEW_CHANGED');
  if (current.limitations.includes('SCHEDULE_BILL_CONFLICT')) throw new Error('SCHEDULE_BILL_CONFLICT');
  const schedule = TransferScheduleSchema.parse({ ...parameters(preview), id: randomUUID(), previewId: preview.id,
    status: 'active', authorityContextHash: preview.authorityContextHash,
    authorizationHash: stableHash(transferScheduleApprovalParameters(preview)), nextEvaluationAt: nextEvaluation(preview),
    createdAt: at(state), updatedAt: at(state) });
  return commitLifecycle(next, schedule, 'activate_transfer_schedule', '已创建模拟转账计划；首笔尚未执行',
    next.approvals.find(item => item.token === input.approvalToken)!.id);
}

function changeStatus(state: DemoState, raw: z.infer<typeof TransferScheduleLifecycleSchema>, status: 'paused' | 'cancelled') {
  const input = TransferScheduleLifecycleSchema.parse(raw);
  const schedule = getTransferScheduleStatus(state, input.scheduleId);
  const next = consumeApproval(state, input.approvalToken, status === 'paused' ? 'pause_transfer_schedule' : 'cancel_transfer_schedule',
    transferScheduleLifecycleParameters(schedule));
  if (status === 'paused' ? schedule.status !== 'active' : !['active', 'paused'].includes(schedule.status))
    throw new Error('SCHEDULE_INVALID_STATUS');
  return commitLifecycle(next, { ...schedule, status, nextEvaluationAt: null, updatedAt: at(state) },
    status === 'paused' ? 'pause_transfer_schedule' : 'cancel_transfer_schedule', status === 'paused' ? '用户确认暂停计划' : '用户确认取消计划',
    next.approvals.find(item => item.token === input.approvalToken)!.id);
}
export const pauseTransferSchedule = (state: DemoState, input: z.infer<typeof TransferScheduleLifecycleSchema>) => changeStatus(state, input, 'paused');
export const cancelTransferSchedule = (state: DemoState, input: z.infer<typeof TransferScheduleLifecycleSchema>) => changeStatus(state, input, 'cancelled');

export function resumeTransferSchedule(state: DemoState, raw: { scheduleId: string }) {
  const input = z.object({ scheduleId: z.string().min(1) }).strict().parse(raw);
  const schedule = getTransferScheduleStatus(state, input.scheduleId);
  if (schedule.status !== 'paused') throw new Error('SCHEDULE_INVALID_STATUS');
  const preview = state.transferSchedulePreviews.find(item => item.id === schedule.previewId);
  if (!preview || schedule.authorizationHash !== stableHash(transferScheduleApprovalParameters(preview)) ||
    stableHash(parameters(schedule)) !== stableHash(parameters(preview)) ||
    schedule.authorityContextHash !== contextHash(state) || preview.authorityContextHash !== contextHash(state))
    throw new Error('SCHEDULE_AUTHORITY_CHANGED');
  const originalApproval = state.approvals.find(item => item.status === 'consumed' && item.action === 'activate_transfer_schedule' &&
    stableHash(item.parameters) === schedule.authorizationHash);
  if (!originalApproval) throw new Error('APPROVAL_TOKEN_INVALID');
  requireSingleMonthly(state, schedule, schedule.id);
  const currentForecast = buildDatedCashflowForecast(state, { accountId: schedule.sourceAccountId,
    horizonEnd: state.goal.targetDate, scenario: 'baseline' });
  if (!forecastHasExecutionAuthority(state, currentForecast)) throw new Error('SCHEDULE_FORECAST_STALE');
  // Rebuild the original semantic plan, ignoring only this schedule's control-plane version changes.
  const normalized = { ...state, twinVersion: preview.twinVersion,
    transferSchedules: state.transferSchedules.filter(item => item.id !== schedule.id) };
  if (stableHash(simulateTransferSchedule(normalized, parameters(preview))) !== stableHash(preview))
    throw new Error('SCHEDULE_AUTHORITY_CHANGED');
  return commitLifecycle(state, { ...schedule, status: 'active', nextEvaluationAt: nextEvaluation(schedule), updatedAt: at(state) },
    'resume_transfer_schedule', '原始授权范围未改变，已恢复模拟计划', originalApproval.id);
}
