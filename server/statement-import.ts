import { randomUUID } from 'node:crypto';
import type { DemoState, ImportIssue, NormalizedStatementRow, StatementImportBatch } from '../shared/contracts.ts';
import type { ParsedStatement } from './statement-parser.ts';
import { parseAmount, validDate } from './statement-parser.ts';
import { CATEGORY_MAP } from './money-mission-fixture.ts';
import { appendAuditEvent, confirmApproval, consumeApproval, createApprovalSnapshot, stableHash } from './governance.ts';

const identity = (row: NormalizedStatementRow) => `${row.sourceKind}:${row.externalId}`;
const merchantBase = (title: string) => title.split(/[·|]/)[0].replace(/退款|退货|订单|refund/gi, '').trim();
export function activeStatementRows(state: DemoState) {
  const active = new Set(state.statementImportBatches.filter(b => b.status === 'committed').map(b => b.id));
  return state.normalizedStatementRows.filter(r => r.batchId && active.has(r.batchId));
}

function syncLegacyProjection(state: DemoState): DemoState {
  if (!state.mission) return state;
  const labels = Object.fromEntries(Object.entries(CATEGORY_MAP).map(([label, category]) => [category, label]));
  const rows = activeStatementRows(state).map(r => ({ id: r.id, date: r.date, merchant: r.title, cents: r.amountCents,
    category: (labels[r.category] ?? '待核对') as NonNullable<DemoState['mission']>['rows'][number]['category'],
    source: ({ bank: '银行卡', wechat_pay: '微信', alipay: '支付宝' } as const)[r.sourceKind], excluded: r.excludedReason !== null }));
  return { ...state, mission: { ...state.mission, pending: null, rows } };
}
export function previewStatementImport(state: DemoState, parsed: ParsedStatement) {
  const batchId = randomUUID(); const issues = parsed.issues.map(i => ({ ...i, id: randomUUID(), batchId }));
  const existing = new Set(activeStatementRows(state).map(identity)); const seen = new Set(existing);
  const rows: NormalizedStatementRow[] = parsed.rows.map((r, index) => {
    const row = { ...r, id: `${batchId}:${index}`, batchId };
    for (const issue of issues) if (issue.rowId === r.id) issue.rowId = row.id;
    if (seen.has(identity(row))) { row.excludedReason = 'duplicate'; issues.push({ id: randomUUID(), batchId, rowId: row.id, kind: 'duplicate', severity: 'info', field: 'externalId', originalValue: row.externalId, correctedValue: null, resolved: true }); }
    seen.add(identity(row)); return row;
  });
  const paired = new Set<string>();
  for (const refund of rows.filter(r => r.amountCents > 0 && r.excludedReason !== 'duplicate' && (r.category === 'refund' || /退款|refund/i.test(r.title)))) {
    const purchase = rows.find(r => !paired.has(r.id) && r.amountCents === -refund.amountCents && !r.excludedReason && r.sourceKind === refund.sourceKind && merchantBase(r.title) === merchantBase(refund.title) && r.date <= refund.date && Date.parse(refund.date) - Date.parse(r.date) <= 7 * 86400000);
    if (purchase) for (const r of [purchase, refund]) { r.excludedReason = 'refund_match'; paired.add(r.id); issues.push({ id: randomUUID(), batchId, rowId: r.id, kind: 'refund_match', severity: 'info', field: 'excludedReason', originalValue: r.title, correctedValue: 'refund_match', resolved: true }); }
    else if (!refund.excludedReason) issues.push({ id: randomUUID(), batchId, rowId: refund.id, kind: 'low_confidence', severity: 'review', field: 'category', originalValue: '未找到对应的原支出，需核对退款', correctedValue: null, resolved: false });
  }
  const dates = rows.filter(r => !issues.some(i => i.rowId === r.id && i.kind === 'invalid_date')).map(r => r.date).sort();
  const batch: StatementImportBatch = { id: batchId, revision:0, templateId: parsed.templateId, format: parsed.format,
    status: issues.some(i => !i.resolved && i.severity !== 'info') ? 'needs_review' : 'ready',
    coverageStart: dates[0] ?? null, coverageEnd: dates.at(-1) ?? null, recordCount: rows.length,
    duplicateCount: rows.filter(r => r.excludedReason === 'duplicate').length, issueIds: issues.map(i => i.id), rowIds: rows.map(r => r.id),
    createdAt: `${state.clock}T12:00:00+08:00`, committedAt: null, twinVersion: state.twinVersion };
  return { state: { ...state, normalizedStatementRows: [...state.normalizedStatementRows, ...rows], statementImportBatches: [...state.statementImportBatches, batch], importIssues: [...state.importIssues, ...issues] }, batch, issues };
}

function findBatch(state: DemoState, id: string) {
  const batch = state.statementImportBatches.find(b => b.id === id); if (!batch) throw new Error('IMPORT_BATCH_NOT_FOUND'); return batch;
}
export function resolveImportIssue(state: DemoState, batchId: string, issueId: string, resolution: { value: string }): DemoState {
  const batch = findBatch(state, batchId); if (!['ready', 'needs_review', 'preview'].includes(batch.status)) throw new Error('IMPORT_BATCH_NOT_EDITABLE');
  const issue = state.importIssues.find(i => i.id === issueId && i.batchId === batchId); if (!issue) throw new Error('IMPORT_ISSUE_NOT_FOUND');
  const value = resolution.value.trim(); let correction: Partial<NormalizedStatementRow>;
  if (issue.field === 'date') { if (!validDate(value)) throw new Error('INVALID_DATE'); correction = { date: value }; }
  else if (issue.field === 'amountCents') { const amountCents = parseAmount(value, 'cents'); if (amountCents === null) throw new Error('INVALID_AMOUNT'); correction = { amountCents }; }
  else if (issue.field === 'category') {
    const category = CATEGORY_MAP[value] ?? (Object.values(CATEGORY_MAP).includes(value) ? value : null);
    if (!category || category === 'unclassified') throw new Error('INVALID_CATEGORY'); correction = { category, excludedReason: category === 'income' ? 'income' : category === 'internal_transfer' ? 'internal_transfer' : null, confidence: 1 };
  } else if (issue.field === 'title') { if (!value || value.length > 240) throw new Error('INVALID_TITLE'); correction = { title: value }; }
  else throw new Error('IMPORT_ISSUE_NOT_EDITABLE');
  const issues = state.importIssues.map(i => i.id === issueId ? { ...i, correctedValue: value, resolved: true } : i);
  const rows = state.normalizedStatementRows.map(r => r.id === issue.rowId ? { ...r, ...correction } : r);
  const dates = rows.filter(r => r.batchId === batchId && validDate(r.date)).map(r => r.date).sort();
  return { ...state, normalizedStatementRows: rows, importIssues: issues, statementImportBatches: state.statementImportBatches.map(b => b.id === batchId ? { ...b, coverageStart: dates[0] ?? null, coverageEnd: dates.at(-1) ?? null, revision:(b.revision??0)+1, status: issues.some(i => i.batchId === batchId && !i.resolved && i.severity !== 'info') ? 'needs_review' : 'ready' } : b) };
}

export function commitStatementImport(state: DemoState, batchId: string, expectedTwinVersion: number, expectedBatchRevision?:number): DemoState {
  const batch = findBatch(state, batchId); if (batch.status === 'committed') return state;
  if(expectedBatchRevision!==undefined&&expectedBatchRevision!==(batch.revision??0))throw new Error('IMPORT_PREVIEW_STALE');
  if (state.twinVersion !== expectedTwinVersion || batch.twinVersion !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
  if (batch.status !== 'ready' || state.importIssues.some(i => i.batchId === batchId && !i.resolved && i.severity !== 'info')) throw new Error('IMPORT_UNRESOLVED_ISSUES');
  const existing = new Set(activeStatementRows(state).map(identity));
  const rows = state.normalizedStatementRows.filter(r => r.batchId === batchId && r.excludedReason !== 'duplicate');
  if (rows.some(r => existing.has(identity(r)))) throw new Error('IMPORT_PREVIEW_STALE');
  const parameters = { batchId, rowsHash: stableHash(rows), recordCount: rows.length };
  const prepared = createApprovalSnapshot(state, 'commit_statement_import', parameters, `${state.clock}T12:05:00.000Z`);
  const approved = confirmApproval(prepared.state, prepared.approval.id, prepared.approval.snapshotHash);
  let next = consumeApproval(approved.state, approved.token, 'commit_statement_import', parameters);
  const imported = rows.map(r => ({ id: r.id, accountId: r.accountId, date: r.date, title: r.title, category: r.category, amountCents: r.amountCents, sourceKind: r.sourceKind, provenance: 'uploaded_statement' as const }));
  const evidence = rows.map(r => ({ id: `evidence:${r.id}`, claimType: 'fact' as const, sourceKind: 'transaction' as const, sourceId: r.id, dataAsOf: state.clock, label: `${r.date} · ${r.category}`, confidence: r.confidence, transactionIds: [r.id] }));
  next = { ...next, twinVersion: next.twinVersion + 1, transactions: [...next.transactions, ...imported], evidenceRefs: [...next.evidenceRefs, ...evidence],
    statementImportBatches: next.statementImportBatches.map(b => b.id === batchId ? { ...b, status: 'committed', committedAt: `${state.clock}T12:00:00+08:00` } : b) };
  return appendAuditEvent(syncLegacyProjection(next), 'statement_import', 'committed', `已确认导入 ${rows.length} 条历史证据；账户余额未改变`, { approvalId: prepared.approval.id });
}
export function revokeStatementImport(state: DemoState, batchId: string, expectedTwinVersion: number): DemoState {
  const batch = findBatch(state, batchId); if (batch.status === 'revoked') return state;
  if (expectedTwinVersion !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
  if (batch.status !== 'committed') throw new Error('IMPORT_BATCH_NOT_COMMITTED');
  const ids = new Set(batch.rowIds);
  const parameters = { batchId, rowsHash: stableHash(state.normalizedStatementRows.filter(row => ids.has(row.id))) };
  const prepared = createApprovalSnapshot(state, 'revoke_statement_import', parameters, `${state.clock}T12:05:00.000Z`);
  const approved = confirmApproval(prepared.state, prepared.approval.id, prepared.approval.snapshotHash);
  const next = consumeApproval(approved.state, approved.token, 'revoke_statement_import', parameters);
  return appendAuditEvent(syncLegacyProjection({ ...next, twinVersion: next.twinVersion + 1, transactions: next.transactions.filter(t => !ids.has(t.id)), evidenceRefs: next.evidenceRefs.filter(e => !e.transactionIds.some(id => ids.has(id))), statementImportBatches: next.statementImportBatches.map(b => b.id === batchId ? { ...b, status: 'revoked' } : b) }), 'statement_import', 'revoked', '仅撤销本批次历史证据；账户余额未改变', { approvalId: prepared.approval.id });
}
