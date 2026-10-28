import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DemoStateSchema, IsoDateSchema, type DemoState, type ImportIssue,
  type NormalizedStatementRow, type StatementImportBatch } from '../shared/contracts.ts';
import { appendAuditEvent, confirmApproval, consumeApproval, createApprovalSnapshot, stableHash } from './governance.ts';
import type { ParsedIssue, ParsedStatement } from './statement-parser.ts';
import { isRefundRow, refundMatches } from './refund-links.ts';

const at = (state: DemoState) => `${state.clock}T12:00:00.000Z`;
const findBatch = (state: DemoState, id: string) => {
  const batch = state.statementImportBatches.find(item => item.id === id);
  if (!batch) throw new Error('IMPORT_BATCH_NOT_FOUND');
  return batch;
};

/** Identifies exactly the rows, corrections, exclusions and batch metadata shown for review. */
export function statementImportContentHash(state: DemoState, batchId: string): string {
  return stableHash({ batch: findBatch(state, batchId),
    rows: state.normalizedStatementRows.filter(row => row.batchId === batchId),
    issues: state.importIssues.filter(issue => issue.batchId === batchId) });
}

/** Reuse the approval primitives; the explicit version-bound request is the confirmation. */
export function governStatementChange(state: DemoState, action: string, parameters: Record<string, unknown>,
  execute: (approved: DemoState) => DemoState): DemoState {
  const created = createApprovalSnapshot(state, action, parameters, `${state.clock}T12:05:00.000Z`);
  const confirmed = confirmApproval(created.state, created.approval.id, created.approval.snapshotHash);
  let next = consumeApproval(confirmed.state, confirmed.token, action, parameters);
  next = appendAuditEvent(next, 'permission', 'checked', action, { approvalId: created.approval.id });
  next = appendAuditEvent(next, 'risk', 'checked', '版本、账户和输入校验通过');
  next = execute(next);
  next = appendAuditEvent(next, 'execute', 'simulated', action);
  DemoStateSchema.parse(next);
  next = appendAuditEvent(next, 'verify', 'confirmed', '模拟结果与授权范围已核对');
  return appendAuditEvent(next, 'audit', 'recorded', '操作证据已写入 Hash 链');
}

function reconcileRows(state: DemoState, batchId: string): DemoState {
  const automatic = new Set(['duplicate', 'refund_match', 'internal_transfer']);
  const previous = state.importIssues.filter(issue => issue.batchId === batchId && automatic.has(issue.kind));
  const removed = new Set(previous.map(issue => issue.id));
  const issues = state.importIssues.filter(issue => !removed.has(issue.id));
  const rows = state.normalizedStatementRows.map(row => row.batchId !== batchId ? row : {
    ...row, excludedReason: null, issueIds: row.issueIds.filter(id => !removed.has(id)),
  }) as NormalizedStatementRow[];
  const active = new Set(state.statementImportBatches.filter(batch => batch.status === 'committed').map(batch => batch.id));
  active.add(batchId);
  const commitOrder = new Map(state.approvals.filter(approval => approval.action === 'commit_statement_import' &&
    approval.status === 'consumed').map((approval, index) => [String(approval.parameters.batchId), index]));
  const order = (row: NormalizedStatementRow) => state.statementImportBatches.some(batch => batch.id === row.batchId && batch.status === 'committed')
    ? commitOrder.get(row.batchId) ?? -1 : Number.MAX_SAFE_INTEGER;
  const eligible = rows.filter(row => active.has(row.batchId) && !issues.some(issue => issue.rowId === row.id &&
    ['invalid_date', 'invalid_amount', 'missing_field'].includes(issue.kind) && issue.correctedValue === null))
    .sort((left, right) => order(left) - order(right));
  const exclusions = new Map<string, NonNullable<NormalizedStatementRow['excludedReason']>>();
  const key = (row: Pick<NormalizedStatementRow, 'accountId' | 'date' | 'title' | 'amountCents'>) =>
    JSON.stringify([row.accountId, row.date, row.title, row.amountCents]);
  // Imported history is derived from retained evidence, including previously excluded rows.
  // Only non-import transactions seed the keys: active import evidence is processed once below.
  const importedIds = new Set(state.normalizedStatementRows.map(row => row.id));
  const seen = new Set(state.transactions.filter(row => !importedIds.has(row.id)).map(key));
  for (const row of eligible) {
    if (seen.has(key(row))) exclusions.set(row.id, 'duplicate');
    else if (row.title === 'Internal transfer' || row.category === 'internal_transfer') exclusions.set(row.id, 'internal_transfer');
    seen.add(key(row));
  }
  for (const row of eligible) {
    if (exclusions.has(row.id) || !isRefundRow(row)) continue;
    const original = eligible.find(candidate => !exclusions.has(candidate.id) && candidate.accountId === row.accountId &&
      candidate.currency === row.currency && refundMatches(row, candidate) &&
      candidate.amountCents === -row.amountCents && candidate.date <= row.date);
    if (original) { exclusions.set(original.id, 'refund_match'); exclusions.set(row.id, 'refund_match'); }
  }
  // A preview updates only its own evidence. Earlier committed history changes only during commit/revoke.
  for (const row of rows.filter(row => row.batchId === batchId)) {
    const kind = exclusions.get(row.id);
    if (!kind) continue;
    const issue: ImportIssue = previous.find(item => item.rowId === row.id && item.kind === kind) ?? {
      id: randomUUID(), batchId, rowId: row.id, field: 'excludedReason', kind, severity: 'info',
      originalValue: kind, correctedValue: null,
    };
    row.excludedReason = kind; row.issueIds.push(issue.id); issues.push(issue);
  }
  return { ...state, normalizedStatementRows: rows, importIssues: issues };
}

/** Rebuild only imported history from active evidence, preserving each transaction's owning row ID. */
function materializeCommittedHistory(input: DemoState): DemoState {
  let state = input;
  const active = new Set(state.statementImportBatches.filter(batch => batch.status === 'committed').map(batch => batch.id));
  for (const id of active) state = reconcileRows(state, id);
  const importedIds = new Set(state.normalizedStatementRows.map(row => row.id));
  const included = state.normalizedStatementRows.filter(row => active.has(row.batchId) && !row.excludedReason);
  return { ...state,
    transactions: [...state.transactions.filter(transaction => !importedIds.has(transaction.id)), ...included.map(row => ({
      id: row.id, accountId: row.accountId, date: row.date, title: row.title, category: row.category,
      amountCents: row.amountCents, sourceKind: row.sourceKind, provenance: 'connected_data' as const,
    }))],
    statementImportBatches: state.statementImportBatches.map(batch => !active.has(batch.id) ? batch : {
      ...batch, importedCount: included.filter(row => row.batchId === batch.id).length,
      excludedCount: state.normalizedStatementRows.filter(row => row.batchId === batch.id && row.excludedReason !== null).length,
      issueIds: state.importIssues.filter(issue => issue.batchId === batch.id).map(issue => issue.id),
    }),
    evidenceRefs: state.evidenceRefs.map(evidence => {
      const row = state.normalizedStatementRows.find(row => active.has(row.batchId) && evidence.id === `evidence-${row.id}`);
      return row ? { ...evidence, label: `账单第 ${row.rowNumber} 行${row.excludedReason ? '（不计入支出）' : ''}` } : evidence;
    }),
  };
}

function refreshBatch(input: DemoState, batchId: string): DemoState {
  const state = reconcileRows(input, batchId);
  const issues = state.importIssues.filter(item => item.batchId === batchId);
  const rows = state.normalizedStatementRows.filter(item => item.batchId === batchId);
  const pending = issues.filter(item => item.severity !== 'info' && item.correctedValue === null);
  return { ...state, statementImportBatches: state.statementImportBatches.map(batch => batch.id !== batchId ? batch : {
    ...batch, status: pending.length ? 'needs_review' : 'ready', reviewCount: pending.length,
    excludedCount: rows.filter(row => row.excludedReason !== null).length,
    issueIds: issues.map(item => item.id),
  }) };
}

export function previewStatementImport(state: DemoState, parsed: ParsedStatement): { state: DemoState; batch: StatementImportBatch; issues: ImportIssue[]; contentHash: string } {
  if (!state.accounts.some(account => account.id === parsed.accountId)) throw new Error('ACCOUNT_NOT_FOUND');
  const batchId = randomUUID(); const issues: ImportIssue[] = [];
  const addIssue = (value: ParsedIssue, rowId: string | null): ImportIssue => {
    const issue = { ...value, id: randomUUID(), batchId, rowId, correctedValue: null };
    issues.push(issue); return issue;
  };
  parsed.issues.forEach(value => addIssue(value, null));
  const rows: NormalizedStatementRow[] = parsed.rows.map(row => {
    const id = randomUUID();
    return { id, batchId, rowNumber: row.rowNumber, accountId: parsed.accountId, sourceKind: parsed.sourceKind,
      date: row.date ?? state.clock, title: row.rawDescription, merchantId: row.merchantId, category: row.category,
      amountCents: row.amountCents ?? 0, currency: 'CNY', confidence: row.confidence,
      issueIds: row.issues.map(value => addIssue(value, id).id),
      excludedReason: row.issues.some(value => value.kind === 'duplicate') ? 'duplicate' : null,
      originalValues: { ...row.originalValues }, correctedValues: {} };
  });
  const dates = rows.filter(row => !row.issueIds.some(id => issues.find(issue => issue.id === id)?.kind === 'invalid_date')).map(row => row.date).sort();
  const batch: StatementImportBatch = { id: batchId, templateId: parsed.templateId, format: parsed.format,
    sourceKind: parsed.sourceKind, accountId: parsed.accountId, status: 'preview', coverageStart: dates[0] ?? state.clock,
    coverageEnd: dates.at(-1) ?? state.clock, recordCount: rows.length, importedCount: 0, excludedCount: 0,
    reviewCount: 0, issueIds: [], createdAt: at(state), committedAt: null };
  const next = refreshBatch({ ...state, statementImportBatches: [...state.statementImportBatches, batch],
    importIssues: [...state.importIssues, ...issues], normalizedStatementRows: [...state.normalizedStatementRows, ...rows] }, batchId);
  return { state: DemoStateSchema.parse(next), batch: findBatch(next, batchId), issues: next.importIssues.filter(issue => issue.batchId === batchId),
    contentHash: statementImportContentHash(next, batchId) };
}

export function resolveImportIssue(state: DemoState, batchId: string, issueId: string, resolution: unknown): DemoState {
  const batch = findBatch(state, batchId);
  if (!['ready', 'needs_review', 'preview'].includes(batch.status)) throw new Error('IMPORT_NOT_EDITABLE');
  const issue = state.importIssues.find(item => item.id === issueId && item.batchId === batchId);
  if (!issue) throw new Error('IMPORT_ISSUE_NOT_FOUND');
  const parsed = z.object({ correctedValue: z.union([z.string(), z.number(), z.boolean()]) }).strict().safeParse(resolution);
  if (!parsed.success) throw new Error('IMPORT_INVALID_RESOLUTION');
  const value = parsed.data.correctedValue;
  const valid = issue.kind === 'invalid_date' ? IsoDateSchema.safeParse(value).success
    : issue.kind === 'invalid_amount' ? typeof value === 'number' && Number.isSafeInteger(value)
    : issue.kind === 'missing_field' ? typeof value === 'string' && value.trim().length > 0 && value.length <= 1000
    : issue.kind === 'low_confidence' ? value === true && state.normalizedStatementRows.some(row => row.batchId === batchId &&
      (issue.rowId === null || row.id === issue.rowId)) : false;
  if (!valid) throw new Error('IMPORT_INVALID_RESOLUTION');
  const rows = state.normalizedStatementRows.map(row => row.id !== issue.rowId ? row : {
    ...row, ...(issue.field === 'date' ? { date: String(value) } : issue.field === 'amountCents' ? { amountCents: Number(value) }
      : issue.field === 'title' ? { title: String(value) } : {}), correctedValues: { ...row.correctedValues, [issue.field]: value } });
  const next = refreshBatch({ ...state, normalizedStatementRows: rows, importIssues: state.importIssues.map(item => item.id !== issue.id ? item
    : { ...item, correctedValue: value }) }, batchId);
  const dates = rows.filter(row => row.batchId === batchId).map(row => row.date).sort();
  return DemoStateSchema.parse({ ...next, statementImportBatches: next.statementImportBatches.map(item => item.id !== batchId ? item : {
    ...item, coverageStart: dates[0] ?? item.coverageStart, coverageEnd: dates.at(-1) ?? item.coverageEnd }) });
}

export function commitStatementImport(input: DemoState, batchId: string, expectedTwinVersion: number, expectedContentHash: string): DemoState {
  const batch = findBatch(input, batchId);
  if (batch.status === 'committed') {
    if (!input.approvals.some(approval => approval.action === 'commit_statement_import' && approval.status === 'consumed' &&
      approval.parameters.batchId === batchId && approval.parameters.expectedTwinVersion === expectedTwinVersion &&
      approval.parameters.expectedContentHash === expectedContentHash)) throw new Error('IMPORT_CONTENT_CHANGED');
    return input;
  }
  if (input.twinVersion !== expectedTwinVersion) throw new Error('TWIN_VERSION_CHANGED');
  if (batch.status === 'revoked' || batch.status === 'failed') throw new Error('IMPORT_NOT_READY');
  if (statementImportContentHash(input, batchId) !== expectedContentHash) throw new Error('IMPORT_CONTENT_CHANGED');
  const state = refreshBatch(input, batchId);
  if (statementImportContentHash(state, batchId) !== expectedContentHash) throw new Error('IMPORT_CONTENT_CHANGED');
  if (state.importIssues.some(issue => issue.batchId === batchId && issue.severity !== 'info' && issue.correctedValue === null))
    throw new Error('IMPORT_UNRESOLVED');
  if (batch.status !== 'ready') throw new Error('IMPORT_NOT_READY');
  const rows = state.normalizedStatementRows.filter(row => row.batchId === batchId);
  const imported = rows.filter(row => !row.excludedReason);
  return governStatementChange(state, 'commit_statement_import', { batchId, expectedTwinVersion, expectedContentHash }, approved => {
    const next = materializeCommittedHistory({ ...approved, twinVersion: state.twinVersion + 1,
      statementImportBatches: approved.statementImportBatches.map(item => item.id !== batchId ? item : {
        ...item, status: 'committed' as const, committedAt: at(state), importedCount: imported.length }),
      evidenceRefs: [...approved.evidenceRefs, { id: `evidence-${batchId}`, claimType: 'fact' as const,
        sourceKind: 'import_batch' as const, sourceId: batchId, dataAsOf: batch.coverageEnd, label: '已确认的模拟账单历史', confidence: 1 },
      ...rows.map(row => ({ id: `evidence-${row.id}`, claimType: 'fact' as const, sourceKind: 'import_batch' as const,
        sourceId: batchId, dataAsOf: row.date, label: `账单第 ${row.rowNumber} 行${row.excludedReason ? '（不计入支出）' : ''}`, confidence: row.confidence }))] });
    if (next.finance !== state.finance || next.accounts !== state.accounts || next.goal !== state.goal)
      throw new Error('IMPORT_AUTHORITY_VIOLATION');
    return next;
  });
}

export function revokeStatementImport(state: DemoState, batchId: string, expectedTwinVersion: number): DemoState {
  const batch = findBatch(state, batchId);
  if (batch.status === 'revoked') return state;
  if (state.twinVersion !== expectedTwinVersion) throw new Error('TWIN_VERSION_CHANGED');
  if (batch.status !== 'committed') throw new Error('IMPORT_NOT_COMMITTED');
  return governStatementChange(state, 'revoke_statement_import', { batchId, expectedTwinVersion }, approved => materializeCommittedHistory({
    ...approved, twinVersion: state.twinVersion + 1,
    statementImportBatches: approved.statementImportBatches.map(item => item.id !== batchId ? item : { ...item, status: 'revoked' }),
  }));
}
