import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, Kysely } from '@victorflow/db';
import {
  type CreateQuoteDto,
  type OrderDetailDto,
  type Page,
  type QuoteDetailDto,
  type QuoteListQuery,
  type QuoteStatus,
  type QuoteSummaryDto,
  type UpdateQuoteDto,
} from '@victorflow/types';
import { iso, likePattern, offsetOf, toCount, toPage } from '../../common/paging';
import { DbService, type Trx } from '../../infra/db/db.service';
import { assertCustomerActive, LINE_COLUMNS, priceDocument, toLineDto } from './documents';
import { OrdersService } from './orders.service';

@Injectable()
export class QuotesService {
  constructor(
    private readonly dbs: DbService,
    private readonly orders: OrdersService,
  ) {}

  async list(query: QuoteListQuery): Promise<Page<QuoteSummaryDto>> {
    let q = this.dbs.db.selectFrom('erp.quotes as q').innerJoin('crm.customers as c', 'c.id', 'q.customer_id');
    if (query.search) {
      const like = likePattern(query.search);
      q = q.where((eb) => eb.or([eb('q.number', 'ilike', like), eb('c.name', 'ilike', like)]));
    }
    if (query.status) q = q.where('q.status', '=', query.status);
    if (query.customerId) q = q.where('q.customer_id', '=', query.customerId);

    const { n } = await q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    const rows = await q
      .select([
        'q.id', 'q.number', 'q.customer_id', 'c.name as customer_name', 'q.status', 'q.quote_date', 'q.valid_until',
        'q.converted_order_id', 'q.total_ht', 'q.total_tva', 'q.total_ttc', 'q.created_at',
      ])
      .orderBy('q.created_at', 'desc')
      .orderBy('q.number', 'desc')
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
        quoteDate: r.quote_date,
        validUntil: r.valid_until,
        convertedOrderId: r.converted_order_id,
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

  get(id: string): Promise<QuoteDetailDto> {
    return this.load(this.dbs.db, id);
  }

  private async load(db: Kysely<Database>, id: string): Promise<QuoteDetailDto> {
    const r = await db
      .selectFrom('erp.quotes as q')
      .innerJoin('crm.customers as c', 'c.id', 'q.customer_id')
      .select([
        'q.id', 'q.number', 'q.customer_id', 'c.name as customer_name', 'q.status', 'q.quote_date', 'q.valid_until',
        'q.converted_order_id', 'q.total_ht', 'q.total_tva', 'q.total_ttc', 'q.created_at', 'q.notes',
      ])
      .where('q.id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException('Quote not found');
    const items = await db.selectFrom('erp.quote_items').select(LINE_COLUMNS).where('quote_id', '=', id).orderBy('position').execute();
    return {
      id: r.id,
      number: r.number,
      customerId: r.customer_id,
      customerName: r.customer_name,
      status: r.status,
      quoteDate: r.quote_date,
      validUntil: r.valid_until,
      convertedOrderId: r.converted_order_id,
      totalHt: r.total_ht,
      totalTva: r.total_tva,
      totalTtc: r.total_ttc,
      createdAt: iso(r.created_at),
      notes: r.notes,
      items: items.map(toLineDto),
    };
  }

  async create(dto: CreateQuoteDto, actorId: string): Promise<QuoteDetailDto> {
    await assertCustomerActive(this.dbs.db, dto.customerId);
    const priced = priceDocument(dto.items);
    return this.dbs.transaction(async (trx) => {
      const quote = await trx
        .insertInto('erp.quotes')
        .values({ customer_id: dto.customerId, valid_until: dto.validUntil ?? null, notes: dto.notes ?? null, ...priced.totals, created_by: actorId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('erp.quote_items').values(priced.rows.map((r) => ({ ...r, quote_id: quote.id }))).execute();
      return this.load(trx, quote.id);
    });
  }

  async update(id: string, dto: UpdateQuoteDto): Promise<QuoteDetailDto> {
    if (dto.customerId) await assertCustomerActive(this.dbs.db, dto.customerId);
    const priced = dto.items ? priceDocument(dto.items) : undefined;
    return this.dbs.transaction(async (trx) => {
      const quote = await this.lock(trx, id);
      this.assertStatus(quote.status, ['DRAFT'], 'Only DRAFT quotes can be edited');
      const patch = {
        ...(dto.customerId !== undefined && { customer_id: dto.customerId }),
        ...(dto.validUntil !== undefined && { valid_until: dto.validUntil }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(priced && priced.totals),
      };
      if (Object.keys(patch).length > 0) await trx.updateTable('erp.quotes').set(patch).where('id', '=', id).execute();
      if (priced) {
        await trx.deleteFrom('erp.quote_items').where('quote_id', '=', id).execute();
        await trx.insertInto('erp.quote_items').values(priced.rows.map((r) => ({ ...r, quote_id: id }))).execute();
      }
      return this.load(trx, id);
    });
  }

  send(id: string): Promise<QuoteDetailDto> {
    return this.moveTo(id, ['DRAFT'], 'SENT');
  }
  accept(id: string): Promise<QuoteDetailDto> {
    return this.moveTo(id, ['SENT'], 'ACCEPTED');
  }
  reject(id: string): Promise<QuoteDetailDto> {
    return this.moveTo(id, ['DRAFT', 'SENT'], 'REJECTED');
  }

  /** Copies the quote's lines (and already-computed amounts) into a new DRAFT order. Exactly once. */
  async convert(id: string, actorId: string): Promise<OrderDetailDto> {
    return this.dbs.transaction(async (trx) => {
      const quote = await trx
        .selectFrom('erp.quotes')
        .select(['id', 'status', 'customer_id', 'notes', 'total_ht', 'total_tva', 'total_ttc'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!quote) throw new NotFoundException('Quote not found');
      this.assertStatus(quote.status, ['DRAFT', 'SENT', 'ACCEPTED'], 'This quote cannot be converted');
      await assertCustomerActive(trx, quote.customer_id);

      const items = await trx.selectFrom('erp.quote_items').select(LINE_COLUMNS).where('quote_id', '=', id).orderBy('position').execute();
      const order = await trx
        .insertInto('erp.orders')
        .values({
          customer_id: quote.customer_id,
          quote_id: quote.id,
          notes: quote.notes,
          total_ht: quote.total_ht,
          total_tva: quote.total_tva,
          total_ttc: quote.total_ttc,
          created_by: actorId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('erp.order_items')
        .values(
          items.map((i) => ({
            order_id: order.id,
            position: i.position,
            description: i.description,
            unit: i.unit,
            quantity: i.quantity,
            unit_price: i.unit_price,
            discount_pct: i.discount_pct,
            tva_rate: i.tva_rate,
            line_ht: i.line_ht,
            line_tva: i.line_tva,
            line_ttc: i.line_ttc,
          })),
        )
        .execute();
      await trx.updateTable('erp.quotes').set({ status: 'CONVERTED', converted_order_id: order.id }).where('id', '=', id).execute();
      return this.orders.load(trx, order.id);
    });
  }

  private async moveTo(id: string, from: QuoteStatus[], to: QuoteStatus): Promise<QuoteDetailDto> {
    return this.dbs.transaction(async (trx) => {
      const quote = await this.lock(trx, id);
      this.assertStatus(quote.status, from, `Cannot move a quote to ${to}`);
      await trx.updateTable('erp.quotes').set({ status: to }).where('id', '=', id).execute();
      return this.load(trx, id);
    });
  }

  private async lock(trx: Trx, id: string) {
    const quote = await trx.selectFrom('erp.quotes').select(['id', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!quote) throw new NotFoundException('Quote not found');
    return quote;
  }

  private assertStatus(actual: QuoteStatus, allowed: QuoteStatus[], message: string): void {
    if (!allowed.includes(actual)) {
      throw new ConflictException({ message: `${message} (quote is ${actual})`, code: 'INVALID_QUOTE_STATE' });
    }
  }
}
