import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DemoStateSchema, type DemoState } from '../shared/contracts.ts';
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
    db.exec('COMMIT');
    return state;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
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
