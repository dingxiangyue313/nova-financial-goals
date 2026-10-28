import { createHash } from 'node:crypto';
import { DatedCashflowForecastInputSchema, DatedCashflowForecastSchema,
  type CashflowEdit, type DatedCashflowForecast, type DatedCashflowForecastInput, type DemoState } from '../shared/contracts.ts';
import { subscriptionSavingsEligible } from './subscription-service.ts';

export type { CashflowEdit } from '../shared/contracts.ts';
type Event = DatedCashflowForecast['events'][number];
const DAY = 86_400_000;
const timestamp = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const shift = (date: string, days: number) => iso(timestamp(date) + days * DAY);
const unique = (values: string[]) => [...new Set(values)].sort();
const priority = (kind: Event['kind'], amount: number) => amount >= 0 ? 100
  : ({ bill: 10, subscription: 20, purchase: 30, transfer: 40, income: 50 })[kind];

function integer(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error('FORECAST_INVALID_CENTS');
  return value;
}

/** Clamp each occurrence from the original day, never from a previously clamped month. */
function monthlyDates(start: string, end: string, day: number): string[] {
  const result: string[] = [];
  const cursor = new Date(timestamp(`${start.slice(0, 7)}-01`));
  while (iso(cursor.getTime()) <= end) {
    const year = cursor.getUTCFullYear(); const month = cursor.getUTCMonth();
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const date = iso(Date.UTC(year, month, Math.min(day, last)));
    if (date >= start && date <= end) result.push(date);
    cursor.setUTCMonth(month + 1);
  }
  return result;
}

/** A deterministic simulation ledger; exact refers to arithmetic under the surfaced assumptions. */
export function buildDatedCashflowForecast(state: DemoState, rawInput: DatedCashflowForecastInput): DatedCashflowForecast {
  const input = DatedCashflowForecastInputSchema.parse(rawInput);
  if (input.horizonEnd < state.clock || timestamp(input.horizonEnd) - timestamp(state.clock) > 366 * DAY)
    throw new Error('FORECAST_INVALID_HORIZON');
  const account = state.accounts.find(item => item.id === input.accountId);
  if (!account) throw new Error('ACCOUNT_NOT_FOUND');
  if (account.protected || account.type === 'emergency') throw new Error('PROTECTED_ACCOUNT');
  // Legacy bills and income are CNY checking-account obligations, with no FX or wallet ownership metadata.
  if (account.currency !== 'CNY') throw new Error('CURRENCY_MISMATCH');
  if (account.type !== 'checking') throw new Error('FORECAST_UNSUPPORTED_ACCOUNT');
  const snapshots = state.accountSnapshots.filter(item => item.accountId === account.id && item.asOf <= state.clock)
    .sort((a, b) => b.asOf.localeCompare(a.asOf) || b.twinVersion - a.twinVersion || b.createdAt.localeCompare(a.createdAt)
      || a.id.localeCompare(b.id));
  const snapshot = snapshots[0];
  if (snapshot && snapshot.currency !== account.currency) throw new Error('CURRENCY_MISMATCH');
  const current = snapshot && snapshot.asOf === state.clock && snapshot.twinVersion <= state.twinVersion &&
    snapshot.balanceCents === account.balanceCents;
  const startingBalanceCents = current ? integer(snapshot.balanceCents) : null;
  const assumptions = ['只预测工资卡；独立应急金和目标钱包余额不计入可用资金',
    '当前余额已包含基准日收支；未来未付账单和订阅按原始日期每月重复，月底不足原日则取当月末日',
    '同日先支出后收入，同类按事件 ID 排序；最低余额包含日内事件顺序'];
  const limitations = ['模拟日期与金额是确定性假设，不保证未来到账、扣款或执行',
    '未记录的消费、账户间资金流和汇率变化未纳入；历史流水不能推算当前余额'];
  if (!current) limitations.push('缺少与当前账户一致的当日权威余额快照；只展示事件范围，不提供可执行预测');
  const evidenceRefs = new Set<string>(['finance']);
  if (current) { evidenceRefs.add(snapshot.id); evidenceRefs.add(snapshot.sourceId); }
  const ledger = new Map<string, Event>();
  const add = (event: Omit<Event, 'priority'>) => {
    integer(event.amountCents);
    const normalized = { ...event, priority: priority(event.kind, event.amountCents), sourceRefs: unique(event.sourceRefs) };
    const previous = ledger.get(event.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new Error('FORECAST_CONFLICTING_EVENT');
    ledger.set(event.id, normalized);
  };
  const nextDay = shift(state.clock, 1);
  // Add a month's lookahead so delaying a month-end salary cannot discard its source occurrence.
  const generationEnd = shift(input.horizonEnd, 31);
  for (const bill of state.bills.filter(item => !item.paid)) {
    if (bill.amountCents < 0) throw new Error('FORECAST_INVALID_CENTS');
    for (const date of monthlyDates(bill.dueDate, generationEnd, Number(bill.dueDate.slice(-2))))
      add({ id: `bill-${bill.id}-${date}`, date, label: bill.title,
        kind: bill.id === 'daily-purchase' ? 'purchase' : 'bill', amountCents: -bill.amountCents, sourceRefs: [bill.id] });
  }
  for (const subscription of state.subscriptions) {
    const verified = state.subscriptionActions.filter(action => action.subscriptionId === subscription.id &&
      subscriptionSavingsEligible(state, action.id)).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.id.localeCompare(b.id));
    for (const action of verified) {
      evidenceRefs.add(action.id); action.evidenceRefs.forEach(ref => evidenceRefs.add(ref));
      if (action.merchantOperationId) evidenceRefs.add(action.merchantOperationId);
    }
    for (const date of monthlyDates(subscription.nextChargeDate, generationEnd, Number(subscription.nextChargeDate.slice(-2)))) {
      if (verified.some(action => date >= action.effectiveAt)) continue;
      add({ id: `subscription-${subscription.id}-${date}`, date, label: subscription.title, kind: 'subscription',
        amountCents: -subscription.monthlyCents, sourceRefs: [subscription.id] });
    }
  }
  const salaryRecords = state.transactions.filter(item => item.accountId === account.id &&
    item.sourceKind === 'bank' && item.category === 'income' && item.title === '工资' && item.amountCents > 0);
  const salaries = salaryRecords.filter(item => item.date <= state.clock)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const salary = salaries[0]; const salaryDay = salary ? Number(salary.date.slice(-2)) : 25;
  assumptions.push(`预计工资每月 ${salaryDay} 日到账，金额 ${integer(state.finance.monthlyIncomeCents)} 分，收入来源与日期沿用当前模拟资料`);
  if (!salary) limitations.push('缺少可验证的银行工资记录；工资日暂按每月 25 日假设');
  const delay = input.scenario === 'stress' ? 3 : 0;
  if (delay) assumptions.push('压力情景假设每次工资延迟 3 个自然日，不代表概率或实际入账');
  for (const date of monthlyDates(nextDay, generationEnd, salaryDay)) {
    if (salaryRecords.some(item => item.date > state.clock && item.date.slice(0, 7) === date.slice(0, 7))) continue;
    add({ id: `salary-${date}`, date: shift(date, delay), label: '工资', kind: 'income',
      amountCents: state.finance.monthlyIncomeCents, sourceRefs: salary ? ['finance', salary.id] : ['finance'] });
  }
  const importedIds = new Set(state.normalizedStatementRows.map(item => item.id));
  for (const transaction of state.transactions.filter(item => item.accountId === account.id && item.date > state.clock))
    add({ id: `transaction-${transaction.id}`, date: transaction.date,
      label: importedIds.has(transaction.id) ? '已确认账单交易' : transaction.title,
      kind: transaction.amountCents >= 0 ? 'income' : 'purchase', amountCents: transaction.amountCents, sourceRefs: [transaction.id] });
  const edited = new Set<string>();
  const applyEdit = (edit: CashflowEdit): boolean => {
    if (edit.type === 'add') {
      if (edit.event.currency !== account.currency) throw new Error('CURRENCY_MISMATCH');
      if (ledger.has(edit.event.id)) throw new Error('FORECAST_DUPLICATE_EDIT');
      const { currency: _currency, ...event } = edit.event; add(event);
    } else {
      const previous = ledger.get(edit.eventId); if (!previous) return false;
      ledger.delete(edit.eventId);
      if (edit.type === 'update') add({ ...previous, date: edit.date ?? previous.date,
        amountCents: edit.amountCents ?? previous.amountCents });
    }
    return true;
  };
  const deferred: CashflowEdit[] = [];
  for (const edit of input.edits ?? []) {
    const id = edit.type === 'add' ? edit.event.id : edit.eventId;
    if (edited.has(id)) throw new Error('FORECAST_DUPLICATE_EDIT');
    edited.add(id);
    const editedDate = edit.type === 'add' ? edit.event.date : edit.type === 'update' ? edit.date : undefined;
    if (editedDate && editedDate <= state.clock) throw new Error('FORECAST_EDIT_DATE');
    if (!applyEdit(edit)) deferred.push(edit);
  }
  // Income/date hypotheses must be applied before deriving salary-triggered transfers.
  for (const schedule of state.transferSchedules.filter(item => item.status === 'active' && item.sourceAccountId === account.id)) {
    if (schedule.currency !== account.currency) throw new Error('CURRENCY_MISMATCH');
    const end = schedule.endDate && schedule.endDate < generationEnd ? schedule.endDate : generationEnd;
    let dates: string[];
    if (schedule.recurrence === 'one_time') dates = [schedule.startDate];
    else if (schedule.trigger.type === 'fixed_day') dates = monthlyDates(schedule.startDate, end, schedule.trigger.day);
    else {
      const trigger = schedule.trigger;
      dates = [...ledger.values()].filter(event => event.kind === 'income' && event.label === '工资' &&
        trigger.accountId === account.id && Number(event.date.slice(-2)) >= trigger.windowStartDay &&
        Number(event.date.slice(-2)) <= trigger.graceEndDay &&
        Math.abs(event.amountCents - trigger.expectedAmountCents) * 10000 <= trigger.expectedAmountCents * trigger.toleranceBps)
        .map(event => shift(event.date, trigger.executeOffsetDays));
      assumptions.push('工资触发的转入日只是预测；实际转入仍须验证银行工资事件，缺失时跳过');
    }
    const goal = state.goals.find(item => item.id === schedule.goalId);
    let remaining = schedule.stopAtGoal && goal ? Math.max(0, goal.targetCents - goal.savedCents) : Number.MAX_SAFE_INTEGER;
    for (const date of unique(dates).filter(date => date >= nextDay && date >= schedule.startDate && date <= end)) {
      const amountCents = Math.min(schedule.amountCents, remaining);
      if (!amountCents) break;
      add({ id: `transfer-${schedule.id}-${date}`, date, label: '目标转入', kind: 'transfer', amountCents: -amountCents,
        sourceRefs: [schedule.id, schedule.forecastId] });
      remaining -= amountCents;
    }
  }
  for (const edit of deferred) if (!applyEdit(edit)) throw new Error('FORECAST_EDIT_EVENT_NOT_FOUND');
  if (edited.size) assumptions.push('用户编辑仅用于当前情景假设，未更改账单、商户状态或已授权计划');
  const events = [...ledger.values()].filter(event => event.date > state.clock && event.date <= input.horizonEnd)
    .sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority || a.id.localeCompare(b.id));
  events.forEach(event => event.sourceRefs.forEach(ref => evidenceRefs.add(ref)));
  for (const ref of state.evidenceRefs) if (evidenceRefs.has(ref.sourceId)) evidenceRefs.add(ref.id);
  let balance = startingBalanceCents; let minimumBalanceCents = balance;
  let minimumBalanceDate = balance === null ? null : state.clock;
  const dailyBalances: DatedCashflowForecast['dailyBalances'] = [];
  if (balance !== null) {
    let eventIndex = 0;
    for (let time = timestamp(state.clock); time <= timestamp(input.horizonEnd); time += DAY) {
      const date = iso(time);
      while (events[eventIndex]?.date === date) {
        balance = integer(balance + events[eventIndex++].amountCents);
        if (balance < minimumBalanceCents!) { minimumBalanceCents = balance; minimumBalanceDate = date; }
      }
      dailyBalances.push({ date, balanceCents: balance });
    }
  }
  const content = { accountId: account.id, currency: account.currency, twinVersion: state.twinVersion,
    dataAsOf: current ? snapshot.asOf : state.finance.updatedAt, horizonStart: state.clock, horizonEnd: input.horizonEnd,
    scenario: input.scenario, precision: current ? 'exact' as const : 'range' as const,
    startingBalanceCents, minimumBalanceCents, minimumBalanceDate, events, dailyBalances,
    evidenceRefs: unique([...evidenceRefs]), assumptions: unique(assumptions), limitations: unique(limitations),
    createdAt: `${state.clock}T12:00:00.000Z` };
  const id = `forecast-${createHash('sha256').update(JSON.stringify(content)).digest('hex')}`;
  return DatedCashflowForecastSchema.parse({ id, executableForecastId: current ? id : null, ...content });
}
