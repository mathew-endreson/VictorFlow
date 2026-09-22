import * as SQLite from 'expo-sqlite';
import type { TaskChanges, TaskDto } from '@victorflow/types';
import type { LocalProof, OutboxItem, SyncStore } from '../sync/types';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  -- Server truth, one JSON document per task (the API's TaskDto). Unsynced edits are NOT stored here (see outbox).
  CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY NOT NULL,           -- also the idempotency key
    seq INTEGER NOT NULL,
    task_id TEXT NOT NULL,
    base_version INTEGER NOT NULL,
    changes TEXT NOT NULL,
    status TEXT NOT NULL,
    conflict TEXT,
    error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS outbox_task_idx ON outbox (task_id);
  CREATE TABLE IF NOT EXISTS proofs (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    file_uri TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    captured_at TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    remote TEXT
  );
  CREATE INDEX IF NOT EXISTS proofs_task_idx ON proofs (task_id);
`;

interface OutboxRow { id: string; task_id: string; base_version: number; changes: string; status: OutboxItem['status']; conflict: string | null; error: string | null; created_at: string }
interface ProofRow { id: string; task_id: string; file_uri: string; mime_type: string; latitude: number | null; longitude: number | null; captured_at: string; status: LocalProof['status']; error: string | null; remote: string | null }

const toOutbox = (r: OutboxRow): OutboxItem => ({
  id: r.id, taskId: r.task_id, baseVersion: r.base_version, changes: JSON.parse(r.changes) as TaskChanges, status: r.status,
  conflict: r.conflict ? (JSON.parse(r.conflict) as TaskDto) : null, error: r.error, createdAt: r.created_at,
});
const toProof = (r: ProofRow): LocalProof => ({
  id: r.id, taskId: r.task_id, fileUri: r.file_uri, mimeType: r.mime_type, latitude: r.latitude, longitude: r.longitude,
  capturedAt: r.captured_at, status: r.status, error: r.error, remote: r.remote ? JSON.parse(r.remote) : null,
});

/** The device's local database: the app reads everything from here, online or not. */
export class SqliteSyncStore implements SyncStore {
  private constructor(private readonly db: SQLite.SQLiteDatabase) {}

  static async open(name = 'victorflow.db'): Promise<SqliteSyncStore> {
    const db = await SQLite.openDatabaseAsync(name);
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync(SCHEMA);
    return new SqliteSyncStore(db);
  }

  async getCursor() {
    return (await this.db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'cursor'))?.value ?? '0';
  }
  async setCursor(cursor: string) {
    await this.db.runAsync('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'cursor', cursor);
  }

  async listTasks() {
    return (await this.db.getAllAsync<{ json: string }>('SELECT json FROM tasks')).map((r) => JSON.parse(r.json) as TaskDto);
  }
  async getTask(id: string) {
    const r = await this.db.getFirstAsync<{ json: string }>('SELECT json FROM tasks WHERE id = ?', id);
    return r ? (JSON.parse(r.json) as TaskDto) : null;
  }
  async upsertTask(task: TaskDto) {
    await this.db.runAsync('INSERT INTO tasks (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json', task.id, JSON.stringify(task));
  }
  async deleteTask(id: string) {
    await this.db.runAsync('DELETE FROM tasks WHERE id = ?', id);
  }

  async listOutbox() {
    return (await this.db.getAllAsync<OutboxRow>('SELECT * FROM outbox ORDER BY seq')).map(toOutbox);
  }
  async putOutbox(i: OutboxItem) {
    // keep the original position when an existing item is updated (seq preserved by the upsert)
    await this.db.runAsync(
      `INSERT INTO outbox (id, seq, task_id, base_version, changes, status, conflict, error, created_at)
       VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM outbox), ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET base_version = excluded.base_version, changes = excluded.changes, status = excluded.status,
                                     conflict = excluded.conflict, error = excluded.error`,
      i.id, i.taskId, i.baseVersion, JSON.stringify(i.changes), i.status, i.conflict ? JSON.stringify(i.conflict) : null, i.error, i.createdAt,
    );
  }
  async removeOutbox(id: string) {
    await this.db.runAsync('DELETE FROM outbox WHERE id = ?', id);
  }

  async listProofs(taskId?: string) {
    const rows = taskId
      ? await this.db.getAllAsync<ProofRow>('SELECT * FROM proofs WHERE task_id = ? ORDER BY captured_at', taskId)
      : await this.db.getAllAsync<ProofRow>('SELECT * FROM proofs ORDER BY captured_at');
    return rows.map(toProof);
  }
  async putProof(p: LocalProof) {
    await this.db.runAsync(
      `INSERT INTO proofs (id, task_id, file_uri, mime_type, latitude, longitude, captured_at, status, error, remote)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET file_uri = excluded.file_uri, status = excluded.status, error = excluded.error, remote = excluded.remote`,
      p.id, p.taskId, p.fileUri, p.mimeType, p.latitude, p.longitude, p.capturedAt, p.status, p.error, p.remote ? JSON.stringify(p.remote) : null,
    );
  }
  async removeProofsForTask(taskId: string) {
    await this.db.runAsync('DELETE FROM proofs WHERE task_id = ?', taskId);
  }

  async transaction(fn: () => Promise<void>) {
    await this.db.withTransactionAsync(fn);
  }

  /** Sign-out / switching user: nothing of the previous user may remain on the device. */
  async clearAll() {
    await this.db.execAsync('DELETE FROM tasks; DELETE FROM outbox; DELETE FROM proofs; DELETE FROM meta;');
  }
}
