import { Controller, Get, Patch, Post } from '@nestjs/common';
import {
  attendanceListQuerySchema,
  createAttendanceSchema,
  PERMISSIONS,
  updateAttendanceSchema,
  type AttendanceDto,
  type AttendanceListQuery,
  type CreateAttendanceDto,
  type Page,
  type UpdateAttendanceDto,
} from '@victorflow/types';
import { CurrentUser, RequirePermissions, type Principal, RequiresFeature } from '../../common/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/zod.pipe';
import { AttendanceService } from './attendance.service';

/** Admin-recorded staff attendance. Desktop only for now — self clock-in from a device is a later concern. */
@RequiresFeature('workforce')
@Controller('workforce/attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @RequirePermissions(PERMISSIONS.WORKFORCE_ATTENDANCE_READ)
  @Get()
  list(@ZQuery(attendanceListQuerySchema) query: AttendanceListQuery): Promise<Page<AttendanceDto>> {
    return this.attendance.list(query);
  }

  @RequirePermissions(PERMISSIONS.WORKFORCE_ATTENDANCE_RECORD)
  @Post()
  create(@ZBody(createAttendanceSchema) dto: CreateAttendanceDto, @CurrentUser() actor: Principal): Promise<AttendanceDto> {
    return this.attendance.create(dto, actor.id);
  }

  @RequirePermissions(PERMISSIONS.WORKFORCE_ATTENDANCE_RECORD)
  @Patch(':id')
  update(@IdParam() id: string, @ZBody(updateAttendanceSchema) dto: UpdateAttendanceDto): Promise<AttendanceDto> {
    return this.attendance.update(id, dto);
  }
}
