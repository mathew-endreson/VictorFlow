import type { INestApplication } from '@nestjs/common';
import { PERMISSIONS } from '@victorflow/types';
import { bearer, createTestApp, dbOf, http, login, TEST_PASSWORD, tokens, USERS } from './helpers/app';

/**
 * A user who may manage users must not be able to use that right to become (or create) someone more powerful,
 * and the installation must never be left with nobody who can manage users.
 */
describe('user management — no privilege escalation, no lock-out (e2e)', () => {
  let app: INestApplication;
  const ROLE = 'USER_ADMIN_TEST';
  const email = (n: string) => `hardening.${n}.${Date.now()}@victorflow.local`;
  const created: string[] = [];
  let managerToken: string;
  let managerId: string;
  let adminToken: string;

  const createUser = async (token: string, roles: string[], address = email('u')) => {
    const res = await http(app).post('/api/v1/users').set(bearer(token)).send({ email: address, fullName: 'Hardening Test', password: TEST_PASSWORD, roles });
    if (res.status === 201) created.push(res.body.id);
    return res;
  };

  beforeAll(async () => {
    app = await createTestApp();
    const db = dbOf(app).db;
    // a role that may manage users but holds far fewer permissions than SUPER_ADMIN
    const role = await db.insertInto('core.roles').values({ code: ROLE, name: 'User admin (test)' }).returning('id').executeTakeFirstOrThrow();
    const perms = await db.selectFrom('core.permissions').select(['id']).where('code', 'in', [PERMISSIONS.CORE_USER_MANAGE, PERMISSIONS.CORE_USER_READ, PERMISSIONS.CORE_ROLE_READ]).execute();
    await db.insertInto('core.role_permissions').values(perms.map((p) => ({ role_id: role.id, permission_id: p.id }))).execute();

    adminToken = (await tokens(app, 'admin')).admin;
    const manager = await createUser(adminToken, [ROLE], email('manager'));
    expect(manager.status).toBe(201);
    managerId = manager.body.id;
    managerToken = (await login(app, manager.body.email)).accessToken;
  });

  afterAll(async () => {
    const db = dbOf(app).db;
    await db.deleteFrom('core.users').where('id', 'in', created).execute();
    await db.deleteFrom('core.roles').where('code', '=', ROLE).execute();
    await app.close();
  });

  it('a user manager cannot create a user with a role that holds permissions they lack', async () => {
    const res = await createUser(managerToken, ['SUPER_ADMIN']);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ROLE_ESCALATION');
    const sales = await createUser(managerToken, ['SALES_MANAGER']);
    expect(sales.status).toBe(403); // sales permissions are also beyond a user-only manager
    expect(sales.body.code).toBe('ROLE_ESCALATION');
  });

  it('cannot give themselves, or anyone, a bigger role', async () => {
    const self = await http(app).patch(`/api/v1/users/${managerId}`).set(bearer(managerToken)).send({ roles: ['SUPER_ADMIN'] });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('ROLE_ESCALATION');

    const other = await createUser(managerToken, [ROLE], email('peer'));
    expect(other.status).toBe(201); // handing out a role they DO fully hold is fine
    const up = await http(app).patch(`/api/v1/users/${other.body.id}`).set(bearer(managerToken)).send({ roles: ['SUPER_ADMIN'] });
    expect(up.status).toBe(403);
    expect(up.body.code).toBe('ROLE_ESCALATION');
  });

  it('cannot reset the password of, disable or re-role a user who holds more power', async () => {
    const admin = await dbOf(app).db.selectFrom('core.users').select('id').where('email', '=', USERS.admin).executeTakeFirstOrThrow();
    for (const body of [{ password: 'Attacker-Pass-1' }, { isActive: false }, { roles: [ROLE] }]) {
      const res = await http(app).patch(`/api/v1/users/${admin.id}`).set(bearer(managerToken)).send(body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('USER_OUT_OF_REACH');
    }
    await http(app).post('/api/v1/auth/login').send({ email: USERS.admin, password: TEST_PASSWORD }).expect(200); // the admin's password is untouched
  });

  it('can still do the job it was given: manage users at its own level', async () => {
    const peer = await createUser(managerToken, [ROLE], email('peer2'));
    expect(peer.status).toBe(201);
    await http(app).patch(`/api/v1/users/${peer.body.id}`).set(bearer(managerToken)).send({ fullName: 'Renamed Peer' }).expect(200);
    await http(app).patch(`/api/v1/users/${peer.body.id}`).set(bearer(managerToken)).send({ isActive: false }).expect(200);
  });

  it('the super administrator can still grant anything (regression)', async () => {
    const res = await createUser(adminToken, ['SUPER_ADMIN'], email('root2'));
    expect(res.status).toBe(201);
    await http(app).patch(`/api/v1/users/${res.body.id}`).set(bearer(adminToken)).send({ roles: ['SALES_MANAGER'] }).expect(200);
  });

  it('refuses any change that would leave nobody able to manage users (LAST_ADMIN) — and changes nothing', async () => {
    const db = dbOf(app).db;
    // make the seeded admin the ONLY active user who can manage users: switch off every other holder
    const holders = await db
      .selectFrom('core.users as u')
      .innerJoin('core.user_roles as ur', 'ur.user_id', 'u.id')
      .innerJoin('core.role_permissions as rp', 'rp.role_id', 'ur.role_id')
      .innerJoin('core.permissions as p', 'p.id', 'rp.permission_id')
      .select('u.id')
      .distinct()
      .where('p.code', '=', PERMISSIONS.CORE_USER_MANAGE)
      .where('u.is_active', '=', true)
      .where('u.email', '<>', USERS.admin)
      .execute();
    if (holders.length > 0) await db.updateTable('core.users').set({ is_active: false }).where('id', 'in', holders.map((h) => h.id)).execute();

    const res = await http(app).patch(`/api/v1/users/${(await db.selectFrom('core.users').select('id').where('email', '=', USERS.admin).executeTakeFirstOrThrow()).id}`).set(bearer(adminToken)).send({ roles: ['SALES_MANAGER'] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LAST_ADMIN');

    const roles = await db
      .selectFrom('core.user_roles as ur')
      .innerJoin('core.roles as r', 'r.id', 'ur.role_id')
      .innerJoin('core.users as u', 'u.id', 'ur.user_id')
      .select('r.code')
      .where('u.email', '=', USERS.admin)
      .execute();
    expect(roles.map((r) => r.code)).toEqual(['SUPER_ADMIN']); // the whole update was rolled back
  });
});
