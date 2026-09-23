import type { Row } from '@victorflow/db';
import type { AttendanceDto } from '@victorflow/types';
import { iso, isoOrNull } from '../../common/paging';

export const ATTENDANCE_COLUMNS = ['id', 'user_id', 'date', 'clock_in', 'clock_out', 'notes', 'created_at', 'updated_at'] as const;

export type AttendanceRow = Pick<Row<'workforce.attendance'>, (typeof ATTENDANCE_COLUMNS)[number]>;

export const toAttendanceDto = (r: AttendanceRow): AttendanceDto => ({
  id: r.id,
  userId: r.user_id,
  date: r.date,
  clockIn: isoOrNull(r.clock_in),
  clockOut: isoOrNull(r.clock_out),
  notes: r.notes,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
