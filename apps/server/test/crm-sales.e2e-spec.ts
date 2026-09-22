import type { INestApplication } from '@nestjs/common';
import { bearer, createTestApp, dbOf, http, tokens } from './helpers/app';

describe('P4 — CRM + Sales (e2e)', () => {
  let app: INestApplication;
  let t: Record<'admin' | 'sales' | 'production' | 'field', string>;

  beforeAll(async () => {
    app = await createTestApp();
    t = await tokens(app, 'admin', 'sales', 'production', 'field');
  });
  afterAll(async () => {
    await app.close();
  });

  const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  async function newCustomer(overrides: Record<string, unknown> = {}) {
    const res = await http(app)
      .post('/api/v1/customers')
      .set(bearer(t.sales))
      .send({ name: `Client ${uniq()}`, wilaya: 'Alger', ...overrides })
      .expect(201);
    return res.body as { id: string; code: string; name: string };
  }

  const line = (over: Record<string, unknown> = {}) => ({ description: 'Enseigne', quantity: '3', unitPrice: '1250.50', ...over });

  async function newOrder(customerId: string, items: unknown[] = [line()], extra: Record<string, unknown> = {}) {
    const res = await http(app).post('/api/v1/orders').set(bearer(t.sales)).send({ customerId, items, ...extra });
    return res;
  }

  describe('customers', () => {
    it('creates a customer with an auto code, Algerian fiscal ids and custom fields', async () => {
      const res = await http(app)
        .post('/api/v1/customers')
        .set(bearer(t.sales))
        .send({
          name: 'Imprimerie El Amel',
          nif: '099916000123456',
          rc: '16/00-1234567B15',
          email: 'contact@elamel.dz',
          wilaya: 'Blida',
          customFields: { source: 'salon', vip: true, discountTier: 2 },
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Imprimerie El Amel',
        customerType: 'COMPANY',
        nif: '099916000123456',
        isActive: true,
        customFields: { source: 'salon', vip: true, discountTier: 2 },
      });
      expect(res.body.code).toMatch(/^CUS-\d{6}$/);
    });

    it('validates input (zod): bad email, short name, non-scalar custom field', async () => {
      const bad = await http(app).post('/api/v1/customers').set(bearer(t.sales)).send({ name: 'x', email: 'nope', customFields: { a: { nested: 1 } } }).expect(400);
      expect(bad.body.issues.map((i: { path: string }) => i.path.split('.')[0]).sort()).toEqual(['customFields', 'email', 'name']);
    });

    it('searches by name/code and filters on a custom field (the GIN-indexed containment query)', async () => {
      const marker = `Zebra${uniq()}`;
      const a = await newCustomer({ name: `${marker} Print`, customFields: { channel: marker } });
      await newCustomer({ name: `Other ${uniq()}`, customFields: { channel: 'web' } });

      const byName = await http(app).get('/api/v1/customers').query({ search: marker }).set(bearer(t.sales)).expect(200);
      expect(byName.body.items.map((c: { id: string }) => c.id)).toEqual([a.id]);
      expect(byName.body.total).toBe(1);

      const byCode = await http(app).get('/api/v1/customers').query({ search: a.code }).set(bearer(t.sales)).expect(200);
      expect(byCode.body.items.map((c: { id: string }) => c.id)).toContain(a.id);

      const byField = await http(app).get('/api/v1/customers').query({ cfKey: 'channel', cfValue: marker }).set(bearer(t.sales)).expect(200);
      expect(byField.body.items.map((c: { id: string }) => c.id)).toEqual([a.id]);
    });

    it('treats LIKE wildcards in the search literally', async () => {
      const c = await newCustomer({ name: `Promo 100% ${uniq()}` });
      const hit = await http(app).get('/api/v1/customers').query({ search: '100%' }).set(bearer(t.sales)).expect(200);
      expect(hit.body.items.map((x: { id: string }) => x.id)).toContain(c.id);
      const miss = await http(app).get('/api/v1/customers').query({ search: '%%%%%%%%zzzz' }).set(bearer(t.sales)).expect(200);
      expect(miss.body.total).toBe(0);
    });

    it('paginates', async () => {
      const page = await http(app).get('/api/v1/customers').query({ page: 1, pageSize: 2 }).set(bearer(t.sales)).expect(200);
      expect(page.body.items).toHaveLength(2);
      expect(page.body.total).toBeGreaterThan(2);
      await http(app).get('/api/v1/customers').query({ pageSize: 9999 }).set(bearer(t.sales)).expect(400);
    });

    it('updates fields; an empty string clears an optional field; custom fields are replaced', async () => {
      const c = await newCustomer({ phone: '0555000000', customFields: { a: 1 } });
      const res = await http(app).patch(`/api/v1/customers/${c.id}`).set(bearer(t.sales)).send({ phone: '', city: 'Oran', customFields: { b: 2 } }).expect(200);
      expect(res.body).toMatchObject({ phone: null, city: 'Oran', customFields: { b: 2 } });
      await http(app).patch(`/api/v1/customers/${c.id}`).set(bearer(t.sales)).send({}).expect(400);
    });

    it('manages contacts; only one is primary', async () => {
      const c = await newCustomer();
      const first = await http(app).post(`/api/v1/customers/${c.id}/contacts`).set(bearer(t.sales)).send({ fullName: 'Ali Ben', isPrimary: true }).expect(201);
      const second = await http(app).post(`/api/v1/customers/${c.id}/contacts`).set(bearer(t.sales)).send({ fullName: 'Sara Ben', isPrimary: true }).expect(201);

      let detail = await http(app).get(`/api/v1/customers/${c.id}`).set(bearer(t.sales)).expect(200);
      expect(detail.body.contacts.filter((x: { isPrimary: boolean }) => x.isPrimary).map((x: { id: string }) => x.id)).toEqual([second.body.id]);

      await http(app).patch(`/api/v1/contacts/${first.body.id}`).set(bearer(t.sales)).send({ isPrimary: true, jobTitle: 'Gérant' }).expect(200);
      detail = await http(app).get(`/api/v1/customers/${c.id}`).set(bearer(t.sales)).expect(200);
      expect(detail.body.contacts.filter((x: { isPrimary: boolean }) => x.isPrimary).map((x: { id: string }) => x.id)).toEqual([first.body.id]);

      await http(app).delete(`/api/v1/contacts/${second.body.id}`).set(bearer(t.sales)).expect(204);
      await http(app).delete(`/api/v1/contacts/${second.body.id}`).set(bearer(t.sales)).expect(404);
    });

    it('enforces permissions: read-only roles cannot write, others cannot even read', async () => {
      const c = await newCustomer();
      await http(app).get(`/api/v1/customers/${c.id}`).set(bearer(t.production)).expect(200); // has crm.customer.read
      await http(app).post('/api/v1/customers').set(bearer(t.production)).send({ name: 'Nope Nope' }).expect(403);
      await http(app).patch(`/api/v1/customers/${c.id}`).set(bearer(t.production)).send({ city: 'X' }).expect(403);
      await http(app).get('/api/v1/customers').set(bearer(t.field)).expect(403);
      await http(app).get('/api/v1/customers').expect(401);
    });

    it('returns 404 for an unknown id and 400 for a malformed one', async () => {
      await http(app).get('/api/v1/customers/11111111-1111-1111-1111-111111111111').set(bearer(t.sales)).expect(404);
      await http(app).get('/api/v1/customers/not-a-uuid').set(bearer(t.sales)).expect(400);
    });

    it('deletes an unused customer but refuses one that has orders (409)', async () => {
      const free = await newCustomer();
      await http(app).delete(`/api/v1/customers/${free.id}`).set(bearer(t.sales)).expect(204);
      await http(app).get(`/api/v1/customers/${free.id}`).set(bearer(t.sales)).expect(404);

      const used = await newCustomer();
      await newOrder(used.id).then((r) => expect(r.status).toBe(201));
      const res = await http(app).delete(`/api/v1/customers/${used.id}`).set(bearer(t.sales)).expect(409);
      expect(res.body.code).toBe('REFERENCE_VIOLATION');
    });
  });

  describe('order totals — HT / TVA 19% / TTC in DZD, no floats', () => {
    it('3 × 1 250,50 → HT 3 751,50 / TVA 712,79 / TTC 4 464,29, and the DB holds the same NUMERIC values', async () => {
      const c = await newCustomer();
      const res = await newOrder(c.id).then((r) => {
        expect(r.status).toBe(201);
        return r.body;
      });
      expect(res.items[0]).toMatchObject({ lineHt: '3751.5000', lineTva: '712.7900', lineTtc: '4464.2900', tvaRate: '19.00', discountPct: '0.00' });
      expect([res.totalHt, res.totalTva, res.totalTtc]).toEqual(['3751.5000', '712.7900', '4464.2900']);

      const row = await dbOf(app).db.selectFrom('erp.orders').select(['total_ht', 'total_tva', 'total_ttc']).where('id', '=', res.id).executeTakeFirstOrThrow();
      expect(row).toEqual({ total_ht: '3751.5000', total_tva: '712.7900', total_ttc: '4464.2900' });
    });

    it('sums rounded lines exactly (ten 0.10 lines make 1.00, not 0.9999999…)', async () => {
      const c = await newCustomer();
      const items = Array.from({ length: 10 }, (_, i) => line({ description: `Ligne ${i}`, quantity: '1', unitPrice: '0.10' }));
      const res = await newOrder(c.id, items).then((r) => r.body);
      expect(res.totalHt).toBe('1.0000');
      // TVA is rounded PER LINE (0.10 × 19% = 0.019 → 0.02) and the document total is the sum of the rounded
      // lines: 10 × 0.02 = 0.20. (Rounding once on the 1.00 total would give 0.19 — a different, equally legal,
      // convention; we pick per-line so an invoice always equals the sum of what is printed on its lines.)
      expect(res.totalTva).toBe('0.2000');
      expect(res.totalTtc).toBe('1.2000');
    });

    it('handles discounts, fractional quantities and a mixed TVA rate', async () => {
      const c = await newCustomer();
      const res = await newOrder(c.id, [
        line({ description: 'Bâche 2.75 m²', quantity: '2.75', unitPrice: '1800' }), //          4950.00 + 940.50
        line({ description: 'Vinyle -12.5%', quantity: '10', unitPrice: '200', discountPct: '12.5' }), // 1750.00 + 332.50
        line({ description: 'Livre 9%', quantity: '1', unitPrice: '100', tvaRate: '9' }), //         100.00 +   9.00
      ]).then((r) => r.body);
      expect(res.items.map((i: { lineHt: string }) => i.lineHt)).toEqual(['4950.0000', '1750.0000', '100.0000']);
      expect(res.items.map((i: { lineTva: string }) => i.lineTva)).toEqual(['940.5000', '332.5000', '9.0000']);
      expect([res.totalHt, res.totalTva, res.totalTtc]).toEqual(['6800.0000', '1282.0000', '8082.0000']);
    });

    it('rejects JSON numbers for money (floats are never accepted), and out-of-range values', async () => {
      const c = await newCustomer();
      const asNumber = await newOrder(c.id, [{ description: 'x', quantity: '1', unitPrice: 12.5 }]);
      expect(asNumber.status).toBe(400);
      expect((await newOrder(c.id, [line({ quantity: '0' })])).status).toBe(400);
      expect((await newOrder(c.id, [line({ unitPrice: '-5' })])).status).toBe(400);
      expect((await newOrder(c.id, [line({ unitPrice: '1.23456' })])).status).toBe(400);
      expect((await newOrder(c.id, [line({ discountPct: '101' })])).status).toBe(400);
      expect((await newOrder(c.id, [])).status).toBe(400);
    });

    it('refuses a missing or inactive customer (422)', async () => {
      expect((await newOrder('11111111-1111-1111-1111-111111111111')).status).toBe(422);
      const c = await newCustomer();
      await http(app).patch(`/api/v1/customers/${c.id}`).set(bearer(t.sales)).send({ isActive: false }).expect(200);
      const res = await newOrder(c.id);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('CUSTOMER_INACTIVE');
    });
  });

  describe('order lifecycle', () => {
    it('edits a DRAFT (totals recomputed), confirms it, then locks it', async () => {
      const c = await newCustomer();
      const order = (await newOrder(c.id)).body;
      expect(order).toMatchObject({ status: 'DRAFT', productionOrder: null, invoice: null });
      expect(order.number).toMatch(/^ORD-\d{4}-\d{6}$/);

      const edited = await http(app)
        .patch(`/api/v1/orders/${order.id}`)
        .set(bearer(t.sales))
        .send({ items: [line({ quantity: '1', unitPrice: '1000' })], notes: 'urgent' })
        .expect(200);
      expect(edited.body).toMatchObject({ totalHt: '1000.0000', totalTva: '190.0000', totalTtc: '1190.0000', notes: 'urgent' });
      expect(edited.body.items).toHaveLength(1);

      const confirmed = await http(app).post(`/api/v1/orders/${order.id}/confirm`).set(bearer(t.sales)).expect(200);
      expect(confirmed.body.status).toBe('CONFIRMED');
      expect(confirmed.body.confirmedAt).toEqual(expect.any(String));

      await http(app).patch(`/api/v1/orders/${order.id}`).set(bearer(t.sales)).send({ notes: 'too late' }).expect(409);
      await http(app).post(`/api/v1/orders/${order.id}/confirm`).set(bearer(t.sales)).expect(409);

      // Confirming released it to production; cancelling is still possible while production has not started
      // (the production order is discarded). Cancelling twice is not.
      const cancelled = await http(app).post(`/api/v1/orders/${order.id}/cancel`).set(bearer(t.sales)).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', productionOrder: null });
      await http(app).post(`/api/v1/orders/${order.id}/cancel`).set(bearer(t.sales)).expect(409);
    });

    it("confirming needs 'sales.order.confirm' (permission, not role name)", async () => {
      const c = await newCustomer();
      const order = (await newOrder(c.id)).body;
      const res = await http(app).post(`/api/v1/orders/${order.id}/confirm`).set(bearer(t.production)).expect(403);
      expect(res.body.message).toContain('sales.order.confirm');
      await http(app).post(`/api/v1/orders/${order.id}/confirm`).set(bearer(t.field)).expect(403);
      await http(app).post(`/api/v1/orders/${order.id}/confirm`).set(bearer(t.admin)).expect(200);
    });

    it('will not confirm a zero-value order', async () => {
      const c = await newCustomer();
      const order = (await newOrder(c.id, [line({ unitPrice: '0' })])).body;
      const res = await http(app).post(`/api/v1/orders/${order.id}/confirm`).set(bearer(t.sales)).expect(422);
      expect(res.body.code).toBe('ZERO_TOTAL');
    });

    it('cancels a DRAFT order; two concurrent confirms → exactly one wins', async () => {
      const c = await newCustomer();
      const cancelled = (await newOrder(c.id)).body;
      const res = await http(app).post(`/api/v1/orders/${cancelled.id}/cancel`).set(bearer(t.sales)).expect(200);
      expect(res.body.status).toBe('CANCELLED');

      const order = (await newOrder(c.id)).body;
      const [a, b] = await Promise.all([
        http(app).post(`/api/v1/orders/${order.id}/confirm`).set(bearer(t.sales)),
        http(app).post(`/api/v1/orders/${order.id}/confirm`).set(bearer(t.admin)),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });

    it('lists with filters and search', async () => {
      const c = await newCustomer({ name: `Listing ${uniq()}` });
      const o1 = (await newOrder(c.id)).body;
      await http(app).post(`/api/v1/orders/${o1.id}/confirm`).set(bearer(t.sales)).expect(200);
      const o2 = (await newOrder(c.id)).body;

      const all = await http(app).get('/api/v1/orders').query({ customerId: c.id }).set(bearer(t.sales)).expect(200);
      expect(all.body.items.map((o: { id: string }) => o.id).sort()).toEqual([o1.id, o2.id].sort());
      expect(all.body.items[0].customerName).toBe(c.name);

      const confirmed = await http(app).get('/api/v1/orders').query({ customerId: c.id, status: 'CONFIRMED' }).set(bearer(t.sales)).expect(200);
      expect(confirmed.body.items.map((o: { id: string }) => o.id)).toEqual([o1.id]);

      const byNumber = await http(app).get('/api/v1/orders').query({ search: o2.number }).set(bearer(t.sales)).expect(200);
      expect(byNumber.body.items.map((o: { id: string }) => o.id)).toEqual([o2.id]);
      await http(app).get('/api/v1/orders').query({ status: 'BOGUS' }).set(bearer(t.sales)).expect(400);
    });
  });

  describe('quote → order', () => {
    it('drafts, sends, accepts and converts a quote into an order with identical lines and totals — once', async () => {
      const c = await newCustomer();
      const quote = (
        await http(app)
          .post('/api/v1/quotes')
          .set(bearer(t.sales))
          .send({
            customerId: c.id,
            validUntil: '2026-12-31',
            items: [line({ description: 'Caisson lumineux', quantity: '2', unitPrice: '15000' }), line({ description: 'Pose', quantity: '1', unitPrice: '3500.75', discountPct: '10' })],
          })
          .expect(201)
      ).body;
      expect(quote.number).toMatch(/^QUO-\d{4}-\d{6}$/);
      // 2 × 15 000 = 30 000.00 ; 3 500,75 − 10 % = 3 150,675 → 3 150,68 (half-up)  ⇒ HT 33 150,68
      // TVA 5 700,00 + 598,63 (3 150,68 × 19 % = 598,6292)                          ⇒ TVA 6 298,63 ; TTC 39 449,31
      expect(quote).toMatchObject({ status: 'DRAFT', validUntil: '2026-12-31', totalHt: '33150.6800', totalTva: '6298.6300', totalTtc: '39449.3100' });

      await http(app).post(`/api/v1/quotes/${quote.id}/convert`).set(bearer(t.production)).expect(403); // sales.quote.convert
      await http(app).post(`/api/v1/quotes/${quote.id}/accept`).set(bearer(t.sales)).expect(409); // must be SENT first
      await http(app).post(`/api/v1/quotes/${quote.id}/send`).set(bearer(t.sales)).expect(200);
      await http(app).patch(`/api/v1/quotes/${quote.id}`).set(bearer(t.sales)).send({ notes: 'x' }).expect(409); // locked once sent
      await http(app).post(`/api/v1/quotes/${quote.id}/accept`).set(bearer(t.sales)).expect(200);

      const order = (await http(app).post(`/api/v1/quotes/${quote.id}/convert`).set(bearer(t.sales)).expect(201)).body;
      expect(order).toMatchObject({ status: 'DRAFT', quoteId: quote.id, customerId: c.id });
      expect([order.totalHt, order.totalTva, order.totalTtc]).toEqual([quote.totalHt, quote.totalTva, quote.totalTtc]);
      expect(order.items.map((i: { description: string; lineTtc: string }) => [i.description, i.lineTtc])).toEqual(
        quote.items.map((i: { description: string; lineTtc: string }) => [i.description, i.lineTtc]),
      );

      const after = (await http(app).get(`/api/v1/quotes/${quote.id}`).set(bearer(t.sales)).expect(200)).body;
      expect(after).toMatchObject({ status: 'CONVERTED', convertedOrderId: order.id });
      await http(app).post(`/api/v1/quotes/${quote.id}/convert`).set(bearer(t.sales)).expect(409);
    });

    it('a rejected quote cannot be converted; concurrent conversions create one order', async () => {
      const c = await newCustomer();
      const mk = async () => (await http(app).post('/api/v1/quotes').set(bearer(t.sales)).send({ customerId: c.id, items: [line()] }).expect(201)).body;

      const rejected = await mk();
      await http(app).post(`/api/v1/quotes/${rejected.id}/reject`).set(bearer(t.sales)).expect(200);
      await http(app).post(`/api/v1/quotes/${rejected.id}/convert`).set(bearer(t.sales)).expect(409);

      const q = await mk();
      const results = await Promise.all([1, 2, 3].map(() => http(app).post(`/api/v1/quotes/${q.id}/convert`).set(bearer(t.sales))));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const orders = await http(app).get('/api/v1/orders').query({ customerId: c.id }).set(bearer(t.sales)).expect(200);
      expect(orders.body.items.filter((o: { id: string }) => o.id).length).toBe(1);
    });
  });
});
