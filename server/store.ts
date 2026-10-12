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
);`);

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
    for (const event of newEvents) db.prepare('INSERT INTO audit_events (id,session_id,at,action,outcome,detail,operation_id) VALUES (?,?,?,?,?,?,?)')
      .run(event.id, sessionId, event.at, event.action, event.outcome, event.detail, event.operationId ?? null);
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
    db.exec('COMMIT');
    return state;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function closeStore() { db.close(); }
