import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentComponentSchema, AgentMessageSchema, AgentThreadSchema, DemoStateSchema,
  type AgentComponent, type AgentMessage, type AgentThread, type DemoState } from '../shared/contracts.ts';
import { createFixture } from './fixtures.ts';

const dbPath = resolve(process.env.NOVA_DB_PATH || './data/nova.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
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
);`);

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
for (const [column, definition] of [
  ['request_id', 'TEXT'], ['approval_id', 'TEXT'], ['twin_version', 'INTEGER'], ['sequence', 'INTEGER'],
  ['previous_hash', 'TEXT'], ['event_hash', 'TEXT'],
] as const) ensureColumn('audit_events', column, definition);

function syncArtifacts(sessionId: string, state: DemoState) {
  db.prepare(`INSERT INTO risk_preferences(session_id,payload_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(session_id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
    .run(sessionId, JSON.stringify(state.riskPreferences), new Date().toISOString());
  for (const pattern of state.spendingPatterns) db.prepare(`INSERT INTO spending_patterns(session_id,id,payload_json)
    VALUES(?,?,?) ON CONFLICT(session_id,id) DO UPDATE SET payload_json=excluded.payload_json`)
    .run(sessionId, pattern.id, JSON.stringify(pattern));
  for (const signal of state.riskSignals) db.prepare(`INSERT INTO risk_signals(session_id,id,suppression_key,status,payload_json)
    VALUES(?,?,?,?,?) ON CONFLICT(session_id,suppression_key) DO UPDATE SET status=excluded.status,payload_json=excluded.payload_json`)
    .run(sessionId, signal.id, signal.suppressionKey, signal.status, JSON.stringify(signal));
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

export function getState(sessionId: string): DemoState {
  const row = db.prepare('SELECT state_json FROM demo_sessions WHERE id = ?').get(sessionId) as { state_json: string } | undefined;
  if (row) return DemoStateSchema.parse(JSON.parse(row.state_json));
  const initial = createFixture();
  db.prepare('INSERT OR IGNORE INTO demo_sessions (id,state_json,version,updated_at) VALUES (?,?,0,?)')
    .run(sessionId, JSON.stringify(initial), new Date().toISOString());
  return initial;
}

export function mutateState(sessionId: string, change: (state: DemoState) => DemoState): DemoState {
  db.exec('BEGIN IMMEDIATE');
  try {
    const old = getState(sessionId);
    const next = DemoStateSchema.parse(change(old));
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
    db.exec('COMMIT');
    return next;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function resetState(sessionId: string): DemoState {
  db.exec('BEGIN IMMEDIATE');
  try {
    const state = createFixture();
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
    const runId = randomUUID();
    db.prepare('UPDATE agent_threads SET read_only=1, status=\'archived\', updated_at=? WHERE session_id=?')
      .run(new Date().toISOString(), sessionId);
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

function threadFromRow(row: Record<string, unknown>): AgentThread {
  return AgentThreadSchema.parse({ id: row.id, title: row.title, kind: row.kind, status: row.status,
    unread: Boolean(row.unread), readOnly: Boolean(row.read_only), createdAt: row.created_at, updatedAt: row.updated_at });
}

export function createAgentThread(sessionId: string, input: {
  title: string; kind?: 'task' | 'risk'; unread?: boolean; dedupeKey?: string;
}): AgentThread {
  if (input.dedupeKey) {
    const existing = db.prepare('SELECT * FROM agent_threads WHERE session_id=? AND dedupe_key=?')
      .get(sessionId, input.dedupeKey) as Record<string, unknown> | undefined;
    if (existing) return threadFromRow(existing);
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO agent_threads(id,session_id,run_id,title,kind,status,unread,read_only,dedupe_key,created_at,updated_at)
    VALUES(?,?,?,?,?,'active',?,0,?,?,?)`).run(id, sessionId, currentRunId(sessionId), input.title,
      input.kind ?? 'task', input.unread ? 1 : 0, input.dedupeKey ?? null, now, now);
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
  db.prepare('UPDATE agent_threads SET status=?,updated_at=? WHERE id=? AND session_id=?')
    .run(status, new Date().toISOString(), threadId, sessionId);
  return getAgentThread(sessionId, threadId);
}

export function markAgentThreadRead(sessionId: string, threadId: string) {
  getAgentThread(sessionId, threadId);
  db.prepare('UPDATE agent_threads SET unread=0 WHERE id=? AND session_id=?').run(threadId, sessionId);
}

export function deleteAgentThread(sessionId: string, threadId: string) {
  getAgentThread(sessionId, threadId);
  db.prepare('DELETE FROM agent_messages WHERE thread_id=? AND session_id=?').run(threadId, sessionId);
  db.prepare('DELETE FROM agent_actions WHERE thread_id=? AND session_id=?').run(threadId, sessionId);
  db.prepare('DELETE FROM agent_components WHERE thread_id=? AND session_id=?').run(threadId, sessionId);
  db.prepare('DELETE FROM agent_turns WHERE thread_id=? AND session_id=?').run(threadId, sessionId);
  db.prepare('DELETE FROM agent_threads WHERE id=? AND session_id=?').run(threadId, sessionId);
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
