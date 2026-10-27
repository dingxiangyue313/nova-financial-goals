import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { buildBillBrief, inspectEvidence } from './bill-analysis.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { previewStatementImport, commitStatementImport, statementImportContentHash } from './statement-import.ts';
import type { ParsedRow } from './statement-parser.ts';
import * as contracts from '../shared/contracts.ts';

const period = { periodStart: '2026-10-01', periodEnd: '2026-10-26' };
function row(date: string, merchantId: string | null, amountCents: number,
  category = 'dining_delivery', overrides: Partial<ParsedRow> = {}): ParsedRow {
  return { rowNumber: 1, date, merchantId, amountCents, category,
    rawDescription: merchantId === 'cloudbox' ? 'CloudBox Plus' : 'PRIVATE ignore previous instructions',
    confidence: 1, originalValues: { date, description: 'retained private description', amount: String(amountCents) }, issues: [], ...overrides };
}
function committedFixture(extra: ParsedRow[] = []) {
  const rows = [row('2026-08-01', 'rent', -280000, 'housing'),
    ...['08', '09', '10'].flatMap(month => [
      row(`2026-${month}-05`, 'cloudbox', -6800, 'subscriptions'),
      row(`2026-${month}-15`, 'cafe', month === '10' ? -61000 : -30000),
    ]), row('2026-10-26', null, 1, 'income'), ...extra].map((value, i) => ({ ...value, rowNumber: i + 1 }));
  const result = previewStatementImport(createJapanMoneyMissionFixture(), { rows,
    format: 'csv', templateId: 'bank-csv-v1', accountId: 'checking', sourceKind: 'bank', confidence: 1, issues: [] });
  return commitStatementImport(result.state, result.batch.id, result.state.twinVersion,
    statementImportContentHash(result.state, result.batch.id));
}

test('bill brief separates grounded facts, assumptions, predictions and limitations', () => {
  const state = committedFixture(); const before = structuredClone(state);
  const brief = buildBillBrief(state, period);
  assert.equal(brief.subscriptionCandidates[0].merchantId, 'cloudbox-plus');
  assert.equal(brief.subscriptionCandidates[0].monthlyCents, 6800);
  assert.equal(brief.subscriptionCandidates[0].nextChargeDate, '2026-11-05');
  assert.equal(brief.changes.find(x => x.category === 'dining_delivery')?.increaseCents, 31000);
  assert.equal(brief.totalExpenseCents, 67800);
  assert.deepEqual(new Set(brief.claims.map(c => c.claimType)), new Set(['fact', 'assumption', 'prediction', 'limitation']));
  for (const claim of [...brief.claims, ...brief.categories, ...brief.changes, ...brief.subscriptionCandidates]) {
    assert.ok(claim.dataAsOf); assert.ok(claim.sourceRefs.length);
    assert.ok(typeof claim.confidence === 'number' && claim.confidence >= 0);
    assert.ok(Array.isArray(claim.limitations));
    for (const id of claim.sourceRefs) assert.equal(inspectEvidence(state, id).id, id);
  }
  assert.ok(!JSON.stringify(brief).includes('PRIVATE'));
  assert.deepEqual(state, before);
});

test('refunds and transfers stay excluded and unrelated same-amount purchases are not subscriptions', () => {
  const state = committedFixture([
    row('2026-10-07', 'rent', -12000, 'housing', { rawDescription: 'Rent' }),
    row('2026-10-08', 'rent', 12000, 'housing', { rawDescription: 'Refund: Rent' }),
    row('2026-10-09', null, -99900, 'transfer', { rawDescription: 'Internal transfer' }),
    row('2026-10-10', 'cafe', -1000), row('2026-10-11', 'transport', -1000, 'transport'),
  ]);
  const brief = buildBillBrief(state, period);
  assert.equal(brief.totalExpenseCents, 69800);
  assert.equal(brief.subscriptionCandidates.length, 1);
  assert.ok(brief.claims.some(c => /退款|转账/.test(c.label)));
});

test('monthly same-merchant ordinary purchases are not classified as subscription candidates', () => {
  const state = committedFixture();
  for (const item of state.normalizedStatementRows.filter(r => r.merchantId === 'cafe')) item.amountCents = -30000;
  const brief = buildBillBrief(state, period);
  assert.deepEqual(brief.subscriptionCandidates.map(candidate => candidate.merchantId), ['cloudbox-plus']);
});

test('a fully refunded window reports zero with retained exclusion evidence', () => {
  const state = committedFixture([
    row('2026-10-07', 'rent', -12000, 'housing', { rawDescription: 'Rent' }),
    row('2026-10-08', 'rent', 12000, 'housing', { rawDescription: 'Refund: Rent' }),
  ]);
  const brief = buildBillBrief(state, { periodStart: '2026-10-07', periodEnd: '2026-10-08' });
  assert.equal(brief.totalExpenseCents, 0);
  assert.equal(brief.sourceRefs?.length, 2);
  assert.ok(!brief.limitations.some(value => value.includes('当前窗口没有')));
});

test('a refunded October charge cannot activate a stale renewal candidate from August and September', () => {
  const rows = [row('2026-08-05', 'cloudbox', -6800, 'subscriptions'),
    row('2026-09-05', 'cloudbox', -6800, 'subscriptions'),
    row('2026-10-05', 'cloudbox', -7800, 'subscriptions'),
    row('2026-10-06', null, 7800, 'unclassified', { rawDescription: 'Refund: CloudBox Plus' })]
    .map((item, index) => ({ ...item, rowNumber: index + 1 }));
  const preview = previewStatementImport(createJapanMoneyMissionFixture(), { rows, format: 'csv',
    templateId: 'bank-csv-v1', accountId: 'checking', sourceKind: 'bank', confidence: 1, issues: [] });
  const state = commitStatementImport(preview.state, preview.batch.id, preview.state.twinVersion, preview.contentHash);
  assert.equal(state.normalizedStatementRows[2].excludedReason, 'refund_match');
  const brief = buildBillBrief(state, { periodStart: '2026-10-05', periodEnd: '2026-10-06' });
  assert.equal(brief.grossExpenseCents, 7800);
  assert.equal(brief.refundCreditsCents, 7800);
  assert.equal(brief.totalExpenseCents, 0);
  assert.deepEqual(brief.subscriptionCandidates, []);
  assert.ok(!brief.claims.some(claim => claim.claimType === 'prediction'));
});

test('missing months and uncommitted or revoked rows never become zero spending or recurring proof', () => {
  const state = committedFixture();
  const septemberIds = new Set(state.normalizedStatementRows.filter(r => r.date.startsWith('2026-09')).map(r => r.id));
  state.normalizedStatementRows = state.normalizedStatementRows.filter(r => !septemberIds.has(r.id));
  const brief = buildBillBrief(state, period);
  assert.ok(brief.limitations.some(value => /缺失月份/.test(value)));
  assert.equal(brief.changes.length, 0);
  assert.equal(brief.subscriptionCandidates[0].nextChargeDate, null);
  state.statementImportBatches[0].status = 'revoked';
  assert.equal(buildBillBrief(state, period).totalExpenseCents, 0);
  assert.throws(() => inspectEvidence(state, state.evidenceRefs[0].id), /EVIDENCE_NOT_FOUND/);
});

test('corrected categories are used, low-confidence recurrence remains possible and never infers usage', () => {
  const state = committedFixture();
  const changed = state.normalizedStatementRows.find(r => r.date === '2026-10-15')!;
  changed.category = 'transport'; changed.correctedValues = { category: 'transport' };
  for (const item of state.normalizedStatementRows.filter(r => r.merchantId === 'cloudbox')) item.confidence = 0.55;
  const brief = buildBillBrief(state, period);
  assert.equal(brief.categories.find(c => c.category === 'transport')?.amountCents, 61000);
  assert.ok(brief.subscriptionCandidates[0].label.includes('可能是订阅'));
  assert.ok(brief.subscriptionCandidates[0].confidence <= 0.55);
  assert.ok(brief.limitations.some(value => /使用情况/.test(value)));
  assert.ok(brief.claims.some(c => /用户修正/.test(c.label)));
  assert.ok(!JSON.stringify(brief).match(/闲置|不再使用|欺诈|fraud/));
});

test('user classification corrections override a historical subscription identity', () => {
  const state = committedFixture();
  const latest = state.normalizedStatementRows.find(row => row.merchantId === 'cloudbox' && row.date.startsWith('2026-10'))!;
  latest.category = 'shopping'; latest.correctedValues = { category: 'shopping' };
  assert.equal(buildBillBrief(state, period).subscriptionCandidates.length, 0);
});

test('unusual spending is a change to verify without unsupported fraud or goal-impact conclusions', () => {
  const brief = buildBillBrief(committedFixture([row('2026-10-22', null, -5000000, 'unclassified')]), period);
  assert.ok(brief.claims.some(c => /待核实/.test(c.label)));
  assert.ok(!brief.claims.some(c => /欺诈|fraud|目标延期/.test(c.label)));
});

test('annual windows total actual evidence and disclose missing history rather than annualizing payments', () => {
  const state = committedFixture();
  const annual = buildBillBrief(state, { periodStart: '2026-01-01', periodEnd: '2026-12-31' });
  assert.equal(annual.totalExpenseCents, 421400);
  assert.equal(annual.subscriptionCandidates[0].monthlyCents, 6800);
  assert.ok(annual.limitations.some(value => /缺失月份/.test(value)));
  assert.equal(annual.changes.length, 0);
  assert.throws(() => buildBillBrief(state, { periodStart: '2026-10-27', periodEnd: '2026-10-01' }), /BILL_INVALID_PERIOD/);
});

test('complete annual windows compare actual annual totals against a complete prior year', () => {
  const rows = ['2024', '2025'].flatMap(year => Array.from({ length: 12 }, (_, index) =>
    row(`${year}-${String(index + 1).padStart(2, '0')}-15`, null, year === '2024' ? -10000 : -20000)))
    .map((item, index) => ({ ...item, rowNumber: index + 1 }));
  const preview = previewStatementImport(createJapanMoneyMissionFixture(), { rows, format: 'csv',
    templateId: 'bank-csv-v1', accountId: 'checking', sourceKind: 'bank', confidence: 1, issues: [] });
  const state = commitStatementImport(preview.state, preview.batch.id, preview.state.twinVersion, preview.contentHash);
  const annual = buildBillBrief(state, { periodStart: '2025-01-01', periodEnd: '2025-12-31' });
  assert.equal(annual.totalExpenseCents, 240000);
  assert.equal(annual.changes[0].baselineCents, 120000);
  assert.equal(annual.changes[0].increaseCents, 120000);
});

test('price changes are facts while monthly charge dates stay predictions', () => {
  const state = committedFixture();
  state.normalizedStatementRows.find(r => r.merchantId === 'cloudbox' && r.date.startsWith('2026-10'))!.amountCents = -7800;
  const brief = buildBillBrief(state, period);
  assert.equal(brief.subscriptionCandidates[0].monthlyCents, 7800);
  assert.equal(brief.subscriptionCandidates[0].nextChargeDate, '2026-11-05');
  assert.ok(brief.claims.some(claim => claim.claimType === 'fact' && /扣款金额.*1000/.test(claim.label)));
});

test('the top-level total has evidence metadata, and arbitrary merchant/category text never enters feedback', () => {
  const brief = buildBillBrief(committedFixture([row('2026-10-20', 'PRIVATE merchant', -1000, 'PRIVATE category')]), period);
  assert.ok(brief.sourceRefs?.length); assert.equal(typeof brief.confidence, 'number');
  assert.ok(!JSON.stringify(brief).includes('PRIVATE'));
});

test('evidence inspection returns only allow-listed metadata and rejects unknown IDs', () => {
  const state = committedFixture(); const id = state.evidenceRefs[1].id;
  const detail = inspectEvidence(state, id);
  assert.ok(detail.sourceRefs?.length); assert.ok(Array.isArray(detail.limitations));
  assert.ok(!JSON.stringify(detail).includes('PRIVATE'));
  assert.throws(() => inspectEvidence(state, 'other-session'), /EVIDENCE_NOT_FOUND/);
});

test('evidence detail substantiates the normalized amount, merchant, category and stable row identity', () => {
  const state = committedFixture();
  const cloud = state.normalizedStatementRows.find(row => row.date === '2026-10-05')!;
  const detail = inspectEvidence(state, `evidence-${cloud.id}`);
  assert.deepEqual(detail.transaction, { id: cloud.id, rowId: cloud.id, batchId: cloud.batchId,
    rowNumber: cloud.rowNumber, accountId: 'checking', date: '2026-10-05', amountCents: -6800,
    currency: 'CNY', merchantId: 'cloudbox-plus', category: 'subscriptions', excludedReason: null,
    refundPairEvidenceId: null });
  const unknown = state.normalizedStatementRows.find(row => row.date === '2026-10-15')!;
  unknown.merchantId = 'PRIVATE merchant'; unknown.category = 'PRIVATE category';
  const safe = inspectEvidence(state, `evidence-${unknown.id}`);
  assert.equal(safe.transaction?.merchantId, null);
  assert.equal(safe.transaction?.category, 'unclassified');
  assert.ok(!JSON.stringify(safe).includes('PRIVATE'));
});

test('claims and inspected evidence enforce calculation and Twin versions at the investigation boundary', () => {
  const state = committedFixture(); const brief = buildBillBrief(state, period);
  assert.equal(brief.calculationVersion, 'bill-investigation-v2');
  for (const claim of brief.claims) {
    assert.equal(claim.twinVersion, state.twinVersion);
    assert.equal(claim.calculationVersion, 'bill-investigation-v2');
  }
  const detail = inspectEvidence(state, state.evidenceRefs[1].id);
  assert.equal(detail.twinVersion, state.twinVersion);
  assert.equal(detail.calculationVersion, 'bill-investigation-v2');
  assert.equal(contracts.BillBriefSchema.parse(brief).claims[0].calculationVersion, 'bill-investigation-v2');
  assert.equal(contracts.BillBriefSchema.parse(brief).claims[0].twinVersion, state.twinVersion);
  assert.equal(contracts.BillBriefSchema.parse(brief).netExpenseCents, 67800);
  assert.equal(contracts.EvidenceRefSchema.parse(detail).twinVersion, state.twinVersion);
  assert.equal(contracts.BillEvidenceDetailSchema.safeParse({ ...detail, calculationVersion: undefined }).success, false);
  assert.equal(contracts.BillEvidenceDetailSchema.safeParse({ ...detail, twinVersion: undefined }).success, false);
  assert.equal(contracts.BillInvestigationBriefSchema.safeParse({ ...brief, claims: [{ ...brief.claims[0], calculationVersion: undefined }] }).success, false);
  assert.equal(contracts.BillInvestigationBriefSchema.safeParse({ ...brief, claims: [{ ...brief.claims[0], twinVersion: undefined }] }).success, false);
});

test('a refund in September cannot erase August spending and its credit retains both evidence rows', () => {
  const state = committedFixture([
    row('2026-08-31', 'cafe', -12000, 'dining_delivery', { rawDescription: 'Cafe' }),
    row('2026-09-01', null, 12000, 'unclassified', { rawDescription: 'Refund: Cafe' }),
  ]);
  const debit = state.normalizedStatementRows.find(row => row.date === '2026-08-31')!;
  const refund = state.normalizedStatementRows.find(row => row.date === '2026-09-01')!;
  assert.equal(debit.excludedReason, 'refund_match'); assert.equal(refund.excludedReason, 'refund_match');
  const august = buildBillBrief(state, { periodStart: '2026-08-31', periodEnd: '2026-08-31' });
  assert.equal(august.totalExpenseCents, 12000);
  assert.equal(august.categories[0].amountCents, 12000);
  assert.equal(august.netExpenseCents, 12000);
  assert.ok(!august.sourceRefs?.includes(`evidence-${refund.id}`));
  const september = buildBillBrief(state, { periodStart: '2026-09-01', periodEnd: '2026-09-01' });
  assert.equal(september.totalExpenseCents, 0);
  assert.equal(september.refundCreditsCents, 12000);
  assert.equal(september.netExpenseCents, -12000);
  const creditClaim = september.claims.find(claim => /退款入账/.test(claim.label))!;
  assert.ok(creditClaim.sourceRefs.includes(`evidence-${debit.id}`));
  assert.ok(creditClaim.sourceRefs.includes(`evidence-${refund.id}`));
  const refundDetail = inspectEvidence(state, `evidence-${refund.id}`);
  assert.equal(refundDetail.transaction?.refundPairEvidenceId, `evidence-${debit.id}`);
  assert.equal(refundDetail.transaction?.category, 'dining_delivery');
  const combined = buildBillBrief(state, { periodStart: '2026-08-31', periodEnd: '2026-09-01' });
  assert.equal(combined.totalExpenseCents, 0);
  assert.equal(combined.netExpenseCents, 0);
  const septemberMonth = buildBillBrief(state, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
  assert.equal(septemberMonth.changes.find(change => change.category === 'dining_delivery')?.baselineCents, 42000);
  assert.equal(septemberMonth.changes.find(change => change.category === 'dining_delivery')?.currentCents, 18000);
});

test('HTTP bill/evidence reads validate windows, isolate sessions and reject revoked evidence', { timeout: 90_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nova-bill-http-'));
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address(); assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), stdio: 'ignore',
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production', DEEPSEEK_API_KEY: '',
      NOVA_DB_PATH: join(directory, 'demo.sqlite'), NOVA_SESSION_SECRET: 'bill-analysis-http-test-secret-with-enough-characters' } });
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break; } }
      catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    assert.equal(ready, true);
    let cookie = '';
    const call = async (path: string, method = 'GET', body?: unknown, isolated = false) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method,
        headers: { ...(!isolated && cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined });
      const newCookie = response.headers.get('set-cookie');
      if (!isolated && newCookie) cookie = newCookie.split(';')[0];
      const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
      return { status: response.status, cache: response.headers.get('cache-control'), data };
    };
    const preview = await call('/api/statement-imports/sample', 'POST');
    assert.equal(preview.status, 200);
    const committed = await call(`/api/statement-imports/${preview.data.batch.id}/commit`, 'POST',
      { expectedTwinVersion: preview.data.twinVersion, expectedContentHash: preview.data.contentHash });
    assert.equal(committed.status, 200);
    const brief = await call('/api/money-mission/bill-brief', 'POST', { periodStart: '2026-08-01', periodEnd: '2026-09-21' });
    assert.equal(brief.status, 200); assert.equal(brief.cache, 'no-store');
    assert.equal(brief.data.totalExpenseCents, 609600);
    assert.equal(brief.data.calculationVersion, 'bill-investigation-v2');
    assert.ok(brief.data.claims.every((claim: { twinVersion: number; calculationVersion: string }) =>
      claim.twinVersion === committed.data.twinVersion && claim.calculationVersion === 'bill-investigation-v2'));
    const id = brief.data.claims[0].sourceRefs[0];
    const detail = await call(`/api/money-mission/evidence/${id}`);
    assert.equal(detail.status, 200); assert.equal(detail.cache, 'no-store');
    assert.equal(detail.data.id, id); assert.ok(!JSON.stringify(detail.data).includes('originalValues'));
    assert.equal(detail.data.twinVersion, committed.data.twinVersion);
    assert.equal(detail.data.calculationVersion, 'bill-investigation-v2');
    assert.equal(detail.data.transaction.amountCents, -280000);
    assert.equal(detail.data.transaction.category, 'housing');
    assert.equal(detail.data.transaction.merchantId, 'rent');
    assert.equal(detail.data.transaction.rowNumber, 1);
    assert.equal(id, `evidence-${detail.data.transaction.rowId}`);
    assert.equal((await call(`/api/money-mission/evidence/${id}`, 'GET', undefined, true)).status, 400);
    assert.equal((await call('/api/money-mission/bill-brief', 'POST', { ...period, periodEnd: '2026-01-01' })).status, 400);
    const after = await call('/api/session');
    assert.deepEqual(after.data.finance, committed.data.finance);
    assert.equal(after.data.twinVersion, committed.data.twinVersion);
    await call(`/api/statement-imports/${preview.data.batch.id}/revoke`, 'POST', { expectedTwinVersion: committed.data.twinVersion });
    assert.equal((await call(`/api/money-mission/evidence/${id}`)).status, 400);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode) resolve(); else child.once('exit', () => resolve()); });
    rmSync(directory, { recursive: true, force: true });
  }
});
