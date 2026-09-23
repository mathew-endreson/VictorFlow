import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from '@victorflow/db';
import type { AttendanceDto, AttendanceListQuery, CreateAttendanceDto, Page, UpdateAttendanceDto } from '@victorflow/types';
import { offsetOf, toCount, toPage } from '../../common/paging';
import { DbService } from '../../infra/db/db.service';
import { ATTENDANCE_COLUMNS, toAttendanceDto } from './attendance.mapper';

/** Admin-recorded attendance (clock-in/out on behalf of staff). Self clock-in from a device is a later,
 * separate concern — not exposed here. */
@Injectable()
export class AttendanceService {
  constructor(private readonly dbs: DbService) {}

  async list(query: AttendanceListQuery): Promise<Page<AttendanceDto>> {
    let q = this.dbs.db.selectFrom('workforce.attendance');
    if (query.userId) q = q.where('user_id', '=', query.userId);
    if (query.from) q = q.where('date', '>=', query.from);
    if (query.to) q = q.where('date', '<=', query.to);

    const { n } = await q.select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();
    const rows = await q
      .select(ATTENDANCE_COLUMNS)
      .orderBy('date', 'desc')
      .orderBy('created_at', 'desc')
      .limit(query.pageSize)
      .offset(offsetOf(query.page, query.pageSize))
      .execute();
    return toPage(rows.map(toAttendanceDto), toCount(n), query.page, query.pageSize);
  }

  async create(dto: CreateAttendanceDto, actorId: string): Promise<AttendanceDto> {
    const user = await this.dbs.db.selectFrom('core.users').select('is_active').where('id', '=', dto.userId).executeTakeFirst();
    if (!user || !user.is_active) throw new UnprocessableEntityException({ message: 'Employee does not exist or is inactive', code: 'INVALID_EMPLOYEE' });

    const existing = await this.dbs.db.selectFrom('workforce.attendance').select('id').where('user_id', '=', dto.userId).where('date', '=', dto.date).executeTakeFirst();
    if (existing) throw new ConflictException({ message: 'An attendance record already exists for this employee and date', code: 'ATTENDANCE_EXISTS', id: existing.id });

    const row = await this.dbs.db
      .insertInto('workforce.attendance')
      .values({
        user_id: dto.userId,
        date: dto.date,
        clock_in: dto.clockIn ?? null,
        clock_out: dto.clockOut ?? null,
        notes: dto.notes ?? null,
        created_by: actorId,
      })
      .returning(ATTENDANCE_COLUMNS)
      .executeTakeFirstOrThrow();
    return toAttendanceDto(row);
  }

  async update(id: string, dto: UpdateAttendanceDto): Promise<AttendanceDto> {
    const patch = {
      ...(dto.clockIn !== undefined && { clock_in: dto.clockIn }),
      ...(dto.clockOut !== undefined && { clock_out: dto.clockOut }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
    };
    const row = await this.dbs.db.updateTable('workforce.attendance').set(patch).where('id', '=', id).returning(ATTENDANCE_COLUMNS).executeTakeFirst();
    if (!row) throw new NotFoundException('Attendance record not found');
    return toAttendanceDto(row);
  }
}
