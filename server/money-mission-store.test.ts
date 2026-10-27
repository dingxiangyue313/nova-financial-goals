import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { getStatementImportBatch, listStatementImportBatches, saveStatementImportPreview, mutateState, getState } from './store.ts';
import { snapshot } from './presentation.ts';

test('import artifacts persist and cannot cross sessions or survive reset as active evidence', () => {
  const a = randomUUID(), b = randomUUID();
  const state = createJapanMoneyMissionFixture(); const batch = { ...state.statementImportBatches[0], id: randomUUID(), status: 'preview' as const };
  saveStatementImportPreview(a, batch);
  assert.equal(getStatementImportBatch(a, batch.id).id, batch.id);
  assert.equal(listStatementImportBatches(a).length, 1);
  assert.throws(() => getStatementImportBatch(b, batch.id), /IMPORT_BATCH_NOT_FOUND/);
  assert.equal(getState(a).statementImportBatches[0].status, 'preview');
  mutateState(a, old => ({ ...old, statementImportBatches: [] }));
  assert.throws(() => getStatementImportBatch(a, batch.id), /IMPORT_BATCH_NOT_FOUND/);
});
test('safe snapshots exclude raw parser evidence and all approval tokens', () => {
  const state = createJapanMoneyMissionFixture(); state.normalizedStatementRows[0].rawDescription = 'PRIVATE_RAW_DESCRIPTION';
  assert.equal(JSON.stringify(snapshot(state)).includes('PRIVATE_RAW_DESCRIPTION'), false);
});
