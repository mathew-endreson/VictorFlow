import type { SyncChange, TaskChanges, TaskDto } from '@victorflow/types';
import { NetworkError, PermanentError, type LocalProof, type OutboxItem, type PushMutation, type SyncApi, type SyncReport, type SyncStore, type TaskView } from './types';

/**
 * Offline-first sync engine. Pure logic — storage and network are injected — so the exact same code runs on the
 * device (SQLite + fetch) and in the unit tests (memory + a fake server that enforces the real OCC/idempotency rules).
 *
 * Ground rules:
 *  1. Local task rows are always SERVER TRUTH. A user's unsynced edits live only in the outbox and are overlaid
 *     at read time, so "what the server said" and "what I typed" never get mixed up.
 *  2. Every queued edit carries an idempotency key (its id). A retry after a lost response replays, never re-applies.
 *  3. The pull cursor advances ONLY from pull responses — never from a push result — or changes made by other
 *     people with a lower change_seq would be skipped.
 *  4. The server decides conflicts (version check). The device only keeps the loser's edit and asks the user.
 */

const newKey = (): string => globalThis.crypto.randomUUID();
const PUSH_BATCH = 50;
const PULL_PAGE = 200;

// ── read side ────────────────────────────────────────────────────────────────

export function overlayTask(task: TaskDto, outbox: readonly OutboxItem[]): TaskView {
  let view: TaskDto = task;
  let pending = false;
  let conflict: OutboxItem | null = null;
  let rejected: OutboxItem | null = null;
  for (const item of outbox) {
    if (item.taskId !== task.id) continue;
    if (item.status === 'FAILED') {
      rejected = item; // not applied anywhere: the task shows server truth, and the user is told why
      continue;
    }
    view = applyChanges(view, item.changes);
    if (item.status === 'PENDING') pending = true;
    if (item.status === 'CONFLICT') conflict = item;
  }
  return { ...view, pending, conflict, rejected };
}

function applyChanges(task: TaskDto, c: TaskChanges): TaskDto {
  return {
    ...task,
    ...(c.status !== undefined && { status: c.status }),
    ...(c.hoursLogged !== undefined && { hoursLogged: c.hoursLogged }),
    ...(c.notes !== undefined && { notes: c.notes }),
  };
}

export async function loadTaskViews(store: SyncStore): Promise<TaskView[]> {
  const [tasks, outbox] = await Promise.all([store.listTasks(), store.listOutbox()]);
  return tasks.map((t) => overlayTask(t, outbox)).sort(byUrgency);
}

const byUrgency = (a: TaskView, b: TaskView) => {
  const done = (t: TaskView) => (t.status === 'DONE' ? 1 : 0);
  return done(a) - done(b) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title);
};

export const pendingCount = (outbox: readonly OutboxItem[]) => outbox.filter((o) => o.status === 'PENDING').length;
export const conflictCount = (outbox: readonly OutboxItem[]) => outbox.filter((o) => o.status === 'CONFLICT').length;
export const rejectedCount = (outbox: readonly OutboxItem[]) => outbox.filter((o) => o.status === 'FAILED').length;

/** The user has read that the server refused an edit: forget it. Only ever removes a refused edit — never a queued one. */
export async function dismissRejected(store: SyncStore, outboxId: string): Promise<void> {
  const item = (await store.listOutbox()).find((o) => o.id === outboxId);
  if (item?.status === 'FAILED') await store.removeOutbox(item.id);
}

// ── write side (works fully offline) ─────────────────────────────────────────

export class ConflictBlockedError extends Error {
  constructor() {
    super('This task has a sync conflict. Resolve it before editing.');
    this.name = 'ConflictBlockedError';
  }
}

/** The task is not on this device (it was removed or reassigned). */
export class TaskNotFoundError extends Error {
  constructor() {
    super('Task not found on this device');
    this.name = 'TaskNotFoundError';
  }
}

/** Record an edit. Nothing touches the network; repeated offline edits to one task collapse into a single queued mutation. */
export async function queueTaskEdit(store: SyncStore, taskId: string, changes: TaskChanges, now: () => Date = () => new Date(), makeKey: () => string = newKey): Promise<void> {
  const task = await store.getTask(taskId);
  if (!task) throw new TaskNotFoundError();
  const mine = (await store.listOutbox()).filter((o) => o.taskId === taskId);
  if (mine.some((o) => o.status === 'CONFLICT')) throw new ConflictBlockedError();

  const pending = mine.find((o) => o.status === 'PENDING');
  if (pending) {
    await store.putOutbox({ ...pending, changes: { ...pending.changes, ...changes } });
    return;
  }
  await store.putOutbox({
    id: makeKey(),
    taskId,
    baseVersion: task.version,
    changes,
    status: 'PENDING',
    conflict: null,
    error: null,
    createdAt: now().toISOString(),
  });
}

/**
 * Settle a version conflict.
 *  'server' → drop my edit (the server's copy is already stored locally).
 *  'mine'   → re-apply my edit on top of the server's CURRENT version, under a NEW idempotency key
 *             (the old key's stored answer is the conflict itself).
 */
export async function resolveConflict(store: SyncStore, outboxId: string, choice: 'server' | 'mine', makeKey: () => string = newKey): Promise<void> {
  const item = (await store.listOutbox()).find((o) => o.id === outboxId);
  if (!item || item.status !== 'CONFLICT') return;
  await store.transaction(async () => {
    await store.removeOutbox(item.id);
    if (choice === 'mine' && item.conflict) {
      await store.putOutbox({ ...item, id: makeKey(), status: 'PENDING', baseVersion: item.conflict.version, conflict: null, error: null });
    }
  });
}

// ── sync ─────────────────────────────────────────────────────────────────────

export interface SyncOptions {
  deviceId: string;
  now?: () => Date;
  makeKey?: () => string;
  pullPageSize?: number;
}

const sameChanges = (a: TaskChanges, b: TaskChanges) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = (o: TaskChanges) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));

const toMutation = (o: OutboxItem, now: Date): PushMutation => ({
  idempotencyKey: o.id,
  entity: 'task',
  op: 'update',
  entityId: o.taskId,
  baseVersion: o.baseVersion,
  changes: o.changes,
  clientTimestamp: now.toISOString(),
});

/**
 * push → upload proofs → pull. Throws NetworkError when the server cannot be reached; everything queued stays queued
 * and the next call simply carries on (which is what makes "go offline, edit, come back online, sync" work).
 */
export async function syncOnce(store: SyncStore, api: SyncApi, opts: SyncOptions): Promise<SyncReport> {
  const now = opts.now ?? (() => new Date());
  const makeKey = opts.makeKey ?? newKey;
  const report: SyncReport = { pushed: 0, applied: 0, conflicts: 0, rejected: 0, uploaded: 0, pulled: 0 };

  // 1 ── PUSH ────────────────────────────────────────────────────────────────
  const pending = (await store.listOutbox()).filter((o) => o.status === 'PENDING');
  for (let i = 0; i < pending.length; i += PUSH_BATCH) {
    const batch = pending.slice(i, i + PUSH_BATCH);
    const sent = new Map(batch.map((o) => [o.id, o]));
    const res = await api.push(opts.deviceId, batch.map((o) => toMutation(o, now())));
    report.pushed += batch.length;

    await store.transaction(async () => {
      for (const r of res.results) {
        const item = sent.get(r.idempotencyKey);
        if (!item) continue;

        if (r.status === 'APPLIED' && r.record) {
          report.applied++;
          await upsertIfNewer(store, r.record);
          // The user may have edited this task again while the request was in flight. If so, the queued item now
          // holds MORE than what was sent: keep the extra, re-based on the version we just created, under a fresh key.
          const current = (await store.listOutbox()).find((o) => o.id === item.id);
          await store.removeOutbox(item.id);
          if (current && !sameChanges(current.changes, item.changes)) {
            await store.putOutbox({ ...current, id: makeKey(), baseVersion: r.record.version });
          }
        } else if (r.status === 'CONFLICT' && r.serverRecord) {
          report.conflicts++;
          await store.upsertTask(r.serverRecord); // truth first
          // start from the queue's CURRENT copy: the user may have added to this edit while the request was in flight
          await store.putOutbox({ ...(await latest(store, item)), status: 'CONFLICT', conflict: r.serverRecord, error: r.error ?? null });
        } else {
          report.rejected++;
          if (r.code === 'NOT_FOUND') {
            // deleted or reassigned on the server: nothing left to edit
            await store.removeOutbox(item.id);
            await store.deleteTask(item.taskId);
            await store.removeProofsForTask(item.taskId);
          } else {
            await store.putOutbox({ ...(await latest(store, item)), status: 'FAILED', error: r.error ?? r.code ?? 'Rejected by the server' });
          }
        }
      }
    });
  }

  // 2 ── PROOF PHOTOS ────────────────────────────────────────────────────────
  for (const proof of (await store.listProofs()).filter((p) => p.status === 'PENDING')) {
    try {
      const remote = await api.uploadProof(proof);
      await store.putProof({ ...proof, status: 'UPLOADED', remote, error: null });
      report.uploaded++;
    } catch (err) {
      if (err instanceof NetworkError) throw err; // try again next time
      if (err instanceof PermanentError) await store.putProof({ ...proof, status: 'FAILED', error: err.message });
      else throw err;
    }
  }

  // 3 ── PULL ────────────────────────────────────────────────────────────────
  const startCursor = await store.getCursor();
  const fullSync = startCursor === '0';
  const seen = new Set<string>();
  let cursor = startCursor;
  for (let guard = 0; guard < 1000; guard++) {
    const page = await api.pull(cursor, opts.pullPageSize ?? PULL_PAGE);
    await store.transaction(async () => {
      for (const change of page.changes) {
        if (change.entity === 'task' && change.op === 'upsert') seen.add(change.record.id);
        await applyChange(store, change);
      }
      await store.setCursor(page.nextCursor); // the ONLY place the cursor moves
    });
    report.pulled += page.changes.length;
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  }

  // A full sync lists everything the server considers ours; tasks it no longer lists were reassigned or removed.
  if (fullSync) {
    const outbox = await store.listOutbox();
    for (const t of await store.listTasks()) {
      if (!seen.has(t.id) && !outbox.some((o) => o.taskId === t.id)) {
        await store.deleteTask(t.id);
        await store.removeProofsForTask(t.id);
      }
    }
  }
  return report;
}

/** The queue's current copy of an item that was just sent (it may have grown since), else the sent copy. */
async function latest(store: SyncStore, sent: OutboxItem): Promise<OutboxItem> {
  return (await store.listOutbox()).find((o) => o.id === sent.id) ?? sent;
}

async function upsertIfNewer(store: SyncStore, task: TaskDto): Promise<void> {
  const existing = await store.getTask(task.id);
  if (!existing || existing.version <= task.version) await store.upsertTask(task);
}

async function applyChange(store: SyncStore, change: SyncChange): Promise<void> {
  if (change.entity === 'task') {
    if (change.op === 'delete') {
      await store.deleteTask(change.record.id);
      await store.removeProofsForTask(change.record.id);
      for (const o of (await store.listOutbox()).filter((x) => x.taskId === change.record.id)) await store.removeOutbox(o.id);
      return;
    }
    await upsertIfNewer(store, change.record);
    return;
  }
  // a proof known to the server (ours, or another device's)
  const local = (await store.listProofs()).find((p) => p.id === change.record.id);
  const proof: LocalProof = {
    id: change.record.id,
    taskId: change.record.taskId,
    fileUri: local?.fileUri ?? '',
    mimeType: change.record.mimeType,
    latitude: change.record.latitude === null ? null : Number(change.record.latitude),
    longitude: change.record.longitude === null ? null : Number(change.record.longitude),
    capturedAt: change.record.capturedAt ?? '',
    status: 'UPLOADED',
    error: null,
    remote: change.record,
  };
  await store.putProof(proof);
}
