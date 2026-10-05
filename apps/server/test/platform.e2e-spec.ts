import type { INestApplication } from '@nestjs/common';
import { hardwareId } from '@victorflow/crypto';
import { sql } from '@victorflow/db';
import { parseMoney, formatMoney } from '@victorflow/types';
import { bearer, createTestApp, dbOf, http, tokens } from './helpers/app';

// The signed-licence behaviour (onboarding, read-only, seats, modules) is in licensing.e2e-spec.ts, on its own database.
describe('licence (dev mode), audit API, dashboard (e2e)', () => {
  const thisMachine = hardwareId();

  describe('dev mode (the default)', () => {
    let app: INestApplication;
    let t: Record<'admin' | 'sales', string>;
    beforeAll(async () => {
      app = await createTestApp();
      t = await tokens(app, 'admin', 'sales');
    });
    afterAll(async () => app.close());

    it("GET /license returns the development entitlement (every module) and shows this machine's id", async () => {
      const res = (await http(app).get('/api/v1/license').set(bearer(t.admin)).expect(200)).body;
      expect(res).toMatchObject({ mode: 'dev', valid: true, state: 'active', enforced: false, problem: null, hardwareId: thisMachine });
      expect(res.entitlement).toMatchObject({ licenceId: 'DEV-LOCAL', edition: 'Development' });
      expect(res.entitlement.modules).toEqual(expect.arrayContaining(['crm', 'sales', 'production', 'finance', 'inventory', 'workforce', 'audit']));
    });

    it('needs core.license.read; the summary is for every signed-in user', async () => {
      await http(app).get('/api/v1/license').set(bearer(t.sales)).expect(403);
      await http(app).get('/api/v1/license').expect(401);
      expect((await http(app).get('/api/v1/license/summary').set(bearer(t.sales)).expect(200)).body).toMatchObject({ mode: 'dev', state: 'active' });
    });

    it('there is no licence to install in dev mode, and the onboarding is done (the dev seed has users)', async () => {
      expect((await http(app).put('/api/v1/license').set(bearer(t.admin)).send({ licence: 'whatever-licence-text' }).expect(409)).body.code).toBe('LICENSE_DEV_MODE');
      expect((await http(app).get('/api/v1/onboarding').expect(200)).body).toEqual({ step: 'done' });
      expect((await http(app).post('/api/v1/onboarding/request').send({ code: 'VF-7K2M-9QXA-4TPL' }).expect(409)).body.code).toBe('ONBOARDING_DONE');
    });
  });

  describe('audit API', () => {
    let app: INestApplication;
    let t: Record<'admin' | 'sales' | 'production', string>;
    beforeAll(async () => {
      app = await createTestApp();
      t = await tokens(app, 'admin', 'sales', 'production');
    });
    afterAll(async () => app.close());
    const db = () => dbOf(app).db;

    it('exposes the trail (who did what) and filters it — admin only', async () => {
      const c = (await http(app).post('/api/v1/customers').set(bearer(t.sales)).send({ name: `Audited ${Date.now()}` }).expect(201)).body;
      await http(app).patch(`/api/v1/customers/${c.id}`).set(bearer(t.sales)).send({ city: 'Tizi Ouzou' }).expect(200);

      const trail = (await http(app).get('/api/v1/audit/trail').query({ table: 'crm.customers', rowId: c.id }).set(bearer(t.admin)).expect(200)).body;
      expect(trail.items.map((e: { operation: string }) => e.operation)).toEqual(['UPDATE', 'INSERT']); // newest first
      expect(trail.items[0]).toMatchObject({ table: 'crm.customers', rowId: c.id, actorName: expect.stringContaining('Samir'), newData: { city: 'Tizi Ouzou' }, oldData: { city: null } });
      expect(trail.items[0].rowHash).toMatch(/^[0-9a-f]{64}$/);

      const updates = (await http(app).get('/api/v1/audit/trail').query({ table: 'crm.customers', operation: 'UPDATE', actorId: trail.items[0].actorId }).set(bearer(t.admin)).expect(200)).body;
      expect(updates.items.every((e: { operation: string }) => e.operation === 'UPDATE')).toBe(true);

      await http(app).get('/api/v1/audit/trail').set(bearer(t.sales)).expect(403);
      await http(app).get('/api/v1/audit/verify').set(bearer(t.production)).expect(403);
      await http(app).get('/api/v1/audit/trail').query({ table: 'DROP TABLE' }).set(bearer(t.admin)).expect(400);
    });

    it('never exposes password hashes in the trail', async () => {
      const res = (await http(app).get('/api/v1/audit/trail').query({ table: 'core.users', pageSize: 200 }).set(bearer(t.admin)).expect(200)).body;
      expect(res.total).toBeGreaterThan(5);
      expect(JSON.stringify(res)).not.toContain('argon2');
      expect(JSON.stringify(res)).not.toContain('password_hash');
    });

    it('verifies an intact hash chain, and DETECTS tampering (edited row) — then the chain heals when the edit is undone', async () => {
      const ok = (await http(app).get('/api/v1/audit/verify').set(bearer(t.admin)).expect(200)).body;
      expect(ok).toMatchObject({ ok: true, firstBrokenId: null, reason: null });
      expect(ok.checked).toBeGreaterThan(100);

      const victim = await db().selectFrom('audit.trail').select('id').orderBy('id', 'desc').limit(1).executeTakeFirstOrThrow();
      try {
        // what a malicious DBA would have to do: disable the guard trigger, then edit history
        await sql`alter table audit.trail disable trigger a_trail_append_only`.execute(db());
        await sql`update audit.trail set new_data = coalesce(new_data, '{}'::jsonb) || '{"tampered": true}'::jsonb where id = ${victim.id}`.execute(db());
        const broken = (await http(app).get('/api/v1/audit/verify').set(bearer(t.admin)).expect(200)).body;
        expect(broken).toMatchObject({ ok: false, firstBrokenId: victim.id });
        expect(broken.reason).toMatch(/modified/);
      } finally {
        await sql`update audit.trail set new_data = nullif(new_data - 'tampered', '{}'::jsonb) where id = ${victim.id}`.execute(db());
        await sql`alter table audit.trail enable trigger a_trail_append_only`.execute(db());
      }
      expect((await http(app).get('/api/v1/audit/verify').set(bearer(t.admin)).expect(200)).body.ok).toBe(true);
    });
  });

  describe('dashboard', () => {
    let app: INestApplication;
    let t: Record<'admin' | 'sales' | 'field', string>;
    beforeAll(async () => {
      app = await createTestApp();
      t = await tokens(app, 'admin', 'sales', 'field');
      // the invoice below is dated today; make sure a fiscal year covers it whatever year the machine clock says
      const year = String(new Date().getFullYear());
      await http(app).post('/api/v1/finance/fiscal-years').set(bearer(t.admin)).send({ code: year, startDate: `${year}-01-01`, endDate: `${year}-12-31` }); // 409 if it already exists — fine
    });
    afterAll(async () => app.close());
    const summary = async () => (await http(app).get('/api/v1/dashboard/summary').set(bearer(t.sales)).expect(200)).body;

    it('counts customers/orders and reports this month\'s revenue exactly — deltas match the invoice we create', async () => {
      const before = await summary();
      expect(before.revenue.month).toMatch(/^\d{4}-\d{2}$/);

      const c = (await http(app).post('/api/v1/customers').set(bearer(t.sales)).send({ name: `Dash Client ${Date.now()}` }).expect(201)).body;
      const o = (await http(app).post('/api/v1/orders').set(bearer(t.admin)).send({ customerId: c.id, items: [{ description: 'Enseigne', quantity: '3', unitPrice: '1250.50', overrideReason: 'test fixture' }] }).expect(201)).body;
      await http(app).post(`/api/v1/orders/${o.id}/confirm`).set(bearer(t.sales)).expect(200);
      const inv = (await http(app).post(`/api/v1/finance/invoices/from-order/${o.id}`).set(bearer(t.sales)).send({}).expect(201)).body; // dated today
      await http(app).post(`/api/v1/finance/invoices/${inv.id}/payments`).set(bearer(t.sales)).send({ amount: '1000', method: 'CASH' }).expect(201);

      const after = await summary();
      const delta = (a: string, b: string) => formatMoney(parseMoney(b) - parseMoney(a));
      expect(after.customers.total).toBe(before.customers.total + 1);
      expect(after.orders.byStatus.CONFIRMED).toBe((before.orders.byStatus.CONFIRMED ?? 0) + 1);
      expect(after.orders.open).toBe(before.orders.open + 1);
      expect(after.production.byStatus.DRAFT).toBe((before.production.byStatus.DRAFT ?? 0) + 1);
      expect(after.revenue.invoiceCount).toBe(before.revenue.invoiceCount + 1);
      expect(delta(before.revenue.ht, after.revenue.ht)).toBe('3751.5000');
      expect(delta(before.revenue.tva, after.revenue.tva)).toBe('712.7900');
      expect(delta(before.revenue.ttc, after.revenue.ttc)).toBe('4464.2900');
      expect(delta(before.revenue.collected, after.revenue.collected)).toBe('1000.0000');
      expect(after.invoices.unpaidCount).toBe(before.invoices.unpaidCount + 1);
      expect(delta(before.invoices.balanceDue, after.invoices.balanceDue)).toBe('3464.2900'); // TTC − payment
    });

    it('a cancelled invoice drops out of revenue and of what is owed', async () => {
      const before = await summary();
      const c = (await http(app).post('/api/v1/customers').set(bearer(t.sales)).send({ name: `Dash Cancel ${Date.now()}` }).expect(201)).body;
      const o = (await http(app).post('/api/v1/orders').set(bearer(t.admin)).send({ customerId: c.id, items: [{ description: 'x', quantity: '1', unitPrice: '500', overrideReason: 'test fixture' }] }).expect(201)).body;
      await http(app).post(`/api/v1/orders/${o.id}/confirm`).set(bearer(t.sales)).expect(200);
      const inv = (await http(app).post(`/api/v1/finance/invoices/from-order/${o.id}`).set(bearer(t.sales)).send({}).expect(201)).body;
      await http(app).post(`/api/v1/finance/invoices/${inv.id}/cancel`).set(bearer(t.admin)).send({ reason: 'dashboard test' }).expect(200);
      const after = await summary();
      expect(after.revenue.ht).toBe(before.revenue.ht);
      expect(after.invoices.balanceDue).toBe(before.invoices.balanceDue);
    });

    it('needs core.dashboard.read', async () => {
      await http(app).get('/api/v1/dashboard/summary').set(bearer(t.field)).expect(403);
      await http(app).get('/api/v1/dashboard/summary').expect(401);
    });
  });
});
