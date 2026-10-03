// Talking to PostgreSQL and preparing the database: wait for it, create the database, migrate, seed.
// `pg` and `@victorflow/db` are not bundled into vf-server.mjs (argon2 is a native addon); they are loaded from the
// deployed server's node_modules (installed) or packages/db (repo), exactly where the API itself loads them from.
import { createRequire } from 'node:module';
import path from 'node:path';
import { databaseUrl } from './env';
import { VfError } from './errors';
import type { ProgramLayout } from './layout';
import type { Secrets, ServerConfig } from './store';

interface PgClient {
  connect(): Promise<void>;
  query(sql: string): Promise<{ rowCount: number | null }>;
  end(): Promise<void>;
}
interface PgModule {
  Client: new (opts: Record<string, unknown>) => PgClient;
}
interface Destroyable {
  destroy(): Promise<void>;
}
interface DbModule {
  createDb(url: string, opts: { max: number }): Destroyable;
  migrateToLatest(db: Destroyable, dir: string): Promise<{ applied: string[] }>;
  seed(db: Destroyable, opts: { demoPassword: string }): Promise<unknown>;
}

const requireFrom = (dir: string) => createRequire(path.join(dir, 'package.json'));
const loadPg = (layout: ProgramLayout) => requireFrom(layout.dbModuleDir)('pg') as PgModule;
// require(), not import(): dist/index.js is a tsup CJS build, and CJS require always sees its real exports.
const loadDbModule = (layout: ProgramLayout) => requireFrom(layout.dbModuleDir)(path.join(layout.dbModuleDir, 'dist', 'index.js')) as DbModule;

async function withClient<T>(layout: ProgramLayout, config: ServerConfig, secrets: Secrets, database: string, fn: (c: PgClient) => Promise<T>): Promise<T> {
  const { Client } = loadPg(layout);
  const client = new Client({ host: '127.0.0.1', port: config.pgPort, user: 'victorflow', password: secrets.dbPassword, database, connectionTimeoutMillis: 4000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** The only proof PostgreSQL is ready: a real login with this install's own password (a stranger's server can't pass it). */
export async function canConnect(layout: ProgramLayout, config: ServerConfig, secrets: Secrets, database = 'postgres'): Promise<boolean> {
  try {
    await withClient(layout, config, secrets, database, (c) => c.query('SELECT 1'));
    return true;
  } catch {
    return false;
  }
}

/** Even with the service dependency, PostgreSQL may still be replaying its log after an unclean shutdown. */
export async function waitForPostgres(layout: ProgramLayout, config: ServerConfig, secrets: Secrets, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await canConnect(layout, config, secrets))) {
    if (Date.now() > deadline) throw new VfError('PG_NOT_READY', `PostgreSQL did not accept a login on 127.0.0.1:${config.pgPort} within ${Math.round(timeoutMs / 1000)} s`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function ensureDatabase(layout: ProgramLayout, config: ServerConfig, secrets: Secrets): Promise<void> {
  await withClient(layout, config, secrets, 'postgres', async (c) => {
    const exists = await c.query("SELECT 1 FROM pg_database WHERE datname = 'victorflow'");
    if (exists.rowCount === 0) await c.query('CREATE DATABASE victorflow');
  });
}

/**
 * Brings the database up to date: create it if needed, apply every new migration, then run the seed.
 *
 * TEMPORARY demo-seeding shim: the seed creates the demo accounts (admin@victorflow.local with this install's random
 * adminPassword from secrets.json) and demo data, because the onboarding flow (licence → company → first admin) does not
 * exist yet. It is idempotent, so it runs on every start. Remove it when onboarding ships.
 */
export async function prepareDatabase(layout: ProgramLayout, config: ServerConfig, secrets: Secrets, log: (line: string) => void): Promise<void> {
  await waitForPostgres(layout, config, secrets);
  await ensureDatabase(layout, config, secrets);
  const dbModule = loadDbModule(layout);
  const db = dbModule.createDb(databaseUrl(config, secrets), { max: 2 });
  try {
    const { applied } = await dbModule.migrateToLatest(db, layout.migrationsDir);
    log(applied.length ? `migrations applied: ${applied.join(', ')}` : 'database schema is up to date');
    await dbModule.seed(db, { demoPassword: secrets.adminPassword });
  } catch (e) {
    throw new VfError('MIGRATE', 'The database could not be brought up to date', e instanceof Error ? (e.stack ?? e.message) : String(e));
  } finally {
    await db.destroy();
  }
}
