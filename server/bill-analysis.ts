import type { BillBrief, DemoState, EvidenceRef, NormalizedStatementRow } from '../shared/contracts.ts';
import { activeStatementRows } from './statement-import.ts';
import { stableHash } from './governance.ts';
import { validDate } from './statement-parser.ts';

const sumExpense = (rows: NormalizedStatementRow[]) => -rows.filter(r => r.amountCents < 0 && r.excludedReason === null).reduce((sum, r) => sum + r.amountCents, 0);
const safeTitle = (row: NormalizedStatementRow) => /ignore|instruction|token|api.?key|system.?prompt|忽略.*指令|密钥/i.test(row.title) ? '待核对商户' : row.title;
export function inspectEvidence(state: DemoState, evidenceId: string): EvidenceRef {
  const row = activeStatementRows(state).find(r => `evidence:${r.id}` === evidenceId);
  if (row) return { id: evidenceId, claimType: 'fact', sourceKind: 'transaction', sourceId: row.id, dataAsOf: state.clock, label: `${row.date} · ${safeTitle(row)}`, confidence: row.confidence, transactionIds: [row.id], sourceRefs: [row.id] };
  const stored = state.evidenceRefs.find(e => e.id === evidenceId);
  if (!stored || stored.transactionIds.some(id => !activeStatementRows(state).some(r => r.id === id))) throw new Error('EVIDENCE_NOT_FOUND');
  return stored;
}
export function buildBillBrief(state: DemoState, input: { periodStart: string; periodEnd: string }): BillBrief {
  if (!validDate(input.periodStart) || !validDate(input.periodEnd) || input.periodStart > input.periodEnd) throw new Error('INVALID_BILL_PERIOD');
  const all = activeStatementRows(state); const rows = all.filter(r => r.date >= input.periodStart && r.date <= input.periodEnd);
  const expenses = rows.filter(r => !r.excludedReason && r.amountCents < 0);
  const categoryNames = [...new Set(expenses.map(r => r.category))];
  const categories = categoryNames.map(category => { const selected = expenses.filter(r => r.category === category); return { category, amountCents: sumExpense(selected), count: selected.length, evidenceIds: selected.map(r => `evidence:${r.id}`) }; }).sort((a, b) => b.amountCents - a.amountCents);
  const limitations = ['账单是历史证据，不修改当前余额。', '交易记录不能推断服务使用频率，也不能证明欺诈。'];
  if (input.periodEnd > state.clock) limitations.push('报告请求包含未来日期；仅汇总当前已覆盖的历史记录。');
  const baselineMonths = ['2026-05', '2026-06', '2026-07'];
  const baselineComplete = baselineMonths.every(month => all.some(r => r.date.startsWith(month) && r.category === 'dining_delivery'));
  const changes: BillBrief['changes'] = [];
  if (baselineComplete && input.periodStart.slice(0, 7) === input.periodEnd.slice(0, 7) && input.periodStart > '2026-07-31') {
    const historical = all.filter(r => baselineMonths.includes(r.date.slice(0, 7)) && r.category === 'dining_delivery');
    const current = expenses.filter(r => r.category === 'dining_delivery'); const baselineCents = Math.round(sumExpense(historical) / 3), currentCents = sumExpense(current);
    changes.push({ category: 'dining_delivery', baselineCents, currentCents, increaseCents: currentCents - baselineCents, evidenceIds: [...historical, ...current].map(r => `evidence:${r.id}`) });
  } else limitations.push('可比的5–7月基线不完整，或报告不是单月，不生成月均差额结论。');
  const groups = new Map<string, NormalizedStatementRow[]>();
  for (const row of all.filter(r => !r.excludedReason && r.amountCents < 0)) {
    const key = row.merchantId ?? `merchant-${stableHash(safeTitle(row)).slice(0, 12)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const subscriptionCandidates: BillBrief['subscriptionCandidates'] = [];
  for (const [merchantId, charges] of groups) {
    const sorted = charges.sort((a, b) => a.date.localeCompare(b.date)); const distinctMonths = new Set(sorted.map(r => r.date.slice(0, 7)));
    if (distinctMonths.size < 3 || sorted.length !== distinctMonths.size || !sorted.some(r => r.category === 'subscription')) continue;
    if (sorted.slice(1).some((r, i) => { const gap = (Date.parse(r.date) - Date.parse(sorted[i].date)) / 86400000; return gap < 24 || gap > 40; })) continue;
    const last = sorted.at(-1)!; const known = state.subscriptions.find(s => s.title === last.title);
    const next = new Date(`${last.date}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
    subscriptionCandidates.push({ id: merchantId === 'cloudbox-plus' ? 'cloudbox' : merchantId, merchantId, title: safeTitle(last), monthlyCents: -last.amountCents, nextChargeDate: known?.nextChargeDate ?? next.toISOString().slice(0, 10), confidence: .9, wording: '可能是订阅；请确认是否仍需使用，交易记录无法反映实际使用情况。', evidenceIds: sorted.map(r => `evidence:${r.id}`) });
  }
  const claim = (claimType: EvidenceRef['claimType'], label: string, refs: string[]): EvidenceRef => ({ id: `claim:${stableHash([claimType,label,refs,state.twinVersion]).slice(0,24)}`, claimType, sourceKind: claimType === 'fact' ? 'system_calculated' : 'user_assumption', sourceId: 'bill-brief', dataAsOf: state.clock, label, confidence: claimType === 'fact' ? 1 : .7, transactionIds: refs.filter(r => r.startsWith('evidence:')).map(r => r.slice(9)), sourceRefs: refs.length ? refs : ['data-coverage'] });
  const totalExpenseCents = sumExpense(expenses);
  const claims = [claim('fact', `本期计入消费 ${totalExpenseCents} 分`, expenses.map(r => `evidence:${r.id}`)), claim('limitation', limitations.join(' '), ['data-coverage'])];
  if (subscriptionCandidates.length) claims.push(claim('assumption', '周期扣费可能是订阅，使用情况仍需用户核实。', subscriptionCandidates.flatMap(s => s.evidenceIds)));
  for (const change of changes) claims.push(claim('fact', `餐饮较基线增加 ${change.increaseCents} 分`, change.evidenceIds));
  return { id: `brief:${stableHash([input,state.twinVersion]).slice(0,24)}`, twinVersion: state.twinVersion, ...input, dataAsOf: state.clock, totalExpenseCents, categories, changes, subscriptionCandidates, claims, limitations };
}
