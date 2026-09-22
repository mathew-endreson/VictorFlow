import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, ROLES } from '@victorflow/types';
import { createDb } from './client';
import { loadEnv } from './env';
import { migrateToLatest } from './migrate';
import { APP_SCHEMAS, type Database } from './schema';
import { seed } from './seed';
import { recreateDatabase } from './testing';

/**
 * These tests talk to a REAL Postgres (docker compose up). They run against a throw-away
 * `<db>_dbtest` database so the dev database is never touched.
 */
loadEnv();
const BASE_URL = process.env.DATABASE_URL ?? 'postgresql://victorflow:victorflow@localhost:5432/victorflow';

let db: Kysely<Database>;

beforeAll(async () => {
  const url = await recreateDatabase(BASE_URL, 'dbtest');
  db = createDb(url, { max: 4 });
  await migrateToLatest(db);
  // Fixed year: the tests below use 2026 dates and must not depend on the machine clock.
  await seed(db, { demoPassword: 'Test-Password-1', fiscalYear: 2026 });
}, 120_000);

afterAll(async () => {
  await db?.destroy();
});

class Rollback extends Error {}

/** Run `fn` inside a transaction that is always rolled back, so destructive experiments leave no trace. */
async function inRolledBackTx<T>(fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await db.transaction().execute(async (trx) => {
      out = await fn(trx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out as T;
}

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; message: string };
  }
  return undefined;
};

const accountId = async (code: string) =>
  (await db.selectFrom('finance.chart_of_accounts').select('id').where('code', '=', code).executeTakeFirstOrThrow()).id;

async function draftEntry(journal: string, date: string) {
  const j = await db.selectFrom('finance.journals').select('id').where('code', '=', journal).executeTakeFirstOrThrow();
  const fy = await db
    .selectFrom('finance.fiscal_years')
    .select('id')
    .where('start_date', '<=', date)
    .where('end_date', '>=', date)
    .executeTakeFirstOrThrow();
  return (
    await db
      .insertInto('finance.journal_entries')
      .values({ journal_id: j.id, fiscal_year_id: fy.id, entry_date: date, description: 'db test' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
}

async function addLine(entryId: string, code: string, debit: string, credit: string) {
  await db
    .insertInto('finance.journal_entry_lines')
    .values({ entry_id: entryId, account_id: await accountId(code), debit, credit })
    .execute();
}

const post = (id: string) =>
  db.updateTable('finance.journal_entries').set({ status: 'POSTED' }).where('id', '=', id).execute();

async function postedEntry(journal: string, date: string) {
  const id = await draftEntry(journal, date);
  await addLine(id, '411', '119.0000', '0');
  await addLine(id, '701', '0', '100.0000');
  await addLine(id, '44571', '0', '19.0000');
  await post(id);
  return id;
}

describe('migrations & seed', () => {
  it('migration files are pure ASCII, so they load on a server with any encoding (e.g. WIN1252)', async () => {
    const dir = path.resolve(__dirname, '..', 'migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      const bad = [...text].find((ch) => ch.charCodeAt(0) > 127);
      expect(bad, `${file} contains non-ASCII "${bad}"`).toBeUndefined();
    }
  });

  it('migrating again is a no-op', async () => {
    expect((await migrateToLatest(db)).applied).toEqual([]);
  });

  it('every table in every app schema has created_at and updated_at', async () => {
    const tables = await sql<{ table_schema: string; table_name: string }>`
      SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' AND table_schema = ANY(${sql.val([...APP_SCHEMAS])}::text[])`.execute(db);
    expect(tables.rows.length).toBeGreaterThan(30);

    const cols = await sql<{ table_schema: string; table_name: string; column_name: string }>`
      SELECT table_schema, table_name, column_name FROM information_schema.columns
       WHERE column_name IN ('created_at', 'updated_at') AND table_schema = ANY(${sql.val([...APP_SCHEMAS])}::text[])`.execute(db);
    const have = new Set(cols.rows.map((c) => `${c.table_schema}.${c.table_name}.${c.column_name}`));
    const missing = tables.rows.flatMap((t) =>
      ['created_at', 'updated_at'].filter((c) => !have.has(`${t.table_schema}.${t.table_name}.${c}`)).map((c) => `${t.table_schema}.${t.table_name}.${c}`),
    );
    expect(missing).toEqual([]);
  });

  it('has every FK/join index the spec calls for, plus a GIN on custom_fields', async () => {
    const { rows } = await sql<{ indexdef: string }>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = ANY(${sql.val([...APP_SCHEMAS])}::text[])`.execute(db);
    const defs = rows.map((r) => r.indexdef);
    const has = (re: RegExp) => defs.some((d) => re.test(d));

    expect(has(/ON finance\.journal_entry_lines USING btree \(entry_id\)/)).toBe(true);
    expect(has(/ON finance\.journal_entry_lines USING btree \(partner_id\)/)).toBe(true);
    expect(has(/ON erp\.order_items USING btree \(order_id\)/)).toBe(true);
    expect(has(/ON crm\.contacts USING btree \(customer_id\)/)).toBe(true);
    expect(has(/ON erp\.work_orders USING btree \(production_order_id\)/)).toBe(true);
    expect(has(/ON inventory\.stock_moves USING btree \(item_id, created_at\)/)).toBe(true);
    expect(has(/ON crm\.customers USING gin \(custom_fields\)/)).toBe(true);
  });

  it('seeds roles, permissions, an admin who holds every permission, and the FSM', async () => {
    const roles = await db.selectFrom('core.roles').select('code').execute();
    expect(roles.map((r) => r.code).sort()).toEqual(Object.values(ROLES).sort());

    const adminPerms = await db
      .selectFrom('core.users as u')
      .innerJoin('core.user_roles as ur', 'ur.user_id', 'u.id')
      .innerJoin('core.role_permissions as rp', 'rp.role_id', 'ur.role_id')
      .innerJoin('core.permissions as p', 'p.id', 'rp.permission_id')
      .select('p.code')
      .where('u.email', '=', 'admin@victorflow.local')
      .execute();
    expect(adminPerms.length).toBe(ALL_PERMISSIONS.length);

    const states = await db.selectFrom('erp.fsm_states').select('code').orderBy('position').execute();
    expect(states.map((s) => s.code)).toEqual(['DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'QUALITY_CHECK', 'COMPLETED', 'REJECTED']);
    const guarded = await db.selectFrom('erp.fsm_transitions').select(['from_state', 'to_state', 'guard_code']).where('guard_code', 'is not', null).execute();
    expect(guarded).toEqual([{ from_state: 'IN_PRODUCTION', to_state: 'QUALITY_CHECK', guard_code: 'ALL_WORK_ORDERS_COMPLETED' }]);
  });

  it('never stores a plaintext password, and hashes with argon2id', async () => {
    const u = await db.selectFrom('core.users').select('password_hash').where('email', '=', 'admin@victorflow.local').executeTakeFirstOrThrow();
    expect(u.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(u.password_hash).not.toContain('Test-Password-1');
  });

  it('re-seeding changes nothing', async () => {
    const count = async () =>
      Number((await sql<{ n: string }>`SELECT (SELECT count(*) FROM core.users) + (SELECT count(*) FROM core.role_permissions) + (SELECT count(*) FROM finance.chart_of_accounts) + (SELECT count(*) FROM crm.customers) + (SELECT count(*) FROM inventory.stock_moves) + (SELECT count(*) FROM workforce.tasks) AS n`.execute(db)).rows[0]!.n);
    const before = await count();
    await seed(db, { demoPassword: 'Test-Password-1', fiscalYear: 2026 });
    expect(await count()).toBe(before);
  });
});

describe('updated_at trigger', () => {
  it('bumps updated_at on UPDATE', async () => {
    const before = await db.selectFrom('crm.customers').select(['id', 'updated_at']).limit(1).executeTakeFirstOrThrow();
    await new Promise((r) => setTimeout(r, 15));
    await db.updateTable('crm.customers').set({ city: 'Blida' }).where('id', '=', before.id).execute();
    const after = await db.selectFrom('crm.customers').select('updated_at').where('id', '=', before.id).executeTakeFirstOrThrow();
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });
});

describe('ledger triggers', () => {
  it('rejects posting an unbalanced entry (VF002) and leaves it a DRAFT', async () => {
    const id = await draftEntry('OD', '2026-03-10');
    await addLine(id, '512', '100', '0');
    await addLine(id, '701', '0', '99.9999');
    const err = await errorOf(post(id));
    expect(err?.code).toBe('VF002');
    expect(err?.message).toMatch(/Unbalanced/);
    const row = await db.selectFrom('finance.journal_entries').select(['status', 'entry_number']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'DRAFT', entry_number: null });
  });

  it('rejects posting an entry with fewer than two lines', async () => {
    const id = await draftEntry('OD', '2026-03-10');
    await addLine(id, '512', '100', '0');
    expect((await errorOf(post(id)))?.code).toBe('VF002');
  });

  it('rejects a line that has both a debit and a credit, or neither', async () => {
    const id = await draftEntry('OD', '2026-03-10');
    expect((await errorOf(addLine(id, '512', '5', '5')))?.code).toBe('23514');
    expect((await errorOf(addLine(id, '512', '0', '0')))?.code).toBe('23514');
  });

  it('numbers from a per-journal, per-fiscal-year SEQUENCE, in order', async () => {
    const a = await postedEntry('BNQ', '2026-04-01');
    const b = await postedEntry('BNQ', '2026-04-02');
    const c = await postedEntry('CAI', '2026-04-02');
    const num = async (id: string) =>
      (await db.selectFrom('finance.journal_entries').select('entry_number').where('id', '=', id).executeTakeFirstOrThrow()).entry_number!;
    const [na, nb, nc] = [await num(a), await num(b), await num(c)];
    expect(na).toMatch(/^BNQ\/2026\/\d{6}$/);
    const seq = (n: string) => Number(n.split('/')[2]);
    expect(seq(nb)).toBe(seq(na) + 1);
    expect(nc).toMatch(/^CAI\/2026\/000001$/); // independent counter per journal

    const seqs = await sql<{ relname: string }>`SELECT relname FROM pg_class WHERE relkind = 'S' AND relnamespace = 'finance'::regnamespace`.execute(db);
    expect(seqs.rows.map((r) => r.relname)).toEqual(expect.arrayContaining(['je_seq_bnq_2026', 'je_seq_cai_2026']));
  });

  it('takes the year from the ENTRY DATE, not the server clock', async () => {
    await db.insertInto('finance.fiscal_years').values({ code: '2031', start_date: '2031-01-01', end_date: '2031-12-31' }).execute();
    const id = await postedEntry('VTE', '2031-06-15');
    const row = await db.selectFrom('finance.journal_entries').select('entry_number').where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.entry_number).toBe('VTE/2031/000001');
  });

  it('refuses an entry dated outside its fiscal year, or in a closed one', async () => {
    const j = await db.selectFrom('finance.journals').select('id').where('code', '=', 'OD').executeTakeFirstOrThrow();
    const fy = await db.selectFrom('finance.fiscal_years').select('id').where('code', '=', '2031').executeTakeFirstOrThrow();
    const outside = db
      .insertInto('finance.journal_entries')
      .values({ journal_id: j.id, fiscal_year_id: fy.id, entry_date: '2030-12-31', description: 'x' })
      .execute();
    expect((await errorOf(outside))?.code).toBe('VF003');

    await db.insertInto('finance.fiscal_years').values({ code: '2033', start_date: '2033-01-01', end_date: '2033-12-31', status: 'CLOSED' }).execute();
    const closed = await db.selectFrom('finance.fiscal_years').select('id').where('code', '=', '2033').executeTakeFirstOrThrow();
    const inClosed = db
      .insertInto('finance.journal_entries')
      .values({ journal_id: j.id, fiscal_year_id: closed.id, entry_date: '2033-05-05', description: 'x' })
      .execute();
    expect((await errorOf(inClosed))?.code).toBe('VF003');
  });

  it('refuses overlapping fiscal years', async () => {
    const overlap = db.insertInto('finance.fiscal_years').values({ code: '2031B', start_date: '2031-06-01', end_date: '2032-05-31' }).execute();
    expect((await errorOf(overlap))?.code).toBe('23P01'); // exclusion_violation
  });

  it('POSTED entries and their lines are immutable: UPDATE, DELETE, INSERT-into, TRUNCATE all rejected', async () => {
    const id = await postedEntry('VTE', '2026-05-05');
    const line = await db.selectFrom('finance.journal_entry_lines').select('id').where('entry_id', '=', id).limit(1).executeTakeFirstOrThrow();

    // Sequential on purpose: a TRUNCATE racing other statements can deadlock and make this flaky.
    const attempts: Array<() => Promise<unknown>> = [
      () => db.updateTable('finance.journal_entries').set({ description: 'tampered' }).where('id', '=', id).execute(),
      () => db.deleteFrom('finance.journal_entries').where('id', '=', id).execute(),
      () => db.updateTable('finance.journal_entry_lines').set({ debit: '1' }).where('id', '=', line.id).execute(),
      () => db.deleteFrom('finance.journal_entry_lines').where('id', '=', line.id).execute(),
      () => addLine(id, '512', '1', '0'),
      () => sql`TRUNCATE finance.journal_entry_lines`.execute(db),
      () => sql`TRUNCATE finance.journal_entries CASCADE`.execute(db),
    ];
    for (const attempt of attempts) expect((await errorOf(attempt()))?.code).toBe('VF001');

    // …and nothing changed
    const after = await db.selectFrom('finance.journal_entries').select(['description', 'status']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(after).toEqual({ description: 'db test', status: 'POSTED' });
  });

  it('a reversing entry can be posted against a POSTED entry, once', async () => {
    const orig = await postedEntry('VTE', '2026-05-06');
    const o = await db.selectFrom('finance.journal_entries').select(['journal_id', 'fiscal_year_id']).where('id', '=', orig).executeTakeFirstOrThrow();
    const rev = (
      await db
        .insertInto('finance.journal_entries')
        .values({ ...o, entry_date: '2026-05-07', description: 'reversal', source_type: 'REVERSAL', reversal_of: orig })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await addLine(rev, '411', '0', '119');
    await addLine(rev, '701', '100', '0');
    await addLine(rev, '44571', '19', '0');
    await post(rev);

    const dup = db
      .insertInto('finance.journal_entries')
      .values({ ...o, entry_date: '2026-05-07', description: 'second reversal', source_type: 'REVERSAL', reversal_of: orig })
      .execute();
    expect((await errorOf(dup))?.code).toBe('23505');
  });
});

describe('inventory trigger', () => {
  it('keeps stock_levels in step with moves, with weighted-average cost', async () => {
    const wh = await db.selectFrom('inventory.warehouses').select('id').where('code', '=', 'MAIN').executeTakeFirstOrThrow();
    const item = await db.insertInto('inventory.items').values({ sku: `TEST-${Date.now()}`, name: 'Test item' }).returning('id').executeTakeFirstOrThrow();
    const move = (move_type: 'RECEIPT' | 'ISSUE', quantity: string, unit_cost?: string) =>
      db.insertInto('inventory.stock_moves').values({ item_id: item.id, warehouse_id: wh.id, move_type, quantity, unit_cost: unit_cost ?? null }).execute();
    const level = async () =>
      db.selectFrom('inventory.stock_levels').select(['quantity', 'avg_cost']).where('item_id', '=', item.id).executeTakeFirstOrThrow();

    await move('RECEIPT', '10', '100');
    expect(await level()).toEqual({ quantity: '10.0000', avg_cost: '100.0000' });
    await move('RECEIPT', '10', '200');
    expect(await level()).toEqual({ quantity: '20.0000', avg_cost: '150.0000' });
    await move('ISSUE', '-5');
    expect(await level()).toEqual({ quantity: '15.0000', avg_cost: '150.0000' });

    const issue = await db.selectFrom('inventory.stock_moves').select('unit_cost').where('item_id', '=', item.id).where('move_type', '=', 'ISSUE').executeTakeFirstOrThrow();
    expect(issue.unit_cost).toBe('150.0000'); // issues are valued at the average
  });

  it('refuses to issue more than is on hand (VF004) and moves are append-only', async () => {
    const wh = await db.selectFrom('inventory.warehouses').select('id').where('code', '=', 'MAIN').executeTakeFirstOrThrow();
    const item = await db.insertInto('inventory.items').values({ sku: `TEST2-${Date.now()}`, name: 'Test item 2' }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('inventory.stock_moves').values({ item_id: item.id, warehouse_id: wh.id, move_type: 'RECEIPT', quantity: '3', unit_cost: '10' }).execute();

    const over = db.insertInto('inventory.stock_moves').values({ item_id: item.id, warehouse_id: wh.id, move_type: 'ISSUE', quantity: '-3.0001' }).execute();
    expect((await errorOf(over))?.code).toBe('VF004');
    const lvl = await db.selectFrom('inventory.stock_levels').select('quantity').where('item_id', '=', item.id).executeTakeFirstOrThrow();
    expect(lvl.quantity).toBe('3.0000'); // failed move left nothing behind

    expect((await errorOf(db.updateTable('inventory.stock_moves').set({ note: 'x' }).where('item_id', '=', item.id).execute()))?.code).toBe('VF001');
    expect((await errorOf(db.deleteFrom('inventory.stock_moves').where('item_id', '=', item.id).execute()))?.code).toBe('VF001');
  });
});

describe('sync triggers (change_seq / version)', () => {
  it('assigns a strictly increasing change_seq to every insert/update and bumps version on update', async () => {
    const t1 = await db.insertInto('workforce.tasks').values({ title: 'seq-1' }).returning(['id', 'change_seq', 'version']).executeTakeFirstOrThrow();
    const t2 = await db.insertInto('workforce.tasks').values({ title: 'seq-2' }).returning(['id', 'change_seq', 'version']).executeTakeFirstOrThrow();
    expect(BigInt(t2.change_seq)).toBeGreaterThan(BigInt(t1.change_seq));
    expect(t1.version).toBe(1);

    const u = await db.updateTable('workforce.tasks').set({ status: 'IN_PROGRESS' }).where('id', '=', t1.id).returning(['change_seq', 'version']).executeTakeFirstOrThrow();
    expect(BigInt(u.change_seq)).toBeGreaterThan(BigInt(t2.change_seq));
    expect(u.version).toBe(2);
  });

  it('change_seq order equals commit order even when transactions interleave', async () => {
    // tx A starts first but commits last; B must not be able to take a lower number than A's commit position.
    const a = db.transaction().execute(async (trx) => {
      const r = await trx.insertInto('workforce.tasks').values({ title: 'commit-order-A' }).returning('change_seq').executeTakeFirstOrThrow();
      await new Promise((res) => setTimeout(res, 300));
      return r.change_seq;
    });
    await new Promise((res) => setTimeout(res, 100));
    const b = db.transaction().execute(async (trx) => {
      const r = await trx.insertInto('workforce.tasks').values({ title: 'commit-order-B' }).returning('change_seq').executeTakeFirstOrThrow();
      return r.change_seq;
    });
    const [seqA, seqB] = await Promise.all([a, b]);
    // B blocked on the lock until A committed, so B's number is necessarily higher.
    expect(BigInt(seqB)).toBeGreaterThan(BigInt(seqA));
  });
});

describe('audit trail', () => {
  it('records inserts/updates/deletes, redacts password_hash, and captures the actor', async () => {
    const actor = (await db.selectFrom('core.users').select('id').where('email', '=', 'admin@victorflow.local').executeTakeFirstOrThrow()).id;
    const name = `Audit Probe ${Date.now()}`;
    const customerId = await db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.user_id', ${actor}, true)`.execute(trx);
      const c = await trx.insertInto('crm.customers').values({ name }).returning('id').executeTakeFirstOrThrow();
      await trx.updateTable('crm.customers').set({ city: 'Sétif' }).where('id', '=', c.id).execute();
      await trx.deleteFrom('crm.customers').where('id', '=', c.id).execute();
      return c.id;
    });

    const rows = await db
      .selectFrom('audit.trail')
      .select(['operation', 'actor_id', 'old_data', 'new_data'])
      .where('table_name', '=', 'customers')
      .where('row_id', '=', customerId)
      .orderBy('id')
      .execute();
    expect(rows.map((r) => r.operation)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
    expect(rows.every((r) => r.actor_id === actor)).toBe(true);
    expect((rows[1]!.new_data as any).city).toBe('Sétif');
    expect((rows[1]!.old_data as any).city).toBeNull();

    const userRows = await db.selectFrom('audit.trail').select('new_data').where('table_name', '=', 'users').where('operation', '=', 'INSERT').execute();
    expect(userRows.length).toBeGreaterThan(0);
    for (const r of userRows) expect(r.new_data).not.toHaveProperty('password_hash');
  });

  it('is append-only: UPDATE, DELETE and TRUNCATE are rejected', async () => {
    expect((await errorOf(db.updateTable('audit.trail').set({ table_name: 'x' }).execute()))?.code).toBe('VF001');
    expect((await errorOf(db.deleteFrom('audit.trail').execute()))?.code).toBe('VF001');
    expect((await errorOf(sql`TRUNCATE audit.trail`.execute(db)))?.code).toBe('VF001');
  });

  const verify = async () =>
    (await sql<{ checked: string; first_broken_id: string | null; reason: string | null }>`SELECT * FROM audit.verify_chain()`.execute(db)).rows[0]!;

  it('has an intact hash chain', async () => {
    const v = await verify();
    expect(Number(v.checked)).toBeGreaterThan(50);
    expect(v.first_broken_id).toBeNull();
  });

  it('links every row to the previous row’s hash, starting from 64 zeros', async () => {
    const { rows } = await sql<{ id: string; prev_hash: string; row_hash: string }>`SELECT id, prev_hash, row_hash FROM audit.trail ORDER BY id LIMIT 25`.execute(db);
    expect(rows[0]!.prev_hash).toBe('0'.repeat(64));
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.prev_hash).toBe(rows[i - 1]!.row_hash);
  });

  // Only a superuser who deliberately disables the guard trigger can tamper with the trail — which is exactly
  // the threat the hash chain exists for. The experiments run in a transaction that is rolled back.
  const verifyIn = async (trx: Transaction<Database>) =>
    (await sql<{ checked: string; first_broken_id: string | null; reason: string | null }>`SELECT * FROM audit.verify_chain()`.execute(trx)).rows[0]!;

  it('detects tampering with a row (edited content)', async () => {
    const target = await db.selectFrom('audit.trail').select('id').where('table_name', '=', 'customers').where('operation', '=', 'INSERT').orderBy('id').limit(1).executeTakeFirstOrThrow();
    const v = await inRolledBackTx(async (trx) => {
      await sql`ALTER TABLE audit.trail DISABLE TRIGGER a_trail_append_only`.execute(trx);
      await sql`UPDATE audit.trail SET new_data = jsonb_set(new_data, '{name}', '"Forged"') WHERE id = ${target.id}`.execute(trx);
      return verifyIn(trx);
    });
    expect(v.first_broken_id).toBe(target.id);
    expect(v.reason).toMatch(/modified/);
    expect((await verify()).first_broken_id).toBeNull(); // rolled back: chain intact again
  });

  it('detects a deleted row (broken link)', async () => {
    const { rows } = await sql<{ id: string }>`SELECT id FROM audit.trail ORDER BY id OFFSET 10 LIMIT 1`.execute(db);
    const victim = rows[0]!.id;
    const v = await inRolledBackTx(async (trx) => {
      await sql`ALTER TABLE audit.trail DISABLE TRIGGER a_trail_append_only`.execute(trx);
      await sql`DELETE FROM audit.trail WHERE id = ${victim}`.execute(trx);
      return verifyIn(trx);
    });
    expect(v.first_broken_id).not.toBeNull();
    expect(v.reason).toMatch(/prev_hash/);
    expect((await verify()).first_broken_id).toBeNull();
  });
});
