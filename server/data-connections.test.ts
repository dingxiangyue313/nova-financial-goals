import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from './fixtures.ts';
import {
  connectDataSources,
  ensureDataSync,
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
