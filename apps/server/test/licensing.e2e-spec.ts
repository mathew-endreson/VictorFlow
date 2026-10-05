import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { formatLicenceText, generateLicenseKeyPair, hardwareId, signLicense, type LicensePayload } from '@victorflow/crypto';
import { createDb, migrateToLatest, recreateDatabase, seedReference, sql } from '@victorflow/db';
import { activationCodeFrom, decodeRequestCode, LICENSE_FEATURES, type LoginResponse } from '@victorflow/types';
import { bearer, createTestApp, dbOf, http, withEnv } from './helpers/app';

/**
 * A shop's server from its first start: a database with the reference data only (no user at all), LICENSE_MODE=crypto
 * with enforcement on, licences signed by a throw-away key standing in for BluxTech's. Its own database, so the
 * sessions other specs leave behind never count against the seats here.
 */
describe('licensing: onboarding, read-only fallback, seats, modules (e2e, crypto mode, enforced)', () => {
  const keys = generateLicenseKeyPair();
  const HW = hardwareId();
  const CODE = activationCodeFrom([5, 18, 0, 19, 7, 22, 29, 8, 2, 25, 23]);
  const dir = mkdtempSync(path.join(tmpdir(), 'vf-e2e-licensing-'));
  const mainFile = path.join(dir, 'license.vfl');
  const PASSWORD = 'Owner-Password-1';
  let dbUrl: string;
  let n = 0;
  /** Whoever won the race to create the owner during the onboarding test. */
  let ownerEmail = '';

  const payload = (over: Partial<LicensePayload> = {}): LicensePayload => ({
    v: 2,
    licenceId: `LIC-E2E-${++n}`,
    shop: 'Imprimerie Test',
    activationCode: CODE,
    hardwareId: HW,
    edition: 'Standard',
    seats: { desktop: 10, mobile: 10 },
    modules: [...LICENSE_FEATURES],
    issuedAt: new Date().toISOString(),
    updatesUntil: '2099-12-31',
    ...over,
  });
  const licence = (over: Partial<LicensePayload> = {}) => formatLicenceText(signLicense(payload(over), keys.privateKeyPem));

  const env = (file: string, extra: Record<string, string> = {}) => ({
    DATABASE_URL: dbUrl,
    LICENSE_MODE: 'crypto',
    LICENSE_ENFORCE: 'true',
    LICENSE_PUBLIC_KEY: keys.publicKeyPem,
    LICENSE_FILE: file,
    LICENSE_SERVER_URL: '',
    ...extra,
  });
  const withApp = <T>(file: string, fn: (app: INestApplication) => Promise<T>, extra: Record<string, string> = {}) =>
    withEnv(env(file, extra), async () => {
      const app = await createTestApp();
      try {
        return await fn(app);
      } finally {
        await app.close();
      }
    });

  const signIn = (app: INestApplication, email: string, client: 'desktop' | 'mobile' = 'desktop', password = PASSWORD) =>
    http(app).post('/api/v1/auth/login').send({ email, password, client });

  beforeAll(async () => {
    dbUrl = await recreateDatabase(process.env.DATABASE_URL!, 'licensing');
    const db = createDb(dbUrl, { max: 2 });
    try {
      await migrateToLatest(db);
      await seedReference(db, { fiscalYear: 2026 });
    } finally {
      await db.destroy();
    }
  }, 120_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  describe('one server, from first start to daily use', () => {
    let app: INestApplication;
    let owner: LoginResponse;

    it('ONBOARDING: licence → company → owner, steps in order, then closed for good', async () => {
      await withEnv(env(mainFile), async () => {
        app = await createTestApp();
      });

      // a fresh server: no licence, no company, nobody to sign in as
      const first = (await http(app).get('/api/v1/onboarding').expect(200)).body;
      expect(first).toMatchObject({ step: 'licence', mode: 'crypto', hardwareId: HW, online: false, licence: null, problem: { code: 'NO_LICENSE_FILE' } });
      expect((await http(app).post('/api/v1/auth/login').send({ email: 'admin@victorflow.local', password: 'Admin123!' })).status).toBe(401); // no demo admin

      // out of order
      expect((await http(app).put('/api/v1/onboarding/company').send({ name: 'Imprimerie Test' }).expect(409)).body).toMatchObject({ code: 'ONBOARDING_STEP', step: 'licence' });
      expect((await http(app).post('/api/v1/onboarding/owner').send({ fullName: 'Owner', email: 'owner@shop.dz', password: PASSWORD }).expect(409)).body.code).toBe('ONBOARDING_STEP');

      // activation code → request code (code + this server's hardware id)
      expect((await http(app).post('/api/v1/onboarding/request').send({ code: CODE.replace(/.$/, CODE.endsWith('2') ? '3' : '2') }).expect(400)).body.code).toBe('ACTIVATION_CODE_INVALID');
      const req = (await http(app).post('/api/v1/onboarding/request').send({ code: CODE.toLowerCase().replace(/-/g, ' ') }).expect(200)).body;
      expect(decodeRequestCode(req.requestCode)).toEqual({ activationCode: CODE, hardwareId: HW });

      // a licence for another server is refused; this server's licence (pasted with chat text around it) is installed
      const wrong = await http(app).post('/api/v1/onboarding/licence').send({ licence: licence({ hardwareId: 'f'.repeat(64) }) }).expect(422);
      expect(wrong.body).toMatchObject({ code: 'LICENCE_REJECTED', licenceProblem: 'HARDWARE_MISMATCH' });
      const afterLicence = (await http(app).post('/api/v1/onboarding/licence').send({ licence: `Here is your licence:\n${licence()}\nThanks` }).expect(200)).body;
      expect(afterLicence).toMatchObject({ step: 'company', licence: { shop: 'Imprimerie Test', activationCode: CODE } });

      const afterCompany = (await http(app).put('/api/v1/onboarding/company').send({ name: 'Imprimerie Test', phone: '0555 00 00 00' }).expect(200)).body;
      expect(afterCompany.step).toBe('owner');

      // two owners submitted at the same moment: exactly one is created
      const [a, b] = await Promise.all([
        http(app).post('/api/v1/onboarding/owner').send({ fullName: 'Nasro Tamri', email: 'owner@shop.dz', password: PASSWORD }),
        http(app).post('/api/v1/onboarding/owner').send({ fullName: 'Someone Else', email: 'other@shop.dz', password: PASSWORD }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const created = a.status === 201 ? a : b;
      owner = created.body as LoginResponse;
      ownerEmail = created === a ? 'owner@shop.dz' : 'other@shop.dz';
      expect(owner.user).toMatchObject({ email: ownerEmail, roles: ['SUPER_ADMIN'] });
      expect(owner.user.permissions).toContain('core.license.manage');
      const users = await dbOf(app).db.selectFrom('core.users').select('email').execute();
      expect(users).toHaveLength(1);

      // done: the wizard is closed, the owner works normally
      expect((await http(app).get('/api/v1/onboarding').expect(200)).body).toEqual({ step: 'done' });
      for (const [method, route, body] of [
        ['post', '/api/v1/onboarding/request', { code: CODE }],
        ['post', '/api/v1/onboarding/licence', { licence: licence() }],
        ['put', '/api/v1/onboarding/company', { name: 'Hijack' }],
        ['post', '/api/v1/onboarding/owner', { fullName: 'Intruder', email: 'intruder@x.dz', password: PASSWORD }],
      ] as const) {
        expect((await http(app)[method](route).send(body).expect(409)).body.code).toBe('ONBOARDING_DONE');
      }
      await http(app).get('/api/v1/auth/me').set(bearer(owner.accessToken)).expect(200);
      expect((await http(app).get('/api/v1/license').set(bearer(owner.accessToken)).expect(200)).body).toMatchObject({ valid: true, state: 'active', enforced: true });
      await http(app).post('/api/v1/customers').set(bearer(owner.accessToken)).send({ name: 'First customer' }).expect(201);
    });

    it('MODULES: a module outside the licence is refused (reads too) and hidden from the summary', async () => {
      await http(app).put('/api/v1/license').set(bearer(owner.accessToken)).send({ licence: licence({ modules: ['crm'] }) }).expect(200);
      expect((await http(app).get('/api/v1/orders').set(bearer(owner.accessToken)).expect(403)).body).toMatchObject({ code: 'LICENSE_FEATURE', feature: 'sales' });
      await http(app).get('/api/v1/customers').set(bearer(owner.accessToken)).expect(200);
      expect((await http(app).get('/api/v1/license/summary').set(bearer(owner.accessToken)).expect(200)).body).toEqual({ mode: 'crypto', state: 'active', modules: ['crm'], problem: null });
      await http(app).put('/api/v1/license').set(bearer(owner.accessToken)).send({ licence: licence() }).expect(200);
      await http(app).get('/api/v1/orders').set(bearer(owner.accessToken)).expect(200);
    });

    it('SEAT LIMIT (desktop 1): a second desktop session is refused until the first signs out or goes idle', async () => {
      await http(app).put('/api/v1/license').set(bearer(owner.accessToken)).send({ licence: licence({ seats: { desktop: 1, mobile: 1 } }) }).expect(200);
      const email = owner.user.email;

      // the onboarding session holds the only desktop seat
      expect((await signIn(app, email).expect(403)).body).toMatchObject({ code: 'LICENSE_SEATS', kind: 'desktop', limit: 1 });

      await http(app).post('/api/v1/auth/logout').send({ refreshToken: owner.refreshToken }).expect(204);
      const second = (await signIn(app, email).expect(200)).body as LoginResponse;

      // a PC switched off: its session stops renewing and frees the seat after the idle window
      await sql`UPDATE core.refresh_tokens SET created_at = created_at - interval '2 hours' WHERE client = 'desktop'`.execute(dbOf(app).db);
      const third = (await signIn(app, email).expect(200)).body as LoginResponse;
      // …and when that PC comes back, its seat has been taken
      expect((await http(app).post('/api/v1/auth/refresh').send({ refreshToken: second.refreshToken }).expect(403)).body).toMatchObject({ code: 'LICENSE_SEATS', kind: 'desktop' });
      // an active session renewing is never refused
      const renewed = (await http(app).post('/api/v1/auth/refresh').send({ refreshToken: third.refreshToken }).expect(200)).body as LoginResponse;
      owner = renewed;
    });

    it('SEAT LIMIT (mobile 1): one mobile user at a time; the same user may sign in again; desktop seats are separate', async () => {
      const t = owner.accessToken;
      for (const email of ['field1@shop.dz', 'field2@shop.dz']) {
        await http(app).post('/api/v1/users').set(bearer(t)).send({ email, fullName: `Field ${email}`, password: PASSWORD, roles: ['FIELD_AGENT'] }).expect(201);
      }
      const f1a = (await signIn(app, 'field1@shop.dz', 'mobile').expect(200)).body as LoginResponse;
      const f1b = (await signIn(app, 'field1@shop.dz', 'mobile').expect(200)).body as LoginResponse; // a second phone, same person
      expect((await signIn(app, 'field2@shop.dz', 'mobile').expect(403)).body).toMatchObject({ code: 'LICENSE_SEATS', kind: 'mobile', limit: 1 });
      // signing in on the desktop is a different seat (and the desktop one is taken by the owner)
      expect((await signIn(app, 'field2@shop.dz', 'desktop').expect(403)).body.kind).toBe('desktop');

      for (const s of [f1a, f1b]) await http(app).post('/api/v1/auth/logout').send({ refreshToken: s.refreshToken }).expect(204);
      await signIn(app, 'field2@shop.dz', 'mobile').expect(200);

      const kinds = await dbOf(app).db.selectFrom('core.refresh_tokens').select('client').distinct().execute();
      expect(kinds.map((k) => k.client).sort()).toEqual(['desktop', 'mobile']);
      await http(app).put('/api/v1/license').set(bearer(t)).send({ licence: licence() }).expect(200); // back to 10 + 10
    });

    it('PERMISSION PER POSITION: only the owner may request or install a licence; every position reads the summary', async () => {
      const t = owner.accessToken;
      const roles = ['SALES_MANAGER', 'PRODUCTION_MANAGER', 'WORKSHOP_SUPERVISOR', 'QA_INSPECTOR', 'FIELD_AGENT'];
      for (const role of roles) {
        const email = `${role.toLowerCase()}@shop.dz`;
        await http(app).post('/api/v1/users').set(bearer(t)).send({ email, fullName: role, password: PASSWORD, roles: [role] }).expect(201);
        const tok = ((await signIn(app, email).expect(200)).body as LoginResponse).accessToken;
        expect((await http(app).get('/api/v1/license/summary').set(bearer(tok)).expect(200)).body.state).toBe('active');
        await http(app).get('/api/v1/license').set(bearer(tok)).expect(403);
        await http(app).post('/api/v1/license/request').set(bearer(tok)).send({ code: CODE }).expect(403);
        await http(app).put('/api/v1/license').set(bearer(tok)).send({ licence: licence() }).expect(403);
        await http(app).post('/api/v1/license/online').set(bearer(tok)).send({ code: CODE }).expect(403);
      }
      // the owner (SUPER_ADMIN)
      expect((await http(app).post('/api/v1/license/request').set(bearer(t)).send({ code: CODE }).expect(200)).body.hardwareId).toBe(HW);
      await http(app).get('/api/v1/license').set(bearer(t)).expect(200);
      expect((await http(app).post('/api/v1/license/online').set(bearer(t)).send({ code: CODE }).expect(409)).body.code).toBe('LICENCE_ONLINE_UNAVAILABLE');
      for (const route of ['/api/v1/license', '/api/v1/license/summary']) await http(app).get(route).expect(401);
    });

    afterAll(async () => app?.close());
  });

  describe('READ-ONLY when the licence check fails: reads and exports work, writes are refused, sign-in still works', () => {
    const cases: Array<[string, () => string, string]> = [
      ['TAMPERED file (more seats typed in)', () => {
        const p = payload();
        const [, sig] = signLicense(p, keys.privateKeyPem).split('.');
        const forged = Buffer.from(JSON.stringify({ ...p, seats: { desktop: 999, mobile: 999 } })).toString('base64url');
        return formatLicenceText(`${forged}.${sig}`);
      }, 'BAD_SIGNATURE'],
      ['WRONG HARDWARE (the database moved to another server)', () => licence({ hardwareId: '0'.repeat(64) }), 'HARDWARE_MISMATCH'],
      ['UPDATES EXPIRED (this version is newer than the licence covers)', () => licence({ updatesUntil: '2020-01-01' }), 'UPDATES_EXPIRED'],
      ['NO licence file at all', () => '', 'NO_LICENSE_FILE'],
    ];

    it.each(cases)('%s', async (_name, make, problem) => {
      const file = path.join(dir, `ro-${++n}.vfl`);
      const text = make();
      if (text) writeFileSync(file, text);
      await withApp(file, async (app) => {
        const login = (await http(app).post('/api/v1/auth/login').send({ email: 'sales_manager@shop.dz', password: PASSWORD, client: 'desktop' }).expect(200)).body as LoginResponse;
        const t = login.accessToken;
        expect((await http(app).get('/api/v1/license/summary').set(bearer(t)).expect(200)).body).toMatchObject({ state: 'read_only', problem });
        // reads, of every module (even one an active licence might not include)
        await http(app).get('/api/v1/customers').set(bearer(t)).expect(200);
        await http(app).get('/api/v1/orders').set(bearer(t)).expect(200);
        await http(app).get('/api/v1/production/board').set(bearer(t)).expect(200);
        // writes
        const res = await http(app).post('/api/v1/customers').set(bearer(t)).send({ name: 'Blocked' }).expect(403);
        expect(res.body).toMatchObject({ code: 'LICENCE_READ_ONLY', licenceProblem: problem });
        await http(app).patch(`/api/v1/customers/${(await http(app).get('/api/v1/customers').set(bearer(t))).body.items[0].id}`).set(bearer(t)).send({ city: 'Oran' }).expect(403);
        await http(app).post('/api/v1/auth/logout').send({ refreshToken: login.refreshToken }).expect(204);
      });
    });

    it('installing a valid licence puts a read-only server right at once', async () => {
      const file = path.join(dir, `ro-fix-${++n}.vfl`);
      writeFileSync(file, licence({ hardwareId: '0'.repeat(64) }));
      await withApp(file, async (app) => {
        const t = ((await http(app).post('/api/v1/auth/login').send({ email: ownerEmail, password: PASSWORD }).expect(200)).body as LoginResponse).accessToken;
        const status = (await http(app).get('/api/v1/license').set(bearer(t)).expect(200)).body;
        expect(status).toMatchObject({ state: 'read_only', problem: { code: 'HARDWARE_MISMATCH' }, activationCode: CODE }); // known, for the transfer request
        await http(app).post('/api/v1/customers').set(bearer(t)).send({ name: 'Before' }).expect(403);
        await http(app).put('/api/v1/license').set(bearer(t)).send({ licence: licence() }).expect(200);
        await http(app).post('/api/v1/customers').set(bearer(t)).send({ name: 'After' }).expect(201);
      });
    });
  });

  describe('ONLINE activation (optional)', () => {
    let stub: Server;
    let url: string;
    beforeAll(async () => {
      // stands in for BluxTech's licence server: signs a licence for whatever request code it receives
      stub = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const r = decodeRequestCode((JSON.parse(body) as { requestCode: string }).requestCode);
          res.writeHead(r ? 200 : 400, { 'content-type': 'application/json' });
          res.end(JSON.stringify(r ? { licence: licence({ licenceId: 'LIC-ONLINE', activationCode: r.activationCode, hardwareId: r.hardwareId }) } : { message: 'bad request code' }));
        });
      });
      await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
      url = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/activate`;
    });
    afterAll(() => new Promise<void>((resolve) => stub.close(() => resolve())));

    const ownerToken = async (app: INestApplication) =>
      ((await http(app).post('/api/v1/auth/login').send({ email: ownerEmail, password: PASSWORD }).expect(200)).body as LoginResponse).accessToken;

    it('sends the request code to the licence server and installs the licence it answers with', async () => {
      await withApp(path.join(dir, 'online.vfl'), async (app) => {
        const t = await ownerToken(app);
        expect((await http(app).get('/api/v1/license').set(bearer(t)).expect(200)).body).toMatchObject({ online: true, state: 'read_only' });
        const status = (await http(app).post('/api/v1/license/online').set(bearer(t)).send({ code: CODE }).expect(200)).body;
        expect(status).toMatchObject({ valid: true, state: 'active', entitlement: { licenceId: 'LIC-ONLINE' } });
      }, { LICENSE_SERVER_URL: url });
    });

    it('an unreachable licence server is a clear 502, and offline activation still works', async () => {
      await withApp(path.join(dir, 'online-down.vfl'), async (app) => {
        const t = await ownerToken(app);
        expect((await http(app).post('/api/v1/license/online').set(bearer(t)).send({ code: CODE }).expect(502)).body.code).toBe('LICENCE_ONLINE_FAILED');
        await http(app).put('/api/v1/license').set(bearer(t)).send({ licence: licence() }).expect(200);
      }, { LICENSE_SERVER_URL: 'http://127.0.0.1:1/activate' });
    });
  });
});
