import crypto from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { trackingToken } from '@victorflow/crypto';
import type { PublicTrackingDto, TrackingLinkDto } from '@victorflow/types';
import { bearer, createTestApp, dbOf, http, tokens, USERS } from './helpers/app';

const NOT_FOUND = { statusCode: 404, error: 'Not Found', message: 'Tracking link not found' };

describe('P8 — public tracking: HMAC link + sanitised read-only timeline (e2e)', () => {
  let app: INestApplication;
  let t: Record<'admin' | 'sales' | 'production' | 'workshop' | 'qa' | 'field', string>;
  const secret = process.env.TRACKING_HMAC_SECRET!;

  beforeAll(async () => {
    app = await createTestApp();
    t = await tokens(app, 'admin', 'sales', 'production', 'workshop', 'qa', 'field');
  });
  afterAll(async () => {
    await app.close();
  });

  const uniq = () => `${Date.now()}${Math.floor(Math.random() * 100000)}`;

  async function newOrder(over: { customerName?: string; unitPrice?: string; notes?: string } = {}) {
    const customer = (await http(app).post('/api/v1/customers').set(bearer(t.sales)).send({ name: over.customerName ?? `Track Client ${uniq()}`, email: `secret.${uniq()}@client.dz`, phone: '0555 99 88 77' }).expect(201)).body;
    const order = (
      await http(app)
        .post('/api/v1/orders')
        .set(bearer(t.sales))
        .send({ customerId: customer.id, dueDate: '2026-12-24', notes: over.notes ?? 'internal', items: [{ description: 'Enseigne caisson 3 m', quantity: '2', unitPrice: over.unitPrice ?? '1000' }] })
        .expect(201)
    ).body;
    return { customer, order };
  }
  const linkOf = async (orderId: string): Promise<TrackingLinkDto> => (await http(app).get(`/api/v1/orders/${orderId}/tracking-link`).set(bearer(t.sales)).expect(200)).body;
  const track = (orderId: string, token: string) => http(app).get(`/api/v1/public/track/${orderId}/${token}`);
  const confirm = async (orderId: string) => (await http(app).post(`/api/v1/orders/${orderId}/confirm`).set(bearer(t.sales)).expect(200)).body;
  const move = (poId: string, to: string, token: string, note?: string) =>
    http(app).post(`/api/v1/production/orders/${poId}/transition`).set(bearer(token)).send({ to, ...(note && { note }) });

  describe('the link', () => {
    it('is HMAC-SHA256(serverSecret, orderId + customerId), served to staff with sales.order.read', async () => {
      const { customer, order } = await newOrder();
      const link = await linkOf(order.id);
      expect(link.orderId).toBe(order.id);
      expect(link.token).toBe(trackingToken(secret, order.id, customer.id));
      expect(link.token).toBe(crypto.createHmac('sha256', secret).update(`${order.id}\n${customer.id}`).digest('base64url')); // independent re-derivation
      expect(link.url).toBe(`${process.env.TRACKER_BASE_URL ?? 'http://localhost:3001'}/t/${order.id}/${link.token}`);

      const other = await newOrder();
      expect((await linkOf(other.order.id)).token).not.toBe(link.token); // per order

      await http(app).get(`/api/v1/orders/${order.id}/tracking-link`).set(bearer(t.field)).expect(403);
      await http(app).get(`/api/v1/orders/${order.id}/tracking-link`).expect(401);
      await http(app).get('/api/v1/orders/11111111-1111-1111-1111-111111111111/tracking-link').set(bearer(t.sales)).expect(404);
    });

    it('depends on the server secret (a different secret gives a different token)', async () => {
      const { customer, order } = await newOrder();
      expect(trackingToken('some-other-secret-0123456789abcdef0123456789', order.id, customer.id)).not.toBe((await linkOf(order.id)).token);
    });
  });

  describe('resolving it — public, read-only, sanitised', () => {
    it('needs no login and returns the order number, status, expected date and the five-step timeline', async () => {
      const { order } = await newOrder();
      const link = await linkOf(order.id);
      const res = await track(order.id, link.token).expect(200); // no Authorization header
      const body = res.body as PublicTrackingDto;
      expect(body).toMatchObject({ orderNumber: order.number, status: { key: 'RECEIVED', label: 'Order received' }, expectedDate: '2026-12-24', cancelled: false });
      expect(body.steps.map((s) => s.key)).toEqual(['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'QUALITY_CHECK', 'COMPLETED']);
      expect(body.steps.map((s) => s.done)).toEqual([true, false, false, false, false]);
      expect(body.steps[0]).toMatchObject({ current: true, at: expect.any(String) });
      expect(body.items).toEqual([{ description: 'Enseigne caisson 3 m', quantity: '2.0000', unit: 'u' }]);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toMatch(/noindex/);
    });

    it('SANITISED: no prices or totals, no customer identity, no staff names, no notes, no internal ids', async () => {
      const secretName = `Ultra Secret Corp ${uniq()}`;
      const { customer, order } = await newOrder({ customerName: secretName, unitPrice: '7777.77', notes: 'INTERNAL: client pays late' });
      const confirmed = await confirm(order.id);
      const po = (await http(app).get(`/api/v1/production/orders/${confirmed.productionOrder.id}`).set(bearer(t.admin)).expect(200)).body;
      const worker = await dbOf(app).db.selectFrom('core.users').select('id').where('email', '=', USERS.workshop).executeTakeFirstOrThrow();
      await http(app).patch(`/api/v1/production/work-orders/${po.workOrders[0].id}`).set(bearer(t.workshop)).send({ assignedTo: worker.id, status: 'IN_PROGRESS' }).expect(200);
      await move(po.id, 'CONFIRMED', t.production).expect(200);
      await move(po.id, 'IN_PRODUCTION', t.workshop).expect(200);

      const link = await linkOf(order.id);
      const raw = (await track(order.id, link.token).expect(200)).text;

      // values that must never appear
      for (const secretValue of [secretName, '7777', '15555', '18510', 'INTERNAL', 'Yacine', 'Karim', 'Nadia', 'secret.', '0555 99 88 77', customer.id, po.id, worker.id, confirmed.productionOrder.number]) {
        expect(raw).not.toContain(secretValue);
      }
      // key names that must never appear (costs, people, ids)
      const keys = new Set<string>();
      (function walk(v: unknown) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
      })(JSON.parse(raw));
      for (const forbidden of ['total', 'totalHt', 'totalTtc', 'totalTva', 'unitPrice', 'lineHt', 'price', 'amount', 'cost', 'customer', 'customerId', 'customerName', 'assignedTo', 'assignedToName', 'actorName', 'worker', 'notes', 'id', 'email', 'phone']) {
        expect(keys.has(forbidden)).toBe(false);
      }
      expect([...keys].sort()).toEqual(['at', 'cancelled', 'current', 'description', 'done', 'expectedDate', 'items', 'key', 'label', 'orderNumber', 'placedAt', 'quantity', 'status', 'steps', 'unit']);
    });

    it('returns an IDENTICAL 404 for a wrong token, another order\'s token, a wrong order id, an unknown order and malformed input', async () => {
      const a = await newOrder();
      const b = await newOrder();
      const linkA = await linkOf(a.order.id);
      const linkB = await linkOf(b.order.id);
      const flipped = linkA.token.slice(0, -1) + (linkA.token.endsWith('A') ? 'B' : 'A');

      const attempts: Array<[string, string]> = [
        [a.order.id, flipped], // one character off
        [a.order.id, linkB.token], // another order's valid token
        [b.order.id, linkA.token], // right token, wrong order
        [a.order.id, linkA.token.toLowerCase() === linkA.token ? linkA.token.toUpperCase() : linkA.token.toLowerCase()],
        [a.order.id, linkA.token.slice(0, 20)], // truncated
        [a.order.id, `${linkA.token}extra`], // too long
        [a.order.id, 'x'],
        ['11111111-1111-1111-1111-111111111111', linkA.token], // unknown order
        ['11111111-1111-1111-1111-111111111111', crypto.randomBytes(32).toString('base64url')],
        ['not-a-uuid', linkA.token], // malformed id — must look like a wrong token, not a 400
        [a.order.id, 'a'.repeat(500)],
      ];
      for (const [id, token] of attempts) {
        const res = await track(id, encodeURIComponent(token));
        expect({ status: res.status, body: res.body }).toEqual({ status: 404, body: NOT_FOUND });
      }
      await track(a.order.id, linkA.token).expect(200); // and the genuine one still works
    });

    it('ALWAYS performs the constant-time compare (crypto.timingSafeEqual) — even for an order that does not exist', async () => {
      const { order } = await newOrder();
      const link = await linkOf(order.id);
      const spy = jest.spyOn(crypto, 'timingSafeEqual');
      try {
        await track(order.id, link.token).expect(200);
        const good = spy.mock.calls.length;
        expect(good).toBeGreaterThan(0);

        await track(order.id, `${link.token.slice(0, -1)}${link.token.endsWith('A') ? 'B' : 'A'}`).expect(404); // same length, wrong content
        expect(spy.mock.calls.length).toBeGreaterThan(good);
        const afterWrong = spy.mock.calls.length;

        await track('11111111-1111-1111-1111-111111111111', link.token).expect(404); // no such order: STILL compares
        expect(spy.mock.calls.length).toBeGreaterThan(afterWrong);

        // and it is comparing equal-length buffers (a length mismatch would throw, so lengths are checked first)
        for (const [a, b] of spy.mock.calls) expect((a as Buffer).length).toBe((b as Buffer).length);
      } finally {
        spy.mockRestore();
      }
    });

    it('is read-only: no write verbs exist on the public route', async () => {
      const { order } = await newOrder();
      const link = await linkOf(order.id);
      for (const verb of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await http(app)[verb](`/api/v1/public/track/${order.id}/${link.token}`).send({});
        expect(res.status).toBe(404);
      }
    });
  });

  describe('the timeline follows production, and hides what customers should not see', () => {
    it('DRAFT → confirmed → in production → quality check → (QC rejection stays invisible) → ready', async () => {
      const { order } = await newOrder();
      const link = await linkOf(order.id);
      const view = async () => (await track(order.id, link.token).expect(200)).body as PublicTrackingDto;
      const state = (v: PublicTrackingDto) => ({ status: v.status.key, done: v.steps.filter((s) => s.done).map((s) => s.key) });

      expect(state(await view())).toEqual({ status: 'RECEIVED', done: ['RECEIVED'] });

      const confirmed = await confirm(order.id);
      const poId = confirmed.productionOrder.id as string;
      const afterConfirm = await view();
      expect(state(afterConfirm)).toEqual({ status: 'CONFIRMED', done: ['RECEIVED', 'CONFIRMED'] });
      expect(afterConfirm.steps[1]!.at).toEqual(expect.any(String));

      await move(poId, 'CONFIRMED', t.production).expect(200); // internal step: not a customer-visible change
      expect(state(await view())).toEqual({ status: 'CONFIRMED', done: ['RECEIVED', 'CONFIRMED'] });

      await move(poId, 'IN_PRODUCTION', t.production).expect(200);
      expect(state(await view())).toEqual({ status: 'IN_PRODUCTION', done: ['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION'] });

      const po = (await http(app).get(`/api/v1/production/orders/${poId}`).set(bearer(t.admin)).expect(200)).body;
      for (const wo of po.workOrders) await http(app).patch(`/api/v1/production/work-orders/${wo.id}`).set(bearer(t.workshop)).send({ status: 'COMPLETED' }).expect(200);
      await move(poId, 'QUALITY_CHECK', t.production).expect(200);
      expect(state(await view())).toEqual({ status: 'QUALITY_CHECK', done: ['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'QUALITY_CHECK'] });

      // QA rejects: the customer just sees it back in production — no "rejected", no reason
      await move(poId, 'REJECTED', t.qa, 'Couleurs non conformes — CONFIDENTIEL').expect(200);
      const rejected = await track(order.id, link.token).expect(200);
      expect(state(rejected.body)).toEqual({ status: 'IN_PRODUCTION', done: ['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION'] });
      expect(rejected.text).not.toMatch(/reject|CONFIDENTIEL|Couleurs/i);

      await move(poId, 'IN_PRODUCTION', t.production).expect(200);
      await move(poId, 'QUALITY_CHECK', t.production).expect(200);
      await move(poId, 'COMPLETED', t.qa).expect(200);
      const done = await view();
      expect(done.status).toEqual({ key: 'COMPLETED', label: 'Ready' });
      expect(done.steps.every((s) => s.done && s.at)).toBe(true);
      expect(done.steps.filter((s) => s.current).map((s) => s.key)).toEqual(['COMPLETED']);
    });

    it('shows a cancelled order as cancelled', async () => {
      const { order } = await newOrder();
      const link = await linkOf(order.id);
      await http(app).post(`/api/v1/orders/${order.id}/cancel`).set(bearer(t.sales)).expect(200);
      const v = (await track(order.id, link.token).expect(200)).body as PublicTrackingDto;
      expect(v).toMatchObject({ cancelled: true, status: { key: 'CANCELLED', label: 'Cancelled' } });
    });
  });
});
