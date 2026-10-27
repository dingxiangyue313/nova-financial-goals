import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { snapshot } from './presentation.ts';
import type { DemoState } from '../shared/contracts.ts';

const at = '2026-10-26T12:00:00+08:00';
const batch: DemoState['statementImportBatches'][number] = {
  id: 'batch-1', templateId: 'bank-csv-v1', format: 'csv', sourceKind: 'bank', accountId: 'checking',
  status: 'needs_review', coverageStart: '2026-08-01', coverageEnd: '2026-10-26', recordCount: 1,
  importedCount: 0, excludedCount: 0, reviewCount: 1, issueIds: ['issue-1'], createdAt: at, committedAt: null,
};
const issue: DemoState['importIssues'][number] = {
  id: 'issue-1', batchId: batch.id, rowId: 'row-1', field: 'date', kind: 'invalid_date', severity: 'review',
  originalValue: 'private-original-value', correctedValue: '2026-10-26',
};
const row: DemoState['normalizedStatementRows'][number] = {
  id: 'row-1', batchId: batch.id, rowNumber: 1, accountId: 'checking', sourceKind: 'bank', date: '2026-10-26',
  title: 'private-statement-row', merchantId: null, category: 'income', amountCents: 850000, currency: 'CNY',
  confidence: 0.5, issueIds: [issue.id], excludedReason: null,
  originalValues: { date: 'private-original-value' }, correctedValues: { date: '2026-10-26' },
};
const evidence: DemoState['evidenceRefs'][number] = {
  id: 'evidence-1', claimType: 'fact', sourceKind: 'import_batch', sourceId: batch.id,
  dataAsOf: '2026-10-26', label: 'Imported history', confidence: 0.5,
};
const action: DemoState['subscriptionActions'][number] = {
  id: 'action-1', subscriptionId: 'cloudbox-plus', merchantId: 'cloudbox', action: 'cancel',
  status: 'prepared', monthlyCents: 6800, paidThrough: '2026-11-04', effectiveAt: '2026-11-05',
  nextChargeSuppressed: false, refundCents: 0, twinVersion: 1, actionHash: 'hash-1',
  merchantOperationId: null, receiptOperationId: null, evidenceRefs: [evidence.id], createdAt: at, updatedAt: at,
};
const schedule: DemoState['transferSchedules'][number] = {
  id: 'schedule-1', previewId: 'preview-1', goalId: 'goal-japan-2027', planOptionId: null,
  sourceAccountId: 'checking', destinationAccountId: 'goal-wallet', amountCents: 100000, currency: 'CNY',
  recurrence: 'monthly', trigger: { type: 'fixed_day', day: 26 }, startDate: '2026-11-26',
  endDate: '2027-06-26', stopAtGoal: true, forecastId: 'forecast-1', twinVersion: 1,
  status: 'draft', authorizationHash: 'authorization-hash', nextEvaluationAt: null, createdAt: at, updatedAt: at,
};
const execution: DemoState['transferExecutions'][number] = {
  id: 'execution-1', scheduleId: schedule.id, period: '2026-11', status: 'scheduled', amountCents: 100000,
  currency: 'CNY', operationId: null, triggerTransactionId: null, scheduledAt: null,
  executedAt: null, receiptOperationId: null, reason: null, createdAt: at, updatedAt: at,
};
const artifactTables = ['statement_import_batches', 'statement_import_issues', 'evidence_refs',
  'subscription_actions', 'transfer_schedules', 'transfer_executions'];

const childMode = process.env.NOVA_MONEY_STORE_TEST_CHILD;
if (childMode) {
  if (childMode === 'legacy') {
    const database = new DatabaseSync(process.env.NOVA_DB_PATH!);
    database.exec(`CREATE TABLE demo_sessions (
      id TEXT PRIMARY KEY, state_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    ); CREATE TABLE legacy_marker (id TEXT PRIMARY KEY, value TEXT);`);
    const legacy = { ...createJapanMoneyMissionFixture() } as Record<string, unknown>;
    for (const key of ['accountSnapshots', 'statementImportBatches', 'importIssues', 'normalizedStatementRows',
      'evidenceRefs', 'billBriefs', 'subscriptionActions', 'datedCashflowForecasts', 'goalPlanOptions',
      'transferSchedulePreviews', 'transferSchedules', 'transferExecutions', 'handoffCasePacks']) delete legacy[key];
    const serialized = JSON.stringify(legacy);
    database.prepare('INSERT INTO demo_sessions VALUES(?,?,7,?)').run('legacy', serialized, at);
    database.prepare('INSERT INTO legacy_marker VALUES(?,?)').run('marker', 'preserved');
    const schemaBefore = database.prepare("SELECT sql,rootpage FROM sqlite_master WHERE name='demo_sessions'").get();
    const store = await import('./store.ts');
    assert.deepEqual(store.getState('legacy').statementImportBatches, []);
    assert.deepEqual(store.listStatementImportBatches('legacy'), []);
    assert.deepEqual(database.prepare("SELECT sql,rootpage FROM sqlite_master WHERE name='demo_sessions'").get(), schemaBefore);
    assert.deepEqual({ ...database.prepare('SELECT * FROM demo_sessions WHERE id=?').get('legacy') },
      { id: 'legacy', state_json: serialized, version: 7, updated_at: at });
    assert.equal(database.prepare('SELECT value FROM legacy_marker').get()!.value, 'preserved');
    for (const table of artifactTables)
      assert.ok(database.prepare('SELECT name FROM sqlite_master WHERE type=? AND name=?').get('table', table), table);
    store.closeStore();
    database.close();
  } else {
    const store = await import('./store.ts');
    if (childMode === 'seed') {
      assert.equal(typeof store.saveStatementImportPreview, 'function', 'missing Money Mission persistence accessor');
      store.mutateState('session-a', () => createJapanMoneyMissionFixture());
      const saved = store.saveStatementImportPreview('session-a', { batch: { ...batch, rawFile: Buffer.from('private-file-buffer'),
        parserDebug: 'private-parser-debug' }, issues: [issue], rows: [row] });
      assert.deepEqual(saved, batch);
      assert.equal(store.getStatementImportBatch('session-a', batch.id).id, batch.id);
      assert.throws(() => store.getStatementImportBatch('session-b', batch.id), /IMPORT_BATCH_NOT_FOUND/);
      assert.deepEqual(store.listStatementImportBatches('session-b'), []);
      store.saveEvidenceRefs('session-a', [evidence]);
      store.saveSubscriptionAction('session-a', action);
      store.saveTransferSchedule('session-a', schedule);
      store.saveTransferExecution('session-a', execution);
      store.saveStatementImportPreview('session-b', { batch: { ...batch, status: 'ready' }, issues: [], rows: [] });
      store.saveEvidenceRefs('session-b', [{ ...evidence, label: 'Other session' }]);
      store.saveSubscriptionAction('session-b', { ...action, status: 'cancelled' });
      store.saveTransferSchedule('session-b', { ...schedule, status: 'paused' });
      store.saveTransferExecution('session-b', { ...execution, status: 'failed' });
      assert.throws(() => store.saveStatementImportPreview('session-a', {
        batch: { ...batch, status: 'committed' }, issues: [{ ...issue, severity: 'invalid' }], rows: [row],
      }));
      assert.throws(() => store.saveEvidenceRefs('session-a', [{ ...evidence, id: 'partial-evidence' },
        { ...evidence, confidence: 2 }]));
      assert.throws(() => store.saveSubscriptionAction('session-a', { ...action, monthlyCents: -1 }));
      assert.throws(() => store.saveTransferSchedule('session-a', { ...schedule, amountCents: 0 }));
      assert.throws(() => store.saveTransferExecution('session-a', { ...execution, period: 'invalid' }));
      assert.equal(store.getStatementImportBatch('session-a', batch.id).status, 'needs_review');
    } else if (childMode === 'reopen') {
      const state = store.getState('session-a');
      assert.deepEqual(store.getStatementImportBatch('session-a', batch.id), batch);
      assert.deepEqual(store.listStatementImportBatches('session-a'), [batch]);
      assert.deepEqual(state.statementImportBatches, [batch]);
      assert.deepEqual(state.importIssues, [issue]);
      assert.deepEqual(state.normalizedStatementRows, [row]);
      assert.deepEqual(state.evidenceRefs, [evidence]);
      assert.deepEqual(state.subscriptionActions, [action]);
      assert.deepEqual(state.transferSchedules, [schedule]);
      assert.deepEqual(state.transferExecutions, [execution]);
      assert.equal(store.getStatementImportBatch('session-b', batch.id).status, 'ready');
      assert.equal(store.getState('session-b').evidenceRefs[0].label, 'Other session');
      assert.equal(store.getState('session-b').subscriptionActions[0].status, 'cancelled');
      assert.equal(store.getState('session-b').transferSchedules[0].status, 'paused');
      assert.equal(store.getState('session-b').transferExecutions[0].status, 'failed');
      const database = new DatabaseSync(process.env.NOVA_DB_PATH!);
      for (const table of artifactTables) {
        const records = database.prepare(`SELECT payload_json FROM ${table} WHERE session_id=?`).all('session-a');
        assert.equal(records.length, 1, table);
        assert.equal(JSON.stringify(records).includes('private-file-buffer'), false);
        assert.equal(JSON.stringify(records).includes('private-parser-debug'), false);
      }
      store.mutateState('session-a', current => ({ ...current, subscriptionActions: [{ ...action, status: 'succeeded' }] }));
      assert.equal(JSON.parse(String(database.prepare('SELECT payload_json FROM subscription_actions WHERE session_id=?').get('session-a')!.payload_json)).status, 'succeeded');
      store.resetState('session-a');
      assert.deepEqual(store.listStatementImportBatches('session-a'), []);
      assert.throws(() => store.getStatementImportBatch('session-a', batch.id), /IMPORT_BATCH_NOT_FOUND/);
      for (const table of artifactTables)
        assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id=?`).get('session-a')!.count, 0, table);
      assert.equal(store.listStatementImportBatches('session-b').length, 1);
      database.close();
    }
    store.closeStore();
  }
} else {
  function runChild(mode: string, databasePath: string) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', new URL(import.meta.url).pathname], {
      env: { ...process.env, NOVA_DB_PATH: databasePath, NOVA_MONEY_STORE_TEST_CHILD: mode }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${mode}: ${result.stdout}\n${result.stderr}`);
  }

  test('Money Mission artifacts survive store reopen and stay session scoped', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova-money-store-'));
    try {
      const databasePath = join(directory, 'mission.sqlite');
      runChild('seed', databasePath);
      runChild('reopen', databasePath);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('legacy state_json rows migrate additively without rewriting existing tables or rows', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova-money-legacy-'));
    try { runChild('legacy', join(directory, 'legacy.sqlite')); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('Snapshot publishes validated Money Mission artifacts without raw rows, buffers, tokens or parser diagnostics', () => {
    const state = createJapanMoneyMissionFixture();
    state.statementImportBatches = [{ ...batch, rawFile: Buffer.from('private-file-buffer'), parserDebug: 'private-parser-debug' } as typeof batch];
    state.importIssues = [issue];
    state.normalizedStatementRows = [row];
    state.evidenceRefs = [evidence];
    state.subscriptionActions = [{ ...action, token: 'private-approval-token' } as typeof action];
    state.transferSchedules = [schedule];
    state.transferExecutions = [execution];
    state.approvals = [{ id: 'approval-1', action: 'transfer', parameters: { amountCents: 100000 },
      twinVersion: 1, snapshotHash: 'snapshot-hash', expiresAt: at, status: 'confirmed', token: 'private-live-token' }];
    const view = snapshot(state);
    assert.deepEqual(view.accountSnapshots.map(item => item.balanceCents), [724000, 2000000, 200000]);
    assert.deepEqual(view.statementImportBatches, [batch]);
    assert.deepEqual(view.evidenceRefs, [evidence]);
    assert.deepEqual(view.subscriptionActions, [action]);
    assert.deepEqual(view.transferSchedules, [schedule]);
    assert.deepEqual(view.transferExecutions, [execution]);
    assert.equal(view.approvalSummaries[0].id, 'approval-1');
    const serialized = JSON.stringify(view);
    for (const secret of ['private-file-buffer', 'private-parser-debug', 'private-approval-token', 'private-live-token',
      'private-original-value', 'private-statement-row', 'normalizedStatementRows', 'importIssues'])
      assert.equal(serialized.includes(secret), false, secret);
  });
}
