import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { generateLicenseKeyPair, hardwareFingerprint, signLicense, type LicensePayload } from '@victorflow/crypto';
import { sql } from '@victorflow/db';
import { parseMoney, formatMoney } from '@victorflow/types';
import { bearer, createTestApp, dbOf, http, tokens } from './helpers/app';

/** Run `fn` with env vars overridden (createTestApp reads the environment when the app is built). */
async function withEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(overrides).map((k) => [k, process.env[k]]));
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  }
}

describe('licensing (dev stub + Ed25519 enforcement), audit API, dashboard (e2e)', () => {
  const keys = generateLicenseKeyPair();
  const dir = mkdtempSync(path.join(tmpdir(), 'vf-e2e-license-'));
  const thisMachine = hardwareFingerprint();
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const licensePayload = (over: Partial<LicensePayload> = {}): LicensePayload => ({
    licenseId: 'LIC-E2E',
    customer: 'Test Customer',
    tier: 'BASIC',
    features: ['crm', 'sales'],
    maxUsers: 50,
    hardwareId: thisMachine,
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...over,
  });
  let n = 0;
  const writeLicense = (token: string) => {
    const file = path.join(dir, `l${++n}.vfl`);
    writeFileSync(file, token);
    return file;
  };
  const cryptoEnv = (file: string, enforce: boolean) => ({ LICENSE_MODE: 'crypto', LICENSE_ENFORCE: String(enforce), LICENSE_PUBLIC_KEY: keys.publicKeyPem, LICENSE_FILE: file });

  async function inApp<T>(env: Record<string, string>, fn: (app: INestApplication, admin: string) => Promise<T>): Promise<T> {
    return withEnv(env, async () => {
      const app = await createTestApp();
      try {
        const { admin } = await tokens(app, 'admin');
        return await fn(app, admin);
      } finally {
        await app.close();
      }
    });
  }

  describe('dev mode (the default)', () => {
    let app: INestApplication;
    let t: Record<'admin' | 'sales', string>;
    beforeAll(async () => {
      app = await createTestApp();
      t = await tokens(app, 'admin', 'sales');
    });
    afterAll(async () => app.close());

    it('GET /license returns a valid PROFESSIONAL dev entitlement and shows this machine\'s id', async () => {
      const res = (await http(app).get('/api/v1/license').set(bearer(t.admin)).expect(200)).body;
      expect(res).toMatchObject({ mode: 'dev', valid: true, enforced: false, problem: null, hardwareId: thisMachine });
      expect(res.entitlement).toMatchObject({ tier: 'PROFESSIONAL', hardwareBound: false, expiresAt: null, licenseId: 'DEV-LOCAL' });
      expect(res.entitlement.features).toEqual(expect.arrayContaining(['crm', 'sales', 'production', 'finance', 'inventory', 'workforce', 'audit']));
    });

    it('needs core.license.read', async () => {
      await http(app).get('/api/v1/license').set(bearer(t.sales)).expect(403);
      await http(app).get('/api/v1/license').expect(401);
    });
  });

  describe('crypto mode with LICENSE_ENFORCE=true', () => {
    it('a valid BASIC licence unlocks its modules and blocks the rest (403 LICENSE_FEATURE); login, health and /license stay open', async () => {
      const file = writeLicense(signLicense(licensePayload(), keys.privateKeyPem));
      await inApp(cryptoEnv(file, true), async (app, admin) => {
        await http(app).get('/api/v1/customers').set(bearer(admin)).expect(200); // crm ✔
        await http(app).get('/api/v1/orders').set(bearer(admin)).expect(200); // sales ✔

        for (const route of ['/api/v1/finance/accounts', '/api/v1/production/board', '/api/v1/inventory/warehouses', '/api/v1/workforce/tasks', '/api/v1/audit/trail']) {
          const res = await http(app).get(route).set(bearer(admin)).expect(403);
          expect(res.body.code).toBe('LICENSE_FEATURE');
        }
        await http(app).get('/api/v1/finance/accounts').expect(401); // anonymous callers get 401, not a licence answer

        await http(app).get('/api/v1/health').expect(200);
        await http(app).get('/api/v1/auth/me').set(bearer(admin)).expect(200);
        const status = (await http(app).get('/api/v1/license').set(bearer(admin)).expect(200)).body;
        expect(status).toMatchObject({ mode: 'crypto', valid: true, enforced: true, problem: null, entitlement: { tier: 'BASIC', hardwareBound: true, features: ['crm', 'sales'] } });
      });
    });

    it('a TAMPERED licence blocks every licensed module (LICENSE_INVALID) but not login or the status page', async () => {
      const [, sig] = signLicense(licensePayload(), keys.privateKeyPem).split('.') as [string, string];
      const forged = Buffer.from(JSON.stringify(licensePayload({ tier: 'ENTERPRISE', features: ['crm', 'sales', 'finance'] }))).toString('base64url');
      const file = writeLicense(`${forged}.${sig}`);
      await inApp(cryptoEnv(file, true), async (app, admin) => {
        const res = await http(app).get('/api/v1/customers').set(bearer(admin)).expect(403);
        expect(res.body).toMatchObject({ code: 'LICENSE_INVALID', licenseProblem: 'BAD_SIGNATURE' });
        await http(app).get('/api/v1/finance/accounts').set(bearer(admin)).expect(403);
        const status = (await http(app).get('/api/v1/license').set(bearer(admin)).expect(200)).body;
        expect(status).toMatchObject({ valid: false, entitlement: null, problem: { code: 'BAD_SIGNATURE' } });
        await http(app).get('/api/v1/auth/me').set(bearer(admin)).expect(200); // you can still log in and see WHY
      });
    });

    it('a licence bound to ANOTHER machine is refused (HARDWARE_MISMATCH)', async () => {
      const file = writeLicense(signLicense(licensePayload({ hardwareId: 'some-other-machine-fingerprint' }), keys.privateKeyPem));
      await inApp(cryptoEnv(file, true), async (app, admin) => {
        expect((await http(app).get('/api/v1/customers').set(bearer(admin)).expect(403)).body.licenseProblem).toBe('HARDWARE_MISMATCH');
        expect((await http(app).get('/api/v1/license').set(bearer(admin)).expect(200)).body.problem.code).toBe('HARDWARE_MISMATCH');
      });
    });

    it('an expired licence and a missing licence file are refused too', async () => {
      const expired = writeLicense(signLicense(licensePayload({ expiresAt: '2026-02-01T00:00:00.000Z' }), keys.privateKeyPem));
      await inApp(cryptoEnv(expired, true), async (app, admin) => {
        expect((await http(app).get('/api/v1/customers').set(bearer(admin)).expect(403)).body.licenseProblem).toBe('EXPIRED');
      });
      await inApp(cryptoEnv(path.join(dir, 'does-not-exist.vfl'), true), async (app, admin) => {
        expect((await http(app).get('/api/v1/customers').set(bearer(admin)).expect(403)).body.licenseProblem).toBe('NO_LICENSE_FILE');
      });
    });

    it('enforces the seat limit when creating users (LICENSE_SEATS)', async () => {
      const file = writeLicense(signLicense(licensePayload({ maxUsers: 1 }), keys.privateKeyPem));
      await inApp(cryptoEnv(file, true), async (app, admin) => {
        const res = await http(app).post('/api/v1/users').set(bearer(admin)).send({ email: `seat.${Date.now()}@victorflow.local`, fullName: 'Over Seat', password: 'a-decent-password', roles: ['FIELD_AGENT'] }).expect(403);
        expect(res.body.code).toBe('LICENSE_SEATS');
      });
    });
  });

  describe('LICENSE_ENFORCE=false (local dev default) — the same INVALID licence blocks nothing', () => {
    it('everything works, and /license still tells the truth about the licence', async () => {
      const file = writeLicense('garbage that is not a licence');
      await inApp(cryptoEnv(file, false), async (app, admin) => {
        await http(app).get('/api/v1/customers').set(bearer(admin)).expect(200);
        await http(app).get('/api/v1/finance/accounts').set(bearer(admin)).expect(200);
        await http(app).get('/api/v1/production/board').set(bearer(admin)).expect(200);
        const status = (await http(app).get('/api/v1/license').set(bearer(admin)).expect(200)).body;
        expect(status).toMatchObject({ mode: 'crypto', enforced: false, valid: false, problem: { code: 'MALFORMED' } });
        await http(app).post('/api/v1/users').set(bearer(admin)).send({ email: `noseat.${Date.now()}@victorflow.local`, fullName: 'No Limit', password: 'a-decent-password', roles: ['FIELD_AGENT'] }).expect(201);
      });
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
