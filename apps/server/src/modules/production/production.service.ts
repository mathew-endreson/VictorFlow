import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type Database, type Kysely } from '@victorflow/db';
import type {
  FsmDefinitionDto,
  Page,
  ProductionBoardDto,
  ProductionCardDto,
  ProductionListQuery,
  ProductionOrderDetailDto,
  ProductionOrderSummaryDto,
  ProductionPatchDto,
  ProductionStageDto,
  TransitionDto,
  UpdateFsmTransitionDto,
  UpdateWorkOrderDto,
  WorkOrderDto,
  WorkOrderListQuery,
  WorkOrderStatus,
} from '@victorflow/types';
import type { Principal } from '../../common/decorators';
import { iso, isoOrNull, likePattern, offsetOf, toCount, toPage } from '../../common/paging';
import { DbService, type Trx } from '../../infra/db/db.service';
import { allowedFrom, FsmService } from './fsm/fsm.service';

export const PRODUCTION_MACHINE = 'production_order';

/**
 * Side effects on the SALES order when a production order enters a state. These are about how the two
 * modules relate (an order is "in production" / "completed" as its production order is), not about the
 * workflow itself, so they sit here rather than in the FSM configuration.
 * MVP-NOTE: keyed by state code; if an admin renames states in the FSM tables, update this map.
 */
const ORDER_EFFECTS: Record<string, 'IN_PRODUCTION' | 'COMPLETED'> = {
  IN_PRODUCTION: 'IN_PRODUCTION',
  COMPLETED: 'COMPLETED',
};

/** Legal work-order status moves. COMPLETED and CANCELLED are final. */
const WORK_ORDER_MOVES: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  PENDING: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['PENDING', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const WO_COLUMNS = [
  'w.id', 'w.production_order_id', 'p.number as po_number', 's.code as stage_code', 's.name as stage_name', 'w.title', 'w.status',
  'w.assigned_to', 'u.full_name as assignee_name', 'w.planned_hours', 'w.actual_hours', 'w.started_at', 'w.completed_at',
] as const;

@Injectable()
export class ProductionService {
  constructor(
    private readonly dbs: DbService,
    private readonly fsm: FsmService,
  ) {}

  // ── creation / discard (called by the sales module inside ITS transaction) ─

  /** Released by order confirmation: a production order in the FSM's initial state, plus one work order per auto-create stage. */
  async createForOrder(trx: Trx, orderId: string, actorId: string): Promise<{ id: string }> {
    const order = await trx.selectFrom('erp.orders').select(['number', 'due_date']).where('id', '=', orderId).executeTakeFirstOrThrow();
    const initial = await this.fsm.initialState(PRODUCTION_MACHINE, trx);

    const po = await trx
      .insertInto('erp.production_orders')
      .values({ order_id: orderId, status: initial, due_date: order.due_date, created_by: actorId })
      .returning('id')
      .executeTakeFirstOrThrow();

    const stages = await trx.selectFrom('erp.production_stages').selectAll().where('auto_create', '=', true).orderBy('position').execute();
    if (stages.length > 0) {
      await trx
        .insertInto('erp.work_orders')
        .values(stages.map((s) => ({ production_order_id: po.id, stage_id: s.id, title: `${s.name} — ${order.number}`, planned_hours: s.default_hours })))
        .execute();
    }
    await trx.insertInto('erp.production_order_events').values({ production_order_id: po.id, from_status: null, to_status: initial, actor_id: actorId, note: 'Released from confirmed order' }).execute();
    return po;
  }

  /** Cancelling a confirmed order removes its production order — but only while production has not begun. */
  async discardForOrder(trx: Trx, orderId: string): Promise<void> {
    const po = await trx.selectFrom('erp.production_orders').select(['id', 'number', 'status']).where('order_id', '=', orderId).forUpdate().executeTakeFirst();
    if (!po) return;
    const initial = await this.fsm.initialState(PRODUCTION_MACHINE, trx);
    if (po.status !== initial) {
      throw new ConflictException({ message: `Production order ${po.number} is already ${po.status}; the order can no longer be cancelled`, code: 'PRODUCTION_STARTED' });
    }
    await trx.deleteFrom('erp.production_orders').where('id', '=', po.id).execute(); // work orders + events cascade
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  /** Kanban board: one column per configured FSM state, cards carrying the moves THIS user may attempt. */
  async board(actor: Principal): Promise<ProductionBoardDto> {
    const def = await this.fsm.definition(PRODUCTION_MACHINE);
    const rows = await this.dbs.db
      .selectFrom('erp.production_orders as p')
      .innerJoin('erp.orders as o', 'o.id', 'p.order_id')
      .innerJoin('crm.customers as c', 'c.id', 'o.customer_id')
      .select([
        'p.id', 'p.number', 'p.order_id', 'o.number as order_number', 'c.name as customer_name', 'p.status', 'p.priority', 'p.due_date',
        sql<string>`(select count(*) from erp.work_orders w where w.production_order_id = p.id and w.status <> 'CANCELLED')`.as('wo_total'),
        sql<string>`(select count(*) from erp.work_orders w where w.production_order_id = p.id and w.status = 'COMPLETED')`.as('wo_done'),
      ])
      .orderBy('p.priority')
      .orderBy('p.due_date', (ob) => ob.asc().nullsLast())
      .orderBy('p.created_at')
      .execute();

    const cards: ProductionCardDto[] = rows.map((r) => ({
      id: r.id,
      number: r.number,
      orderId: r.order_id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      status: r.status,
      priority: r.priority,
      dueDate: r.due_date,
      workOrdersTotal: toCount(r.wo_total),
      workOrdersCompleted: toCount(r.wo_done),
      allowedTransitions: allowedFrom(def.transitions, r.status, actor.permissions),
    }));

    return { columns: def.states.map((s) => ({ ...s, cards: cards.filter((c) => c.status === s.code) })) };
  }

  async list(query: ProductionListQuery): Promise<Page<ProductionOrderSummaryDto>> {
    let q = this.dbs.db
      .selectFrom('erp.production_orders as p')
      .innerJoin('erp.orders as o', 'o.id', 'p.order_id')
      .innerJoin('crm.customers as c', 'c.id', 'o.customer_id');
    if (query.status) q = q.where('p.status', '=', query.status);
    if (query.search) {
      const like = likePattern(query.search);
      q = q.where((eb) => eb.or([eb('p.number', 'ilike', like), eb('o.number', 'ilike', like), eb('c.name', 'ilike', like)]));
    }
    const { n } = await q.select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();
    const rows = await q
      .select(['p.id', 'p.number', 'p.order_id', 'o.number as order_number', 'c.name as customer_name', 'p.status', 'p.priority', 'p.due_date', 'p.created_at'])
      .orderBy('p.created_at', 'desc')
      .limit(query.pageSize)
      .offset(offsetOf(query.page, query.pageSize))
      .execute();
    return toPage(
      rows.map((r) => ({
        id: r.id,
        number: r.number,
        orderId: r.order_id,
        orderNumber: r.order_number,
        customerName: r.customer_name,
        status: r.status,
        priority: r.priority,
        dueDate: r.due_date,
        createdAt: iso(r.created_at),
      })),
      toCount(n),
      query.page,
      query.pageSize,
    );
  }

  get(id: string, actor: Principal): Promise<ProductionOrderDetailDto> {
    return this.load(this.dbs.db, id, actor);
  }

  private async load(db: Kysely<Database>, id: string, actor: Principal): Promise<ProductionOrderDetailDto> {
    const po = await db
      .selectFrom('erp.production_orders as p')
      .innerJoin('erp.orders as o', 'o.id', 'p.order_id')
      .innerJoin('crm.customers as c', 'c.id', 'o.customer_id')
      .select([
        'p.id', 'p.number', 'p.order_id', 'o.number as order_number', 'o.status as order_status', 'c.name as customer_name', 'p.status',
        'p.priority', 'p.due_date', 'p.notes', 'p.rejection_reason', 'p.created_at',
      ])
      .where('p.id', '=', id)
      .executeTakeFirst();
    if (!po) throw new NotFoundException('Production order not found');

    const def = await this.fsm.definition(PRODUCTION_MACHINE, db);
    const workOrders = await this.workOrderQuery(db).where('w.production_order_id', '=', id).orderBy('s.position').orderBy('w.created_at').execute();
    const events = await db
      .selectFrom('erp.production_order_events as e')
      .leftJoin('core.users as u', 'u.id', 'e.actor_id')
      .select(['e.id', 'e.from_status', 'e.to_status', 'u.full_name as actor_name', 'e.note', 'e.created_at'])
      .where('e.production_order_id', '=', id)
      .orderBy('e.id')
      .execute();

    return {
      id: po.id,
      number: po.number,
      orderId: po.order_id,
      orderNumber: po.order_number,
      orderStatus: po.order_status,
      customerName: po.customer_name,
      status: po.status,
      priority: po.priority,
      dueDate: po.due_date,
      notes: po.notes,
      rejectionReason: po.rejection_reason,
      createdAt: iso(po.created_at),
      workOrders: workOrders.map(toWorkOrderDto),
      events: events.map((e) => ({ id: e.id, fromStatus: e.from_status, toStatus: e.to_status, actorName: e.actor_name, note: e.note, createdAt: iso(e.created_at) })),
      allowedTransitions: allowedFrom(def.transitions, po.status, actor.permissions),
    };
  }

  // ── transition ─────────────────────────────────────────────────────────────

  /**
   * Move a production order along the configured FSM. Everything happens in one transaction: lock the row,
   * ask the engine (matrix → permission → note → guard), then write the new state, the history event and the
   * sales-order side effect. Two concurrent moves on one card serialise on the row lock; the second sees the
   * new state and is refused as an illegal transition.
   */
  async transition(id: string, dto: TransitionDto, actor: Principal): Promise<ProductionOrderDetailDto> {
    return this.dbs.transaction(async (trx) => {
      const po = await trx.selectFrom('erp.production_orders').select(['id', 'status', 'order_id']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!po) throw new NotFoundException('Production order not found');

      await this.fsm.authorize(trx, PRODUCTION_MACHINE, { entityId: id, from: po.status, to: dto.to, actor, note: dto.note });

      await trx
        .updateTable('erp.production_orders')
        .set({ status: dto.to, rejection_reason: dto.to === 'REJECTED' ? (dto.note ?? null) : null })
        .where('id', '=', id)
        .execute();
      await trx
        .insertInto('erp.production_order_events')
        .values({ production_order_id: id, from_status: po.status, to_status: dto.to, actor_id: actor.id, note: dto.note ?? null })
        .execute();

      const effect = ORDER_EFFECTS[dto.to];
      if (effect) {
        await trx
          .updateTable('erp.orders')
          .set({ status: effect, ...(effect === 'COMPLETED' && { completed_at: new Date() }) })
          .where('id', '=', po.order_id)
          .where('status', 'in', ['CONFIRMED', 'IN_PRODUCTION'])
          .execute();
      }
      return this.load(trx, id, actor);
    });
  }

  async patch(id: string, dto: ProductionPatchDto, actor: Principal): Promise<ProductionOrderDetailDto> {
    const patch = {
      ...(dto.priority !== undefined && { priority: dto.priority }),
      ...(dto.dueDate !== undefined && { due_date: dto.dueDate }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
    };
    return this.dbs.transaction(async (trx) => {
      const res = await trx.updateTable('erp.production_orders').set(patch).where('id', '=', id).executeTakeFirst();
      if (res.numUpdatedRows === 0n) throw new NotFoundException('Production order not found');
      return this.load(trx, id, actor);
    });
  }

  // ── work orders ────────────────────────────────────────────────────────────

  private workOrderQuery(db: Kysely<Database>) {
    return db
      .selectFrom('erp.work_orders as w')
      .innerJoin('erp.production_orders as p', 'p.id', 'w.production_order_id')
      .innerJoin('erp.production_stages as s', 's.id', 'w.stage_id')
      .leftJoin('core.users as u', 'u.id', 'w.assigned_to')
      .select([...WO_COLUMNS]);
  }

  async listWorkOrders(query: WorkOrderListQuery): Promise<Page<WorkOrderDto>> {
    const filtered = (q: ReturnType<ProductionService['workOrderQuery']>) => {
      let out = q;
      if (query.productionOrderId) out = out.where('w.production_order_id', '=', query.productionOrderId);
      if (query.status) out = out.where('w.status', '=', query.status);
      if (query.assignedTo) out = out.where('w.assigned_to', '=', query.assignedTo);
      if (query.search) out = out.where((eb) => eb.or([eb('w.title', 'ilike', likePattern(query.search!)), eb('p.number', 'ilike', likePattern(query.search!))]));
      return out;
    };
    const countRow = await this.dbs.db
      .selectFrom(filtered(this.workOrderQuery(this.dbs.db)).as('x'))
      .select(sql<string>`count(*)`.as('n'))
      .executeTakeFirstOrThrow();
    const rows = await filtered(this.workOrderQuery(this.dbs.db))
      .orderBy('w.created_at', 'desc')
      .limit(query.pageSize)
      .offset(offsetOf(query.page, query.pageSize))
      .execute();
    return toPage(rows.map(toWorkOrderDto), toCount(countRow.n), query.page, query.pageSize);
  }

  async updateWorkOrder(id: string, dto: UpdateWorkOrderDto): Promise<WorkOrderDto> {
    return this.dbs.transaction(async (trx) => {
      const wo = await trx.selectFrom('erp.work_orders').select(['id', 'status', 'production_order_id', 'started_at']).where('id', '=', id).executeTakeFirst();
      if (!wo) throw new NotFoundException('Work order not found');

      // Lock the parent production order: work-order changes and transitions on it are serialised, so the
      // "all work orders completed" guard can never race a completion that is committing at that moment.
      const po = await trx.selectFrom('erp.production_orders').select(['status', 'number']).where('id', '=', wo.production_order_id).forUpdate().executeTakeFirstOrThrow();
      if (await this.fsm.isTerminal(PRODUCTION_MACHINE, po.status, trx)) {
        throw new ConflictException({ message: `Production order ${po.number} is ${po.status}; its work orders are closed`, code: 'PRODUCTION_CLOSED' });
      }
      // re-read under the lock
      const current = await trx.selectFrom('erp.work_orders').select(['status', 'started_at']).where('id', '=', id).executeTakeFirstOrThrow();

      const patch: Record<string, unknown> = {};
      if (dto.status !== undefined && dto.status !== current.status) {
        if (!WORK_ORDER_MOVES[current.status].includes(dto.status)) {
          throw new ConflictException({ message: `A ${current.status} work order cannot become ${dto.status}`, code: 'INVALID_WORK_ORDER_STATE' });
        }
        patch.status = dto.status;
        const now = new Date();
        if ((dto.status === 'IN_PROGRESS' || dto.status === 'COMPLETED') && !current.started_at) patch.started_at = now;
        if (dto.status === 'COMPLETED') patch.completed_at = now;
        if (dto.status === 'PENDING') patch.started_at = null;
      }
      if (dto.assignedTo !== undefined) {
        if (dto.assignedTo !== null) {
          const u = await trx.selectFrom('core.users').select('is_active').where('id', '=', dto.assignedTo).executeTakeFirst();
          if (!u || !u.is_active) throw new UnprocessableEntityException({ message: 'Assignee does not exist or is inactive', code: 'INVALID_ASSIGNEE' });
        }
        patch.assigned_to = dto.assignedTo;
      }
      if (dto.actualHours !== undefined) patch.actual_hours = dto.actualHours;

      if (Object.keys(patch).length > 0) await trx.updateTable('erp.work_orders').set(patch).where('id', '=', id).execute();
      const row = await this.workOrderQuery(trx).where('w.id', '=', id).executeTakeFirstOrThrow();
      return toWorkOrderDto(row);
    });
  }

  /**
   * Called when a field task linked to a work order is finished. Runs inside the caller's transaction, takes the same
   * production-order lock as every other work-order change, and quietly does nothing when the work order is already
   * final or its production order is closed — a device syncing late must never be able to reopen or corrupt them.
   */
  async completeWorkOrder(trx: Trx, workOrderId: string): Promise<void> {
    const wo = await trx.selectFrom('erp.work_orders').select(['production_order_id']).where('id', '=', workOrderId).executeTakeFirst();
    if (!wo) return;
    const po = await trx.selectFrom('erp.production_orders').select('status').where('id', '=', wo.production_order_id).forUpdate().executeTakeFirst();
    if (!po || (await this.fsm.isTerminal(PRODUCTION_MACHINE, po.status, trx))) return;
    await trx
      .updateTable('erp.work_orders')
      .set({ status: 'COMPLETED', completed_at: new Date(), started_at: sql<Date>`coalesce(started_at, now())` })
      .where('id', '=', workOrderId)
      .where('status', 'in', ['PENDING', 'IN_PROGRESS'])
      .execute();
  }

  async stages(): Promise<ProductionStageDto[]> {
    const rows = await this.dbs.db.selectFrom('erp.production_stages').selectAll().orderBy('position').execute();
    return rows.map((s) => ({ id: s.id, code: s.code, name: s.name, position: s.position, autoCreate: s.auto_create, defaultHours: s.default_hours }));
  }

  // ── FSM configuration ──────────────────────────────────────────────────────

  fsmDefinition(): Promise<FsmDefinitionDto> {
    return this.fsm.definition(PRODUCTION_MACHINE);
  }

  /** Edit one transition of the live workflow: toggle it, change the permission it needs, its guard, or note requirement. */
  async updateTransition(id: string, dto: UpdateFsmTransitionDto): Promise<FsmDefinitionDto> {
    if (dto.guardCode && !this.fsm.hasGuard(dto.guardCode)) {
      throw new UnprocessableEntityException({ message: `Unknown guard "${dto.guardCode}"`, code: 'UNKNOWN_GUARD' });
    }
    return this.dbs.transaction(async (trx) => {
      if (dto.permissionCode) {
        const p = await trx.selectFrom('core.permissions').select('id').where('code', '=', dto.permissionCode).executeTakeFirst();
        if (!p) throw new UnprocessableEntityException({ message: `Unknown permission "${dto.permissionCode}"`, code: 'UNKNOWN_PERMISSION' });
      }
      const patch = {
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
        ...(dto.permissionCode !== undefined && { permission_code: dto.permissionCode }),
        ...(dto.guardCode !== undefined && { guard_code: dto.guardCode }),
        ...(dto.requiresNote !== undefined && { requires_note: dto.requiresNote }),
        ...(dto.label !== undefined && { label: dto.label }),
      };
      const res = await trx.updateTable('erp.fsm_transitions').set(patch).where('id', '=', id).where('machine_code', '=', PRODUCTION_MACHINE).executeTakeFirst();
      if (res.numUpdatedRows === 0n) throw new NotFoundException('Transition not found');
      return this.fsm.definition(PRODUCTION_MACHINE, trx);
    });
  }

  /** Small helper for the tracking module: the customer-visible history of a production order. */
  async eventsFor(db: Kysely<Database>, orderId: string) {
    return db
      .selectFrom('erp.production_order_events as e')
      .innerJoin('erp.production_orders as p', 'p.id', 'e.production_order_id')
      .select(['e.to_status', 'e.created_at'])
      .where('p.order_id', '=', orderId)
      .orderBy('e.id')
      .execute();
  }
}

type WorkOrderRow = {
  id: string;
  production_order_id: string;
  po_number: string;
  stage_code: string;
  stage_name: string;
  title: string;
  status: WorkOrderStatus;
  assigned_to: string | null;
  assignee_name: string | null;
  planned_hours: string;
  actual_hours: string;
  started_at: Date | null;
  completed_at: Date | null;
};

const toWorkOrderDto = (r: WorkOrderRow): WorkOrderDto => ({
  id: r.id,
  productionOrderId: r.production_order_id,
  productionOrderNumber: r.po_number,
  stageCode: r.stage_code,
  stageName: r.stage_name,
  title: r.title,
  status: r.status,
  assignedTo: r.assigned_to,
  assignedToName: r.assignee_name,
  plannedHours: r.planned_hours,
  actualHours: r.actual_hours,
  startedAt: isoOrNull(r.started_at),
  completedAt: isoOrNull(r.completed_at),
});
