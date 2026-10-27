import type { DemoState, NormalizedStatementRow } from '../shared/contracts.ts';
import { createMissionFixture } from './mission.ts';

export const CATEGORY_MAP: Record<string, string> = { 餐饮: 'dining_delivery', 住房: 'housing', 交通: 'transport', 购物: 'shopping', 订阅: 'subscription', 水电: 'utilities', 保险: 'insurance', 工资: 'income', 退款: 'refund', 内部转账: 'internal_transfer', 待核对: 'unclassified' };
export function createJapanMoneyMissionFixture(includeHistory = true): DemoState {
  const old = createMissionFixture();
  const rows: NormalizedStatementRow[] = old.mission!.rows.map(row => ({
    id: row.id, externalId: row.id, accountId: 'checking', currency: 'CNY', date: row.date, title: row.merchant,
    merchantId: row.merchant === 'CloudBox Plus' ? 'cloudbox-plus' : row.category === '工资' ? 'salary' : null,
    amountCents: row.cents, category: CATEGORY_MAP[row.category], originalCategory: row.category,
    sourceKind: row.source === '银行卡' ? 'bank' : row.source === '微信' ? 'wechat_pay' : 'alipay',
    rawDescription: row.merchant, confidence: 1, batchId: 'bundled-history',
    excludedReason: row.category === '工资' ? 'income' : row.category === '内部转账' ? 'internal_transfer' : row.excluded ? 'refund_match' : null,
  }));
  return {
    ...old,
    accounts: old.accounts.map(a => a.id==='goal-wallet' ? {...a,goalId:old.goal.id} : a),
    bills: [['rent','房租',1,280000],['purchase','日常采购',8,30000],['utilities','水电',10,42000],['transport','交通',15,20000],['insurance','保险',18,28000]].map(([id,title,day,amount]) => ({ id: String(id), title: String(title), dueDate: `2026-11-${String(day).padStart(2,'0')}`,amountCents: Number(amount),paid: false,recurrence: 'monthly' as const })),
    accountSnapshots: old.accounts.filter(a => a.currency === 'CNY').map(a => ({ id: `snapshot-${a.id}`, accountId: a.id, balanceCents: a.balanceCents, currency: a.currency, asOf: old.clock, source: 'simulated_connection', confirmed: true, twinVersion: old.twinVersion })),
    normalizedStatementRows: includeHistory ? rows : [],
    statementImportBatches: includeHistory ? [{ id: 'bundled-history', templateId: 'nova-synthetic-v1', format: 'csv', status: 'committed', coverageStart: '2026-05-01', coverageEnd: '2026-10-26', recordCount: rows.length, duplicateCount: 0, issueIds: [], rowIds: rows.map(r => r.id), createdAt: '2026-10-26T12:00:00+08:00', committedAt: '2026-10-26T12:00:00+08:00', twinVersion: old.twinVersion }] : [],
    transactions: includeHistory ? old.transactions : [],
    mission: { ...old.mission!, artifactsVersion:2, rows: includeHistory ? old.mission!.rows : [], batches: includeHistory ? old.mission!.batches : [] },
  };
}
