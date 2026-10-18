import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from '../server/fixtures.ts';
import { snapshot } from '../server/presentation.ts';
import { createOfflineSnapshot, OfflineSnapshotSchema } from './offline.ts';

test('offline snapshot keeps only goal assessment and connection freshness', () => {
  const state = createFixture();
  const source = snapshot({
    ...state,
    dataConnections: [{
      id: 'connection:bank', source: 'bank', label: '银行卡', status: 'connected', simulated: true,
      permissionScopes: ['balances', 'transactions_90_days'], connectedAt: '2026-09-21T12:00:00+08:00',
      revokedAt: null, lastSyncedAt: '2026-09-21T12:00:00+08:00', lastAttemptAt: '2026-09-21T12:00:00+08:00',
      coverageStart: '2026-06-24', coverageEnd: '2026-09-21', errorCode: null, errorMessage: null,
      consecutiveFailures: 0,
    }],
  });

  const cached = createOfflineSnapshot(source, '2026-09-21T13:00:00+08:00');
  assert.equal(OfflineSnapshotSchema.safeParse(cached).success, true);
  assert.equal(cached.goal.title, source.goal.title);
  assert.equal(cached.connections[0].simulated, true);
  assert.equal('operations' in cached, false);
  assert.equal('approvals' in cached, false);
  assert.equal('cards' in cached, false);
});
