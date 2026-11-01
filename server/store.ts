import { verifyAuditChain } from './governance.ts';
import { ChatMemorySchema } from '../shared/chat-routing.ts';
import {tickGoalNotices} from './goal-notices.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentComponentSchema, AgentMessageSchema, AgentTaskConstraintsSchema, AgentTaskFactsSchema,
  AgentTaskPhaseSchema, AgentTaskPreferenceSchema, AgentTaskRunRecordSchema, AgentTaskSchema,
  AgentTaskSourceSchema, AgentThreadSchema, DemoStateSchema, GoalDraftSchema, IsoDateSchema,
  AgentToolResultSchema, AgentRunSchema, type AgentRun, type AgentToolResult, type AgentComponent, type AgentMessage, type AgentTask, type AgentTaskPhase, type AgentThread,
  StatementImportBatchSchema, ImportIssueSchema, NormalizedStatementRowSchema, EvidenceRefSchema,
  SubscriptionActionSchema, TransferScheduleSchema, TransferExecutionSchema,
  type StatementImportBatch, type EvidenceRef, type SubscriptionAction, type TransferSchedule,
  type TransferExecution, type DemoState, type GoalDraft } from '../shared/contracts.ts';
import { createFirstUseFixture } from './fixtures.ts';
import { reconcileServices, validateServiceBalances } from './financial-services.ts';
import {tickSubscriptionNotifications} from './subscription-notifications.ts';
import { migrateLegacyProduct } from './legacy-product-migration.ts';
import { inspectEvidence } from './bill-analysis.ts';

const dbPath = resolve(process.env.NOVA_DB_PATH || './data/nova.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('CREATE TABLE IF NOT EXISTS chat_navigation_memory (session_id TEXT NOT NULL, thread_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id,thread_id))');
export function getChatMemory(sessionId:string,threadId:string){
  getAgentThread(sessionId,threadId);
  const row=db.prepare('SELECT payload FROM chat_navigation_memory WHERE session_id=? AND thread_id=?').get(sessionId,threadId) as {payload:string}|undefined;
  return row?ChatMemorySchema.parse(JSON.parse(row.payload)):ChatMemorySchema.parse({destination:null});
}
export function saveChatMemory(sessionId:string,threadId:string,value:unknown){
  getAgentThread(sessionId,threadId);const memory=ChatMemorySchema.parse(value);
  db.prepare('INSERT INTO chat_navigation_memory VALUES (?,?,?) ON CONFLICT(session_id,thread_id) DO UPDATE SET payload=excluded.payload').run(sessionId,threadId,JSON.stringify(memory));return memory;
}
db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
db.exec(`CREATE TABLE IF NOT EXISTS demo_sessions (
  id TEXT PRIMARY KEY, state_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, at TEXT NOT NULL,
  action TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT NOT NULL, operation_id TEXT
);
CREATE TABLE IF NOT EXISTS approval_artifacts (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nonce_artifacts (
  session_id TEXT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY(session_id, nonce)
);
CREATE TABLE IF NOT EXISTS operation_artifacts (
  operation_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  input_hash TEXT, status TEXT NOT NULL, payload_json TEXT NOT NULL,
  UNIQUE(session_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS receipt_artifacts (
  operation_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_preferences (
  session_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spending_patterns (
  session_id TEXT NOT NULL, id TEXT NOT NULL, payload_json TEXT NOT NULL,
  PRIMARY KEY(session_id, id)
);
CREATE TABLE IF NOT EXISTS risk_signals (
  session_id TEXT NOT NULL, id TEXT NOT NULL, suppression_key TEXT NOT NULL,
  status TEXT NOT NULL, payload_json TEXT NOT NULL,
  PRIMARY KEY(session_id, id), UNIQUE(session_id, suppression_key)
);
CREATE TABLE IF NOT EXISTS weekly_risk_summaries (
  session_id TEXT NOT NULL, id TEXT NOT NULL, dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL, payload_json TEXT NOT NULL,
  PRIMARY KEY(session_id, id), UNIQUE(session_id, dedupe_key)
);
CREATE TABLE IF NOT EXISTS data_connections (
  session_id TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL,
  payload_json TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(session_id, source)
);
CREATE TABLE IF NOT EXISTS data_sync_batches (
  session_id TEXT NOT NULL, id TEXT NOT NULL, dedupe_key TEXT NOT NULL,
  kind TEXT NOT NULL, payload_json TEXT NOT NULL,
  PRIMARY KEY(session_id, id), UNIQUE(session_id, dedupe_key)
);
CREATE TABLE IF NOT EXISTS imported_transactions (
  session_id TEXT NOT NULL, source TEXT NOT NULL, external_transaction_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(session_id, source, external_transaction_id)
);
CREATE TABLE IF NOT EXISTS agent_runs (
  session_id TEXT PRIMARY KEY, current_run_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_threads (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, run_id TEXT NOT NULL, title TEXT NOT NULL,
  kind TEXT NOT NULL, status TEXT NOT NULL, unread INTEGER NOT NULL DEFAULT 0,
  read_only INTEGER NOT NULL DEFAULT 0, dedupe_key TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(session_id, dedupe_key)
);
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, thread_id TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, components_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_turns (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, thread_id TEXT NOT NULL, intent TEXT NOT NULL,
  provider TEXT NOT NULL, fallback_reason TEXT, twin_version INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_components (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, thread_id TEXT NOT NULL, turn_id TEXT NOT NULL,
  component_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, thread_id TEXT NOT NULL, action_type TEXT NOT NULL,
  twin_version INTEGER NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL,
  result_json TEXT, expires_at TEXT NOT NULL, idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(session_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS goal_drafts (
  session_id TEXT NOT NULL, thread_id TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(session_id, thread_id)
);
CREATE TABLE IF NOT EXISTS agent_tasks (
  task_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, thread_id TEXT NOT NULL, run_id TEXT NOT NULL,
  revision INTEGER NOT NULL, phase TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(session_id, thread_id, run_id)
);
CREATE INDEX IF NOT EXISTS agent_tasks_session_run ON agent_tasks(session_id, run_id);
CREATE TABLE IF NOT EXISTS agent_tool_results (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  task_id TEXT NOT NULL, run_id TEXT NOT NULL, twin_version INTEGER NOT NULL,
  tool TEXT NOT NULL, dedupe_key TEXT NOT NULL, payload_json TEXT NOT NULL,
  UNIQUE(session_id, thread_id, run_id, dedupe_key)
);
CREATE TABLE IF NOT EXISTS agent_task_runs (
  run_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  task_id TEXT NOT NULL, demo_run_id TEXT NOT NULL, triggering_message_id TEXT NOT NULL,
  revision INTEGER NOT NULL, status TEXT NOT NULL, worker_token TEXT, payload_json TEXT NOT NULL,
  UNIQUE(session_id, thread_id, demo_run_id, triggering_message_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_task_runs_active
  ON agent_task_runs(session_id,task_id) WHERE status='running';
CREATE TABLE IF NOT EXISTS monitor_subscriptions (
  session_id TEXT NOT NULL, task_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  demo_run_id TEXT NOT NULL, goal_id TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(session_id,task_id)
);
CREATE TABLE IF NOT EXISTS monitor_events (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, task_id TEXT NOT NULL,
  demo_run_id TEXT NOT NULL, goal_id TEXT NOT NULL, twin_version INTEGER NOT NULL,
  kind TEXT NOT NULL, dedupe_key TEXT NOT NULL, status TEXT NOT NULL,
  due_demo_date TEXT, available_at TEXT NOT NULL, lease_token TEXT, lease_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL, processed_at TEXT,
  UNIQUE(session_id,dedupe_key)
);
CREATE INDEX IF NOT EXISTS monitor_events_due ON monitor_events(status,available_at,lease_until);
CREATE TABLE IF NOT EXISTS monitor_notifications (
  session_id TEXT NOT NULL, event_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL, candidate_result_id TEXT, subject_key TEXT,
  twin_version INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(session_id,event_id), UNIQUE(session_id,message_id), UNIQUE(session_id,subject_key)
);
CREATE TABLE IF NOT EXISTS passkey_credentials (
  session_id TEXT PRIMARY KEY, credential_id TEXT NOT NULL UNIQUE, public_key BLOB NOT NULL,
  counter INTEGER NOT NULL, transports_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  challenge TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL, operation_id TEXT,
  input_hash TEXT, mandate_id TEXT, twin_version INTEGER, expires_at TEXT NOT NULL,
  consumed_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS statement_import_batches (
  session_id TEXT NOT NULL, id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS statement_import_issues (
  session_id TEXT NOT NULL, id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS evidence_refs (
  session_id TEXT NOT NULL, id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS subscription_actions (
  session_id TEXT NOT NULL, id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS transfer_schedules (
  session_id TEXT NOT NULL, id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS transfer_executions (
  session_id TEXT NOT NULL, id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS transfer_schedule_authorities (
  session_id TEXT NOT NULL, schedule_id TEXT NOT NULL, payload_json TEXT NOT NULL,
  PRIMARY KEY(session_id,schedule_id)
);
CREATE TABLE IF NOT EXISTS transfer_schedule_leases (
  session_id TEXT NOT NULL, schedule_id TEXT NOT NULL, period TEXT NOT NULL,
  lease_token TEXT, lease_until TEXT, PRIMARY KEY(session_id,schedule_id,period)
);`);

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
for (const [column, definition] of [
  ['request_id', 'TEXT'], ['approval_id', 'TEXT'], ['twin_version', 'INTEGER'], ['sequence', 'INTEGER'],
  ['previous_hash', 'TEXT'], ['event_hash', 'TEXT'],
] as const) ensureColumn('audit_events', column, definition);
ensureColumn('monitor_notifications', 'subject_key', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS monitor_notifications_subject ON monitor_notifications(session_id,subject_key) WHERE subject_key IS NOT NULL');

const moneyMissionTables = {
  statementImportBatches: 'statement_import_batches', importIssues: 'statement_import_issues',
  evidenceRefs: 'evidence_refs', subscriptionActions: 'subscription_actions',
  transferSchedules: 'transfer_schedules', transferExecutions: 'transfer_executions',
} as const;

function syncArtifacts(sessionId: string, state: DemoState) {
  for (const schedule of state.transferSchedules) {
    // Capture authority only at first persistence. Legacy schedules without a baseline fail closed.
    if (!db.prepare('SELECT 1 FROM transfer_schedules WHERE session_id=? AND id=?').get(sessionId, schedule.id))
      db.prepare('INSERT OR IGNORE INTO transfer_schedule_authorities VALUES(?,?,?)')
        .run(sessionId, schedule.id, JSON.stringify(transferScheduleAuthority(state, schedule)));
  }
  for (const [collection, table] of Object.entries(moneyMissionTables)) {
    for (const artifact of state[collection as keyof typeof moneyMissionTables]) {
      db.prepare(`INSERT INTO ${table}(session_id,id,payload_json) VALUES(?,?,?)
        ON CONFLICT(session_id,id) DO UPDATE SET payload_json=excluded.payload_json`)
        .run(sessionId, artifact.id, JSON.stringify(artifact));
    }
  }
  db.prepare(`INSERT INTO risk_preferences(session_id,payload_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(session_id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
    .run(sessionId, JSON.stringify(state.riskPreferences), new Date().toISOString());
  for (const pattern of state.spendingPatterns) db.prepare(`INSERT INTO spending_patterns(session_id,id,payload_json)
    VALUES(?,?,?) ON CONFLICT(session_id,id) DO UPDATE SET payload_json=excluded.payload_json`)
    .run(sessionId, pattern.id, JSON.stringify(pattern));
  for (const signal of state.riskSignals) db.prepare(`INSERT INTO risk_signals(session_id,id,suppression_key,status,payload_json)
    VALUES(?,?,?,?,?) ON CONFLICT(session_id,suppression_key) DO UPDATE SET status=excluded.status,payload_json=excluded.payload_json`)
    .run(sessionId, signal.id, signal.suppressionKey, signal.status, JSON.stringify(signal));
  for (const summary of state.weeklyRiskSummaries) db.prepare(`INSERT INTO weekly_risk_summaries(session_id,id,dedupe_key,status,payload_json)
    VALUES(?,?,?,?,?) ON CONFLICT(session_id,dedupe_key) DO UPDATE SET status=excluded.status,payload_json=excluded.payload_json`)
    .run(sessionId, summary.id, summary.dedupeKey, summary.status, JSON.stringify(summary));
  for (const connection of state.dataConnections) db.prepare(`INSERT INTO data_connections(session_id,source,status,payload_json,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(session_id,source) DO UPDATE SET status=excluded.status,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
    .run(sessionId, connection.source, connection.status, JSON.stringify(connection), new Date().toISOString());
  for (const batch of state.dataSyncBatches) db.prepare(`INSERT INTO data_sync_batches(session_id,id,dedupe_key,kind,payload_json)
    VALUES(?,?,?,?,?) ON CONFLICT(session_id,dedupe_key) DO UPDATE SET payload_json=excluded.payload_json`)
    .run(sessionId, batch.id, batch.dedupeKey, batch.kind, JSON.stringify(batch));
  for (const transaction of state.transactions) {
    if (!transaction.sourceKind) continue;
    db.prepare(`INSERT INTO imported_transactions(session_id,source,external_transaction_id,payload_json)
      VALUES(?,?,?,?) ON CONFLICT(session_id,source,external_transaction_id) DO UPDATE SET payload_json=excluded.payload_json`)
      .run(sessionId, transaction.sourceKind, transaction.id, JSON.stringify(transaction));
  }
  for (const approval of state.approvals) db.prepare(`INSERT INTO approval_artifacts(id,session_id,status,payload_json)
    VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload_json=excluded.payload_json`)
    .run(approval.id, sessionId, approval.status, JSON.stringify(approval));
  for (const nonce of state.consumedNonces) db.prepare('INSERT OR IGNORE INTO nonce_artifacts(session_id,nonce) VALUES(?,?)')
    .run(sessionId, nonce);
  for (const operation of state.operations) db.prepare(`INSERT INTO operation_artifacts(operation_id,session_id,idempotency_key,input_hash,status,payload_json)
    VALUES(?,?,?,?,?,?) ON CONFLICT(operation_id) DO UPDATE SET input_hash=excluded.input_hash,status=excluded.status,payload_json=excluded.payload_json`)
    .run(operation.operationId, sessionId, operation.idempotencyKey, operation.inputHash ?? null, operation.status, JSON.stringify(operation));
  for (const receipt of state.receipts) db.prepare(`INSERT INTO receipt_artifacts(operation_id,session_id,payload_json)
    VALUES(?,?,?) ON CONFLICT(operation_id) DO UPDATE SET payload_json=excluded.payload_json`)
    .run(receipt.operationId, sessionId, JSON.stringify(receipt));
}

export function migrateDemoStateShape(raw: unknown): DemoState {
  const value = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : raw;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const legacyGoal = record.goal;
    if (!Array.isArray(record.goals)) record.goals = legacyGoal ? [legacyGoal] : [];
    if (!('primaryGoalId' in record)) record.primaryGoalId = legacyGoal && typeof legacyGoal === 'object'
      ? String((legacyGoal as { id?: unknown }).id || '') || null : null;
  }
  return DemoStateSchema.parse(value&&typeof value==='object'?migrateLegacyProduct(value as Record<string,unknown>):value);
}

export function getState(sessionId: string): DemoState {
  const row = db.prepare('SELECT state_json FROM demo_sessions WHERE id = ?').get(sessionId) as { state_json: string } | undefined;
  if (row) return migrateDemoStateShape(JSON.parse(row.state_json));
  const initial = createFirstUseFixture();
  db.prepare('INSERT OR IGNORE INTO demo_sessions (id,state_json,version,updated_at) VALUES (?,?,0,?)')
    .run(sessionId, JSON.stringify(initial), new Date().toISOString());
  return initial;
}

export function mutateState(sessionId: string, change: (state: DemoState) => DemoState): DemoState {
  db.exec('BEGIN IMMEDIATE');
  try {
    const next = persistStateChange(sessionId, change);
    db.exec('COMMIT');
    return next;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

const StatementImportPreviewSchema = z.object({
  batch: StatementImportBatchSchema, issues: z.array(ImportIssueSchema), rows: z.array(NormalizedStatementRowSchema),
});

function mergeArtifacts<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const artifacts = new Map(current.map(artifact => [artifact.id, artifact]));
  for (const artifact of incoming) artifacts.set(artifact.id, artifact);
  return [...artifacts.values()];
}

export function saveStatementImportPreview(sessionId: string, value: unknown): StatementImportBatch {
  const preview = StatementImportPreviewSchema.parse(value);
  mutateState(sessionId, state => ({ ...state,
    statementImportBatches: mergeArtifacts(state.statementImportBatches, [preview.batch]),
    importIssues: mergeArtifacts(state.importIssues, preview.issues),
    normalizedStatementRows: mergeArtifacts(state.normalizedStatementRows, preview.rows),
  }));
  return preview.batch;
}

export function getStatementImportBatch(sessionId: string, id: string): StatementImportBatch {
  const row = db.prepare('SELECT payload_json FROM statement_import_batches WHERE session_id=? AND id=?')
    .get(sessionId, id) as { payload_json: string } | undefined;
  if (!row) throw new Error('IMPORT_BATCH_NOT_FOUND');
  return StatementImportBatchSchema.parse(JSON.parse(row.payload_json));
}

export function listStatementImportBatches(sessionId: string): StatementImportBatch[] {
  const rows = db.prepare('SELECT payload_json FROM statement_import_batches WHERE session_id=? ORDER BY rowid')
    .all(sessionId) as Array<{ payload_json: string }>;
  return rows.map(row => StatementImportBatchSchema.parse(JSON.parse(row.payload_json)));
}

export function saveEvidenceRefs(sessionId: string, value: unknown): EvidenceRef[] {
  const refs = z.array(EvidenceRefSchema).parse(value);
  mutateState(sessionId, state => ({ ...state, evidenceRefs: mergeArtifacts(state.evidenceRefs, refs) }));
  return refs;
}

export function saveSubscriptionAction(sessionId: string, value: unknown): SubscriptionAction {
  const action = SubscriptionActionSchema.parse(value);
  mutateState(sessionId, state => ({ ...state,
    subscriptionActions: mergeArtifacts(state.subscriptionActions, [action]) }));
  return action;
}

export function saveTransferSchedule(sessionId: string, value: unknown): TransferSchedule {
  const schedule = TransferScheduleSchema.parse(value);
  mutateState(sessionId, state => ({ ...state,
    transferSchedules: mergeArtifacts(state.transferSchedules, [schedule]) }));
  return schedule;
}

export function saveTransferExecution(sessionId: string, value: unknown): TransferExecution {
  const execution = TransferExecutionSchema.parse(value);
  mutateState(sessionId, state => ({ ...state,
    transferExecutions: mergeArtifacts(state.transferExecutions, [execution]) }));
  return execution;
}

export function transferScheduleAuthority(state: DemoState, schedule: TransferSchedule) {
  const { savedCents: _saved, status: _status, ...goal } = state.goal;
  return { goal, primaryGoalId: state.primaryGoalId, emergencyCents: state.finance.emergencyCents,
    accounts: [schedule.sourceAccountId, schedule.destinationAccountId].map(id => {
      const account = state.accounts.find(item => item.id === id);
      if (!account) return null;
      const { balanceCents: _balance, ...configuration } = account;
      return configuration;
    }) };
}

export function getTransferScheduleAuthority(sessionId: string, scheduleId: string): unknown {
  const row = db.prepare('SELECT payload_json FROM transfer_schedule_authorities WHERE session_id=? AND schedule_id=?')
    .get(sessionId, scheduleId) as { payload_json: string } | undefined;
  return row ? JSON.parse(row.payload_json) : null;
}

export function claimTransferSchedule(sessionId: string, scheduleId: string, period: string, now: Date): string | null {
  const token = randomUUID();
  const result = db.prepare(`INSERT INTO transfer_schedule_leases VALUES(?,?,?,?,?)
    ON CONFLICT(session_id,schedule_id,period) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until
    WHERE transfer_schedule_leases.lease_token IS NULL OR transfer_schedule_leases.lease_until<=?`)
    .run(sessionId, scheduleId, period, token, new Date(now.getTime() + 30000).toISOString(), now.toISOString());
  return result.changes ? token : null;
}

/** Balance, operation, receipt, period outcome and monitor outbox commit together. */
export function commitTransferSchedule(sessionId: string, scheduleId: string, period: string, token: string,
  now: Date, change: (state: DemoState) => { state: DemoState; execution: TransferExecution }): TransferExecution {
  db.exec('BEGIN IMMEDIATE');
  try {
    const lease = db.prepare('SELECT lease_token,lease_until FROM transfer_schedule_leases WHERE session_id=? AND schedule_id=? AND period=?')
      .get(sessionId, scheduleId, period) as { lease_token: string; lease_until: string } | undefined;
    if (lease?.lease_token !== token || lease.lease_until <= now.toISOString()) throw new Error('SCHEDULE_LEASE_LOST');
    const result = change(getState(sessionId));
    const next = persistStateChange(sessionId, () => result.state);
    if (['failed', 'unknown', 'skipped_missing_trigger'].includes(result.execution.status))
      enqueueTransferOutcome(sessionId, next.transferSchedules.find(item => item.id === scheduleId)?.goalId ?? next.goal.id,
        result.execution, now);
    db.prepare('UPDATE transfer_schedule_leases SET lease_token=NULL,lease_until=NULL WHERE session_id=? AND schedule_id=? AND period=? AND lease_token=?')
      .run(sessionId, scheduleId, period, token);
    db.exec('COMMIT');
    return result.execution;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function dueTransferSchedules(now: Date | undefined, limit: number): Array<{ sessionId: string; scheduleId: string }> {
  const time = new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 23);
  const rows = db.prepare(`SELECT s.session_id,s.id FROM transfer_schedules s JOIN demo_sessions d ON d.id=s.session_id
    WHERE json_extract(s.payload_json,'$.status')='active'
      AND json_extract(s.payload_json,'$.trigger.type')='salary_event'
      AND julianday(json_extract(s.payload_json,'$.nextEvaluationAt'))<=
        julianday(COALESCE(?,json_extract(d.state_json,'$.clock')||'T'||?||'+08:00'))
    ORDER BY json_extract(s.payload_json,'$.nextEvaluationAt'),s.session_id,s.id LIMIT ?`)
    .all(now?.toISOString() ?? null, time, Math.max(0, Math.min(100, Math.floor(limit)))) as Array<{ session_id: string; id: string }>;
  return rows.map(row => ({ sessionId: row.session_id, scheduleId: row.id }));
}

function persistStateChange(sessionId: string, change: (state: DemoState) => DemoState): DemoState {
  const old = getState(sessionId);
  const next = DemoStateSchema.parse(change(old));
  validateServiceBalances(old, next);
  const newEvents = next.audit.slice(old.audit.length);
  const result = db.prepare('UPDATE demo_sessions SET state_json = ?, version = version + 1, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(next), new Date().toISOString(), sessionId);
  if (!result.changes) throw new Error('SESSION_NOT_FOUND');
  for (const event of newEvents) db.prepare(`INSERT INTO audit_events
    (id,session_id,at,action,outcome,detail,operation_id,request_id,approval_id,twin_version,sequence,previous_hash,event_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(event.id, sessionId, event.at, event.action, event.outcome, event.detail, event.operationId ?? null,
      event.requestId ?? null, event.approvalId ?? null, event.twinVersion ?? null, event.sequence ?? null,
      event.previousHash ?? null, event.eventHash ?? null);
  syncArtifacts(sessionId, next);
  if (next.twinVersion !== old.twinVersion) {
    const subscriptions = db.prepare(`SELECT task_id,demo_run_id,goal_id FROM monitor_subscriptions
      WHERE session_id=? AND status='active'`).all(sessionId) as Array<{
        task_id: string; demo_run_id: string; goal_id: string }>;
    const now = new Date().toISOString();
    for (const item of subscriptions) {
      const goal = next.goals.find(entry => entry.id === item.goal_id);
      if (!goal || goal.status !== 'active' || next.primaryGoalId !== item.goal_id) {
        db.prepare("UPDATE monitor_subscriptions SET status='cancelled',updated_at=? WHERE session_id=? AND task_id=?")
          .run(now, sessionId, item.task_id);
        db.prepare("UPDATE monitor_events SET status='stale',processed_at=? WHERE session_id=? AND task_id=? AND status IN ('pending','leased')")
          .run(now, sessionId, item.task_id);
        const row = db.prepare('SELECT payload_json FROM agent_tasks WHERE session_id=? AND task_id=?')
          .get(sessionId, item.task_id) as { payload_json: string } | undefined;
        if (row) {
          const task = AgentTaskSchema.parse(JSON.parse(row.payload_json));
          if (task.phase !== 'completed' && task.phase !== 'failed') {
            const done = AgentTaskSchema.parse({ ...task, phase: 'completed', waitingReason: null,
              terminationReason: goal?.status === 'achieved' ? 'goal_completed' : 'cancelled',
              pendingActionId: null, nextCheck: null, taskRevision: task.taskRevision + 1,
              updatedAt: now });
            db.prepare('UPDATE agent_tasks SET revision=?,phase=?,payload_json=?,updated_at=? WHERE session_id=? AND task_id=?')
              .run(done.taskRevision, done.phase, JSON.stringify(done), now, sessionId, item.task_id);
          }
        }
        continue;
      }
      db.prepare(`INSERT OR IGNORE INTO monitor_events
      (id,session_id,task_id,demo_run_id,goal_id,twin_version,kind,dedupe_key,status,
       due_demo_date,available_at,lease_token,lease_until,attempts,payload_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,'pending',NULL,?,NULL,NULL,0,?,?)`)
      .run(randomUUID(), sessionId, item.task_id, item.demo_run_id, item.goal_id,
        next.twinVersion, 'twin_changed', `twin:${item.task_id}:${next.twinVersion}`,
        now, JSON.stringify({ fromTwinVersion: old.twinVersion, toTwinVersion: next.twinVersion,
          asOf: next.clock }), now);
    }
  }
  return next;
}

export interface StoredPasskeyCredential {
  credentialId: string; publicKey: Uint8Array; counter: number; transports: string[];
}
export interface StoredWebAuthnChallenge {
  challenge: string; kind: 'registration' | 'authentication'; operationId: string | null;
  inputHash: string | null; mandateId: string | null; twinVersion: number | null;
  expiresAt: string; consumedAt: string | null;
}

export function getPasskeyCredential(sessionId: string): StoredPasskeyCredential | null {
  const row = db.prepare('SELECT * FROM passkey_credentials WHERE session_id=?').get(sessionId) as Record<string, unknown> | undefined;
  return row ? { credentialId: String(row.credential_id), publicKey: new Uint8Array(row.public_key as Uint8Array),
    counter: Number(row.counter), transports: JSON.parse(String(row.transports_json)) } : null;
}

export function saveWebAuthnChallenge(sessionId: string, value: StoredWebAuthnChallenge) {
  db.prepare(`INSERT INTO webauthn_challenges(challenge,session_id,kind,operation_id,input_hash,mandate_id,twin_version,expires_at,consumed_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,NULL,?)`).run(value.challenge, sessionId, value.kind, value.operationId, value.inputHash,
      value.mandateId, value.twinVersion, value.expiresAt, new Date().toISOString());
}

export function getWebAuthnChallenge(sessionId: string, challenge: string): StoredWebAuthnChallenge {
  const row = db.prepare('SELECT * FROM webauthn_challenges WHERE challenge=? AND session_id=?').get(challenge, sessionId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('WEBAUTHN_CHALLENGE_NOT_FOUND');
  return { challenge: String(row.challenge), kind: row.kind as StoredWebAuthnChallenge['kind'],
    operationId: row.operation_id ? String(row.operation_id) : null, inputHash: row.input_hash ? String(row.input_hash) : null,
    mandateId: row.mandate_id ? String(row.mandate_id) : null, twinVersion: row.twin_version == null ? null : Number(row.twin_version),
    expiresAt: String(row.expires_at), consumedAt: row.consumed_at ? String(row.consumed_at) : null };
}

function assertUsableChallenge(sessionId: string, challenge: string, kind: StoredWebAuthnChallenge['kind']) {
  const record = getWebAuthnChallenge(sessionId, challenge);
  if (record.kind !== kind) throw new Error('WEBAUTHN_CHALLENGE_TYPE_MISMATCH');
  if (record.consumedAt) throw new Error('WEBAUTHN_CHALLENGE_REPLAYED');
  if (Date.parse(record.expiresAt) <= Date.now()) throw new Error('WEBAUTHN_CHALLENGE_EXPIRED');
  return record;
}

export function completePasskeyRegistration(sessionId: string, challenge: string, credential: StoredPasskeyCredential) {
  db.exec('BEGIN IMMEDIATE');
  try {
    assertUsableChallenge(sessionId, challenge, 'registration');
    const now = new Date().toISOString();
    db.prepare('UPDATE webauthn_challenges SET consumed_at=? WHERE challenge=? AND session_id=? AND consumed_at IS NULL').run(now, challenge, sessionId);
    db.prepare(`INSERT INTO passkey_credentials(session_id,credential_id,public_key,counter,transports_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET credential_id=excluded.credential_id,
      public_key=excluded.public_key,counter=excluded.counter,transports_json=excluded.transports_json,updated_at=excluded.updated_at`)
      .run(sessionId, credential.credentialId, Buffer.from(credential.publicKey), credential.counter,
        JSON.stringify(credential.transports), now, now);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function completePasskeyAuthentication(sessionId: string, challenge: string, credentialId: string,
  newCounter: number, change: (state: DemoState, binding: StoredWebAuthnChallenge) => DemoState): DemoState {
  db.exec('BEGIN IMMEDIATE');
  try {
    const binding = assertUsableChallenge(sessionId, challenge, 'authentication');
    const credential = getPasskeyCredential(sessionId);
    if (!credential || credential.credentialId !== credentialId) throw new Error('WEBAUTHN_CREDENTIAL_MISMATCH');
    const next = persistStateChange(sessionId, old => change(old, binding));
    const now = new Date().toISOString();
    db.prepare('UPDATE webauthn_challenges SET consumed_at=? WHERE challenge=? AND session_id=? AND consumed_at IS NULL').run(now, challenge, sessionId);
    db.prepare('UPDATE passkey_credentials SET counter=?,updated_at=? WHERE session_id=?').run(newCounter, now, sessionId);
    db.exec('COMMIT');
    return next;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function resetState(sessionId: string): DemoState {
  db.exec('BEGIN IMMEDIATE');
  try {
    const state = createFirstUseFixture();
    db.prepare('INSERT INTO demo_sessions (id,state_json,version,updated_at) VALUES (?,?,0,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json, version=version+1, updated_at=excluded.updated_at')
      .run(sessionId, JSON.stringify(state), new Date().toISOString());
    db.prepare('DELETE FROM audit_events WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM approval_artifacts WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM nonce_artifacts WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM operation_artifacts WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM receipt_artifacts WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM risk_preferences WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM spending_patterns WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM risk_signals WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM weekly_risk_summaries WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM data_connections WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM data_sync_batches WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM imported_transactions WHERE session_id=?').run(sessionId);
    for (const table of Object.values(moneyMissionTables))
      db.prepare(`DELETE FROM ${table} WHERE session_id=?`).run(sessionId);
    db.prepare("UPDATE monitor_subscriptions SET status='cancelled',updated_at=? WHERE session_id=?")
      .run(new Date().toISOString(), sessionId);
    db.prepare("UPDATE monitor_events SET status='stale',processed_at=? WHERE session_id=? AND status IN ('pending','leased')")
      .run(new Date().toISOString(), sessionId);
    const runId = randomUUID();
    db.prepare('UPDATE agent_threads SET read_only=1, status=\'archived\', updated_at=? WHERE session_id=?')
      .run(new Date().toISOString(), sessionId);
    const oldTasks = db.prepare('SELECT * FROM agent_tasks WHERE session_id=?')
      .all(sessionId) as Array<Record<string, unknown>>;
    for (const row of oldTasks) {
      const old = AgentTaskSchema.parse(JSON.parse(String(row.payload_json)));
      if (old.phase === 'completed' || old.phase === 'failed') continue;
      const updatedAt = new Date().toISOString();
      const next = AgentTaskSchema.parse({ ...old, phase: 'completed', waitingReason: null,
        terminationReason: 'demo_reset', pendingActionId: null, nextCheck: null,
        taskRevision: old.taskRevision + 1, updatedAt, readOnly: true });
      db.prepare('UPDATE agent_tasks SET revision=?,phase=?,payload_json=?,updated_at=? WHERE task_id=? AND session_id=?')
        .run(next.taskRevision, next.phase, JSON.stringify(next), updatedAt, next.taskId, sessionId);
    }
    db.prepare(`INSERT INTO agent_runs(session_id,current_run_id) VALUES(?,?)
      ON CONFLICT(session_id) DO UPDATE SET current_run_id=excluded.current_run_id`).run(sessionId, runId);
    db.exec('COMMIT');
    return state;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function currentRunId(sessionId: string): string {
  const row = db.prepare('SELECT current_run_id FROM agent_runs WHERE session_id=?').get(sessionId) as { current_run_id: string } | undefined;
  if (row) return row.current_run_id;
  const id = randomUUID();
  db.prepare('INSERT INTO agent_runs(session_id,current_run_id) VALUES(?,?)').run(sessionId, id);
  return id;
}

const TaskPatchSchema = z.object({
  phase: AgentTaskPhaseSchema.optional(),
  waitingReason: AgentTaskSchema.shape.waitingReason.optional(),
  terminationReason: AgentTaskSchema.shape.terminationReason.optional(),
  baseTwinVersion: z.number().int().positive().optional(),
  goalDraftId: z.string().min(1).nullable().optional(),
  goalId: z.string().min(1).nullable().optional(),
  facts: AgentTaskFactsSchema.optional(),
  constraints: AgentTaskConstraintsSchema.optional(),
  candidateTargetDate: IsoDateSchema.nullable().optional(),
  fieldSources: z.record(z.string(), AgentTaskSourceSchema).optional(),
  preferences: z.array(AgentTaskPreferenceSchema).max(30).optional(),
  unknowns: z.array(z.string().min(1).max(80)).max(30).optional(),
  evidenceRefs: z.array(z.string().min(1)).max(100).optional(),
  candidateRefs: z.array(z.string().min(1)).max(30).optional(),
  pendingActionId: z.string().min(1).nullable().optional(),
  nextCheck: z.string().datetime({ offset: true }).nullable().optional(),
  runRecord: AgentTaskRunRecordSchema.optional(),
}).strict();
export type AgentTaskPatch = z.input<typeof TaskPatchSchema>;

const taskTransitions: Record<AgentTaskPhase, readonly AgentTaskPhase[]> = {
  understanding: ['investigating', 'awaiting_user', 'paused', 'completed', 'failed'],
  investigating: ['understanding', 'simulating', 'awaiting_user', 'paused', 'completed', 'failed'],
  simulating: ['understanding', 'investigating', 'awaiting_user', 'awaiting_confirmation', 'paused', 'completed', 'failed'],
  awaiting_user: ['understanding', 'investigating', 'awaiting_confirmation', 'paused', 'completed', 'failed'],
  awaiting_confirmation: ['understanding', 'simulating', 'awaiting_user', 'verifying', 'monitoring', 'paused', 'completed', 'failed'],
  verifying: ['monitoring', 'paused', 'completed', 'failed'],
  monitoring: ['understanding', 'investigating', 'awaiting_confirmation', 'paused', 'completed', 'failed'],
  paused: ['understanding', 'investigating', 'simulating', 'awaiting_user', 'awaiting_confirmation', 'monitoring', 'completed'],
  completed: ['monitoring'], failed: [],
};

function taskFromRow(sessionId: string, row: Record<string, unknown>): AgentTask {
  const thread = getAgentThread(sessionId, String(row.thread_id));
  const readOnly = thread.readOnly || thread.status === 'archived' || row.run_id !== currentRunId(sessionId);
  const task = AgentTaskSchema.parse({ ...JSON.parse(String(row.payload_json)), readOnly });
  if (task.taskId !== row.task_id || task.threadId !== row.thread_id || task.demoRunId !== row.run_id ||
    task.taskRevision !== row.revision) throw new Error('TASK_STORE_CORRUPT');
  return task;
}

function taskDraftFields(draft: GoalDraft | null, sourceMessageId: string | null = null) {
  return {
    facts: { title: draft?.title ?? null, targetCents: draft?.targetCents ?? null,
      originalTargetDate: draft?.targetDate ?? null, savedCents: draft?.savedCents ?? null },
    constraints: { latestAllowedDate: null, monthlyContributionCapCents: draft?.monthlyContributionCapCents ?? null,
      protectedCents: draft?.protectedCents ?? null, preserveEssentialSpending: null },
    fieldSources: Object.fromEntries(Object.entries(draft?.fieldSources ?? {}).map(([field, kind]) => [field,
      { kind: kind === 'user_provided' ? 'user_message' : kind,
        messageId: kind === 'user_provided' ? sourceMessageId : null,
        confirmation: kind === 'user_provided' ? 'unconfirmed' : 'system_verified' }])),
    unknowns: draft?.missingRequiredFields ?? ['title', 'targetCents', 'targetDate'],
  };
}

function validateTaskSources(sessionId: string, threadId: string, task: AgentTask) {
  for (const source of [...Object.values(task.fieldSources), ...task.preferences.map(item => item.source)]) {
    if (source.messageId === null) continue;
    if (source.kind !== 'user_message') throw new Error('TASK_SOURCE_NOT_FOUND');
    const row = db.prepare(`SELECT id FROM agent_messages WHERE id=? AND session_id=? AND thread_id=? AND role='user'`)
      .get(source.messageId, sessionId, threadId);
    if (!row) throw new Error('TASK_SOURCE_NOT_FOUND');
  }
  for (const [kind, refs] of [['evidence', task.evidenceRefs], ['candidate', task.candidateRefs]] as const) {
    for (const ref of refs) {
      const result = getAgentToolResult(sessionId, threadId, ref);
      if (result.taskId !== task.taskId || result.demoRunId !== task.demoRunId ||
        (kind === 'candidate' && (result.tool !== 'candidate_preview' || result.status !== 'ok')))
        throw new Error('TASK_TOOL_RESULT_NOT_FOUND');
    }
  }
}

export function getAgentToolResult(sessionId: string, threadId: string, id: string): AgentToolResult {
  const row = db.prepare(`SELECT payload_json FROM agent_tool_results
    WHERE id=? AND session_id=? AND thread_id=?`).get(id, sessionId, threadId) as { payload_json: string } | undefined;
  if (!row) throw new Error('TASK_TOOL_RESULT_NOT_FOUND');
  return AgentToolResultSchema.parse(JSON.parse(row.payload_json));
}

function toolSourceExists(sessionId: string, task: AgentTask, state: DemoState,
  source: AgentToolResult['sourceEntities'][number]): boolean {
  switch (source.kind) {
    case 'finance': return source.id === 'finance';
    case 'task': return source.id === task.taskId;
    case 'account': return state.accounts.some(item => item.id === source.id);
    case 'bill': return state.bills.some(item => item.id === source.id);
    case 'transaction': return state.transactions.some(item => item.id === source.id);
    case 'connection': return state.dataConnections.some(item => item.id === source.id);
    case 'evidence': {
      try { inspectEvidence(state, source.id); return true; } catch { return false; }
    }
    case 'tool_result': {
      try {
        const evidence = getAgentToolResult(sessionId, task.threadId, source.id);
        return evidence.taskId === task.taskId && evidence.demoRunId === task.demoRunId &&
          evidence.twinVersion === state.twinVersion;
      } catch { return false; }
    }
  }
}

export function saveAgentToolResult(sessionId: string, result: AgentToolResult, dedupeKey: string): AgentToolResult {
  const parsed = AgentToolResultSchema.parse(result);
  const task = getAgentTask(sessionId, parsed.taskId);
  if (task.readOnly || task.threadId !== parsed.threadId || task.demoRunId !== parsed.demoRunId)
    throw new Error('TASK_TOOL_RESULT_NOT_ALLOWED');
  const state = getState(sessionId);
  if (parsed.twinVersion !== state.twinVersion || parsed.dataAsOf !== state.finance.updatedAt)
    throw new Error('TASK_TWIN_VERSION_MISMATCH');
  for (const source of parsed.sourceEntities)
    if (!toolSourceExists(sessionId, task, state, source)) throw new Error('TASK_TOOL_SOURCE_NOT_FOUND');
  db.prepare(`INSERT OR IGNORE INTO agent_tool_results
    (id,session_id,thread_id,task_id,run_id,twin_version,tool,dedupe_key,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(parsed.toolResultId, sessionId, parsed.threadId, parsed.taskId,
    parsed.demoRunId, parsed.twinVersion, parsed.tool, dedupeKey, JSON.stringify(parsed));
  const row = db.prepare(`SELECT payload_json FROM agent_tool_results
    WHERE session_id=? AND thread_id=? AND run_id=? AND dedupe_key=?`)
    .get(sessionId, parsed.threadId, parsed.demoRunId, dedupeKey) as { payload_json: string };
  return AgentToolResultSchema.parse(JSON.parse(row.payload_json));
}

export function getAgentRun(sessionId: string, threadId: string, runId: string): AgentRun {
  const row = db.prepare(`SELECT payload_json FROM agent_task_runs WHERE run_id=? AND session_id=? AND thread_id=?`)
    .get(runId, sessionId, threadId) as { payload_json: string } | undefined;
  if (!row) throw new Error('AGENT_RUN_NOT_FOUND');
  return AgentRunSchema.parse(JSON.parse(row.payload_json));
}

export function claimAgentRun(sessionId: string, threadId: string, runId: string, workerToken: string): boolean {
  return Boolean(db.prepare(`UPDATE agent_task_runs SET worker_token=?
    WHERE run_id=? AND session_id=? AND thread_id=? AND status='running' AND worker_token IS NULL`)
    .run(workerToken, runId, sessionId, threadId).changes);
}

export function getLatestAgentRunForThread(sessionId: string, threadId: string): AgentRun | null {
  const task = getAgentTaskForThread(sessionId, threadId);
  if (!task) return null;
  const row = db.prepare(`SELECT payload_json FROM agent_task_runs
    WHERE session_id=? AND thread_id=? AND demo_run_id=? ORDER BY rowid DESC LIMIT 1`)
    .get(sessionId, threadId, task.demoRunId) as { payload_json: string } | undefined;
  return row ? AgentRunSchema.parse(JSON.parse(row.payload_json)) : null;
}

export function createAgentRun(sessionId: string, threadId: string, triggeringMessageId: string,
  deadlineMs = 75_000): AgentRun {
  const task = getAgentTaskForThread(sessionId, threadId);
  if (!task || task.readOnly || task.phase === 'completed' || task.phase === 'failed' || task.phase === 'paused' ||
    !task.facts.title || task.facts.targetCents === null || !task.facts.originalTargetDate)
    throw new Error('AGENT_RUN_TASK_NOT_READY');
  const message = db.prepare(`SELECT id FROM agent_messages
    WHERE id=? AND session_id=? AND thread_id=? AND role='user'`)
    .get(triggeringMessageId, sessionId, threadId);
  if (!message) throw new Error('AGENT_RUN_MESSAGE_NOT_FOUND');
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = db.prepare(`SELECT payload_json FROM agent_task_runs WHERE session_id=? AND thread_id=?
      AND demo_run_id=? AND triggering_message_id=?`)
      .get(sessionId, threadId, task.demoRunId, triggeringMessageId) as { payload_json: string } | undefined;
    if (previous) { db.exec('COMMIT'); return AgentRunSchema.parse(JSON.parse(previous.payload_json)); }
    const active = db.prepare(`SELECT payload_json FROM agent_task_runs
      WHERE session_id=? AND task_id=? AND status='running'`)
      .get(sessionId, task.taskId) as { payload_json: string } | undefined;
    if (active) { db.exec('COMMIT'); return AgentRunSchema.parse(JSON.parse(active.payload_json)); }
    const now = new Date().toISOString();
    const run = AgentRunSchema.parse({ runId: randomUUID(), taskId: task.taskId, threadId,
      demoRunId: task.demoRunId, triggeringMessageId, status: 'running', revision: 0,
      provider: null, startedAt: now, updatedAt: now,
      deadlineAt: new Date(Date.now() + deadlineMs).toISOString(), decisionCount: 0, toolCallCount: 0,
      reasonCode: null, recommendedResultIds: [], question: null,
      steps: [{ kind: 'started', summary: '开始读取当前模拟数据', at: now, toolResultId: null }] });
    db.prepare(`INSERT INTO agent_task_runs
      (run_id,session_id,thread_id,task_id,demo_run_id,triggering_message_id,revision,status,payload_json)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(run.runId, sessionId, threadId, task.taskId, task.demoRunId,
      triggeringMessageId, 0, run.status, JSON.stringify(run));
    db.exec('COMMIT');
    return run;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function updateAgentRun(sessionId: string, threadId: string, runId: string,
  expectedRevision: number, patch: Partial<AgentRun>): AgentRun {
  db.exec('BEGIN IMMEDIATE');
  try {
    const old = getAgentRun(sessionId, threadId, runId);
    if (old.revision !== expectedRevision) throw new Error('AGENT_RUN_REVISION_CONFLICT');
    if (old.status !== 'running') throw new Error('AGENT_RUN_NOT_RUNNING');
    const next = AgentRunSchema.parse({ ...old, ...patch, runId: old.runId, taskId: old.taskId,
      threadId: old.threadId, demoRunId: old.demoRunId, triggeringMessageId: old.triggeringMessageId,
      revision: old.revision + 1, updatedAt: new Date().toISOString() });
    const changed = db.prepare(`UPDATE agent_task_runs SET revision=?,status=?,payload_json=?
      WHERE run_id=? AND session_id=? AND thread_id=? AND revision=? AND status='running'`)
      .run(next.revision, next.status, JSON.stringify(next), runId, sessionId, threadId, expectedRevision);
    if (!changed.changes) throw new Error('AGENT_RUN_REVISION_CONFLICT');
    db.exec('COMMIT');
    return next;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function cancelAgentRun(sessionId: string, threadId: string, runId: string,
  reasonCode = 'USER_CANCELLED'): AgentRun {
  const run = getAgentRun(sessionId, threadId, runId);
  if (run.status !== 'running') return run;
  const at = new Date().toISOString();
  return updateAgentRun(sessionId, threadId, runId, run.revision, { status: 'cancelled', reasonCode,
    steps: [...run.steps.slice(-99), { kind: 'stopped', summary: reasonCode === 'SUPERSEDED'
      ? '收到新的任务条件，旧调查已停止' : '用户停止了本次调查', at, toolResultId: null }] });
}

export function cancelActiveAgentRunForThread(sessionId: string, threadId: string,
  reasonCode = 'SUPERSEDED'): AgentRun | null {
  const run = getLatestAgentRunForThread(sessionId, threadId);
  return run?.status === 'running' ? cancelAgentRun(sessionId, threadId, run.runId, reasonCode) : null;
}

export function createAgentTask(sessionId: string, threadId: string): AgentTask {
  const thread = getAgentThread(sessionId, threadId);
  if (thread.kind !== 'task' || thread.readOnly || thread.status !== 'active') throw new Error('TASK_THREAD_NOT_WRITABLE');
  const runId = currentRunId(sessionId);
  const existing = db.prepare('SELECT * FROM agent_tasks WHERE session_id=? AND thread_id=? AND run_id=?')
    .get(sessionId, threadId, runId) as Record<string, unknown> | undefined;
  if (existing) return taskFromRow(sessionId, existing);
  const draft = getGoalDraft(sessionId, threadId);
  const latestUser = db.prepare(`SELECT id FROM agent_messages WHERE session_id=? AND thread_id=? AND role='user'
    ORDER BY rowid DESC LIMIT 1`).get(sessionId, threadId) as { id: string } | undefined;
  const now = new Date().toISOString();
  const task = AgentTaskSchema.parse({ taskId: randomUUID(), threadId, demoRunId: runId,
    goalDraftId: draft?.id ?? null, goalId: draft?.goalId ?? null, phase: 'understanding', waitingReason: null,
    taskRevision: 0, baseTwinVersion: getState(sessionId).twinVersion,
    ...taskDraftFields(draft, latestUser?.id ?? null),
    candidateTargetDate: null, preferences: [],
    evidenceRefs: [], candidateRefs: [], runRecords: [], pendingActionId: null, nextCheck: null,
    createdAt: now, updatedAt: now, terminationReason: null, readOnly: false });
  db.prepare(`INSERT OR IGNORE INTO agent_tasks(task_id,session_id,thread_id,run_id,revision,phase,payload_json,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(task.taskId, sessionId, threadId, runId, 0, task.phase, JSON.stringify(task), now);
  return getAgentTaskForThread(sessionId, threadId)!;
}

export function getAgentTask(sessionId: string, taskId: string): AgentTask {
  const row = db.prepare('SELECT * FROM agent_tasks WHERE task_id=? AND session_id=?')
    .get(taskId, sessionId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('TASK_NOT_FOUND');
  return taskFromRow(sessionId, row);
}

export function getAgentTaskForThread(sessionId: string, threadId: string): AgentTask | null {
  getAgentThread(sessionId, threadId);
  const row = db.prepare('SELECT * FROM agent_tasks WHERE session_id=? AND thread_id=? AND run_id=?')
    .get(sessionId, threadId, currentRunId(sessionId)) as Record<string, unknown> | undefined;
  return row ? taskFromRow(sessionId, row) : null;
}

export function updateAgentTask(sessionId: string, taskId: string, expectedRevision: number,
  input: AgentTaskPatch): AgentTask {
  const patch = TaskPatchSchema.parse(input);
  db.exec('BEGIN IMMEDIATE');
  try {
    const old = getAgentTask(sessionId, taskId);
    if (old.readOnly) throw new Error('TASK_READ_ONLY');
    if (old.taskRevision !== expectedRevision) throw new Error('TASK_REVISION_CONFLICT');
    const phase = patch.phase ?? old.phase;
    if (phase !== old.phase && !taskTransitions[old.phase].includes(phase)) throw new Error('TASK_INVALID_TRANSITION');
    if (patch.goalDraftId !== undefined && patch.goalDraftId !== null &&
      getGoalDraft(sessionId, old.threadId)?.id !== patch.goalDraftId) throw new Error('TASK_DRAFT_NOT_FOUND');
    if (patch.goalId !== undefined && patch.goalId !== null) {
      const state = getState(sessionId);
      if (!state.goals.some(goal => goal.id === patch.goalId) && state.goal.id !== patch.goalId)
        throw new Error('TASK_GOAL_NOT_FOUND');
    }
    if (patch.baseTwinVersion !== undefined && patch.baseTwinVersion !== getState(sessionId).twinVersion)
      throw new Error('TASK_TWIN_VERSION_MISMATCH');
    const { runRecord, ...fields } = patch;
    const invalidatesCandidates = Boolean(
      patch.facts && JSON.stringify(patch.facts) !== JSON.stringify(old.facts) ||
      patch.constraints && JSON.stringify(patch.constraints) !== JSON.stringify(old.constraints) ||
      patch.preferences && JSON.stringify(patch.preferences) !== JSON.stringify(old.preferences) ||
      patch.baseTwinVersion !== undefined && patch.baseTwinVersion !== old.baseTwinVersion,
    );
    const updatedAt = new Date().toISOString();
    const next = AgentTaskSchema.parse({ ...old, ...fields, phase,
      candidateRefs: invalidatesCandidates ? [] : fields.candidateRefs ?? old.candidateRefs,
      candidateTargetDate: invalidatesCandidates ? null
        : fields.candidateTargetDate !== undefined ? fields.candidateTargetDate : old.candidateTargetDate,
      pendingActionId: invalidatesCandidates ? null
        : fields.pendingActionId !== undefined ? fields.pendingActionId : old.pendingActionId,
      runRecords: runRecord ? [...old.runRecords.slice(-99), runRecord] : old.runRecords,
      taskRevision: old.taskRevision + 1, updatedAt, readOnly: false });
    validateTaskSources(sessionId, old.threadId, next);
    const result = db.prepare(`UPDATE agent_tasks SET revision=?,phase=?,payload_json=?,updated_at=?
      WHERE task_id=? AND session_id=? AND run_id=? AND revision=?`).run(next.taskRevision, next.phase,
      JSON.stringify(next), updatedAt, taskId, sessionId, old.demoRunId, expectedRevision);
    if (!result.changes) throw new Error('TASK_REVISION_CONFLICT');
    if (next.phase === 'paused' || next.phase === 'completed' || next.phase === 'failed' ||
      (['monitoring', 'awaiting_confirmation'].includes(old.phase) &&
        !['monitoring', 'awaiting_confirmation'].includes(next.phase)))
      db.prepare(`UPDATE monitor_subscriptions SET status=?,updated_at=? WHERE session_id=? AND task_id=? AND status='active'`)
        .run(next.phase === 'completed' || next.phase === 'failed' ? 'cancelled' : 'paused',
          updatedAt, sessionId, taskId);
    db.exec('COMMIT');
    return next;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function pauseAgentTask(sessionId: string, taskId: string, expectedRevision: number): AgentTask {
  return updateAgentTask(sessionId, taskId, expectedRevision, { phase: 'paused', waitingReason: 'user_paused' });
}

export function resumeAgentTask(sessionId: string, taskId: string, expectedRevision: number,
  phase: 'understanding' | 'investigating' | 'simulating' | 'monitoring' = 'understanding'): AgentTask {
  if (getAgentTask(sessionId, taskId).phase !== 'paused') throw new Error('TASK_NOT_PAUSED');
  return updateAgentTask(sessionId, taskId, expectedRevision, { phase, waitingReason: null });
}

export function cancelAgentTask(sessionId: string, taskId: string, expectedRevision: number): AgentTask {
  return updateAgentTask(sessionId, taskId, expectedRevision,
    { phase: 'completed', waitingReason: null, terminationReason: 'cancelled', pendingActionId: null, nextCheck: null });
}

function threadFromRow(row: Record<string, unknown>): AgentThread {
  return AgentThreadSchema.parse({ id: row.id, title: row.title, kind: row.kind, status: row.status,
    unread: Boolean(row.unread), readOnly: Boolean(row.read_only), createdAt: row.created_at, updatedAt: row.updated_at });
}

export function createAgentThread(sessionId: string, input: {
  title: string; kind?: 'task' | 'risk' | 'summary'; unread?: boolean; dedupeKey?: string;
}): AgentThread {
  const runId = currentRunId(sessionId);
  const storedDedupeKey = input.dedupeKey ? `${runId}:${input.dedupeKey}` : null;
  if (input.dedupeKey) {
    const existing = db.prepare('SELECT * FROM agent_threads WHERE session_id=? AND run_id=? AND dedupe_key=?')
      .get(sessionId, runId, storedDedupeKey) as Record<string, unknown> | undefined;
    if (existing) return threadFromRow(existing);
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO agent_threads(id,session_id,run_id,title,kind,status,unread,read_only,dedupe_key,created_at,updated_at)
    VALUES(?,?,?,?,?,'active',?,0,?,?,?)`).run(id, sessionId, runId, input.title,
      input.kind ?? 'task', input.unread ? 1 : 0, storedDedupeKey, now, now);
  return AgentThreadSchema.parse({ id, title: input.title, kind: input.kind ?? 'task', status: 'active',
    unread: Boolean(input.unread), readOnly: false, createdAt: now, updatedAt: now });
}

export function listAgentThreads(sessionId: string, includeArchived = false): AgentThread[] {
  const rows = db.prepare(`SELECT * FROM agent_threads WHERE session_id=? ${includeArchived ? '' : "AND status='active'"}
    ORDER BY unread DESC, updated_at DESC`).all(sessionId) as Array<Record<string, unknown>>;
  return rows.map(threadFromRow);
}

export function getAgentThread(sessionId: string, threadId: string): AgentThread {
  const row = db.prepare('SELECT * FROM agent_threads WHERE id=? AND session_id=?').get(threadId, sessionId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('THREAD_NOT_FOUND');
  return threadFromRow(row);
}

export function renameAgentThread(sessionId: string, threadId: string, title: string): AgentThread {
  getAgentThread(sessionId, threadId);
  db.prepare('UPDATE agent_threads SET title=?,updated_at=? WHERE id=? AND session_id=?')
    .run(title.slice(0, 80), new Date().toISOString(), threadId, sessionId);
  return getAgentThread(sessionId, threadId);
}

export function setAgentThreadStatus(sessionId: string, threadId: string, status: 'active' | 'archived') {
  getAgentThread(sessionId, threadId);
  db.exec('BEGIN IMMEDIATE');
  try {
    const updatedAt = new Date().toISOString();
    db.prepare('UPDATE agent_threads SET status=?,updated_at=? WHERE id=? AND session_id=?')
      .run(status, updatedAt, threadId, sessionId);
    if (status === 'archived') {
      db.prepare("UPDATE monitor_subscriptions SET status='paused',updated_at=? WHERE session_id=? AND thread_id=? AND status='active'")
        .run(updatedAt, sessionId, threadId);
      const rows = db.prepare('SELECT * FROM agent_tasks WHERE session_id=? AND thread_id=? AND run_id=?')
        .all(sessionId, threadId, currentRunId(sessionId)) as Array<Record<string, unknown>>;
      for (const row of rows) {
        const old = AgentTaskSchema.parse(JSON.parse(String(row.payload_json)));
        if (old.phase === 'completed' || old.phase === 'failed' || old.phase === 'paused') continue;
        const next = AgentTaskSchema.parse({ ...old, phase: 'paused', waitingReason: 'thread_archived',
          taskRevision: old.taskRevision + 1, updatedAt, readOnly: true });
        db.prepare('UPDATE agent_tasks SET revision=?,phase=?,payload_json=?,updated_at=? WHERE task_id=? AND session_id=?')
          .run(next.taskRevision, next.phase, JSON.stringify(next), updatedAt, next.taskId, sessionId);
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return getAgentThread(sessionId, threadId);
}

export function markAgentThreadRead(sessionId: string, threadId: string) {
  getAgentThread(sessionId, threadId);
  db.prepare('UPDATE agent_threads SET unread=0 WHERE id=? AND session_id=?').run(threadId, sessionId);
}

export function markAgentThreadUnread(sessionId: string, threadId: string) {
  getAgentThread(sessionId, threadId);
  db.prepare('UPDATE agent_threads SET unread=1,updated_at=? WHERE id=? AND session_id=?')
    .run(new Date().toISOString(), threadId, sessionId);
  return getAgentThread(sessionId, threadId);
}

export function deleteAgentThread(sessionId: string, threadId: string) {
  getAgentThread(sessionId, threadId);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE monitor_events SET status='stale',processed_at=? WHERE session_id=? AND task_id IN (SELECT task_id FROM monitor_subscriptions WHERE session_id=? AND thread_id=?) AND status IN ('pending','leased')")
      .run(new Date().toISOString(), sessionId, sessionId, threadId);
    db.prepare('DELETE FROM monitor_subscriptions WHERE session_id=? AND thread_id=?').run(sessionId, threadId);
    for (const table of ['agent_messages', 'agent_actions', 'agent_components', 'agent_turns', 'goal_drafts', 'agent_tasks', 'agent_tool_results', 'agent_task_runs'])
      db.prepare(`DELETE FROM ${table} WHERE thread_id=? AND session_id=?`).run(threadId, sessionId);
    db.prepare('DELETE FROM agent_threads WHERE id=? AND session_id=?').run(threadId, sessionId);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function getGoalDraft(sessionId: string, threadId: string): GoalDraft | null {
  const row = db.prepare('SELECT payload_json FROM goal_drafts WHERE session_id=? AND thread_id=?')
    .get(sessionId, threadId) as { payload_json: string } | undefined;
  return row ? GoalDraftSchema.parse(JSON.parse(row.payload_json)) : null;
}

export function saveGoalDraft(sessionId: string, draft: GoalDraft): GoalDraft {
  const parsed = GoalDraftSchema.parse(draft);
  const thread = getAgentThread(sessionId, parsed.threadId);
  if (thread.readOnly || thread.status !== 'active') throw new Error('THREAD_READ_ONLY');
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = getGoalDraft(sessionId, parsed.threadId);
    db.prepare(`INSERT INTO goal_drafts(session_id,thread_id,payload_json,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(session_id,thread_id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .run(sessionId, parsed.threadId, JSON.stringify(parsed), parsed.updatedAt);
    const task = getAgentTaskForThread(sessionId, parsed.threadId);
    if (!task) createAgentTask(sessionId, parsed.threadId);
    else if (task.phase !== 'completed' && task.phase !== 'failed') {
      const fields = taskDraftFields(parsed);
      const latestUser = db.prepare(`SELECT id FROM agent_messages WHERE session_id=? AND thread_id=? AND role='user'
        ORDER BY rowid DESC LIMIT 1`).get(sessionId, parsed.threadId) as { id: string } | undefined;
      const sourceFields = { ...task.fieldSources };
      const changes: Record<string, [unknown, unknown]> = {
        title: [previous?.title, parsed.title], targetCents: [previous?.targetCents, parsed.targetCents],
        targetDate: [previous?.targetDate, parsed.targetDate], savedCents: [previous?.savedCents, parsed.savedCents],
        monthlyContributionCents: [previous?.monthlyContributionCapCents, parsed.monthlyContributionCapCents],
        protectedCents: [previous?.protectedCents, parsed.protectedCents],
      };
      const changed = Object.values(changes).some(([before, after]) => before !== after);
      for (const [key, [before, after]] of Object.entries(changes)) if (before !== after) {
        if (after === null) { delete sourceFields[key]; continue; }
        const kind = parsed.fieldSources[key] ?? 'user_provided';
        sourceFields[key] = { kind: kind === 'user_provided' ? 'user_message' : kind,
          messageId: kind === 'user_provided' ? latestUser?.id ?? null : null,
          confirmation: kind === 'user_provided' ? 'unconfirmed' : 'system_verified' };
      }
      if (changed || task.goalDraftId !== parsed.id || task.goalId !== parsed.goalId) {
        const updatedAt = new Date().toISOString();
        const phase = changed && task.phase !== 'paused' ? 'understanding' : task.phase;
        const next = AgentTaskSchema.parse({ ...task, goalDraftId: parsed.id, goalId: parsed.goalId ?? task.goalId,
        phase, waitingReason: phase === 'understanding' ? null : task.waitingReason,
        facts: fields.facts, constraints: { ...task.constraints,
          latestAllowedDate: task.facts.originalTargetDate === fields.facts.originalTargetDate
            ? task.constraints.latestAllowedDate : null,
          monthlyContributionCapCents: fields.constraints.monthlyContributionCapCents,
          protectedCents: fields.constraints.protectedCents },
        candidateTargetDate: changed ? null : task.candidateTargetDate,
        candidateRefs: changed ? [] : task.candidateRefs,
        pendingActionId: changed ? null : task.pendingActionId,
        nextCheck: changed ? null : task.nextCheck,
        fieldSources: sourceFields,
        unknowns: [...new Set([...task.unknowns.filter(key => !['title', 'targetCents', 'targetDate'].includes(key)),
          ...parsed.missingRequiredFields])], taskRevision: task.taskRevision + 1, updatedAt });
      validateTaskSources(sessionId, parsed.threadId, next);
      db.prepare('UPDATE agent_tasks SET revision=?,phase=?,payload_json=?,updated_at=? WHERE task_id=? AND session_id=?')
        .run(next.taskRevision, next.phase, JSON.stringify(next), updatedAt, next.taskId, sessionId);
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return parsed;
}

export function saveAgentTurnRecord(sessionId: string, input: { id: string; threadId: string; intent: string;
  provider: string; fallbackReason: string | null; twinVersion: number; components: AgentComponent[] }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO agent_turns(id,session_id,thread_id,intent,provider,fallback_reason,twin_version,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(input.id, sessionId, input.threadId, input.intent, input.provider,
      input.fallbackReason, input.twinVersion, now);
  const insert = db.prepare(`INSERT INTO agent_components(id,session_id,thread_id,turn_id,component_type,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?)`);
  for (const component of input.components) insert.run(component.id, sessionId, input.threadId, input.id,
    component.type, JSON.stringify(component), now);
}

export function agentArtifactCounts(sessionId: string) {
  const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id=?`)
    .get(sessionId) as { count: number }).count);
  return { turns: count('agent_turns'), components: count('agent_components') };
}

export function agentActionCount(sessionId: string): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM agent_actions WHERE session_id=?')
    .get(sessionId) as { count: number }).count;
}

export function saveAgentMessage(sessionId: string, threadId: string, input: {
  role: AgentMessage['role']; content: string; components: AgentComponent[];
}): AgentMessage {
  const thread = getAgentThread(sessionId, threadId);
  if (thread.readOnly) throw new Error('THREAD_READ_ONLY');
  const message = AgentMessageSchema.parse({ id: randomUUID(), threadId, role: input.role,
    content: input.content, components: input.components, createdAt: new Date().toISOString() });
  db.prepare(`INSERT INTO agent_messages(id,session_id,thread_id,role,content,components_json,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(message.id, sessionId, threadId, message.role, message.content,
      JSON.stringify(message.components), message.createdAt);
  db.prepare('UPDATE agent_threads SET updated_at=? WHERE id=? AND session_id=?')
    .run(message.createdAt, threadId, sessionId);
  return message;
}

export function getAgentMessages(sessionId: string, threadId: string, limit = 100): AgentMessage[] {
  getAgentThread(sessionId, threadId);
  const rows = db.prepare(`SELECT * FROM (SELECT rowid AS insertion_order,* FROM agent_messages WHERE session_id=? AND thread_id=?
    ORDER BY created_at DESC,rowid DESC LIMIT ?) ORDER BY created_at ASC,insertion_order ASC`).all(sessionId, threadId, limit) as Array<Record<string, unknown>>;
  return rows.map(row => AgentMessageSchema.parse({ id: row.id, threadId: row.thread_id, role: row.role,
    content: row.content, components: AgentComponentSchema.array().parse(JSON.parse(String(row.components_json))), createdAt: row.created_at }));
}

export interface StoredAgentAction {
  id: string; threadId: string; actionType: string; twinVersion: number; status: string;
  payload: Record<string, unknown>; result: unknown; expiresAt: string; idempotencyKey: string;
}
export function createAgentAction(sessionId: string, threadId: string, actionType: string,
  twinVersion: number, payload: Record<string, unknown>): StoredAgentAction {
  const id = randomUUID(); const now = new Date(); const idempotencyKey = randomUUID();
  const action = { id, threadId, actionType, twinVersion, status: 'pending', payload, result: null,
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(), idempotencyKey };
  db.prepare(`INSERT INTO agent_actions(id,session_id,thread_id,action_type,twin_version,status,payload_json,result_json,expires_at,idempotency_key,created_at)
    VALUES(?,?,?,?,?,'pending',?,NULL,?,?,?)`).run(id, sessionId, threadId, actionType, twinVersion,
      JSON.stringify(payload), action.expiresAt, idempotencyKey, now.toISOString());
  return action;
}

export function getAgentAction(sessionId: string, actionId: string): StoredAgentAction {
  const row = db.prepare('SELECT * FROM agent_actions WHERE id=? AND session_id=?').get(actionId, sessionId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('AGENT_ACTION_NOT_FOUND');
  return { id: String(row.id), threadId: String(row.thread_id), actionType: String(row.action_type),
    twinVersion: Number(row.twin_version), status: String(row.status), payload: JSON.parse(String(row.payload_json)),
    result: row.result_json ? JSON.parse(String(row.result_json)) : null, expiresAt: String(row.expires_at),
    idempotencyKey: String(row.idempotency_key) };
}

export function finishAgentAction(sessionId: string, actionId: string, status: 'consumed' | 'cancelled', result: unknown) {
  db.prepare('UPDATE agent_actions SET status=?,result_json=? WHERE id=? AND session_id=?')
    .run(status, JSON.stringify(result), actionId, sessionId);
  return getAgentAction(sessionId, actionId);
}

export function tickFinancialServices() {
  const sessions = db.prepare(`SELECT id FROM demo_sessions WHERE
    EXISTS(SELECT 1 FROM json_each(state_json,'$.financialServices.investments') WHERE json_extract(value,'$.status') IN ('pending','unknown') AND json_extract(value,'$.settlesOn') <= json_extract(state_json,'$.clock'))
    OR EXISTS(SELECT 1 FROM json_each(state_json,'$.financialServices.bookings') WHERE json_extract(value,'$.status') = 'refund_pending' AND json_extract(value,'$.refundOn') <= json_extract(state_json,'$.clock')) LIMIT 100`).all() as Array<{id:string}>;
  for (const session of sessions) mutateState(session.id, s => reconcileServices(s));
  return sessions.length;
}
export function tickGoalNoticeQueue(){const sessions=db.prepare('SELECT id FROM demo_sessions ORDER BY updated_at LIMIT 100').all() as Array<{id:string}>;for(const session of sessions)mutateState(session.id,s=>tickGoalNotices(s));return sessions.length;}
export function tickSubscriptionReminderQueue(now=new Date()){
 const sessions=db.prepare(`SELECT id FROM demo_sessions WHERE EXISTS(SELECT 1 FROM json_each(state_json,'$.subscriptionActions') WHERE json_extract(value,'$.action')='remind') ORDER BY updated_at LIMIT 100`).all() as Array<{id:string}>;
 for(const session of sessions)mutateState(session.id,state=>tickSubscriptionNotifications(state,now));
 return sessions.length;
}

export interface MonitorEvent {
  id: string; sessionId: string; taskId: string; demoRunId: string; goalId: string;
  twinVersion: number; kind: 'twin_changed' | 'bonus_followup' | 'transfer_outcome'; status: string;
  dueDemoDate: string | null; attempts: number; leaseToken: string; payload: Record<string, unknown>;
}

export function monitorStatus(sessionId: string, threadId: string) {
  const task = getAgentTaskForThread(sessionId, threadId);
  if (!task) return { enabled: false, goalId: null, status: null, pendingEvents: 0 };
  const row = db.prepare(`SELECT status,goal_id FROM monitor_subscriptions WHERE session_id=? AND task_id=?`)
    .get(sessionId, task.taskId) as { status: 'active' | 'paused' | 'cancelled'; goal_id: string } | undefined;
  const pending = db.prepare(`SELECT COUNT(*) AS count FROM monitor_events WHERE session_id=? AND task_id=?
    AND status IN ('pending','leased')`).get(sessionId, task.taskId) as { count: number };
  return { enabled: row?.status === 'active', goalId: row?.goal_id ?? null,
    status: row?.status ?? null, pendingEvents: pending.count };
}

export function setMonitorSubscription(sessionId: string, threadId: string, enabled: boolean) {
  const thread = getAgentThread(sessionId, threadId);
  const task = getAgentTaskForThread(sessionId, threadId);
  const state = getState(sessionId);
  if (!task || task.readOnly || thread.readOnly || thread.status !== 'active' ||
    task.demoRunId !== currentRunId(sessionId)) throw new Error('MONITOR_TASK_UNAVAILABLE');
  const goal = state.goals.find(item => item.id === task.goalId);
  if (enabled && (!goal || goal.status !== 'active' || state.primaryGoalId !== goal.id))
    throw new Error('MONITOR_GOAL_NOT_ACTIVE');
  const existing = monitorStatus(sessionId, threadId);
  const goalId = goal?.id ?? existing.goalId;
  if (!goalId) throw new Error('MONITOR_GOAL_NOT_FOUND');
  if (enabled && existing.enabled || !enabled && existing.status !== 'active') return existing;
  if (enabled && !['completed', 'paused', 'monitoring'].includes(task.phase))
    throw new Error('MONITOR_TASK_NOT_READY');
  if (enabled) updateAgentTask(sessionId, task.taskId, task.taskRevision,
    { phase: 'monitoring', waitingReason: null, terminationReason: null, goalId });
  else if (task.phase === 'monitoring') updateAgentTask(sessionId, task.taskId, task.taskRevision,
    { phase: 'paused', waitingReason: 'user_paused' });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO monitor_subscriptions(session_id,task_id,thread_id,demo_run_id,goal_id,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(session_id,task_id) DO UPDATE SET status=excluded.status,
    goal_id=excluded.goal_id,updated_at=excluded.updated_at`)
    .run(sessionId, task.taskId, threadId, task.demoRunId, goalId, enabled ? 'active' : 'paused', now, now);
  if (enabled) db.prepare(`INSERT OR IGNORE INTO monitor_events(id,session_id,task_id,demo_run_id,goal_id,
    twin_version,kind,dedupe_key,status,due_demo_date,available_at,lease_token,lease_until,attempts,payload_json,created_at)
    VALUES(?,?,?,?,?,?,'twin_changed',?,'pending',NULL,?,NULL,NULL,0,?,?)`)
    .run(randomUUID(), sessionId, task.taskId, task.demoRunId, goalId, state.twinVersion,
      `twin:${task.taskId}:${state.twinVersion}`, now, JSON.stringify({ initial: true, asOf: state.clock }), now);
  return monitorStatus(sessionId, threadId);
}

export function claimMonitorEvent(now = new Date()): MonitorEvent | null {
  const timestamp = now.toISOString();
  const row = db.prepare(`SELECT e.* FROM monitor_events e JOIN demo_sessions d ON d.id=e.session_id
    WHERE (e.status='pending' OR (e.status='leased' AND e.lease_until<=?))
    AND e.available_at<=? AND (e.due_demo_date IS NULL OR json_extract(d.state_json,'$.clock')>=e.due_demo_date)
    ORDER BY e.available_at,e.created_at LIMIT 1`).get(timestamp, timestamp) as Record<string, unknown> | undefined;
  if (!row) return null;
  const leaseToken = randomUUID();
  const changed = db.prepare(`UPDATE monitor_events SET status='leased',lease_token=?,lease_until=?,attempts=attempts+1
    WHERE id=? AND (status='pending' OR (status='leased' AND lease_until<=?))`)
    .run(leaseToken, new Date(now.getTime() + 30_000).toISOString(), String(row.id), timestamp);
  if (!changed.changes) return null;
  return { id: String(row.id), sessionId: String(row.session_id), taskId: String(row.task_id),
    demoRunId: String(row.demo_run_id), goalId: String(row.goal_id), twinVersion: Number(row.twin_version),
    kind: String(row.kind) as MonitorEvent['kind'], status: 'leased', dueDemoDate: row.due_demo_date as string | null,
    attempts: Number(row.attempts) + 1, leaseToken, payload: JSON.parse(String(row.payload_json)) };
}

export function finishMonitorEvent(event: MonitorEvent, status: 'done' | 'stale' | 'dead' | 'pending',
  now = new Date()): void {
  const next = status === 'pending' ? new Date(now.getTime() + Math.min(60_000, 1_000 * 2 ** event.attempts)).toISOString()
    : now.toISOString();
  db.prepare(`UPDATE monitor_events SET status=?,available_at=?,lease_token=NULL,lease_until=NULL,processed_at=?
    WHERE id=? AND session_id=? AND status='leased' AND lease_token=?`)
    .run(status, next, status === 'pending' ? null : now.toISOString(), event.id, event.sessionId, event.leaseToken);
}

export function deferMonitorEvent(event: MonitorEvent, availableAt: string): void {
  db.prepare(`UPDATE monitor_events SET status='pending',available_at=?,lease_token=NULL,lease_until=NULL,
    attempts=MAX(0,attempts-1)
    WHERE id=? AND session_id=? AND status='leased' AND lease_token=?`)
    .run(availableAt, event.id, event.sessionId, event.leaseToken);
}

export function monitorEventIsCurrent(event: MonitorEvent): boolean {
  if (event.kind === 'transfer_outcome') return currentRunId(event.sessionId) === event.demoRunId &&
    getState(event.sessionId).transferExecutions.some(item => item.id === event.payload.executionId &&
      ['failed', 'unknown', 'skipped_missing_trigger'].includes(item.status));
  const subscription = db.prepare(`SELECT * FROM monitor_subscriptions WHERE session_id=? AND task_id=?`)
    .get(event.sessionId, event.taskId) as Record<string, unknown> | undefined;
  if (!subscription || subscription.status !== 'active' || subscription.demo_run_id !== event.demoRunId ||
    subscription.goal_id !== event.goalId || currentRunId(event.sessionId) !== event.demoRunId) return false;
  const task = getAgentTaskForThread(event.sessionId, String(subscription.thread_id));
  const thread = getAgentThread(event.sessionId, String(subscription.thread_id));
  const state = getState(event.sessionId);
  return Boolean(task && task.taskId === event.taskId &&
    ['monitoring', 'awaiting_confirmation'].includes(task.phase) &&
    !task.readOnly && thread.status === 'active' && !thread.readOnly &&
    (event.kind === 'bonus_followup' || state.twinVersion === event.twinVersion) &&
    state.primaryGoalId === event.goalId &&
    state.goals.some(item => item.id === event.goalId && item.status === 'active'));
}

export function scheduleBonusFollowup(sessionId: string, threadId: string): string {
  if (!monitorStatus(sessionId, threadId).enabled) throw new Error('MONITOR_NOT_ENABLED');
  const task = getAgentTaskForThread(sessionId, threadId)!;
  const state = getState(sessionId);
  const [year, month] = state.clock.split('-').map(Number);
  const dueDemoDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO monitor_events(id,session_id,task_id,demo_run_id,goal_id,
    twin_version,kind,dedupe_key,status,due_demo_date,available_at,lease_token,lease_until,attempts,payload_json,created_at)
    VALUES(?,?,?,?,?,?,'bonus_followup',?,'pending',?,?,NULL,NULL,0,?,?)`)
    .run(randomUUID(), sessionId, task.taskId, task.demoRunId, task.goalId,
      state.twinVersion, `bonus:${task.taskId}:${dueDemoDate}`, dueDemoDate, now,
      JSON.stringify({ question: '奖金是否到账', plannedAsOf: state.clock }), now);
  return dueDemoDate;
}

export function monitorThreadId(event: MonitorEvent): string {
  if (event.kind === 'transfer_outcome') return createAgentThread(event.sessionId,
    { title: '转账计划 · 需要核对', kind: 'risk', dedupeKey: `transfer:${event.payload.scheduleId}` }).id;
  const row = db.prepare(`SELECT thread_id FROM monitor_subscriptions WHERE session_id=? AND task_id=?`)
    .get(event.sessionId, event.taskId) as { thread_id: string } | undefined;
  if (!row) throw new Error('MONITOR_SUBSCRIPTION_NOT_FOUND');
  return row.thread_id;
}

export function enqueueTransferOutcome(sessionId: string, goalId: string, execution: TransferExecution,
  now = new Date()): void {
  const state = getState(sessionId);
  db.prepare(`INSERT OR IGNORE INTO monitor_events(id,session_id,task_id,demo_run_id,goal_id,
    twin_version,kind,dedupe_key,status,due_demo_date,available_at,attempts,payload_json,created_at)
    VALUES(?,?,?,?,?,?,'transfer_outcome',?,'pending',NULL,?,0,?,?)`)
    .run(randomUUID(), sessionId, `schedule:${execution.scheduleId}`, currentRunId(sessionId), goalId,
      state.twinVersion, `transfer:${execution.id}`, now.toISOString(),
      JSON.stringify({ executionId: execution.id, scheduleId: execution.scheduleId, status: execution.status,
        reason: execution.reason }), now.toISOString());
}

export function monitorSubjectAlreadyDelivered(sessionId: string, subjectKey: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM monitor_notifications WHERE session_id=? AND subject_key=?')
    .get(sessionId, subjectKey));
}

export function deliverMonitorNotification(event: MonitorEvent, threadId: string,
  content: string, components: AgentComponent[], candidateResultId: string | null,
  subjectKey: string): AgentMessage | null {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!monitorEventIsCurrent(event)) { finishMonitorEvent(event, 'stale'); db.exec('COMMIT'); return null; }
    const prior = db.prepare(`SELECT message_id FROM monitor_notifications
      WHERE session_id=? AND (event_id=? OR subject_key=?)`)
      .get(event.sessionId, event.id, subjectKey) as { message_id: string } | undefined;
    if (prior) { finishMonitorEvent(event, 'done'); db.exec('COMMIT'); return null; }
    const message = saveAgentMessage(event.sessionId, threadId, { role: 'assistant', content, components });
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO monitor_notifications(session_id,event_id,thread_id,message_id,candidate_result_id,
      subject_key,twin_version,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(event.sessionId, event.id, threadId, message.id, candidateResultId, subjectKey, event.twinVersion, now);
    markAgentThreadUnread(event.sessionId, threadId);
    finishMonitorEvent(event, 'done');
    db.exec('COMMIT');
    return message;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function monitorRecommendationIsCurrent(sessionId: string, threadId: string, resultId: string,
  twinVersion: number): boolean {
  const row = db.prepare(`SELECT n.event_id FROM monitor_notifications n
    JOIN monitor_events e ON e.id=n.event_id AND e.session_id=n.session_id
    JOIN monitor_subscriptions s ON s.session_id=e.session_id AND s.task_id=e.task_id
    WHERE n.session_id=? AND s.thread_id=? AND n.candidate_result_id=? AND n.twin_version=?
      AND s.status='active' AND e.status='done' ORDER BY n.created_at DESC LIMIT 1`)
    .get(sessionId, threadId, resultId, twinVersion) as { event_id: string } | undefined;
  return Boolean(row);
}

export function listMonitorEvents(sessionId: string): Array<{ id: string; kind: string; status: string;
  twinVersion: number; attempts: number; dueDemoDate: string | null }> {
  const rows = db.prepare(`SELECT id,kind,status,twin_version,attempts,due_demo_date
    FROM monitor_events WHERE session_id=? ORDER BY created_at,rowid`).all(sessionId) as Array<Record<string, unknown>>;
  return rows.map(row => ({ id: String(row.id), kind: String(row.kind), status: String(row.status),
    twinVersion: Number(row.twin_version), attempts: Number(row.attempts),
    dueDemoDate: row.due_demo_date as string | null }));
}

export function artifactCounts(sessionId: string) {
  const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id=?`)
    .get(sessionId) as { count: number }).count);
  return {
    approvals: count('approval_artifacts'), nonces: count('nonce_artifacts'),
    operations: count('operation_artifacts'), receipts: count('receipt_artifacts'),
  };
}

export function storedAuditChain(sessionId: string) {
  return db.prepare(`SELECT sequence,previous_hash AS previousHash,event_hash AS eventHash,twin_version AS twinVersion
    FROM audit_events WHERE session_id=? ORDER BY sequence`).all(sessionId) as Array<{
      sequence: number; previousHash: string; eventHash: string; twinVersion: number;
    }>;
}

export function closeStore() { db.close(); }

// Global control is deliberately independent of demo sessions and reset operations.
db.exec(`CREATE TABLE IF NOT EXISTS ai_safety_control (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), mode TEXT NOT NULL,
  activated_at TEXT, reason_code TEXT);
  INSERT OR IGNORE INTO ai_safety_control(singleton,mode,activated_at,reason_code) VALUES(1,'normal',NULL,NULL);`);
ensureColumn('ai_safety_control', 'cancellation_generation', 'INTEGER NOT NULL DEFAULT 0');
export function aiSafetyCancellationGeneration(): number {
  return (db.prepare('SELECT cancellation_generation FROM ai_safety_control WHERE singleton=1').get() as { cancellation_generation: number }).cancellation_generation;
}
export function readAiSafetyControl() {
  return db.prepare('SELECT mode, activated_at AS activatedAt, reason_code AS reasonCode FROM ai_safety_control WHERE singleton=1').get() as
    Pick<import('../shared/contracts.ts').AiSafetyControl, 'mode' | 'activatedAt' | 'reasonCode'>;
}
export function persistAiSafetyMode(enabled: boolean, reasonCode: NonNullable<import('../shared/contracts.ts').AiSafetyControl['reasonCode']>): boolean {
  db.exec('BEGIN IMMEDIATE');
  try {
    const mode = enabled ? 'safe_mode' : 'normal';
    if (readAiSafetyControl().mode === mode) { db.exec('COMMIT'); return false; }
    const at = new Date().toISOString();
    db.prepare('UPDATE ai_safety_control SET mode=?,activated_at=?,reason_code=?,cancellation_generation=cancellation_generation+? WHERE singleton=1')
      .run(mode, enabled ? at : null, enabled ? reasonCode : null, enabled ? 1 : 0);
    if (enabled) {
      const rows = db.prepare("SELECT run_id,payload_json FROM agent_task_runs WHERE status='running'").all() as Array<{run_id:string;payload_json:string}>;
      for (const row of rows) {
        const run = AgentRunSchema.parse(JSON.parse(row.payload_json));
        const next = AgentRunSchema.parse({ ...run, status: 'cancelled', reasonCode: 'AI_SAFE_MODE', revision: run.revision + 1, updatedAt: at });
        db.prepare("UPDATE agent_task_runs SET status='cancelled',revision=?,payload_json=? WHERE run_id=?")
          .run(next.revision, JSON.stringify(next), row.run_id);
      }
    }
    db.exec('COMMIT'); return true;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/** Receipt projections deliberately exclude prompts, messages, payloads and thread-wide turns. */
export function getAiSafetyReceiptFacts(sessionId: string, runId: string) {
  const run = db.prepare(`SELECT run_id AS runId, status,
    json_extract(payload_json,'$.provider') AS provider,
    json_extract(payload_json,'$.reasonCode') AS reasonCode,
    json_extract(payload_json,'$.decisionCount') AS decisionCount,
    json_extract(payload_json,'$.toolCallCount') AS toolCallCount,
    json_extract(payload_json,'$.startedAt') AS startedAt,
    json_extract(payload_json,'$.updatedAt') AS updatedAt
    FROM agent_task_runs WHERE session_id=? AND run_id=?
    AND EXISTS (SELECT 1 FROM demo_sessions d WHERE d.id=agent_task_runs.session_id)`).get(sessionId, runId);
  if (!run) return null;
  const tools = db.prepare(`SELECT DISTINCT t.id AS evidenceId, t.tool AS name,
    json_extract(t.payload_json,'$.status') AS status, t.twin_version AS twinVersion
    FROM agent_task_runs r JOIN agent_tool_results t
      ON t.session_id=r.session_id AND t.thread_id=r.thread_id
      AND t.task_id=r.task_id AND t.run_id=r.demo_run_id
    WHERE r.session_id=? AND r.run_id=? AND (
      EXISTS (SELECT 1 FROM json_each(r.payload_json,'$.steps') s
        WHERE json_extract(s.value,'$.toolResultId')=t.id)
      OR EXISTS (SELECT 1 FROM json_each(r.payload_json,'$.recommendedResultIds') s WHERE s.value=t.id))`)
    .all(sessionId, runId);
  const audit = db.prepare(`SELECT json_extract(d.state_json,'$.audit') AS events
    FROM demo_sessions d JOIN agent_task_runs r ON r.session_id=d.id
    WHERE r.session_id=? AND r.run_id=?`).get(sessionId,runId) as {events:string}|undefined;
  const actions = db.prepare(`SELECT a.status FROM agent_task_runs r JOIN agent_actions a
    ON a.session_id=r.session_id AND a.thread_id=r.thread_id
    AND json_extract(a.payload_json,'$.taskId')=r.task_id
    AND json_extract(a.payload_json,'$.demoRunId')=r.demo_run_id
    WHERE r.session_id=? AND r.run_id=? AND a.action_type='apply_verified_candidate'
    AND EXISTS (SELECT 1 FROM json_each(r.payload_json,'$.recommendedResultIds') x
      WHERE x.value=json_extract(a.payload_json,'$.resultId'))`).all(sessionId,runId);
  return { run, tools, actions, auditChainValid: audit ? verifyAuditChain(JSON.parse(audit.events)) : null };
}
