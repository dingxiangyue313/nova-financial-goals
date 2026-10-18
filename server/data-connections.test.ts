import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from './fixtures.ts';
import {
  connectDataSources,
  ensureDataSync,
  failDataSource,
  recoverDataSource,
  revokeDataSource,
} from './data-connections.ts';

test('connecting selected simulated sources imports 90 days of objective data once', () => {
  const initial = createFixture();
  const first = connectDataSources(initial, ['bank', 'wechat_pay', 'alipay']);

  assert.equal(first.state.dataConnections.length, 3);
  assert.equal(first.state.dataConnections.every(item => item.status === 'connected'), true);
  assert.equal(first.state.dataConnections.every(item => item.permissionScopes.includes('transactions_90_days')), true);
  assert.equal(first.result.importedCount > 0, true);
  assert.equal(first.result.coverageStart, '2026-06-24');
  assert.equal(first.result.coverageEnd, initial.clock);
  assert.equal(first.state.finance.historyMonths, 3);
  assert.equal(first.state.finance.updatedAt, initial.clock);
  assert.equal(first.state.twinVersion, initial.twinVersion + 1);
  assert.equal(first.state.transactions.some(item => item.sourceKind === 'wechat_pay'), true);
  assert.equal(first.state.transactions.some(item => item.sourceKind === 'alipay'), true);
  assert.equal(first.state.transactions.some(item => item.sourceKind === 'bank'), true);

  const replay = ensureDataSync(first.state);
  assert.equal(replay.result.replayed, true);
  assert.equal(replay.result.importedCount, 0);
  assert.equal(replay.state.twinVersion, first.state.twinVersion);
  assert.equal(replay.state.transactions.length, first.state.transactions.length);
});

test('a source connected later receives its own history and reports only its imported rows', () => {
  const bankOnly = connectDataSources(createFixture(), ['bank']).state;
  assert.equal(bankOnly.transactions.filter(item => item.sourceKind === 'wechat_pay').length, 0);

  const withWechat = connectDataSources(bankOnly, ['wechat_pay']);
  const wechat = withWechat.state.dataConnections.find(item => item.source === 'wechat_pay');
  assert.equal(withWechat.state.transactions.filter(item => item.sourceKind === 'wechat_pay').length, 4);
  assert.equal(wechat?.coverageStart, '2026-06-24');
  assert.equal(wechat?.lastSyncedAt, '2026-09-21T12:00:00+08:00');
  assert.equal(withWechat.result.sources.find(item => item.source === 'bank')?.importedCount, 0);
  assert.equal(withWechat.result.sources.find(item => item.source === 'wechat_pay')?.importedCount, 4);
});

test('automatic batches stay quiet before creating one material goal signal', () => {
  const connected = connectDataSources(createFixture(), ['bank', 'wechat_pay', 'alipay']).state;
  const active = { ...connected, goal: { ...connected.goal, status: 'active' as const } };

  const quiet = ensureDataSync({ ...active, clock: '2026-09-22' });
  assert.equal(quiet.result.batchKinds.includes('weekly_trend'), true);
  assert.equal(quiet.state.riskSignals.length, 0);
  assert.equal(quiet.state.spendingPatterns.some(item => item.category === 'subscriptions_demo'), true);

  const material = ensureDataSync({ ...quiet.state, clock: '2026-09-23' });
  assert.equal(material.result.batchKinds.includes('goal_risk'), true);
  assert.equal(material.state.riskSignals.length, 1);
  assert.equal(material.state.pendingImpact?.delayDays, 16);
  assert.deepEqual([...new Set(material.state.riskSignals[0].evidence.map(item => item.sourceKind))], ['wechat_pay']);

  const replay = ensureDataSync(material.state);
  assert.equal(replay.result.replayed, true);
  assert.equal(replay.state.riskSignals.length, 1);
  assert.equal(replay.state.twinVersion, material.state.twinVersion);
});

test('revoking a source keeps imported history but prevents future source batches', () => {
  const connected = connectDataSources(createFixture(), ['bank', 'wechat_pay', 'alipay']).state;
  const importedWechat = connected.transactions.filter(item => item.sourceKind === 'wechat_pay').length;
  const revoked = revokeDataSource(connected, 'wechat_pay');

  assert.equal(revoked.dataConnections.find(item => item.source === 'wechat_pay')?.status, 'revoked');
  assert.equal(revoked.transactions.filter(item => item.sourceKind === 'wechat_pay').length, importedWechat);

  const synced = ensureDataSync({ ...revoked, clock: '2026-09-23', goal: { ...revoked.goal, status: 'active' } }).state;
  assert.equal(synced.transactions.filter(item => item.sourceKind === 'wechat_pay').length, importedWechat);
  assert.equal(synced.dataConnections.find(item => item.source === 'wechat_pay')?.lastSyncedAt,
    revoked.dataConnections.find(item => item.source === 'wechat_pay')?.lastSyncedAt);
});

test('one failed source stays stale while healthy sources continue syncing', () => {
  const connected = connectDataSources(createFixture(), ['bank', 'wechat_pay', 'alipay']).state;
  const failed = failDataSource({ ...connected, goal: { ...connected.goal, status: 'active' } }, 'wechat_pay');
  const previousSuccess = failed.dataConnections.find(item => item.source === 'wechat_pay')?.lastSyncedAt;

  const synced = ensureDataSync({ ...failed, clock: '2026-09-23' });
  const wechat = synced.state.dataConnections.find(item => item.source === 'wechat_pay');

  assert.equal(wechat?.status, 'error');
  assert.equal(wechat?.lastSyncedAt, previousSuccess);
  assert.equal(wechat?.lastAttemptAt, '2026-09-23T12:00:00+08:00');
  assert.equal(wechat?.errorCode, 'SOURCE_TEMPORARILY_UNAVAILABLE');
  assert.equal(synced.result.status, 'partial');
  assert.equal(synced.result.sources.find(item => item.source === 'wechat_pay')?.status, 'failed');
  assert.equal(synced.result.sources.find(item => item.source === 'alipay')?.status, 'synced');
  assert.equal(synced.state.riskSignals.length, 0);
});

test('retry recovers one failed source and catches up material risk exactly once', () => {
  const connected = connectDataSources(createFixture(), ['bank', 'wechat_pay', 'alipay']).state;
  const failed = failDataSource({ ...connected, goal: { ...connected.goal, status: 'active' }, clock: '2026-09-23' }, 'wechat_pay');
  const partial = ensureDataSync(failed).state;

  const recovered = recoverDataSource(partial, 'wechat_pay');
  assert.equal(recovered.result.status, 'completed');
  assert.equal(recovered.result.batchKinds.includes('goal_risk'), true);
  assert.equal(recovered.state.dataConnections.find(item => item.source === 'wechat_pay')?.status, 'connected');
  assert.equal(recovered.state.dataConnections.find(item => item.source === 'wechat_pay')?.errorCode, null);
  assert.equal(recovered.state.riskSignals.length, 1);

  const replay = recoverDataSource(recovered.state, 'wechat_pay');
  assert.equal(replay.result.replayed, true);
  assert.equal(replay.state.riskSignals.length, 1);
  assert.equal(replay.state.transactions.length, recovered.state.transactions.length);
});

test('revoked sources cannot be recovered as a retry', () => {
  const connected = connectDataSources(createFixture(), ['wechat_pay']).state;
  const revoked = revokeDataSource(connected, 'wechat_pay');
  assert.throws(() => recoverDataSource(revoked, 'wechat_pay'), /DATA_CONNECTION_REVOKED/);
});

test('connecting a failed source again clears its temporary error metadata', () => {
  const connected = connectDataSources(createFixture(), ['wechat_pay']).state;
  const failed = failDataSource(connected, 'wechat_pay');
  const reconnected = connectDataSources(failed, ['wechat_pay']).state.dataConnections[0];
  assert.equal(reconnected.status, 'connected');
  assert.equal(reconnected.errorCode, null);
  assert.equal(reconnected.errorMessage, null);
  assert.equal(reconnected.consecutiveFailures, 0);
});

test('any missing source suppresses a new immediate risk and keeps global finance freshness unchanged', () => {
  for (const source of ['bank', 'alipay'] as const) {
    const connected = connectDataSources(createFixture(), ['bank', 'wechat_pay', 'alipay']).state;
    const active = { ...connected, goal: { ...connected.goal, status: 'active' as const } };
    const failed = failDataSource(active, source);
    const synced = ensureDataSync({ ...failed, clock: '2026-09-23' });
    assert.equal(synced.result.status, 'partial');
    assert.equal(synced.state.riskSignals.length, 0, `${source} failure must suppress immediate risk`);
    assert.equal(synced.state.pendingImpact, null);
    assert.equal(synced.state.finance.updatedAt, connected.finance.updatedAt);
  }
});
