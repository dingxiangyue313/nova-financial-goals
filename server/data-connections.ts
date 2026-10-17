import type {
  DataConnection,
  DataSourceKind,
  DataSyncBatch,
  DataSyncResult,
  DemoState,
  Transaction,
} from '../shared/contracts.ts';
import { appendAuditEvent } from './governance.ts';
import { applySpendingTrendDemo, applyWeeklySummaryDemo } from './risk.ts';

export const DATA_SOURCE_LABELS: Record<DataSourceKind, string> = {
  bank: '银行卡',
  wechat_pay: '微信支付',
  alipay: '支付宝',
};

const ALL_SCOPES = ['balances', 'transactions_90_days'] as const;
const DAY = 86_400_000;

function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

function atShanghaiNoon(date: string) { return `${date}T12:00:00+08:00`; }

const historicalTransactions: Transaction[] = [
  { id: 'connected-bank-salary-july', accountId: 'checking', date: '2026-07-01', title: '工资', category: 'income', amountCents: 900000, sourceKind: 'bank', provenance: 'connected_data' },
  { id: 'connected-bank-rent-july', accountId: 'checking', date: '2026-07-05', title: '房租与固定账单', category: 'bills', amountCents: -450000, sourceKind: 'bank', provenance: 'connected_data' },
  { id: 'connected-bank-salary-august', accountId: 'checking', date: '2026-08-01', title: '工资', category: 'income', amountCents: 900000, sourceKind: 'bank', provenance: 'connected_data' },
  { id: 'connected-bank-rent-august', accountId: 'checking', date: '2026-08-05', title: '房租与固定账单', category: 'bills', amountCents: -450000, sourceKind: 'bank', provenance: 'connected_data' },
  { id: 'trend-old-1', accountId: 'checking', date: '2026-06-28', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -30000, sourceKind: 'wechat_pay', provenance: 'connected_data' },
  { id: 'trend-old-2', accountId: 'checking', date: '2026-07-12', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -30000, sourceKind: 'wechat_pay', provenance: 'connected_data' },
  { id: 'trend-previous-1', accountId: 'checking', date: '2026-07-28', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -30000, sourceKind: 'wechat_pay', provenance: 'connected_data' },
  { id: 'trend-previous-2', accountId: 'checking', date: '2026-08-12', title: '外卖与打车', category: 'delivery_and_rides', amountCents: -30000, sourceKind: 'wechat_pay', provenance: 'connected_data' },
  { id: 'weekly-old-1', accountId: 'checking', date: '2026-06-28', title: '数字订阅', category: 'subscriptions_demo', amountCents: -10000, sourceKind: 'alipay', provenance: 'connected_data' },
  { id: 'weekly-old-2', accountId: 'checking', date: '2026-07-12', title: '数字订阅', category: 'subscriptions_demo', amountCents: -10000, sourceKind: 'alipay', provenance: 'connected_data' },
  { id: 'weekly-previous-1', accountId: 'checking', date: '2026-07-28', title: '数字订阅', category: 'subscriptions_demo', amountCents: -10000, sourceKind: 'alipay', provenance: 'connected_data' },
  { id: 'weekly-previous-2', accountId: 'checking', date: '2026-08-12', title: '数字订阅', category: 'subscriptions_demo', amountCents: -10000, sourceKind: 'alipay', provenance: 'connected_data' },
];

function connectedSources(state: DemoState) {
  return new Set(state.dataConnections.filter(item => item.status === 'connected').map(item => item.source));
}

function tagImportedTransactions(state: DemoState): DemoState {
  return {
    ...state,
    transactions: state.transactions.map(item => item.sourceKind ? item : item.id.startsWith('weekly-')
      ? { ...item, sourceKind: 'alipay' as const, provenance: 'connected_data' as const }
      : item.id.startsWith('trend-')
        ? { ...item, sourceKind: 'wechat_pay' as const, provenance: 'connected_data' as const }
        : item),
  };
}

function batch(state: DemoState, kind: DataSyncBatch['kind'], sources: DataSourceKind[], importedCount: number,
  versionBefore: number): DataSyncBatch {
  return {
    id: `sync:${kind}:${state.clock}`,
    dedupeKey: `${kind}:${state.clock}`,
    kind,
    sources,
    status: 'completed',
    importedCount,
    completedAt: atShanghaiNoon(state.clock),
    twinVersionBefore: versionBefore,
    twinVersionAfter: versionBefore + 1,
  };
}

export function ensureDataSync(input: DemoState): { state: DemoState; result: DataSyncResult } {
  const sources = connectedSources(input);
  const existingKeys = new Set(input.dataSyncBatches.map(item => item.dedupeKey));
  const versionBefore = input.twinVersion;
  const beforeIds = new Set(input.transactions.map(item => item.id));
  const completed: DataSyncBatch[] = [];
  let state = input;

  if (!existingKeys.has(`historical:${input.clock}`) && input.dataSyncBatches.every(item => item.kind !== 'historical')) {
    const eligible = historicalTransactions.filter(item => item.sourceKind && sources.has(item.sourceKind));
    const additions = eligible.filter(item => !beforeIds.has(item.id));
    state = { ...state, transactions: [...additions, ...state.transactions], finance: {
      ...state.finance, historyMonths: additions.length ? 3 : state.finance.historyMonths, updatedAt: input.clock,
    } };
    if (eligible.length) completed.push(batch(state, 'historical', [...sources], additions.length, versionBefore));
  }

  if (input.clock >= '2026-09-22' && sources.has('alipay')
      && !input.dataSyncBatches.some(item => item.kind === 'weekly_trend')) {
    const before = state.transactions.length;
    state = tagImportedTransactions(applyWeeklySummaryDemo(state).state);
    completed.push(batch(state, 'weekly_trend', ['alipay'], state.transactions.length - before, versionBefore));
  }

  if (input.clock >= '2026-09-23' && sources.has('wechat_pay')
      && !input.dataSyncBatches.some(item => item.kind === 'goal_risk')) {
    const before = state.transactions.length;
    state = tagImportedTransactions(applySpendingTrendDemo(state).state);
    completed.push(batch(state, 'goal_risk', ['wechat_pay'], state.transactions.length - before, versionBefore));
  }

  const importedCount = completed.reduce((sum, item) => sum + item.importedCount, 0);
  if (!completed.length) return {
    state: input,
    result: { importedCount: 0, replayed: true, batchKinds: [],
      coverageStart: input.dataConnections.find(item => item.status === 'connected')?.coverageStart ?? null,
      coverageEnd: input.dataConnections.find(item => item.status === 'connected')?.coverageEnd ?? null,
      twinVersion: input.twinVersion },
  };

  const twinVersion = versionBefore + 1;
  const syncedAt = atShanghaiNoon(input.clock);
  const coverageStart = addDays(input.clock, -89);
  state = {
    ...state,
    twinVersion,
    finance: { ...state.finance, updatedAt: input.clock },
    dataConnections: state.dataConnections.map(item => item.status === 'connected' ? {
      ...item, lastSyncedAt: syncedAt, coverageStart: item.coverageStart ?? coverageStart, coverageEnd: input.clock,
    } : item),
    dataSyncBatches: [...state.dataSyncBatches, ...completed.map(item => ({ ...item, twinVersionAfter: twinVersion }))],
    riskSignals: state.riskSignals.map(item => item.twinVersion > versionBefore ? { ...item, twinVersion } : item),
  };
  state = appendAuditEvent(state, 'data_sync', 'completed', `自动同步 ${importedCount} 笔模拟流水`);
  return { state, result: { importedCount, replayed: false, batchKinds: completed.map(item => item.kind),
    coverageStart, coverageEnd: input.clock, twinVersion } };
}

export function connectDataSources(input: DemoState, selected: DataSourceKind[]) {
  const unique = [...new Set(selected)];
  if (!unique.length) throw new Error('DATA_SOURCE_REQUIRED');
  const now = atShanghaiNoon(input.clock);
  const bySource = new Map(input.dataConnections.map(item => [item.source, item]));
  const dataConnections = [...bySource.values()].map(item => unique.includes(item.source)
    ? { ...item, status: 'connected' as const, revokedAt: null } : item);
  for (const source of unique) if (!bySource.has(source)) dataConnections.push({
    id: `connection:${source}`, source, label: DATA_SOURCE_LABELS[source], status: 'connected', simulated: true,
    permissionScopes: [...ALL_SCOPES], connectedAt: now, revokedAt: null,
    lastSyncedAt: null, coverageStart: null, coverageEnd: null,
  });
  const connected = appendAuditEvent({ ...input, dataConnections }, 'data_connection', 'connected',
    `已连接 ${unique.map(source => DATA_SOURCE_LABELS[source]).join('、')}模拟数据`);
  return ensureDataSync(connected);
}

export function revokeDataSource(input: DemoState, source: DataSourceKind): DemoState {
  const target = input.dataConnections.find(item => item.source === source);
  if (!target) throw new Error('DATA_CONNECTION_NOT_FOUND');
  if (target.status === 'revoked') return input;
  const next = {
    ...input,
    twinVersion: input.twinVersion + 1,
    dataConnections: input.dataConnections.map(item => item.source === source
      ? { ...item, status: 'revoked' as const, revokedAt: atShanghaiNoon(input.clock) } : item),
  };
  return appendAuditEvent(next, 'data_connection', 'revoked', `已停止 ${DATA_SOURCE_LABELS[source]} 后续同步；历史依据保留`);
}
