import test from 'node:test';
import assert from 'node:assert/strict';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { parseStatementBuffer } from './statement-parser.ts';
import { previewStatementImport, resolveImportIssue, commitStatementImport as confirmImport, revokeStatementImport } from './statement-import.ts';
import { stableHash, verifyAuditChain } from './governance.ts';
import { DemoStateSchema, type DemoState } from '../shared/contracts.ts';

const reviewedHash = (state: DemoState, id: string) => stableHash({
  batch: state.statementImportBatches.find(batch => batch.id === id),
  rows: state.normalizedStatementRows.filter(row => row.batchId === id),
  issues: state.importIssues.filter(issue => issue.batchId === id),
});
const commitStatementImport = (state: DemoState, id: string, version: number, hash = reviewedHash(state, id)) =>
  confirmImport(state, id, version, hash);

async function preview(text = '2026-08-01,Cafe,-12.34') {
  return previewStatementImport(createJapanMoneyMissionFixture(), await parseStatementBuffer({
    buffer: Buffer.from(`date,description,amount\n${text}`), fileName: 'history.csv', mimeType: 'text/csv', templateId: 'bank-csv-v1' }));
}

test('confirmation rejects changed reviewed import contents without partial state', async () => {
  const result = await preview('2026-08-01,Cafe,wrong');
  const issue = result.issues[0];
  const reviewed = resolveImportIssue(result.state, result.batch.id, issue.id, { correctedValue: -100 });
  const reviewedHash = stableHash({ batch: reviewed.statementImportBatches[0], rows: reviewed.normalizedStatementRows,
    issues: reviewed.importIssues });
  assert.equal(commitStatementImport(reviewed, result.batch.id, reviewed.twinVersion, reviewedHash).transactions.at(-1)?.amountCents, -100);
  const changed = resolveImportIssue(reviewed, result.batch.id, issue.id, { correctedValue: -99999 });
  const before = structuredClone(changed);
  assert.throws(() => commitStatementImport(changed, result.batch.id, reviewed.twinVersion, reviewedHash), /IMPORT_CONTENT_CHANGED/);
  assert.deepEqual(changed, before);
});

test('overlapping imports deduplicate refunded retained evidence and ignore revoked batches', async () => {
  const first = await preview('2026-08-01,Cafe,-12.34\n2026-08-02,Refund: Cafe,12.34');
  const committed = commitStatementImport(first.state, first.batch.id, 1);
  const debit = await parseStatementBuffer({ buffer: Buffer.from('date,description,amount\n2026-08-01,Cafe,-12.34'),
    fileName: 'overlap.csv', mimeType: 'text/csv', templateId: 'bank-csv-v1' });
  const overlapping = previewStatementImport(committed, debit);
  const second = commitStatementImport(overlapping.state, overlapping.batch.id, 2);
  assert.equal(second.transactions.length, 1);
  assert.equal(second.statementImportBatches.find(batch => batch.id === overlapping.batch.id)?.excludedCount, 1);
  assert.equal(second.normalizedStatementRows.length, 3);
  const revoked = revokeStatementImport(committed, first.batch.id, 2);
  const fresh = previewStatementImport(revoked, debit);
  const third = commitStatementImport(fresh.state, fresh.batch.id, 3);
  assert.equal(third.transactions.length, 2);
  assert.equal(third.statementImportBatches.find(batch => batch.id === fresh.batch.id)?.excludedCount, 0);
});

test('refunds reconcile across committed batches and revocation restores the surviving debit', async () => {
  const first = await preview(); const committed = commitStatementImport(first.state, first.batch.id, 1);
  const refund = await parseStatementBuffer({ buffer: Buffer.from('date,description,amount\n2026-08-02,Refund: Cafe,12.34'),
    fileName: 'refund.csv', mimeType: 'text/csv', templateId: 'bank-csv-v1' });
  const next = previewStatementImport(committed, refund);
  assert.deepEqual(next.state.transactions, committed.transactions, 'preview must not modify authoritative history');
  assert.deepEqual(next.state.normalizedStatementRows[0], committed.normalizedStatementRows[0]);
  const refunded = commitStatementImport(next.state, next.batch.id, 2);
  assert.equal(refunded.transactions.length, 1);
  assert.equal(refunded.normalizedStatementRows.filter(row => row.excludedReason === 'refund_match').length, 2);
  const restored = revokeStatementImport(refunded, next.batch.id, 3);
  assert.deepEqual(restored.transactions, committed.transactions);
  assert.equal(restored.normalizedStatementRows.find(row => row.batchId === first.batch.id)?.excludedReason, null);
  assert.equal(restored.statementImportBatches.find(batch => batch.id === first.batch.id)?.importedCount, 1);
});

test('an older preview cannot take transaction ownership from a batch committed before it', async () => {
  const early = await preview('2026-08-01,Cafe,wrong');
  const parsed = await parseStatementBuffer({ buffer: Buffer.from('date,description,amount\n2026-08-01,Cafe,-12.34'),
    fileName: 'later.csv', mimeType: 'text/csv', templateId: 'bank-csv-v1' });
  const later = previewStatementImport(early.state, parsed);
  const committedFirst = commitStatementImport(later.state, later.batch.id, 1);
  const correctedEarly = resolveImportIssue(committedFirst, early.batch.id, early.issues[0].id, { correctedValue: -1234 });
  const final = commitStatementImport(correctedEarly, early.batch.id, 2);
  assert.deepEqual(final.transactions, committedFirst.transactions);
  assert.equal(final.statementImportBatches.find(batch => batch.id === early.batch.id)?.excludedCount, 1);
});

test('commit imports history without changing authoritative balances and increments Twin exactly once', async () => {
  const { state, batch } = await preview(); const before = structuredClone(state);
  const committed = commitStatementImport(state, batch.id, state.twinVersion);
  assert.equal(committed.accounts.find(x => x.id === 'checking')?.balanceCents, 724000);
  assert.equal(committed.finance.checkingCents, 724000);
  assert.equal(committed.goal.savedCents, 200000);
  assert.equal(committed.transactions.length, before.transactions.length + 1);
  assert.equal(committed.twinVersion, before.twinVersion + 1);
  assert.deepEqual(state, before);
  assert.deepEqual(commitStatementImport(committed, batch.id, state.twinVersion, reviewedHash(state, batch.id)), committed);
  assert.throws(() => commitStatementImport(committed, batch.id, state.twinVersion, 'wrong'), /IMPORT_CONTENT_CHANGED/);
  assert.equal(verifyAuditChain(committed.audit), true);
  assert.deepEqual(committed.audit.slice(-5).map(x => x.action), ['permission', 'risk', 'execute', 'verify', 'audit']);
  assert.ok(committed.evidenceRefs.length >= 2);
  assert.deepEqual(DemoStateSchema.parse(committed), committed);
});

test('blocking issues require valid corrections, retain originals, and changed Twin rejects commit', async () => {
  const { state, batch, issues } = await preview('2026-02-30,Cafe,wrong');
  assert.throws(() => commitStatementImport(state, batch.id, state.twinVersion), /IMPORT_UNRESOLVED/);
  const dateIssue = issues.find(x => x.kind === 'invalid_date')!;
  const amountIssue = issues.find(x => x.kind === 'invalid_amount')!;
  assert.throws(() => resolveImportIssue(state, batch.id, dateIssue.id, { correctedValue: '2026-02-30' }), /IMPORT_INVALID_RESOLUTION/);
  let corrected = resolveImportIssue(state, batch.id, dateIssue.id, { correctedValue: '2026-08-01' });
  corrected = resolveImportIssue(corrected, batch.id, amountIssue.id, { correctedValue: -1234 });
  assert.equal(corrected.normalizedStatementRows[0].originalValues.amount, 'wrong');
  assert.equal(corrected.normalizedStatementRows[0].correctedValues.amountCents, -1234);
  assert.throws(() => commitStatementImport({ ...corrected, twinVersion: 2 }, batch.id, 1), /TWIN_VERSION_CHANGED/);
  const committed = commitStatementImport(corrected, batch.id, 1);
  assert.equal(committed.transactions.at(-1)?.amountCents, -1234);
  assert.throws(() => resolveImportIssue(committed, batch.id, dateIssue.id, { correctedValue: '2026-09-01' }), /IMPORT_NOT_EDITABLE/);
});

test('duplicates, matched refunds and internal transfers preserve evidence without inflating spending', async () => {
  const { state, batch } = await preview('2026-08-01,Cafe,-12.34\n2026-08-01,Cafe,-12.34\n2026-08-02,Refund: Cafe,12.34\n2026-08-03,Internal transfer,-100.00\n2026-08-04,Transport,-20.00');
  const committed = commitStatementImport(state, batch.id, 1);
  assert.equal(committed.transactions.length, 2);
  assert.equal(committed.transactions.at(-1)?.amountCents, -2000);
  assert.equal(committed.normalizedStatementRows.length, 5);
  assert.equal(committed.statementImportBatches[0].excludedCount, 4);
  assert.equal(committed.evidenceRefs.length, 6);
});

test('revoke removes only its batch transactions and replay leaves version unchanged', async () => {
  const { state, batch } = await preview();
  const committed = commitStatementImport(state, batch.id, 1);
  const revoked = revokeStatementImport(committed, batch.id, 2);
  assert.deepEqual(revoked.transactions, state.transactions);
  assert.equal(revoked.normalizedStatementRows.length, 1);
  assert.equal(revoked.evidenceRefs.length, committed.evidenceRefs.length);
  assert.deepEqual(revokeStatementImport(revoked, batch.id, 2), revoked);
  assert.deepEqual(revoked.accounts, state.accounts);
  assert.throws(() => commitStatementImport(revoked, batch.id, 3), /IMPORT_NOT_READY/);
});

test('foreign session batch and issue identifiers fail closed', async () => {
  const first = await preview(); const second = await preview('bad,Cafe,wrong');
  assert.throws(() => commitStatementImport(second.state, first.batch.id, 1), /IMPORT_BATCH_NOT_FOUND/);
  assert.throws(() => revokeStatementImport(second.state, first.batch.id, 1), /IMPORT_BATCH_NOT_FOUND/);
  assert.throws(() => resolveImportIssue(first.state, first.batch.id, second.issues[0].id, { correctedValue: '2026-08-01' }), /IMPORT_ISSUE_NOT_FOUND/);
});

test('a second identical import detects transactions already committed to the same account', async () => {
  const first = await preview(); const committed = commitStatementImport(first.state, first.batch.id, 1);
  const parsed = await parseStatementBuffer({ buffer: Buffer.from('date,description,amount\n2026-08-01,Cafe,-12.34'),
    fileName: 'again.csv', mimeType: 'text/csv', templateId: 'bank-csv-v1' });
  const second = previewStatementImport(committed, parsed);
  const result = commitStatementImport(second.state, second.batch.id, 2);
  assert.equal(result.transactions.length, committed.transactions.length);
});

test('corrected amounts are reconciled again before they can inflate spending', async () => {
  const result = await preview('2026-08-01,Cafe,-12.34\n2026-08-01,Cafe,wrong');
  const issue = result.issues.find(item => item.kind === 'invalid_amount')!;
  const corrected = resolveImportIssue(result.state, result.batch.id, issue.id, { correctedValue: -1234 });
  const committed = commitStatementImport(corrected, result.batch.id, 1);
  assert.equal(committed.transactions.length, 2);
  assert.equal(committed.statementImportBatches[0].excludedCount, 1);
  assert.equal(committed.normalizedStatementRows[1].originalValues.amount, 'wrong');
});

test('low-confidence OCR requires explicit review and cannot authorize an empty result', async () => {
  const parsed = await parseStatementBuffer({ buffer: Buffer.from('date,description,amount\n2026-08-01,Cafe,-12.34'),
    fileName: 'review.csv', mimeType: 'text/csv', templateId: 'bank-csv-v1' });
  parsed.confidence = 0.5; parsed.rows[0].confidence = 0.5;
  parsed.issues.push({ kind: 'low_confidence', field: 'confidence', originalValue: 0.5, severity: 'blocking' });
  const result = previewStatementImport(createJapanMoneyMissionFixture(), parsed);
  assert.throws(() => commitStatementImport(result.state, result.batch.id, 1), /IMPORT_UNRESOLVED/);
  const corrected = resolveImportIssue(result.state, result.batch.id, result.issues[0].id, { correctedValue: true });
  assert.equal(commitStatementImport(corrected, result.batch.id, 1).transactions.length, 2);
  const empty = previewStatementImport(createJapanMoneyMissionFixture(), { ...parsed, rows: [] });
  assert.throws(() => resolveImportIssue(empty.state, empty.batch.id, empty.issues[0].id, { correctedValue: true }), /IMPORT_INVALID_RESOLUTION/);
});
