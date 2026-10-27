import type { CashflowEdit, DatedCashflowForecast, DemoState } from '../shared/contracts.ts';
import { stableHash } from './governance.ts';
import { validDate } from './statement-parser.ts';

export function monthDate(year: number, month: number, day: number) {
  const last = new Date(Date.UTC(year,month + 1,0)).getUTCDate(); return new Date(Date.UTC(year,month,Math.min(day,last))).toISOString().slice(0,10);
}
export const addIsoDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0,10);
export function buildDatedCashflowForecast(state: DemoState, input: { accountId: string; horizonEnd: string; scenario: 'baseline' | 'stress' | 'edited'; edits?: CashflowEdit[]; contributionCents?: number; contributionOverrides?: Record<string, number> }): DatedCashflowForecast {
  if (!validDate(input.horizonEnd) || input.horizonEnd < state.clock || input.horizonEnd > addIsoDays(state.clock,366)) throw new Error('INVALID_FORECAST_HORIZON');
  const account = state.accounts.find(a => a.id === input.accountId); if (!account) throw new Error('ACCOUNT_NOT_FOUND');
  if (account.currency !== 'CNY') throw new Error('CURRENCY_MISMATCH');
  if (account.protected || account.type !== 'checking') throw new Error('PROTECTED_ACCOUNT');
  const snapshot = state.accountSnapshots.filter(s => s.accountId === account.id && s.confirmed && s.currency === account.currency && s.asOf <= state.clock).sort((a,b) => b.asOf.localeCompare(a.asOf) || b.twinVersion - a.twinVersion)[0];
  const freshConnection = state.dataConnections.some(c => c.source === 'bank' && c.status === 'connected' && c.permissionScopes.includes('balances'));
  const precision = !snapshot ? 'insufficient_balance' : snapshot.asOf === state.clock && snapshot.balanceCents === account.balanceCents && state.finance.checkingCents === account.balanceCents && (snapshot.source === 'user_confirmed' || freshConnection) ? 'exact' : 'range';
  const limitations = ['仅预测已知账单和已声明假设，未知支出可能改变结果。', '转入日期是假设工资按时到账的预览，实际执行仍需验证到账。'];
  const assumptions = ['工资通常25日到账；未来工资为假设。', '日内先考虑已知支出，再考虑收入和目标转入。', '核心应急金不进入活期预测。'];
  type Event = Omit<DatedCashflowForecast['events'][number], 'balanceCents'>;
  const events = new Map<string,Event>();
  const put = (event: Event) => { if (event.date > state.clock && event.date <= input.horizonEnd) events.set(event.id,event); };
  const base = { accountId: account.id,currency: account.currency,claimType: 'prediction' as const };
  const start = new Date(`${state.clock}T00:00:00Z`); const end = new Date(`${input.horizonEnd}T00:00:00Z`);
  for (let cursor = new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),1)); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const year = cursor.getUTCFullYear(), month = cursor.getUTCMonth(), period = monthDate(year,month,1).slice(0,7);
    put({ ...base,id:`salary:${period}`,date:monthDate(year,month,25),label:'工资',priority:20,amountCents:state.finance.monthlyIncomeCents,claimType:'assumption',sourceRefs:['finance:monthlyIncomeCents'] });
    for (const bill of state.bills) {
      const dueDate = bill.recurrence === 'monthly' ? monthDate(year,month,Number(bill.dueDate.slice(8))) : bill.dueDate;
      if (bill.recurrence !== 'monthly' && (bill.paid || dueDate.slice(0,7) !== period)) continue;
      put({ ...base,id:`bill:${bill.id}:${bill.recurrence === 'monthly' ? period : dueDate}`,date:dueDate,label:bill.title,priority:10,amountCents:-bill.amountCents,sourceRefs:[bill.id] });
    }
    for (const sub of state.subscriptions) {
      const cancelled = state.subscriptionActions.some(a => a.subscriptionId === sub.id && a.action === 'cancel' && ['succeeded','reconciled'].includes(a.status) && a.nextChargeSuppressed && a.effectiveAt <= monthDate(year,month,Number(sub.nextChargeDate.slice(8))));
      const dueDate = monthDate(year,month,Number(sub.nextChargeDate.slice(8)));
      if (cancelled || dueDate < sub.nextChargeDate || (sub.cadence === 'annual' && dueDate.slice(5,7) !== sub.nextChargeDate.slice(5,7))) continue;
      put({ ...base,id:`subscription:${sub.id}:${period}`,date:dueDate,label:sub.title,priority:10,amountCents:-sub.monthlyCents,sourceRefs:[sub.id] });
    }
  }
  if ((input.edits?.length ?? 0) > 40) throw new Error('INVALID_FORECAST_EDITS');
  for (const [index, edit] of (input.edits ?? []).entries()) {
    if (edit.currency !== account.currency) throw new Error('CURRENCY_MISMATCH');
    if (!validDate(edit.date) || !Number.isSafeInteger(edit.amountCents)) throw new Error('INVALID_FORECAST_EDIT');
    if (edit.operation === 'remove' || edit.operation === 'replace') { if (!edit.eventId || !events.has(edit.eventId)) throw new Error('DATA_EVENT_NOT_FOUND'); events.delete(edit.eventId); }
    if (edit.operation !== 'remove') put({ ...base,id:edit.eventId ?? `edit:${index}`,date:edit.date,label:edit.label,amountCents:edit.amountCents,priority:edit.amountCents < 0 ? 10 : 20,claimType:'assumption',sourceRefs:[`user-edit:${index}`] });
  }
  const activeSchedules = state.transferSchedules.filter(s => s.status === 'active' && s.sourceAccountId === account.id);
  const contributions = input.contributionCents !== undefined
    ? [...activeSchedules.filter(s => s.goalId !== state.goal.id), { id: 'preview', amountCents: input.contributionCents, endDate: state.goal.targetDate, goalId: state.goal.id }]
    : activeSchedules;
  for (const plan of contributions) {
    const goal = state.goals.find(goal => goal.id === plan.goalId);
    let gap = Math.max(0, Math.min(goal?.targetCents ?? 0, 'targetCents' in plan ? plan.targetCents : goal?.targetCents ?? 0) - (goal?.savedCents ?? 0));
    const fixedDay = 'trigger' in plan && plan.trigger.type === 'fixed_day' ? plan.trigger.expectedDay : null;
    const dates = fixedDay === null
      ? [...events.values()].filter(event => event.id.startsWith('salary:') && Number(event.date.slice(8)) <= 27).map(event => addIsoDays(event.date, 1))
      : Array.from({ length: 14 }, (_, index) => monthDate(start.getUTCFullYear(), start.getUTCMonth() + index, fixedDay));
    for (const date of dates.sort()) {
      if (date <= state.clock || date > input.horizonEnd || date > plan.endDate || gap <= 0 || plan.amountCents <= 0) continue;
      if ('frequency' in plan && plan.frequency === 'one_time') continue; // Confirmed one-time transfers have already changed authoritative balances.
      const periodKey = `schedule:${plan.id}:${date.slice(0, 7)}`;
      if (state.transferExecutions.some(execution => execution.periodKey === periodKey)) continue;
      const requestedAmount = plan.id === 'preview' ? input.contributionOverrides?.[date.slice(0, 7)] ?? plan.amountCents : plan.amountCents;
      if (!Number.isSafeInteger(requestedAmount) || requestedAmount < 0) throw new Error('INVALID_CONTRIBUTION');
      const amount = Math.min(requestedAmount, gap); gap -= amount;
      if (amount === 0) continue;
      put({ ...base, id: `transfer:${periodKey}`, date, label: fixedDay === null ? '旅行金转入（需工资实际到账）' : '目标转入（固定日期）', priority: 30, amountCents: -amount, sourceRefs: [plan.id] });
    }
  }
  if (input.scenario === 'stress') {
    const nextSalary = [...events.values()].filter(e => e.id.startsWith('salary:')).sort((a,b) => a.date.localeCompare(b.date))[0];
    const date = nextSalary ? addIsoDays(nextSalary.date,-1) : addIsoDays(state.clock,1);
    put({ ...base,id:'stress:essential-spending',date,label:'压力情景：额外必要支出',priority:10,amountCents:-50000,claimType:'assumption',sourceRefs:['scenario:essential-spending-500'] });
    assumptions.push('压力情景额外增加一次¥500必要支出。');
  }
  let balance = snapshot?.balanceCents ?? 0, minimum = balance, minimumDate = state.clock;
  const ledger = [...events.values()].sort((a,b) => a.date.localeCompare(b.date) || a.priority-b.priority || a.id.localeCompare(b.id)).map(e => { balance += e.amountCents; if (balance < minimum) { minimum = balance; minimumDate = e.date; } return { ...e,balanceCents:balance }; });
  if (precision !== 'exact') limitations.push('没有足够新鲜的权威余额；本预测不能用于执行转账。');
  return { forecastId: precision === 'exact' ? `forecast:${stableHash([state.twinVersion,snapshot,input]).slice(0,32)}` : null,twinVersion:state.twinVersion,accountId:account.id,horizonEnd:input.horizonEnd,scenario:input.scenario,precision,minimumBalanceCents:snapshot ? minimum : null,minimumBalanceDate:snapshot ? minimumDate : null,events:ledger,assumptions,limitations,dataAsOf:snapshot?.asOf ?? state.finance.updatedAt };
}
