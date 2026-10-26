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

function sourceResults(state: DemoState, completed: DataSyncBatch[]) {
  return state.dataConnections.map(connection => {
    const importedCount = completed.filter(item => item.sources.includes(connection.source))
      .reduce((sum, item) => sum + item.importedCount, 0);
    if (connection.status === 'revoked') return { source: connection.source, status: 'skipped' as const, importedCount: 0, errorCode: null };
    if (connection.status === 'error') return { source: connection.source, status: 'failed' as const, importedCount: 0,
      errorCode: connection.errorCode || 'SOURCE_TEMPORARILY_UNAVAILABLE' };
    return { source: connection.source, status: completed.some(item => item.sources.includes(connection.source)) ? 'synced' as const : 'unchanged' as const,
      importedCount, errorCode: null };
  });
}

function resultStatus(results: ReturnType<typeof sourceResults>, completed: DataSyncBatch[]) {
  const failed = results.filter(item => item.status === 'failed').length;
  const healthy = results.filter(item => item.status === 'synced' || item.status === 'unchanged').length;
  if (failed && healthy) return 'partial' as const;
  if (failed) return 'failed' as const;
  return completed.length ? 'completed' as const : 'unchanged' as const;
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
  const sourceKey = sources.length === 1 ? `:${sources[0]}` : '';
  return {
    id: `sync:${kind}${sourceKey}:${state.clock}`,
    dedupeKey: `${kind}${sourceKey}:${state.clock}`,
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
  if (input.mission) return { state: input, result: { importedCount: 0, replayed: true, status: 'unchanged', sources: input.dataConnections.map(c => ({ source: c.source, status: 'unchanged', importedCount: 0, errorCode: null })), batchKinds: [], coverageStart: '2026-05-01', coverageEnd: input.finance.updatedAt, twinVersion: input.twinVersion } };
  const sources = connectedSources(input);
  const versionBefore = input.twinVersion;
  const beforeIds = new Set(input.transactions.map(item => item.id));
  const completed: DataSyncBatch[] = [];
  let state = input;
  const hasIncompleteSource = input.dataConnections.some(item => item.status !== 'connected');

  for (const source of sources) {
    const eligible = historicalTransactions.filter(item => item.sourceKind === source);
    const hasImportedHistory = eligible.every(item => beforeIds.has(item.id));
    if (hasImportedHistory || !eligible.length) continue;
    const additions = eligible.filter(item => !beforeIds.has(item.id));
    additions.forEach(item => beforeIds.add(item.id));
    state = { ...state, transactions: [...additions, ...state.transactions], finance: {
      ...state.finance, historyMonths: additions.length ? 3 : state.finance.historyMonths,
      updatedAt: hasIncompleteSource ? input.finance.updatedAt : input.clock,
    } };
    completed.push(batch(state, 'historical', [source], additions.length, versionBefore));
  }

  if (input.clock >= '2026-09-22' && sources.has('alipay')
      && !input.dataSyncBatches.some(item => item.kind === 'weekly_trend')) {
    const before = state.transactions.length;
    state = tagImportedTransactions(applyWeeklySummaryDemo(state).state);
    completed.push(batch(state, 'weekly_trend', ['alipay'], state.transactions.length - before, versionBefore));
  }

  if (input.clock >= '2026-09-23' && !hasIncompleteSource && sources.has('wechat_pay')
      && !input.dataSyncBatches.some(item => item.kind === 'goal_risk')) {
    const before = state.transactions.length;
    state = tagImportedTransactions(applySpendingTrendDemo(state).state);
    completed.push(batch(state, 'goal_risk', ['wechat_pay'], state.transactions.length - before, versionBefore));
  }

  const importedCount = completed.reduce((sum, item) => sum + item.importedCount, 0);
  const syncedAt = atShanghaiNoon(input.clock);
  const coverageStart = addDays(input.clock, -89);
  const attemptedConnections = state.dataConnections.map(item => item.status === 'revoked' ? item : item.status === 'error'
    ? { ...item, lastAttemptAt: syncedAt }
    : { ...item, lastAttemptAt: syncedAt, lastSyncedAt: syncedAt, coverageStart: item.coverageStart ?? coverageStart,
      coverageEnd: input.clock, errorCode: null, errorMessage: null, consecutiveFailures: 0 });
  const outcomes = sourceResults({ ...state, dataConnections: attemptedConnections }, completed);
  if (!completed.length) return {
    state: { ...state, dataConnections: attemptedConnections },
    result: { importedCount: 0, replayed: true, status: resultStatus(outcomes, completed), sources: outcomes, batchKinds: [],
      coverageStart: attemptedConnections.find(item => item.status === 'connected')?.coverageStart ?? null,
      coverageEnd: attemptedConnections.find(item => item.status === 'connected')?.coverageEnd ?? null,
      twinVersion: input.twinVersion },
  };

  const twinVersion = versionBefore + 1;
  state = {
    ...state,
    twinVersion,
    finance: { ...state.finance, updatedAt: hasIncompleteSource ? input.finance.updatedAt : input.clock },
    dataConnections: attemptedConnections,
    dataSyncBatches: [...state.dataSyncBatches, ...completed.map(item => ({ ...item, twinVersionAfter: twinVersion }))],
    riskSignals: state.riskSignals.map(item => item.twinVersion > versionBefore ? { ...item, twinVersion } : item),
  };
  state = appendAuditEvent(state, 'data_sync', 'completed', `自动同步 ${importedCount} 笔模拟流水`);
  return { state, result: { importedCount, replayed: false, status: resultStatus(outcomes, completed), sources: outcomes,
    batchKinds: completed.map(item => item.kind),
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
    lastSyncedAt: null, lastAttemptAt: null, coverageStart: null, coverageEnd: null,
    errorCode: null, errorMessage: null, consecutiveFailures: 0,
  });
  const connected = appendAuditEvent({ ...input, dataConnections }, 'data_connection', 'connected',
    `已连接 ${unique.map(source => DATA_SOURCE_LABELS[source]).join('、')}模拟数据`);
  return ensureDataSync(connected);
}

export function failDataSource(input: DemoState, source: DataSourceKind): DemoState {
  const target = input.dataConnections.find(item => item.source === source);
  if (!target) throw new Error('DATA_CONNECTION_NOT_FOUND');
  if (target.status === 'revoked') throw new Error('DATA_CONNECTION_REVOKED');
  if (target.status === 'error') return input;
  const next = {
    ...input,
    dataConnections: input.dataConnections.map(item => item.source === source ? {
      ...item,
      status: 'error' as const,
      lastAttemptAt: atShanghaiNoon(input.clock),
      errorCode: 'SOURCE_TEMPORARILY_UNAVAILABLE',
      errorMessage: '模拟数据来源暂时无法连接，请稍后重试。',
      consecutiveFailures: item.consecutiveFailures + 1,
    } : item),
  };
  return appendAuditEvent(next, 'data_connection', 'failed', `${DATA_SOURCE_LABELS[source]}模拟数据暂时无法更新`);
}

export function recoverDataSource(input: DemoState, source: DataSourceKind) {
  const target = input.dataConnections.find(item => item.source === source);
  if (!target) throw new Error('DATA_CONNECTION_NOT_FOUND');
  if (target.status === 'revoked') throw new Error('DATA_CONNECTION_REVOKED');
  const recovered = target.status === 'error' ? appendAuditEvent({
    ...input,
    dataConnections: input.dataConnections.map(item => item.source === source ? {
      ...item, status: 'connected' as const, errorCode: null, errorMessage: null, consecutiveFailures: 0,
    } : item),
  }, 'data_connection', 'recovered', `${DATA_SOURCE_LABELS[source]}模拟数据连接已恢复`) : input;
  return ensureDataSync(recovered);
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
