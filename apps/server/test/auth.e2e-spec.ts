import { Controller, Get, type INestApplication } from '@nestjs/common';
import { PERMISSIONS } from '@victorflow/types';
import { Authenticated, Public } from '../src/common/decorators';
import { bearer, createTestApp, dbOf, http, login, TEST_PASSWORD, tokens, USERS } from './helpers/app';

// Routes that exist only in this test, to prove the guard's default-deny.
@Controller('__probe')
class ProbeController {
  @Get('undeclared')
  undeclared() {
    return { reached: true };
  }
  @Public()
  @Get('open')
  open() {
    return { reached: true };
  }
  @Authenticated()
  @Get('any-user')
  anyUser() {
    return { reached: true };
  }
}

describe('P3 — auth + RBAC (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp([ProbeController]);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('login', () => {
    it('returns tokens plus the user with roles and permissions', async () => {
      const res = await http(app).post('/api/v1/auth/login').send({ email: USERS.admin, password: TEST_PASSWORD }).expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken.length).toBeGreaterThan(30);
      expect(res.body.expiresIn).toBe(900);
      expect(res.body.user).toMatchObject({ email: USERS.admin, roles: ['SUPER_ADMIN'] });
      expect(res.body.user.permissions).toContain('sales.order.confirm');
      expect(res.body.user).not.toHaveProperty('password_hash');
    });

    it('is case-insensitive on the email', async () => {
      await http(app).post('/api/v1/auth/login').send({ email: 'ADMIN@VictorFlow.LOCAL', password: TEST_PASSWORD }).expect(200);
    });

    it('rejects a wrong password and an unknown user with the SAME response (no user enumeration)', async () => {
      const wrong = await http(app).post('/api/v1/auth/login').send({ email: USERS.admin, password: 'nope-nope' }).expect(401);
      const unknown = await http(app).post('/api/v1/auth/login').send({ email: 'ghost@victorflow.local', password: 'nope-nope' }).expect(401);
      expect(wrong.body).toEqual(unknown.body);
    });

    it('validates input with zod (400 + field issues)', async () => {
      const res = await http(app).post('/api/v1/auth/login').send({ email: 'not-an-email' }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['email', 'password']);
    });

    it('refuses a deactivated account, and an already-issued token stops working at once', async () => {
      const { accessToken } = await login(app, USERS.qa);
      await http(app).get('/api/v1/auth/me').set(bearer(accessToken)).expect(200);

      const db = dbOf(app).db;
      await db.updateTable('core.users').set({ is_active: false }).where('email', '=', USERS.qa).execute();
      try {
        await http(app).get('/api/v1/auth/me').set(bearer(accessToken)).expect(401);
        await http(app).post('/api/v1/auth/login').send({ email: USERS.qa, password: TEST_PASSWORD }).expect(401);
      } finally {
        await db.updateTable('core.users').set({ is_active: true }).where('email', '=', USERS.qa).execute();
      }
    });
  });

  describe('authentication', () => {
    it('protected routes reject a missing, malformed or tampered token with 401', async () => {
      await http(app).get('/api/v1/users').expect(401);
      await http(app).get('/api/v1/users').set('Authorization', 'Bearer garbage').expect(401);
      await http(app).get('/api/v1/users').set('Authorization', 'Basic abc').expect(401);

      const { accessToken } = await login(app, USERS.admin);
      const [h, p, s] = accessToken.split('.');
      const forged = Buffer.from(JSON.stringify({ sub: '00000000-0000-0000-0000-000000000000', iss: 'victorflow' })).toString('base64url');
      await http(app).get('/api/v1/users').set('Authorization', `Bearer ${h}.${forged}.${s}`).expect(401);
      void p;
    });

    it('rejects an unsigned (alg:none) token', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const { user } = await login(app, USERS.admin);
      const payload = Buffer.from(JSON.stringify({ sub: user.id, iss: 'victorflow' })).toString('base64url');
      await http(app).get('/api/v1/users').set('Authorization', `Bearer ${header}.${payload}.`).expect(401);
    });

    it('GET /auth/me works for any signed-in user', async () => {
      const t = await tokens(app, 'field');
      const res = await http(app).get('/api/v1/auth/me').set(bearer(t.field)).expect(200);
      expect(res.body.roles).toEqual(['FIELD_AGENT']);
    });
  });

  describe('authorisation is by PERMISSION', () => {
    it('a route the caller lacks the permission for → 403 naming the missing permission', async () => {
      const t = await tokens(app, 'field', 'sales');
      const res = await http(app).get('/api/v1/users').set(bearer(t.field)).expect(403);
      expect(res.body.message).toContain(PERMISSIONS.CORE_USER_READ);
      await http(app).get('/api/v1/users').set(bearer(t.sales)).expect(403);
    });

    it('a caller who holds the permission is let in', async () => {
      const t = await tokens(app, 'admin');
      const res = await http(app).get('/api/v1/users').set(bearer(t.admin)).expect(200);
      expect(res.body.map((u: { email: string }) => u.email)).toContain(USERS.admin);
    });

    it('the role NAME is irrelevant: a custom role with the permission works, and revoking it takes effect immediately', async () => {
      const db = dbOf(app).db;
      const role = await db.insertInto('core.roles').values({ code: 'AUDITOR_X', name: 'Auditor X' }).returning('id').executeTakeFirstOrThrow();
      const perm = await db.selectFrom('core.permissions').select('id').where('code', '=', PERMISSIONS.CORE_USER_READ).executeTakeFirstOrThrow();
      const user = await db.selectFrom('core.users').select('id').where('email', '=', USERS.field).executeTakeFirstOrThrow();

      const { accessToken } = await login(app, USERS.field);
      await http(app).get('/api/v1/users').set(bearer(accessToken)).expect(403);

      await db.insertInto('core.role_permissions').values({ role_id: role.id, permission_id: perm.id }).execute();
      await db.insertInto('core.user_roles').values({ user_id: user.id, role_id: role.id }).execute();
      try {
        await http(app).get('/api/v1/users').set(bearer(accessToken)).expect(200); // same token, new permission

        await db.deleteFrom('core.role_permissions').where('role_id', '=', role.id).execute();
        await http(app).get('/api/v1/users').set(bearer(accessToken)).expect(403); // and gone again, no stale claims
      } finally {
        await db.deleteFrom('core.user_roles').where('role_id', '=', role.id).execute();
        await db.deleteFrom('core.roles').where('id', '=', role.id).execute();
      }
    });

    it('DEFAULT DENY: a route with no declared permission is refused even for a SUPER_ADMIN', async () => {
      const t = await tokens(app, 'admin');
      const res = await http(app).get('/api/v1/__probe/undeclared').set(bearer(t.admin)).expect(403);
      expect(res.body.message).toMatch(/denied by default/);
      await http(app).get('/api/v1/__probe/undeclared').expect(401);
    });

    it('@Public and @Authenticated behave as declared', async () => {
      await http(app).get('/api/v1/__probe/open').expect(200);
      await http(app).get('/api/v1/__probe/any-user').expect(401);
      const t = await tokens(app, 'field');
      await http(app).get('/api/v1/__probe/any-user').set(bearer(t.field)).expect(200);
    });

    it('creating users needs core.user.manage; unknown roles are refused; passwords are argon2id-hashed', async () => {
      const t = await tokens(app, 'admin', 'sales');
      const body = { email: `new.${Date.now()}@victorflow.local`, fullName: 'New Person', password: 'a-decent-password', roles: ['FIELD_AGENT'] };
      await http(app).post('/api/v1/users').set(bearer(t.sales)).send(body).expect(403);
      await http(app).post('/api/v1/users').set(bearer(t.admin)).send({ ...body, roles: ['NO_SUCH_ROLE'] }).expect(422);
      await http(app).post('/api/v1/users').set(bearer(t.admin)).send({ ...body, password: 'short' }).expect(400);
      const created = await http(app).post('/api/v1/users').set(bearer(t.admin)).send(body).expect(201);
      expect(created.body).toMatchObject({ email: body.email, roles: ['FIELD_AGENT'], isActive: true });

      const row = await dbOf(app).db.selectFrom('core.users').select('password_hash').where('id', '=', created.body.id).executeTakeFirstOrThrow();
      expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
      await http(app).post('/api/v1/users').set(bearer(t.admin)).send(body).expect(409); // duplicate email

      await login(app, body.email, body.password); // the new user can sign in
    });
  });

  describe('refresh tokens', () => {
    it('rotates on use; replaying the old token is treated as theft and revokes the whole session', async () => {
      const first = await login(app, USERS.workshop);
      const second = await http(app).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
      expect(second.body.refreshToken).not.toBe(first.refreshToken);
      await http(app).get('/api/v1/auth/me').set(bearer(second.body.accessToken)).expect(200);

      // attacker replays the ALREADY-USED first token
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
      // …which also burned the legitimate holder's newer token (same family)
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: second.body.refreshToken }).expect(401);
    });

    it('stores only a hash of the refresh token', async () => {
      const s = await login(app, USERS.production);
      const rows = await dbOf(app).db.selectFrom('core.refresh_tokens').select('token_hash').execute();
      expect(rows.some((r) => r.token_hash === s.refreshToken)).toBe(false);
      expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
    });

    it('logout revokes the session; garbage tokens are rejected', async () => {
      const s = await login(app, USERS.sales);
      await http(app).post('/api/v1/auth/logout').send({ refreshToken: s.refreshToken }).expect(204);
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: 'x'.repeat(43) }).expect(401);
      await http(app).post('/api/v1/auth/logout').send({ refreshToken: 'x'.repeat(43) }).expect(204); // idempotent
    });

    it('deactivating a user revokes their refresh tokens', async () => {
      const t = await tokens(app, 'admin');
      const created = await http(app)
        .post('/api/v1/users')
        .set(bearer(t.admin))
        .send({ email: `temp.${Date.now()}@victorflow.local`, fullName: 'Temp User', password: 'a-decent-password', roles: ['FIELD_AGENT'] })
        .expect(201);
      const session = await login(app, created.body.email, 'a-decent-password');
      await http(app).patch(`/api/v1/users/${created.body.id}`).set(bearer(t.admin)).send({ isActive: false }).expect(200);
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    });
  });

  describe('health', () => {
    it('is public and reports dependencies', async () => {
      const res = await http(app).get('/api/v1/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
    });
  });

  describe('audit', () => {
    it('records the acting user on writes made through the API', async () => {
      const t = await tokens(app, 'admin');
      const email = `audited.${Date.now()}@victorflow.local`;
      const created = await http(app)
        .post('/api/v1/users')
        .set(bearer(t.admin))
        .send({ email, fullName: 'Audited Person', password: 'a-decent-password', roles: ['QA_INSPECTOR'] })
        .expect(201);

      const admin = await dbOf(app).db.selectFrom('core.users').select('id').where('email', '=', USERS.admin).executeTakeFirstOrThrow();
      const trail = await dbOf(app)
        .db.selectFrom('audit.trail')
        .select(['actor_id', 'new_data'])
        .where('table_name', '=', 'users')
        .where('row_id', '=', created.body.id)
        .where('operation', '=', 'INSERT')
        .executeTakeFirstOrThrow();
      expect(trail.actor_id).toBe(admin.id);
      expect(trail.new_data).not.toHaveProperty('password_hash');
    });
  });
});
