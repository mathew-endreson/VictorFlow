import type { ProofDto, SyncPullResponse, SyncPushResponse, TaskChanges, TaskDto } from '@victorflow/types';

/**
 * A queued edit, waiting to be pushed. Its id IS the idempotency key sent to the server: retrying the same item
 * (after a dropped response, say) can never apply it twice.
 *
 * Invariant: at most ONE 'PENDING' item per task (edits made offline are coalesced into it), and while a task has
 * a 'CONFLICT' item it cannot be edited until the conflict is resolved. A 'FAILED' item is an edit the server refused
 * for good: it is kept (and shown) until the user dismisses it, so a refused edit never just disappears.
 */
export interface OutboxItem {
  id: string;
  taskId: string;
  /** The server version this edit was made against; the server applies it only if this is still the current version. */
  baseVersion: number;
  changes: TaskChanges;
  status: 'PENDING' | 'CONFLICT' | 'FAILED';
  /** The server's copy at the moment the conflict was detected. */
  conflict: TaskDto | null;
  error: string | null;
  createdAt: string;
}

export interface LocalProof {
  id: string;
  taskId: string;
  /** file:// URI of the photo on this device ('' for proofs that came from the server). */
  fileUri: string;
  mimeType: string;
  latitude: number | null;
  longitude: number | null;
  capturedAt: string;
  status: 'PENDING' | 'UPLOADED' | 'FAILED';
  error: string | null;
  remote: ProofDto | null;
}

/** What the engine needs from local storage (SQLite on the device, a Map in tests). */
export interface SyncStore {
  getCursor(): Promise<string>;
  setCursor(cursor: string): Promise<void>;
  listTasks(): Promise<TaskDto[]>;
  getTask(id: string): Promise<TaskDto | null>;
  upsertTask(task: TaskDto): Promise<void>;
  deleteTask(id: string): Promise<void>;
  listOutbox(): Promise<OutboxItem[]>;
  putOutbox(item: OutboxItem): Promise<void>;
  removeOutbox(id: string): Promise<void>;
  listProofs(taskId?: string): Promise<LocalProof[]>;
  putProof(proof: LocalProof): Promise<void>;
  removeProofsForTask(taskId: string): Promise<void>;
  /** Run `fn` atomically. */
  transaction(fn: () => Promise<void>): Promise<void>;
  clearAll(): Promise<void>;
}

export interface PushMutation {
  idempotencyKey: string;
  entity: 'task';
  op: 'update';
  entityId: string;
  baseVersion: number;
  changes: TaskChanges;
  clientTimestamp: string;
}

/** What the engine needs from the network. */
export interface SyncApi {
  push(deviceId: string, mutations: PushMutation[]): Promise<SyncPushResponse>;
  pull(cursor: string, limit: number): Promise<SyncPullResponse>;
  uploadProof(proof: LocalProof): Promise<ProofDto>;
}

/** The device cannot reach the server (offline, timeout, DNS). Everything queued stays queued. */
export class NetworkError extends Error {
  constructor(message = 'Cannot reach the server') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The server refused an upload for good (4xx): retrying will not help. */
export class PermanentError extends Error {
  constructor(
    message: string,
    /** HTTP status, when the refusal came from the server (lets the UI word it in the user's language). */
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'PermanentError';
  }
}

export interface SyncReport {
  pushed: number;
  applied: number;
  conflicts: number;
  rejected: number;
  uploaded: number;
  pulled: number;
}

/** A task as the UI shows it: server truth with the device's unsynced edits laid over it. */
export type TaskView = TaskDto & {
  /** true while an edit is waiting to be pushed. */
  pending: boolean;
  /** Set when the last push of this task's edit hit a version conflict that needs a decision. */
  conflict: OutboxItem | null;
  /** The most recent edit the server refused for good (validation, permission …), until the user dismisses it. */
  rejected: OutboxItem | null;
};
