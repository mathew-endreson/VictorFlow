// Test doubles for the sync engine: an in-memory store, and a FAKE SERVER that enforces the same rules as the real
// one (version check, idempotency keys, monotonic change_seq, tombstones). Used by engine.test.ts.
import type { ProofDto, SyncChange, SyncMutationResult, SyncPullResponse, SyncPushResponse, TaskDto } from '@victorflow/types';
import { NetworkError, PermanentError, type LocalProof, type OutboxItem, type PushMutation, type SyncApi, type SyncStore } from './types';

export class MemoryStore implements SyncStore {
  cursor = '0';
  tasks = new Map<string, TaskDto>();
  outbox = new Map<string, OutboxItem>();
  proofs = new Map<string, LocalProof>();

  async getCursor() { return this.cursor; }
  async setCursor(c: string) { this.cursor = c; }
  async listTasks() { return [...this.tasks.values()]; }
  async getTask(id: string) { return this.tasks.get(id) ?? null; }
  async upsertTask(t: TaskDto) { this.tasks.set(t.id, t); }
  async deleteTask(id: string) { this.tasks.delete(id); }
  async listOutbox() { return [...this.outbox.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async putOutbox(i: OutboxItem) { this.outbox.set(i.id, i); }
  async removeOutbox(id: string) { this.outbox.delete(id); }
  async listProofs(taskId?: string) { return [...this.proofs.values()].filter((p) => !taskId || p.taskId === taskId); }
  async putProof(p: LocalProof) { this.proofs.set(p.id, p); }
  async removeProofsForTask(taskId: string) { for (const p of [...this.proofs.values()]) if (p.taskId === taskId) this.proofs.delete(p.id); }
  async transaction(fn: () => Promise<void>) {
    // all-or-nothing, like SQLite: snapshot, run, restore on failure
    const snap = { tasks: new Map(this.tasks), outbox: new Map(this.outbox), proofs: new Map(this.proofs), cursor: this.cursor };
    try {
      await fn();
    } catch (e) {
      Object.assign(this, snap);
      throw e;
    }
  }
  async clearAll() { this.tasks.clear(); this.outbox.clear(); this.proofs.clear(); this.cursor = '0'; }
}

export function makeTask(over: Partial<TaskDto> & { id: string }): TaskDto {
  return {
    title: `Task ${over.id}`, description: null, status: 'TODO', assignedTo: 'user-1', workOrderId: null, dueDate: null,
    hoursLogged: '0.00', notes: null, version: 1, changeSeq: '0', deletedAt: null, updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

export class FakeServer implements SyncApi {
  tasks = new Map<string, TaskDto>();
  private seq = 0;
  private stored = new Map<string, SyncMutationResult>();
  proofs = new Map<string, ProofDto>();
  online = true;
  /** Apply the next push on the server, then lose the response (the classic "did it go through?" case). */
  dropNextPushResponse = false;
  /** Runs after the server has applied a push but before the device sees the answer (edit-while-in-flight). */
  onPushInFlight?: () => Promise<void>;
  applyCount = new Map<string, number>();
  pushCalls = 0;
  uploadError: Error | null = null;
  /** Refuse the next edit the way the real API does for a validation / permission problem. */
  rejectNextEdit: { code: string; error: string } | null = null;

  /** Simulates a change made elsewhere (desktop, another device): bumps version and change_seq like the DB trigger. */
  put(task: TaskDto): TaskDto {
    const existing = this.tasks.get(task.id);
    const next = { ...task, version: existing ? existing.version + 1 : task.version, changeSeq: String(++this.seq) };
    this.tasks.set(task.id, next);
    return next;
  }
  remove(id: string) {
    const t = this.tasks.get(id);
    if (t) this.tasks.set(id, { ...t, deletedAt: '2026-01-02T00:00:00Z', version: t.version + 1, changeSeq: String(++this.seq) });
  }

  async push(_deviceId: string, mutations: PushMutation[]): Promise<SyncPushResponse> {
    if (!this.online) throw new NetworkError();
    this.pushCalls++;
    const results: SyncMutationResult[] = mutations.map((m) => {
      const prev = this.stored.get(m.idempotencyKey);
      if (prev) return { ...prev, replayed: true }; // idempotency: same key → stored answer, nothing applied
      const t = this.tasks.get(m.entityId);
      let r: SyncMutationResult;
      if (this.rejectNextEdit) { r = { idempotencyKey: m.idempotencyKey, status: 'REJECTED', replayed: false, ...this.rejectNextEdit }; this.rejectNextEdit = null; }
      else if (!t || t.deletedAt) r = { idempotencyKey: m.idempotencyKey, status: 'REJECTED', replayed: false, code: 'NOT_FOUND', error: 'Task not found' };
      else if (t.version !== m.baseVersion) r = { idempotencyKey: m.idempotencyKey, status: 'CONFLICT', replayed: false, code: 'VERSION_CONFLICT', error: `Version conflict: you edited version ${m.baseVersion}, the server has version ${t.version}`, serverRecord: t };
      else {
        const updated: TaskDto = { ...t, ...m.changes, version: t.version + 1, changeSeq: String(++this.seq) };
        this.tasks.set(t.id, updated);
        this.applyCount.set(m.idempotencyKey, (this.applyCount.get(m.idempotencyKey) ?? 0) + 1);
        r = { idempotencyKey: m.idempotencyKey, status: 'APPLIED', replayed: false, record: updated };
      }
      this.stored.set(m.idempotencyKey, r);
      return r;
    });
    if (this.onPushInFlight) {
      const hook = this.onPushInFlight;
      this.onPushInFlight = undefined;
      await hook();
    }
    if (this.dropNextPushResponse) {
      this.dropNextPushResponse = false;
      throw new NetworkError('connection lost before the response arrived');
    }
    return { results };
  }

  async pull(cursor: string, limit: number): Promise<SyncPullResponse> {
    if (!this.online) throw new NetworkError();
    const all: SyncChange[] = [
      ...[...this.tasks.values()].filter((t) => BigInt(t.changeSeq) > BigInt(cursor)).map((t): SyncChange => (t.deletedAt ? { entity: 'task', op: 'delete', changeSeq: t.changeSeq, record: { id: t.id } } : { entity: 'task', op: 'upsert', changeSeq: t.changeSeq, record: t })),
      ...[...this.proofs.values()].filter((p) => BigInt(p.changeSeq) > BigInt(cursor)).map((p): SyncChange => ({ entity: 'proof', op: 'upsert', changeSeq: p.changeSeq, record: p })),
    ].sort((a, b) => (BigInt(a.changeSeq) < BigInt(b.changeSeq) ? -1 : 1));
    const changes = all.slice(0, limit);
    return { changes, nextCursor: changes.length ? changes[changes.length - 1]!.changeSeq : cursor, hasMore: all.length > limit };
  }

  async uploadProof(p: LocalProof): Promise<ProofDto> {
    if (!this.online) throw new NetworkError();
    if (this.uploadError) throw this.uploadError;
    const task = this.tasks.get(p.taskId);
    if (!task || task.deletedAt) throw new PermanentError('Task not found'); // the real API answers 404 for a deleted task
    const dto: ProofDto = { id: p.id, taskId: p.taskId, mimeType: p.mimeType, sizeBytes: 123, latitude: p.latitude === null ? null : p.latitude.toFixed(6), longitude: p.longitude === null ? null : p.longitude.toFixed(6), capturedAt: p.capturedAt, changeSeq: String(++this.seq), url: `/proofs/${p.id}` };
    this.proofs.set(p.id, dto);
    return dto;
  }
}

export { NetworkError, PermanentError };
