import type { Row } from '@victorflow/db';
import type { ProofDto, TaskDto } from '@victorflow/types';
import { iso, isoOrNull } from '../../common/paging';

export const TASK_COLUMNS = [
  'id', 'title', 'description', 'status', 'assigned_to', 'work_order_id', 'due_date', 'hours_logged', 'notes',
  'version', 'change_seq', 'deleted_at', 'updated_at',
] as const;

export type TaskRow = Pick<Row<'workforce.tasks'>, (typeof TASK_COLUMNS)[number]>;

export const toTaskDto = (r: TaskRow): TaskDto => ({
  id: r.id,
  title: r.title,
  description: r.description,
  status: r.status,
  assignedTo: r.assigned_to,
  workOrderId: r.work_order_id,
  dueDate: r.due_date,
  hoursLogged: r.hours_logged,
  notes: r.notes,
  version: r.version,
  changeSeq: r.change_seq,
  deletedAt: isoOrNull(r.deleted_at),
  updatedAt: iso(r.updated_at),
});

export const PROOF_COLUMNS = ['id', 'task_id', 'mime_type', 'size_bytes', 'latitude', 'longitude', 'captured_at', 'change_seq'] as const;

export type ProofRow = Pick<Row<'workforce.task_proofs'>, (typeof PROOF_COLUMNS)[number]>;

export const toProofDto = (r: ProofRow): ProofDto => ({
  id: r.id,
  taskId: r.task_id,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  latitude: r.latitude,
  longitude: r.longitude,
  capturedAt: isoOrNull(r.captured_at),
  changeSeq: r.change_seq,
  // relative to the API base URL (which already ends in /api/v1), so clients can simply join `${baseUrl}${url}`
  url: `/workforce/proofs/${r.id}/file`,
});
