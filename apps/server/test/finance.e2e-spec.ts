import type { INestApplication } from '@nestjs/common';
import { sql } from '@victorflow/db';
import { bearer, createTestApp, dbOf, http, tokens } from './helpers/app';

type Line = { accountCode: string; accountName: string; debit: string; credit: string; partnerId: string | null };

describe('P5 — finance ledger, invoices, payments (e2e)', () => {
  let app: INestApplication;
  let t: Record<'admin' | 'sales' | 'production' | 'qa', string>;

  beforeAll(async () => {
    app = await createTestApp();
    t = await tokens(app, 'admin', 'sales', 'production', 'qa');
    // Several tests below date documents in 2027; the seed only opens the current test year (2026).
    await http(app).post('/api/v1/finance/fiscal-years').set(bearer(t.admin)).send({ code: '2027', startDate: '2027-01-01', endDate: '2027-12-31' }).expect(201);
  });
  afterAll(async () => {
    await app.close();
  });

  const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const db = () => dbOf(app).db;
  const line = (accountCode: string, debit: string, credit: string, extra: object = {}) => ({ accountCode, debit, credit, ...extra });
  const codeOf = (lines: Line[], code: string) => lines.find((l) => l.accountCode === code);

  const postManual = (body: object, token = t.admin) => http(app).post('/api/v1/finance/entries').set(bearer(token)).send(body);
  const entryCount = async () => Number((await db().selectFrom('finance.journal_entries').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n);

  // t.admin creates the order (no service catalogue seeded for this suite, so every line is a manual/
  // override price, and t.admin holds sales.order.override_price) — orthogonal to what these tests
  // actually exercise (the ledger/invoice/payment side, not who may create an order).
  async function confirmedOrder(items: object[] = [{ description: 'Enseigne', quantity: '3', unitPrice: '1250.50', overrideReason: 'test fixture' }]) {
    const c = (await http(app).post('/api/v1/customers').set(bearer(t.sales)).send({ name: `Fin Client ${uniq()}` }).expect(201)).body;
    const o = (await http(app).post('/api/v1/orders').set(bearer(t.admin)).send({ customerId: c.id, items }).expect(201)).body;
    await http(app).post(`/api/v1/orders/${o.id}/confirm`).set(bearer(t.sales)).expect(200);
    return { customer: c, order: o };
  }

  const invoiceFor = (orderId: string, body: object = { invoiceDate: '2026-03-10' }, token = t.sales) =>
    http(app).post(`/api/v1/finance/invoices/from-order/${orderId}`).set(bearer(token)).send(body);

  describe('manual entries — balance enforced', () => {
    it('REJECTS an unbalanced entry (422 with exact figures) and leaves no trace', async () => {
      const before = await entryCount();
      const res = await postManual({
        journalCode: 'OD',
        entryDate: '2026-03-01',
        description: 'Unbalanced on purpose',
        lines: [line('512', '100.0000', '0'), line('701', '0', '99.9999')],
      }).expect(422);
      expect(res.body.code).toBe('UNBALANCED_ENTRY');
      expect(res.body.details).toEqual({ totalDebit: '100.0000', totalCredit: '99.9999', difference: '0.0001' });
      expect(await entryCount()).toBe(before); // atomic: not even a DRAFT row survived
    });

    it('posts a balanced entry, numbered from the journal/fiscal-year sequence, with exact decimals', async () => {
      const res = await postManual({
        journalCode: 'OD',
        entryDate: '2026-03-02',
        description: 'Capital injection',
        reference: 'CAP-1',
        lines: [line('512', '0.1', '0'), line('530', '0.2', '0'), line('101', '0', '0.3')], // 0.1 + 0.2 = 0.3 exactly
      }).expect(201);
      expect(res.body).toMatchObject({ status: 'POSTED', journalCode: 'OD', fiscalYear: '2026', totalDebit: '0.3000', totalCredit: '0.3000' });
      expect(res.body.entryNumber).toMatch(/^OD\/2026\/\d{6}$/);
      expect(res.body.lines).toHaveLength(3);
    });

    it('rejects malformed input at the boundary (400) and unusable accounts/journals/dates (422)', async () => {
      const base = { journalCode: 'OD', entryDate: '2026-03-02', description: 'x1', lines: [line('512', '5', '0'), line('701', '0', '5')] };
      await postManual({ ...base, lines: [line('512', '5', '0')] }).expect(400); // < 2 lines (zod)
      await postManual({ ...base, lines: [{ accountCode: '512', debit: 5, credit: '0' }, line('701', '0', '5')] }).expect(400); // number, not string
      await postManual({ ...base, entryDate: '2026-02-30' }).expect(400); // not a real date
      await postManual({ ...base, lines: [line('512', '5', '5'), line('701', '0', '5')] }).expect(422); // both sides
      await postManual({ ...base, lines: [line('999999', '5', '0'), line('701', '0', '5')] }).then((r) => expect(r.body.code).toBe('UNKNOWN_ACCOUNT'));
      await postManual({ ...base, lines: [line('4457', '5', '0'), line('701', '0', '5')] }).then((r) => {
        expect(r.status).toBe(422); // 4457 is a non-postable group account
        expect(r.body.code).toBe('ACCOUNT_NOT_POSTABLE');
      });
      await postManual({ ...base, journalCode: 'ZZ' }).then((r) => expect(r.body.code).toBe('UNKNOWN_JOURNAL'));
      await postManual({ ...base, entryDate: '2019-06-01' }).then((r) => {
        expect(r.status).toBe(422);
        expect(r.body.code).toBe('NO_FISCAL_YEAR');
      });
    });

    it('takes the YEAR from the entry DATE, not the server clock', async () => {
      const years = (await http(app).get('/api/v1/finance/fiscal-years').set(bearer(t.admin)).expect(200)).body;
      expect(years.find((y: { code: string }) => y.code === '2027')).toMatchObject({ status: 'OPEN', startDate: '2027-01-01', endDate: '2027-12-31' });

      const in2027 = await postManual({ journalCode: 'ACH', entryDate: '2027-03-15', description: 'Future year', lines: [line('601', '10', '0'), line('401', '0', '10')] }).expect(201);
      expect(in2027.body.entryNumber).toBe('ACH/2027/000001');
      expect(in2027.body.fiscalYear).toBe('2027');

      const dec2026 = await postManual({ journalCode: 'ACH', entryDate: '2026-12-31', description: 'Last day', lines: [line('601', '10', '0'), line('401', '0', '10')] }).expect(201);
      expect(dec2026.body.entryNumber).toMatch(/^ACH\/2026\/\d{6}$/);

      // each (journal, year) has its OWN Postgres sequence
      const seqs = await sql<{ relname: string }>`select relname from pg_class where relkind = 'S' and relnamespace = 'finance'::regnamespace`.execute(db());
      expect(seqs.rows.map((r) => r.relname)).toEqual(expect.arrayContaining(['je_seq_ach_2027', 'je_seq_ach_2026']));
    });

    it('numbers 12 concurrent postings uniquely and consecutively (a SEQUENCE, not COUNT(*)+1)', async () => {
      const N = 12;
      const results = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          postManual({ journalCode: 'CAI', entryDate: '2026-04-01', description: `Concurrent ${i}`, lines: [line('530', '1', '0'), line('701', '0', '1')] }),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      const nums = results.map((r) => Number((r.body.entryNumber as string).split('/')[2])).sort((a, b) => a - b);
      expect(new Set(nums).size).toBe(N); // no duplicates
      expect(nums[N - 1]! - nums[0]!).toBe(N - 1); // no gaps among successes
    });

    it('refuses a closed fiscal year', async () => {
      await http(app).post('/api/v1/finance/fiscal-years').set(bearer(t.admin)).send({ code: '2024', startDate: '2024-01-01', endDate: '2024-12-31' }).expect(201);
      const y = (await http(app).get('/api/v1/finance/fiscal-years').set(bearer(t.admin)).expect(200)).body.find((f: { code: string }) => f.code === '2024');
      await http(app).post(`/api/v1/finance/fiscal-years/${y.id}/close`).set(bearer(t.admin)).expect(200);
      const res = await postManual({ journalCode: 'OD', entryDate: '2024-06-01', description: 'Into a closed year', lines: [line('512', '5', '0'), line('701', '0', '5')] }).expect(422);
      expect(res.body.code).toBe('FISCAL_YEAR_CLOSED');
    });

    it('overlapping fiscal years are refused (409)', async () => {
      await http(app).post('/api/v1/finance/fiscal-years').set(bearer(t.admin)).send({ code: '2026B', startDate: '2026-07-01', endDate: '2027-06-30' }).expect(409);
    });
  });

  describe('invoice from an order — balanced 411 / 701 / 44571', () => {
    it('posts Dr 411 TTC / Cr 701 HT / Cr 44571 TVA — balanced, partnered, atomic', async () => {
      const { customer, order } = await confirmedOrder(); // 3 × 1250.50 → HT 3751.50, TVA 712.79, TTC 4464.29
      const res = await invoiceFor(order.id).expect(201);
      const inv = res.body;
      expect(inv).toMatchObject({
        status: 'ISSUED',
        orderId: order.id,
        customerId: customer.id,
        invoiceDate: '2026-03-10',
        dueDate: '2026-04-09',
        totalHt: '3751.5000',
        totalTva: '712.7900',
        totalTtc: '4464.2900',
        amountPaid: '0.0000',
        balanceDue: '4464.2900',
      });
      expect(inv.number).toMatch(/^INV-2026-\d{6}$/);
      expect(inv.items).toHaveLength(1);

      const entry = (await http(app).get(`/api/v1/finance/entries/${inv.journalEntry.id}`).set(bearer(t.admin)).expect(200)).body;
      expect(entry).toMatchObject({ status: 'POSTED', journalCode: 'VTE', sourceType: 'INVOICE', reference: inv.number, entryDate: '2026-03-10' });
      expect(entry.entryNumber).toMatch(/^VTE\/2026\/\d{6}$/);
      expect(entry.lines).toHaveLength(3);

      const [receivable, sales, vat] = [codeOf(entry.lines, '411')!, codeOf(entry.lines, '701')!, codeOf(entry.lines, '44571')!];
      expect(receivable).toMatchObject({ debit: '4464.2900', credit: '0.0000', partnerId: customer.id });
      expect(sales).toMatchObject({ debit: '0.0000', credit: '3751.5000' });
      expect(vat).toMatchObject({ debit: '0.0000', credit: '712.7900' });
      expect(entry.totalDebit).toBe(entry.totalCredit); // BALANCED
      expect(entry.totalDebit).toBe('4464.2900');
    });

    it('numbers invoices gap-free and increasing per year', async () => {
      const a = await confirmedOrder();
      const b = await confirmedOrder();
      const [ia, ib] = [(await invoiceFor(a.order.id).expect(201)).body, (await invoiceFor(b.order.id).expect(201)).body];
      const seq = (n: string) => Number(n.split('-')[2]);
      expect(seq(ib.number)).toBe(seq(ia.number) + 1);

      const other = (await invoiceFor((await confirmedOrder()).order.id, { invoiceDate: '2027-01-05' }).expect(201)).body;
      expect(other.number).toBe('INV-2027-000001'); // year comes from the invoice DATE
    });

    it('a zero-TVA order posts just two lines and still balances', async () => {
      const { order } = await confirmedOrder([{ description: 'Export', quantity: '1', unitPrice: '1000', tvaRate: '0', overrideReason: 'test fixture' }]);
      const inv = (await invoiceFor(order.id).expect(201)).body;
      const entry = (await http(app).get(`/api/v1/finance/entries/${inv.journalEntry.id}`).set(bearer(t.admin)).expect(200)).body;
      expect(entry.lines.map((l: Line) => l.accountCode).sort()).toEqual(['411', '701']);
      expect(entry.totalDebit).toBe('1000.0000');
    });

    it('refuses to invoice a DRAFT order, an unknown order, or the same order twice', async () => {
      const c = (await http(app).post('/api/v1/customers').set(bearer(t.sales)).send({ name: `Draft Client ${uniq()}` }).expect(201)).body;
      const draft = (await http(app).post('/api/v1/orders').set(bearer(t.admin)).send({ customerId: c.id, items: [{ description: 'x', quantity: '1', unitPrice: '10', overrideReason: 'test fixture' }] }).expect(201)).body;
      expect((await invoiceFor(draft.id)).body.code).toBe('ORDER_NOT_INVOICEABLE');
      await invoiceFor('11111111-1111-1111-1111-111111111111').then((r) => expect(r.status).toBe(404));

      const { order } = await confirmedOrder();
      await invoiceFor(order.id).expect(201);
      const dup = await invoiceFor(order.id).expect(409);
      expect(dup.body.code).toBe('ALREADY_INVOICED');
    });

    it('two simultaneous invoice requests for one order → exactly one invoice', async () => {
      const { order } = await confirmedOrder();
      const [a, b] = await Promise.all([invoiceFor(order.id), invoiceFor(order.id, { invoiceDate: '2026-03-11' })]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
    });

    it('rolls back EVERYTHING when posting fails (no invoice, no number consumed, no entry)', async () => {
      const { order } = await confirmedOrder();
      const entriesBefore = await entryCount();
      const res = await invoiceFor(order.id, { invoiceDate: '2019-01-01' }).expect(422); // no fiscal year
      expect(res.body.code).toBe('NO_FISCAL_YEAR');
      expect(await entryCount()).toBe(entriesBefore);
      const invs = await db().selectFrom('finance.invoices').select('id').where('order_id', '=', order.id).execute();
      expect(invs).toHaveLength(0);
      await invoiceFor(order.id).expect(201); // and the order can still be invoiced normally afterwards
    });
  });

  describe('cancellation posts a REVERSING entry; posted entries are immutable', () => {
    it('cancelling an invoice reverses its entry (swapped lines), leaves the original untouched, and frees the order', async () => {
      const { order } = await confirmedOrder();
      const inv = (await invoiceFor(order.id).expect(201)).body;
      const originalId = inv.journalEntry.id;

      const cancelled = (
        await http(app).post(`/api/v1/finance/invoices/${inv.id}/cancel`).set(bearer(t.admin)).send({ reason: 'Client withdrew', entryDate: '2026-03-12' }).expect(200)
      ).body;
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancelEntry.entryNumber).toMatch(/^VTE\/2026\/\d{6}$/);

      const reversal = (await http(app).get(`/api/v1/finance/entries/${cancelled.cancelEntry.id}`).set(bearer(t.admin)).expect(200)).body;
      expect(reversal).toMatchObject({ sourceType: 'REVERSAL', reversalOf: originalId, entryDate: '2026-03-12', status: 'POSTED' });
      // swapped: 411 is now CREDITED, 701 / 44571 DEBITED, amounts identical
      expect(codeOf(reversal.lines, '411')).toMatchObject({ debit: '0.0000', credit: '4464.2900' });
      expect(codeOf(reversal.lines, '701')).toMatchObject({ debit: '3751.5000', credit: '0.0000' });
      expect(codeOf(reversal.lines, '44571')).toMatchObject({ debit: '712.7900', credit: '0.0000' });
      expect(reversal.totalDebit).toBe(reversal.totalCredit);

      const original = (await http(app).get(`/api/v1/finance/entries/${originalId}`).set(bearer(t.admin)).expect(200)).body;
      expect(original).toMatchObject({ status: 'POSTED', reversedBy: reversal.id });
      expect(codeOf(original.lines, '411')).toMatchObject({ debit: '4464.2900' }); // unchanged

      // the order can be invoiced again, with a NEW number
      const again = (await invoiceFor(order.id).expect(201)).body;
      expect(again.number).not.toBe(inv.number);

      await http(app).post(`/api/v1/finance/invoices/${inv.id}/cancel`).set(bearer(t.admin)).send({ reason: 'twice?' }).expect(409);
    });

    it('a reversal nets the ledger to zero for that invoice', async () => {
      const { customer, order } = await confirmedOrder();
      const inv = (await invoiceFor(order.id).expect(201)).body;
      await http(app).post(`/api/v1/finance/invoices/${inv.id}/cancel`).set(bearer(t.admin)).send({ reason: 'net zero', entryDate: '2026-03-12' }).expect(200);

      const bal = await sql<{ d: string; c: string }>`
        select coalesce(sum(l.debit),0)::text as d, coalesce(sum(l.credit),0)::text as c
          from finance.journal_entry_lines l join finance.chart_of_accounts a on a.id = l.account_id
         where l.partner_id = ${customer.id} and a.code = '411'`.execute(db());
      expect(bal.rows[0]).toEqual({ d: '4464.2900', c: '4464.2900' });
    });

    it('reverses a manual entry once — a second reversal, or reversing a reversal, is refused', async () => {
      const posted = (await postManual({ journalCode: 'OD', entryDate: '2026-05-01', description: 'To reverse', lines: [line('512', '50', '0'), line('701', '0', '50')] }).expect(201)).body;
      const rev = (await http(app).post(`/api/v1/finance/entries/${posted.id}/reverse`).set(bearer(t.admin)).send({ reason: 'Posted by mistake', entryDate: '2026-05-02' }).expect(201)).body;
      expect(rev.reversalOf).toBe(posted.id);
      expect((await http(app).post(`/api/v1/finance/entries/${posted.id}/reverse`).set(bearer(t.admin)).send({ reason: 'again', entryDate: '2026-05-02' }).expect(409)).body.code).toBe('ALREADY_REVERSED');
      expect((await http(app).post(`/api/v1/finance/entries/${rev.id}/reverse`).set(bearer(t.admin)).send({ reason: 'undo undo', entryDate: '2026-05-02' }).expect(409)).body.code).toBe('IS_REVERSAL');
    });

    it('the DATABASE rejects UPDATE / DELETE on a POSTED entry and its lines, whatever the caller', async () => {
      const posted = (await postManual({ journalCode: 'OD', entryDate: '2026-05-03', description: 'Immutable', lines: [line('512', '9', '0'), line('701', '0', '9')] }).expect(201)).body;
      // Thunks, awaited one by one: an eagerly-built array would start every query at once and leave later
      // rejections unhandled while an earlier one is still being awaited.
      const attempts: Array<() => Promise<unknown>> = [
        () => db().updateTable('finance.journal_entries').set({ description: 'edited' }).where('id', '=', posted.id).execute(),
        () => db().deleteFrom('finance.journal_entries').where('id', '=', posted.id).execute(),
        () => db().updateTable('finance.journal_entry_lines').set({ debit: '99' }).where('entry_id', '=', posted.id).execute(),
        () => db().deleteFrom('finance.journal_entry_lines').where('entry_id', '=', posted.id).execute(),
      ];
      for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ code: 'VF001' });
    });
  });

  describe('payments', () => {
    it('applies partial then full payments: PARTIALLY_PAID → PAID, each posted Dr bank|cash / Cr 411', async () => {
      const { customer, order } = await confirmedOrder();
      const inv = (await invoiceFor(order.id).expect(201)).body; // TTC 4464.29

      const p1 = (await http(app).post(`/api/v1/finance/invoices/${inv.id}/payments`).set(bearer(t.sales)).send({ amount: '1000', method: 'CASH', paidAt: '2026-03-15', reference: 'REC-1' }).expect(201)).body;
      expect(p1).toMatchObject({ status: 'PARTIALLY_PAID', amountPaid: '1000.0000', balanceDue: '3464.2900' });
      expect(p1.payments).toHaveLength(1);

      const e1 = (await http(app).get(`/api/v1/finance/entries/${p1.payments[0].journalEntryId}`).set(bearer(t.admin)).expect(200)).body;
      expect(e1).toMatchObject({ journalCode: 'CAI', sourceType: 'PAYMENT', entryDate: '2026-03-15' });
      expect(codeOf(e1.lines, '530')).toMatchObject({ debit: '1000.0000' });
      expect(codeOf(e1.lines, '411')).toMatchObject({ credit: '1000.0000', partnerId: customer.id });

      const p2 = (await http(app).post(`/api/v1/finance/invoices/${inv.id}/payments`).set(bearer(t.sales)).send({ amount: '3464.29', method: 'BANK_TRANSFER', paidAt: '2026-03-20' }).expect(201)).body;
      expect(p2).toMatchObject({ status: 'PAID', amountPaid: '4464.2900', balanceDue: '0.0000' });
      const e2 = (await http(app).get(`/api/v1/finance/entries/${p2.payments[1].journalEntryId}`).set(bearer(t.admin)).expect(200)).body;
      expect(e2.journalCode).toBe('BNQ');
      expect(codeOf(e2.lines, '512')).toMatchObject({ debit: '3464.2900' });

      await http(app).post(`/api/v1/finance/invoices/${inv.id}/payments`).set(bearer(t.sales)).send({ amount: '1', method: 'CASH', paidAt: '2026-03-21' }).expect(409); // already PAID
    });

    it('refuses an overpayment (422 with the balance) and a non-positive or float amount (400)', async () => {
      const { order } = await confirmedOrder();
      const inv = (await invoiceFor(order.id).expect(201)).body;
      const pay = (body: object) => http(app).post(`/api/v1/finance/invoices/${inv.id}/payments`).set(bearer(t.sales)).send({ method: 'CASH', paidAt: '2026-03-15', ...body });
      const over = await pay({ amount: '4464.30' }).expect(422);
      expect(over.body).toMatchObject({ code: 'OVERPAYMENT', details: { balanceDue: '4464.2900' } });
      await pay({ amount: '0' }).expect(400);
      await pay({ amount: '-5' }).expect(400);
      await pay({ amount: 100.5 }).expect(400);
      await pay({ amount: '10', method: 'BITCOIN' }).expect(400);
    });

    it('two simultaneous payments cannot together exceed the balance', async () => {
      const { order } = await confirmedOrder();
      const inv = (await invoiceFor(order.id).expect(201)).body;
      const pay = () => http(app).post(`/api/v1/finance/invoices/${inv.id}/payments`).set(bearer(t.sales)).send({ amount: '3000', method: 'CASH', paidAt: '2026-03-15' });
      const [a, b] = await Promise.all([pay(), pay()]);
      expect([a.status, b.status].sort()).toEqual([201, 422]);
      const after = (await http(app).get(`/api/v1/finance/invoices/${inv.id}`).set(bearer(t.sales)).expect(200)).body;
      expect(after.amountPaid).toBe('3000.0000');
    });

    it('an invoice with payments cannot be cancelled; a cancelled one cannot be paid', async () => {
      const { order } = await confirmedOrder();
      const inv = (await invoiceFor(order.id).expect(201)).body;
      await http(app).post(`/api/v1/finance/invoices/${inv.id}/payments`).set(bearer(t.sales)).send({ amount: '10', method: 'CASH', paidAt: '2026-03-15' }).expect(201);
      expect((await http(app).post(`/api/v1/finance/invoices/${inv.id}/cancel`).set(bearer(t.admin)).send({ reason: 'nope' }).expect(409)).body.code).toBe('HAS_PAYMENTS');

      const { order: o2 } = await confirmedOrder();
      const inv2 = (await invoiceFor(o2.id).expect(201)).body;
      await http(app).post(`/api/v1/finance/invoices/${inv2.id}/cancel`).set(bearer(t.admin)).send({ reason: 'mistake', entryDate: '2026-03-12' }).expect(200);
      await http(app).post(`/api/v1/finance/invoices/${inv2.id}/payments`).set(bearer(t.sales)).send({ amount: '10', method: 'CASH', paidAt: '2026-03-15' }).expect(409);
    });

    it('lists invoices (filter/search) and payments', async () => {
      const { customer, order } = await confirmedOrder();
      const inv = (await invoiceFor(order.id).expect(201)).body;
      await http(app).post(`/api/v1/finance/invoices/${inv.id}/payments`).set(bearer(t.sales)).send({ amount: '5', method: 'CHEQUE', paidAt: '2026-03-15' }).expect(201);

      const byCustomer = (await http(app).get('/api/v1/finance/invoices').query({ customerId: customer.id }).set(bearer(t.sales)).expect(200)).body;
      expect(byCustomer.items.map((i: { id: string }) => i.id)).toEqual([inv.id]);
      expect(byCustomer.items[0]).toMatchObject({ customerName: customer.name, orderNumber: order.number, status: 'PARTIALLY_PAID' });
      const byStatus = (await http(app).get('/api/v1/finance/invoices').query({ status: 'PARTIALLY_PAID', search: inv.number }).set(bearer(t.sales)).expect(200)).body;
      expect(byStatus.items).toHaveLength(1);
      const pays = (await http(app).get('/api/v1/finance/payments').query({ invoiceId: inv.id }).set(bearer(t.sales)).expect(200)).body;
      expect(pays.items).toHaveLength(1);
      expect(pays.items[0]).toMatchObject({ amount: '5.0000', method: 'CHEQUE', invoiceNumber: inv.number });
    });
  });

  describe('reporting & permissions', () => {
    it('the trial balance always balances and includes the invoice accounts', async () => {
      const tb = (await http(app).get('/api/v1/finance/trial-balance').query({ fiscalYear: '2026' }).set(bearer(t.admin)).expect(200)).body;
      expect(tb.balanced).toBe(true);
      expect(tb.totalDebit).toBe(tb.totalCredit);
      const codes = tb.rows.map((r: { accountCode: string }) => r.accountCode);
      expect(codes).toEqual(expect.arrayContaining(['411', '701', '44571', '512', '530']));
      const sum = (k: 'debit' | 'credit') => tb.rows.reduce((a: bigint, r: Record<string, string>) => a + BigInt((r[k] as string).replace('.', '')), 0n);
      expect(sum('debit')).toBe(sum('credit'));
      await http(app).get('/api/v1/finance/trial-balance').query({ fiscalYear: '1999' }).set(bearer(t.admin)).expect(404);
    });

    it('lists and filters ledger entries', async () => {
      const list = (await http(app).get('/api/v1/finance/entries').query({ journal: 'VTE', from: '2026-03-01', to: '2026-03-31', pageSize: 100 }).set(bearer(t.admin)).expect(200)).body;
      expect(list.total).toBeGreaterThan(3);
      expect(list.items.every((e: { journalCode: string }) => e.journalCode === 'VTE')).toBe(true);
      const byAccount = (await http(app).get('/api/v1/finance/entries').query({ accountCode: '44571', pageSize: 100 }).set(bearer(t.admin)).expect(200)).body;
      expect(byAccount.items.length).toBeGreaterThan(0);
    });

    it('permissions: sales can invoice and take payments but not post/reverse/cancel or read the ledger; production sees nothing', async () => {
      const { order } = await confirmedOrder();
      const inv = (await invoiceFor(order.id, { invoiceDate: '2026-03-10' }, t.sales).expect(201)).body; // finance.invoice.create ✔

      await http(app).get('/api/v1/finance/entries').set(bearer(t.sales)).expect(403); // finance.entry.read ✘
      await http(app).post('/api/v1/finance/entries').set(bearer(t.sales)).send({ journalCode: 'OD', entryDate: '2026-03-01', description: 'nope', lines: [line('512', '1', '0'), line('701', '0', '1')] }).expect(403);
      await http(app).post(`/api/v1/finance/invoices/${inv.id}/cancel`).set(bearer(t.sales)).send({ reason: 'nope' }).expect(403);
      await http(app).get('/api/v1/finance/invoices').set(bearer(t.production)).expect(403);
      await http(app).post(`/api/v1/finance/invoices/from-order/${order.id}`).set(bearer(t.qa)).send({}).expect(403);
      await http(app).get('/api/v1/finance/invoices').expect(401);
    });
  });
});
