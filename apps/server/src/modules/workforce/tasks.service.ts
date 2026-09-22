import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from '@victorflow/db';
import { PERMISSIONS, type CreateTaskDto, type Page, type TaskDto, type TaskListQuery, type UpdateTaskDto } from '@victorflow/types';
import type { Principal } from '../../common/decorators';
import { likePattern, offsetOf, toCount, toPage } from '../../common/paging';
import { DbService, type Trx } from '../../infra/db/db.service';
import { TASK_COLUMNS, toTaskDto } from './task.mapper';

/** Server-side task management (desktop / supervisors). Every change goes through the same triggers as a device push: version and change_seq advance, so devices see it on their next pull and their stale edits conflict. */
@Injectable()
export class TasksService {
  constructor(private readonly dbs: DbService) {}

  async list(user: Principal, query: TaskListQuery): Promise<Page<TaskDto>> {
    const canSeeAll = user.permissions.has(PERMISSIONS.WORKFORCE_TASK_READ_ALL);
    let q = this.dbs.db.selectFrom('workforce.tasks').where('deleted_at', 'is', null);
    if (!canSeeAll) q = q.where('assigned_to', '=', user.id);
    else if (query.assignedTo) q = q.where('assigned_to', '=', query.assignedTo);
    if (query.status) q = q.where('status', '=', query.status);
    if (query.search) q = q.where('title', 'ilike', likePattern(query.search));

    const { n } = await q.select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();
    const rows = await q.select(TASK_COLUMNS).orderBy('due_date', (ob) => ob.asc().nullsLast()).orderBy('created_at', 'desc').limit(query.pageSize).offset(offsetOf(query.page, query.pageSize)).execute();
    return toPage(rows.map(toTaskDto), toCount(n), query.page, query.pageSize);
  }

  async get(user: Principal, id: string): Promise<TaskDto> {
    const row = await this.dbs.db.selectFrom('workforce.tasks').select(TASK_COLUMNS).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    const canSeeAll = user.permissions.has(PERMISSIONS.WORKFORCE_TASK_READ_ALL);
    if (!row || (!canSeeAll && row.assigned_to !== user.id)) throw new NotFoundException('Task not found');
    return toTaskDto(row);
  }

  async create(dto: CreateTaskDto, actorId: string): Promise<TaskDto> {
    return this.dbs.transaction(async (trx) => {
      await this.assertAssignee(trx, dto.assignedTo);
      await this.assertWorkOrder(trx, dto.workOrderId);
      const row = await trx
        .insertInto('workforce.tasks')
        .values({
          title: dto.title,
          description: dto.description ?? null,
          assigned_to: dto.assignedTo ?? null,
          work_order_id: dto.workOrderId ?? null,
          due_date: dto.dueDate ?? null,
          created_by: actorId,
        })
        .returning(TASK_COLUMNS)
        .executeTakeFirstOrThrow();
      return toTaskDto(row);
    });
  }

  async update(id: string, dto: UpdateTaskDto): Promise<TaskDto> {
    return this.dbs.transaction(async (trx) => {
      if (dto.assignedTo !== undefined) await this.assertAssignee(trx, dto.assignedTo);
      const patch = {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.assignedTo !== undefined && { assigned_to: dto.assignedTo }),
        ...(dto.dueDate !== undefined && { due_date: dto.dueDate }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.hoursLogged !== undefined && { hours_logged: dto.hoursLogged }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      };
      const row = await trx.updateTable('workforce.tasks').set(patch).where('id', '=', id).where('deleted_at', 'is', null).returning(TASK_COLUMNS).executeTakeFirst();
      if (!row) throw new NotFoundException('Task not found');
      return toTaskDto(row);
    });
  }

  /** Soft delete: the row stays as a tombstone so devices learn about the deletion through pull. */
  async remove(id: string): Promise<void> {
    const res = await this.dbs.transaction((trx) =>
      trx.updateTable('workforce.tasks').set({ deleted_at: new Date() }).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst(),
    );
    if (res.numUpdatedRows === 0n) throw new NotFoundException('Task not found');
  }

  private async assertAssignee(trx: Trx, userId: string | null | undefined): Promise<void> {
    if (!userId) return;
    const u = await trx.selectFrom('core.users').select('is_active').where('id', '=', userId).executeTakeFirst();
    if (!u || !u.is_active) throw new UnprocessableEntityException({ message: 'Assignee does not exist or is inactive', code: 'INVALID_ASSIGNEE' });
  }

  private async assertWorkOrder(trx: Trx, workOrderId: string | null | undefined): Promise<void> {
    if (!workOrderId) return;
    const w = await trx.selectFrom('erp.work_orders').select('id').where('id', '=', workOrderId).executeTakeFirst();
    if (!w) throw new UnprocessableEntityException({ message: 'Work order does not exist', code: 'UNKNOWN_WORK_ORDER' });
  }
}
