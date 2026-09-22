import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type Database, type Kysely } from '@victorflow/db';
import {
  formatMoney,
  parseMoney,
  type CancelInvoiceDto,
  type CreateInvoiceDto,
  type InvoiceDetailDto,
  type InvoiceListQuery,
  type InvoiceStatus,
  type InvoiceSummaryDto,
  type Page,
  type PaymentDto,
  type PaymentListQuery,
  type PaymentMethod,
  type RecordPaymentDto,
} from '@victorflow/types';
import { iso, isoOrNull, likePattern, offsetOf, toCount, toPage } from '../../common/paging';
import { DbService } from '../../infra/db/db.service';
import { LINE_COLUMNS, toLineDto } from '../sales/documents';
import { addDays, todayIso } from './dates';
import { ACCOUNTS, DEFAULT_PAYMENT_TERM_DAYS, JOURNALS } from './finance.constants';
import { LedgerService } from './ledger.service';

const INVOICEABLE = ['CONFIRMED', 'IN_PRODUCTION', 'COMPLETED'];

interface InvoiceRow {
  id: string;
  number: string;
  order_id: string;
  order_number: string;
  customer_id: string;
  customer_name: string;
  invoice_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  total_ht: string;
  total_tva: string;
  total_ttc: string;
  amount_paid: string;
}

const toSummary = (r: InvoiceRow): InvoiceSummaryDto => ({
  id: r.id,
  number: r.number,
  orderId: r.order_id,
  orderNumber: r.order_number,
  customerId: r.customer_id,
  customerName: r.customer_name,
  invoiceDate: r.invoice_date,
  dueDate: r.due_date,
  status: r.status,
  totalHt: r.total_ht,
  totalTva: r.total_tva,
  totalTtc: r.total_ttc,
  amountPaid: r.amount_paid,
  balanceDue: formatMoney(parseMoney(r.total_ttc) - parseMoney(r.amount_paid)),
});

const conflict = (message: string, code: string) => new ConflictException({ message, code });

@Injectable()
export class InvoicesService {
  constructor(
    private readonly dbs: DbService,
    private readonly ledger: LedgerService,
  ) {}

  // ── queries ────────────────────────────────────────────────────────────────

  private summaryQuery(db: Kysely<Database>) {
    return db
      .selectFrom('finance.invoices as i')
      .innerJoin('erp.orders as o', 'o.id', 'i.order_id')
      .innerJoin('crm.customers as c', 'c.id', 'i.customer_id');
  }

  async list(query: InvoiceListQuery): Promise<Page<InvoiceSummaryDto>> {
    let q = this.summaryQuery(this.dbs.db);
    if (query.status) q = q.where('i.status', '=', query.status);
    if (query.customerId) q = q.where('i.customer_id', '=', query.customerId);
    if (query.search) {
      const like = likePattern(query.search);
      q = q.where((eb) => eb.or([eb('i.number', 'ilike', like), eb('o.number', 'ilike', like), eb('c.name', 'ilike', like)]));
    }
    const { n } = await q.select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();
    const rows = await q
      .select([
        'i.id', 'i.number', 'i.order_id', 'o.number as order_number', 'i.customer_id', 'c.name as customer_name', 'i.invoice_date',
        'i.due_date', 'i.status', 'i.total_ht', 'i.total_tva', 'i.total_ttc', 'i.amount_paid',
      ])
      .orderBy('i.invoice_date', 'desc')
      .orderBy('i.number', 'desc')
      .limit(query.pageSize)
      .offset(offsetOf(query.page, query.pageSize))
      .execute();
    return toPage(rows.map(toSummary), toCount(n), query.page, query.pageSize);
  }

  get(id: string): Promise<InvoiceDetailDto> {
    return this.load(this.dbs.db, id);
  }

  private async load(db: Kysely<Database>, id: string): Promise<InvoiceDetailDto> {
    const r = await this.summaryQuery(db)
      .select([
        'i.id', 'i.number', 'i.order_id', 'o.number as order_number', 'i.customer_id', 'c.name as customer_name', 'i.invoice_date',
        'i.due_date', 'i.status', 'i.total_ht', 'i.total_tva', 'i.total_ttc', 'i.amount_paid', 'i.journal_entry_id',
        'i.cancel_entry_id', 'i.cancelled_at',
      ])
      .where('i.id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException('Invoice not found');

    const items = await db.selectFrom('erp.order_items').select(LINE_COLUMNS).where('order_id', '=', r.order_id).orderBy('position').execute();
    const payments = await this.paymentsQuery(db).where('p.invoice_id', '=', id).orderBy('p.paid_at').orderBy('p.created_at').execute();

    const entryRef = async (entryId: string | null) => {
      if (!entryId) return null;
      const e = await db.selectFrom('finance.journal_entries').select(['id', 'entry_number']).where('id', '=', entryId).executeTakeFirst();
      return e ? { id: e.id, entryNumber: e.entry_number } : null;
    };

    return {
      ...toSummary(r),
      items: items.map(toLineDto),
      payments: payments.map(toPaymentDto),
      journalEntry: await entryRef(r.journal_entry_id),
      cancelEntry: await entryRef(r.cancel_entry_id),
      cancelledAt: isoOrNull(r.cancelled_at),
    };
  }

  private paymentsQuery(db: Kysely<Database>) {
    return db
      .selectFrom('finance.payments as p')
      .innerJoin('finance.invoices as i', 'i.id', 'p.invoice_id')
      .select(['p.id', 'p.invoice_id', 'i.number as invoice_number', 'p.customer_id', 'p.amount', 'p.method', 'p.paid_at', 'p.reference', 'p.journal_entry_id', 'p.created_at']);
  }

  async listPayments(query: PaymentListQuery): Promise<Page<PaymentDto>> {
    const base = this.dbs.db.selectFrom('finance.payments as p');
    const filtered = query.invoiceId ? base.where('p.invoice_id', '=', query.invoiceId) : base;
    const { n } = await filtered.select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();

    let q = this.paymentsQuery(this.dbs.db);
    if (query.invoiceId) q = q.where('p.invoice_id', '=', query.invoiceId);
    const rows = await q
      .orderBy('p.paid_at', 'desc')
      .orderBy('p.created_at', 'desc')
      .limit(query.pageSize)
      .offset(offsetOf(query.page, query.pageSize))
      .execute();
    return toPage(rows.map(toPaymentDto), toCount(n), query.page, query.pageSize);
  }

  // ── commands ───────────────────────────────────────────────────────────────

  /**
   * Issue an invoice for an order and post it to the ledger — atomically:
   *     Dr 411 Clients (partner = customer)   TTC
   *       Cr 701 Ventes de produits finis      HT
   *       Cr 44571 TVA collectée               TVA
   * If any step fails (unbalanced, closed fiscal year, …) nothing is written, not even the invoice number.
   */
  async createFromOrder(orderId: string, dto: CreateInvoiceDto, actorId: string): Promise<InvoiceDetailDto> {
    return this.dbs.transaction(async (trx) => {
      const locked = await trx.selectFrom('erp.orders').select('id').where('id', '=', orderId).forUpdate().executeTakeFirst();
      if (!locked) throw new NotFoundException('Order not found');

      const order = await trx
        .selectFrom('erp.orders as o')
        .innerJoin('crm.customers as c', 'c.id', 'o.customer_id')
        .select(['o.id', 'o.number', 'o.status', 'o.customer_id', 'c.name as customer_name', 'o.total_ht', 'o.total_tva', 'o.total_ttc'])
        .where('o.id', '=', orderId)
        .executeTakeFirstOrThrow();

      if (!INVOICEABLE.includes(order.status)) {
        throw conflict(`Only CONFIRMED (or later) orders can be invoiced; ${order.number} is ${order.status}`, 'ORDER_NOT_INVOICEABLE');
      }
      const existing = await trx
        .selectFrom('finance.invoices')
        .select(['number', 'status'])
        .where('order_id', '=', orderId)
        .where('status', '<>', 'CANCELLED')
        .executeTakeFirst();
      if (existing) throw conflict(`Order ${order.number} is already invoiced (${existing.number})`, 'ALREADY_INVOICED');

      const ht = parseMoney(order.total_ht);
      const tva = parseMoney(order.total_tva);
      const ttc = parseMoney(order.total_ttc);
      if (ht + tva !== ttc || ttc <= 0n) {
        throw new UnprocessableEntityException({ message: 'Order totals are inconsistent or zero; cannot invoice', code: 'INVALID_ORDER_TOTALS' });
      }

      const invoiceDate = dto.invoiceDate ?? todayIso();
      const dueDate = dto.dueDate === undefined ? addDays(invoiceDate, DEFAULT_PAYMENT_TERM_DAYS) : dto.dueDate;

      // Gap-free, per-year invoice number (counter row inside this transaction; year from the invoice DATE).
      const num = await sql<{ n: string }>`select core.next_doc_no('INV', ${invoiceDate}::date) as n`.execute(trx);
      const number = num.rows[0]!.n;

      const invoiceId = randomUUID();
      const posted = await this.ledger.postInTx(
        trx,
        {
          journalCode: JOURNALS.SALES,
          entryDate: invoiceDate,
          description: `Invoice ${number} - ${order.customer_name}`,
          reference: number,
          sourceType: 'INVOICE',
          sourceId: invoiceId,
          lines: [
            { accountCode: ACCOUNTS.RECEIVABLES, debit: order.total_ttc, partnerId: order.customer_id, description: `Invoice ${number}` },
            { accountCode: ACCOUNTS.SALES, credit: order.total_ht, description: `Sales ${order.number}` },
            ...(tva > 0n ? [{ accountCode: ACCOUNTS.VAT_COLLECTED, credit: order.total_tva, description: `TVA ${number}` }] : []),
          ],
        },
        actorId,
      );

      await trx
        .insertInto('finance.invoices')
        .values({
          id: invoiceId,
          number,
          order_id: orderId,
          customer_id: order.customer_id,
          invoice_date: invoiceDate,
          due_date: dueDate ?? null,
          status: 'ISSUED',
          total_ht: order.total_ht,
          total_tva: order.total_tva,
          total_ttc: order.total_ttc,
          journal_entry_id: posted.id,
          created_by: actorId,
        })
        .execute();

      return this.load(trx, invoiceId);
    });
  }

  /**
   * Cancel an unpaid invoice: the original entry stays untouched (POSTED entries are immutable) and a reversing
   * entry — debits and credits swapped — is posted. The invoice keeps its number; a new one can be issued for the order.
   * MVP-NOTE: real Algerian practice is a credit note (avoir); this is the ledger-level equivalent.
   */
  async cancel(id: string, dto: CancelInvoiceDto, actorId: string): Promise<InvoiceDetailDto> {
    return this.dbs.transaction(async (trx) => {
      const inv = await trx
        .selectFrom('finance.invoices')
        .select(['id', 'number', 'status', 'amount_paid', 'journal_entry_id'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!inv) throw new NotFoundException('Invoice not found');
      if (inv.status === 'CANCELLED') throw conflict('Invoice is already cancelled', 'ALREADY_CANCELLED');
      if (parseMoney(inv.amount_paid) > 0n) {
        // MVP-NOTE: refunding / un-applying payments is out of scope; cancel needs an unpaid invoice.
        throw conflict(`Invoice ${inv.number} has payments (${inv.amount_paid}); it cannot be cancelled`, 'HAS_PAYMENTS');
      }
      if (!inv.journal_entry_id) throw conflict('Invoice has no ledger entry to reverse', 'NO_ENTRY');

      const reversal = await this.ledger.reverseInTx(trx, inv.journal_entry_id, { reason: `Invoice ${inv.number} cancelled: ${dto.reason}`, entryDate: dto.entryDate }, actorId);
      await trx
        .updateTable('finance.invoices')
        .set({ status: 'CANCELLED', cancelled_at: new Date(), cancel_entry_id: reversal.id })
        .where('id', '=', id)
        .execute();
      return this.load(trx, id);
    });
  }

  /** Record a customer payment and post it:  Dr 512 Banque (or 530 Caisse)  /  Cr 411 Clients. */
  async recordPayment(invoiceId: string, dto: RecordPaymentDto, actorId: string): Promise<InvoiceDetailDto> {
    return this.dbs.transaction(async (trx) => {
      // The row lock serialises concurrent payments, so two cashiers cannot both pay the last dinar.
      const inv = await trx
        .selectFrom('finance.invoices')
        .select(['id', 'number', 'status', 'customer_id', 'total_ttc', 'amount_paid'])
        .where('id', '=', invoiceId)
        .forUpdate()
        .executeTakeFirst();
      if (!inv) throw new NotFoundException('Invoice not found');
      if (inv.status !== 'ISSUED' && inv.status !== 'PARTIALLY_PAID') {
        throw conflict(`Invoice ${inv.number} is ${inv.status} and cannot receive payments`, 'INVOICE_NOT_PAYABLE');
      }

      const amount = parseMoney(dto.amount);
      const paid = parseMoney(inv.amount_paid);
      const ttc = parseMoney(inv.total_ttc);
      const remaining = ttc - paid;
      if (amount > remaining) {
        throw new UnprocessableEntityException({
          message: `Payment ${formatMoney(amount)} exceeds the balance due ${formatMoney(remaining)}`,
          code: 'OVERPAYMENT',
          details: { balanceDue: formatMoney(remaining) },
        });
      }

      const paidAt = dto.paidAt ?? todayIso();
      const paymentId = randomUUID();
      const cash = dto.method === 'CASH';
      const posted = await this.ledger.postInTx(
        trx,
        {
          journalCode: cash ? JOURNALS.CASH : JOURNALS.BANK,
          entryDate: paidAt,
          description: `Payment received for ${inv.number} (${dto.method})`,
          reference: dto.reference ?? inv.number,
          sourceType: 'PAYMENT',
          sourceId: paymentId,
          lines: [
            { accountCode: cash ? ACCOUNTS.CASH : ACCOUNTS.BANK, debit: dto.amount },
            { accountCode: ACCOUNTS.RECEIVABLES, credit: dto.amount, partnerId: inv.customer_id },
          ],
        },
        actorId,
      );

      await trx
        .insertInto('finance.payments')
        .values({
          id: paymentId,
          invoice_id: invoiceId,
          customer_id: inv.customer_id,
          amount: dto.amount,
          method: dto.method,
          paid_at: paidAt,
          reference: dto.reference ?? null,
          journal_entry_id: posted.id,
          created_by: actorId,
        })
        .execute();

      const newPaid = paid + amount;
      await trx
        .updateTable('finance.invoices')
        .set({ amount_paid: formatMoney(newPaid), status: newPaid === ttc ? 'PAID' : 'PARTIALLY_PAID' })
        .where('id', '=', invoiceId)
        .execute();

      return this.load(trx, invoiceId);
    });
  }
}

function toPaymentDto(r: {
  id: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  amount: string;
  method: PaymentMethod;
  paid_at: string;
  reference: string | null;
  journal_entry_id: string | null;
  created_at: Date;
}): PaymentDto {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
    customerId: r.customer_id,
    amount: r.amount,
    method: r.method,
    paidAt: r.paid_at,
    reference: r.reference,
    journalEntryId: r.journal_entry_id,
    createdAt: iso(r.created_at),
  };
}
