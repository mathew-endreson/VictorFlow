import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type Database, type Kysely } from '@victorflow/db';
import {
  parseMoney,
  type CreateOrderDto,
  type OrderDetailDto,
  type OrderListQuery,
  type OrderStatus,
  type OrderSummaryDto,
  type Page,
  type UpdateOrderDto,
} from '@victorflow/types';
import { iso, isoOrNull, likePattern, offsetOf, toCount, toPage } from '../../common/paging';
import { DbService, type Trx } from '../../infra/db/db.service';
import { ProductionService } from '../production/production.service';
import { assertCustomerActive, LINE_COLUMNS, priceDocument, toLineDto } from './documents';

@Injectable()
export class OrdersService {
  constructor(
    private readonly dbs: DbService,
    private readonly production: ProductionService,
  ) {}

  async list(query: OrderListQuery): Promise<Page<OrderSummaryDto>> {
    let q = this.dbs.db.selectFrom('erp.orders as o').innerJoin('crm.customers as c', 'c.id', 'o.customer_id');
    if (query.search) {
      const like = likePattern(query.search);
      q = q.where((eb) => eb.or([eb('o.number', 'ilike', like), eb('c.name', 'ilike', like)]));
    }
    if (query.status) q = q.where('o.status', '=', query.status);
    if (query.customerId) q = q.where('o.customer_id', '=', query.customerId);
    if (query.uninvoiced) {
      q = q
        .where('o.status', 'in', ['CONFIRMED', 'IN_PRODUCTION', 'COMPLETED'])
        .where(sql<boolean>`not exists (select 1 from finance.invoices i where i.order_id = o.id and i.status <> 'CANCELLED')`);
    }

    const { n } = await q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    const rows = await q
      .select([
        'o.id', 'o.number', 'o.customer_id', 'c.name as customer_name', 'o.status', 'o.order_date', 'o.due_date',
        'o.total_ht', 'o.total_tva', 'o.total_ttc', 'o.created_at',
      ])
      .orderBy('o.created_at', 'desc')
      .orderBy('o.number', 'desc')
      .limit(query.pageSize)
      .offset(offsetOf(query.page, query.pageSize))
      .execute();

    return toPage(
      rows.map((r) => ({
        id: r.id,
        number: r.number,
        customerId: r.customer_id,
        customerName: r.customer_name,
        status: r.status,
        orderDate: r.order_date,
        dueDate: r.due_date,
        totalHt: r.total_ht,
        totalTva: r.total_tva,
        totalTtc: r.total_ttc,
        createdAt: iso(r.created_at),
      })),
      toCount(n),
      query.page,
      query.pageSize,
    );
  }

  get(id: string): Promise<OrderDetailDto> {
    return this.load(this.dbs.db, id);
  }

  /** Reads an order using the given handle (a Trx sees its own uncommitted writes). */
  async load(db: Kysely<Database>, id: string): Promise<OrderDetailDto> {
    const o = await db
      .selectFrom('erp.orders as o')
      .innerJoin('crm.customers as c', 'c.id', 'o.customer_id')
      .select([
        'o.id', 'o.number', 'o.customer_id', 'c.name as customer_name', 'o.status', 'o.order_date', 'o.due_date',
        'o.total_ht', 'o.total_tva', 'o.total_ttc', 'o.created_at', 'o.notes', 'o.quote_id', 'o.confirmed_at',
      ])
      .where('o.id', '=', id)
      .executeTakeFirst();
    if (!o) throw new NotFoundException('Order not found');

    const items = await db.selectFrom('erp.order_items').select(LINE_COLUMNS).where('order_id', '=', id).orderBy('position').execute();
    const production = await db.selectFrom('erp.production_orders').select(['id', 'number', 'status']).where('order_id', '=', id).executeTakeFirst();
    const invoice = await db
      .selectFrom('finance.invoices')
      .select(['id', 'number', 'status'])
      .where('order_id', '=', id)
      .where('status', '<>', 'CANCELLED')
      .executeTakeFirst();

    return {
      id: o.id,
      number: o.number,
      customerId: o.customer_id,
      customerName: o.customer_name,
      status: o.status,
      orderDate: o.order_date,
      dueDate: o.due_date,
      totalHt: o.total_ht,
      totalTva: o.total_tva,
      totalTtc: o.total_ttc,
      createdAt: iso(o.created_at),
      notes: o.notes,
      quoteId: o.quote_id,
      confirmedAt: isoOrNull(o.confirmed_at),
      items: items.map(toLineDto),
      productionOrder: production ?? null,
      invoice: invoice ?? null,
    };
  }

  async create(dto: CreateOrderDto, actorId: string): Promise<OrderDetailDto> {
    await assertCustomerActive(this.dbs.db, dto.customerId);
    const priced = priceDocument(dto.items);

    return this.dbs.transaction(async (trx) => {
      const order = await trx
        .insertInto('erp.orders')
        .values({
          customer_id: dto.customerId,
          due_date: dto.dueDate ?? null,
          notes: dto.notes ?? null,
          ...priced.totals,
          created_by: actorId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('erp.order_items').values(priced.rows.map((r) => ({ ...r, order_id: order.id }))).execute();
      return this.load(trx, order.id);
    });
  }

  async update(id: string, dto: UpdateOrderDto): Promise<OrderDetailDto> {
    if (dto.customerId) await assertCustomerActive(this.dbs.db, dto.customerId);
    const priced = dto.items ? priceDocument(dto.items) : undefined;

    return this.dbs.transaction(async (trx) => {
      const order = await this.lock(trx, id);
      this.assertStatus(order.status, ['DRAFT'], 'Only DRAFT orders can be edited');

      const patch = {
        ...(dto.customerId !== undefined && { customer_id: dto.customerId }),
        ...(dto.dueDate !== undefined && { due_date: dto.dueDate }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(priced && priced.totals),
      };
      if (Object.keys(patch).length > 0) await trx.updateTable('erp.orders').set(patch).where('id', '=', id).execute();

      if (priced) {
        await trx.deleteFrom('erp.order_items').where('order_id', '=', id).execute();
        await trx.insertInto('erp.order_items').values(priced.rows.map((r) => ({ ...r, order_id: id }))).execute();
      }
      return this.load(trx, id);
    });
  }

  /**
   * DRAFT → CONFIRMED, and release the order to production (a production order in the FSM's initial state plus
   * its work orders) — in the same transaction, so an order is never "confirmed but unknown to production".
   */
  async confirm(id: string, actorId: string): Promise<OrderDetailDto> {
    return this.dbs.transaction(async (trx) => {
      const order = await this.lock(trx, id);
      this.assertStatus(order.status, ['DRAFT'], 'Only DRAFT orders can be confirmed');
      if (parseMoney(order.total_ttc) <= 0n) {
        throw new UnprocessableEntityException({ message: 'An order with a zero total cannot be confirmed', code: 'ZERO_TOTAL' });
      }
      await trx
        .updateTable('erp.orders')
        .set({ status: 'CONFIRMED', confirmed_at: new Date(), confirmed_by: actorId })
        .where('id', '=', id)
        .execute();
      await this.production.createForOrder(trx, id, actorId);
      return this.load(trx, id);
    });
  }

  /**
   * DRAFT orders can always be cancelled. A CONFIRMED order can be cancelled only while its production order has
   * not left the initial state and it has not been invoiced; its production order is then discarded.
   */
  async cancel(id: string): Promise<OrderDetailDto> {
    return this.dbs.transaction(async (trx) => {
      const order = await this.lock(trx, id);
      this.assertStatus(order.status, ['DRAFT', 'CONFIRMED'], 'Only DRAFT or CONFIRMED orders can be cancelled');
      if (order.status === 'CONFIRMED') {
        const invoice = await trx.selectFrom('finance.invoices').select('number').where('order_id', '=', id).where('status', '<>', 'CANCELLED').executeTakeFirst();
        if (invoice) {
          throw new ConflictException({ message: `Order is invoiced (${invoice.number}); cancel the invoice first`, code: 'ORDER_INVOICED' });
        }
        await this.production.discardForOrder(trx, id);
      }
      await trx.updateTable('erp.orders').set({ status: 'CANCELLED' }).where('id', '=', id).execute();
      return this.load(trx, id);
    });
  }

  /** Row-locks the order for the rest of the transaction so concurrent confirm/edit/cancel serialise. */
  async lock(trx: Trx, id: string) {
    const order = await trx
      .selectFrom('erp.orders')
      .select(['id', 'status', 'total_ttc', 'customer_id'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private assertStatus(actual: OrderStatus, allowed: OrderStatus[], message: string): void {
    if (!allowed.includes(actual)) {
      throw new ConflictException({ message: `${message} (order is ${actual})`, code: 'INVALID_ORDER_STATE' });
    }
  }
}
