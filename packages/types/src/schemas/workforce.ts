import { z } from 'zod';
import { TASK_STATUSES, type TaskStatus } from '../enums';
import { isoDateSchema, paginationSchema, uuidSchema } from './common';

const hours = z.string().regex(/^\d{1,4}(\.\d{1,2})?$/, 'Hours as a decimal string, e.g. "2.5"');
const notes = z.string().trim().max(2000).nullable();

// ── server-side task management (desktop / supervisors) ──────────────────────

export const createTaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  assignedTo: uuidSchema.nullable().optional(),
  workOrderId: uuidSchema.nullable().optional(),
  dueDate: isoDateSchema.nullable().optional(),
});
export type CreateTaskDto = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(2000).nullable(),
    assignedTo: uuidSchema.nullable(),
    dueDate: isoDateSchema.nullable(),
    status: z.enum(TASK_STATUSES),
    hoursLogged: hours,
    notes,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;

export const taskListQuerySchema = paginationSchema.extend({
  status: z.enum(TASK_STATUSES).optional(),
  assignedTo: uuidSchema.optional(),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

// ── mobile sync ──────────────────────────────────────────────────────────────

/** What a device may change on a task. (Title, assignment etc. are set on the server.) */
export const taskChangesSchema = z
  .object({
    status: z.enum(TASK_STATUSES),
    /** Total hours logged on the task (absolute, not a delta — so a retried mutation is idempotent by nature too). */
    hoursLogged: hours,
    notes,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'A mutation must change at least one field');
export type TaskChanges = z.infer<typeof taskChangesSchema>;

export const syncMutationSchema = z.object({
  /** Client-generated, unique per mutation. The server stores it so a retry replays the result instead of re-applying. */
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/, 'Letters, digits and . _ : - only'),
  entity: z.literal('task'),
  op: z.literal('update'),
  entityId: uuidSchema,
  /** The task version the device edited. The server applies the change only if this is still the current version. */
  baseVersion: z.number().int().min(1),
  changes: taskChangesSchema,
  clientTimestamp: z.string().max(40).optional(),
});
export type SyncMutation = z.infer<typeof syncMutationSchema>;

export const syncPushSchema = z.object({
  deviceId: z.string().trim().min(1).max(100),
  mutations: z.array(syncMutationSchema).min(1).max(100),
});
export type SyncPushDto = z.infer<typeof syncPushSchema>;

export const syncPullQuerySchema = z.object({
  /** change_seq of the last change the device has seen ("0" on first sync). Opaque to clients. */
  cursor: z.string().regex(/^\d{1,18}$/, 'cursor must be a non-negative integer string').default('0'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

export const proofFieldsSchema = z.object({
  /** Client-generated UUID: re-uploading the same proof is a no-op. */
  proofId: uuidSchema,
  taskId: uuidSchema,
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  capturedAt: z.string().max(40).optional(),
});
export type ProofFields = z.infer<typeof proofFieldsSchema>;

// ── responses ────────────────────────────────────────────────────────────────

export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignedTo: string | null;
  workOrderId: string | null;
  dueDate: string | null;
  hoursLogged: string;
  notes: string | null;
  version: number;
  changeSeq: string;
  deletedAt: string | null;
  updatedAt: string;
}

export interface ProofDto {
  id: string;
  taskId: string;
  mimeType: string;
  sizeBytes: number;
  latitude: string | null;
  longitude: string | null;
  capturedAt: string | null;
  changeSeq: string;
  /** Path of the photo relative to the API base URL: fetch `${baseUrl}${url}` with the bearer token. */
  url: string;
}

export type SyncMutationStatus = 'APPLIED' | 'CONFLICT' | 'REJECTED';

export interface SyncMutationResult {
  idempotencyKey: string;
  status: SyncMutationStatus;
  /** true when this exact key had already been processed and the stored result was returned. */
  replayed: boolean;
  /** The task after the change (APPLIED). */
  record?: TaskDto;
  /** The task as the server has it now (CONFLICT) — for the device to show and resolve. */
  serverRecord?: TaskDto;
  code?: string;
  error?: string;
}

export interface SyncPushResponse {
  results: SyncMutationResult[];
}

export type SyncChange =
  | { entity: 'task'; op: 'upsert'; changeSeq: string; record: TaskDto }
  | { entity: 'task'; op: 'delete'; changeSeq: string; record: { id: string } }
  | { entity: 'proof'; op: 'upsert'; changeSeq: string; record: ProofDto };

export interface SyncPullResponse {
  changes: SyncChange[];
  /** Send this back as ?cursor= next time. Advance the cursor ONLY from pull responses. */
  nextCursor: string;
  hasMore: boolean;
}

// ── public tracking ──────────────────────────────────────────────────────────

export interface TrackingStepDto {
  key: 'RECEIVED' | 'CONFIRMED' | 'IN_PRODUCTION' | 'QUALITY_CHECK' | 'COMPLETED';
  label: string;
  /** When the step was reached, or null if it has not been yet. */
  at: string | null;
  done: boolean;
  current: boolean;
}

/** Everything a customer may see about an order — no prices, no names of staff, no internal ids. */
export interface PublicTrackingDto {
  orderNumber: string;
  status: { key: string; label: string };
  placedAt: string;
  expectedDate: string | null;
  cancelled: boolean;
  steps: TrackingStepDto[];
  items: Array<{ description: string; quantity: string; unit: string }>;
}

export interface TrackingLinkDto {
  orderId: string;
  token: string;
  url: string;
}
