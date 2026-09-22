#!/usr/bin/env node
/**
 * A local PostgreSQL 16 for machines WITHOUT Docker — no installer, no admin rights.
 *
 * It fetches the `embedded-postgres` binaries from npm into ./.local/pgtools (once), initialises a data directory in
 * ./.local/postgres with the user / password / database from DATABASE_URL, and starts it with pg_ctl (so it keeps
 * running on its own, on the port DATABASE_URL names). Everything lives under ./.local (git-ignored); delete that
 * folder to start over.
 *
 *   node scripts/local-postgres.mjs start | stop | status
 *   pnpm db:local start | stop | status
 *
 * `pnpm dev:up` calls this automatically when Docker is unavailable.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PG_VERSION_PACKAGE = 'embedded-postgres@16.14.0-beta.17'; // PostgreSQL 16, same major as the docker image
const isWin = process.platform === 'win32';
const SAFE_IDENT = /^[A-Za-z0-9_]+$/;

const paths = () => {
  const base = join(ROOT, '.local');
  return { base, tools: join(base, 'pgtools'), data: join(base, 'postgres'), logFile: join(base, 'postgres.log') };
};

/** DATABASE_URL from the environment, else from ./.env, else from ./.env.example. */
export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of ['.env', '.env.example']) {
    const p = join(ROOT, file);
    if (!existsSync(p)) continue;
    const m = /^DATABASE_URL\s*=\s*(.+)$/m.exec(readFileSync(p, 'utf8'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return 'postgresql://victorflow:victorflow@localhost:5432/victorflow';
}

function parse(url) {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), db: decodeURIComponent(u.pathname.slice(1)) };
}

const exe = (bin, name) => join(bin, isWin ? `${name}.exe` : name);

function binDir() {
  const scope = join(paths().tools, 'node_modules', '@embedded-postgres');
  if (!existsSync(scope)) return null;
  for (const d of readdirSync(scope)) {
    const bin = join(scope, d, 'native', 'bin');
    if (existsSync(exe(bin, 'pg_ctl'))) return bin;
  }
  return null;
}

function ensureTools(log) {
  if (binDir()) return binDir();
  const { base, tools } = paths();
  mkdirSync(tools, { recursive: true });
  writeFileSync(join(tools, 'package.json'), '{"name":"vf-pgtools","private":true}\n');
  writeFileSync(join(base, '.gitignore'), '*\n');
  log(`Downloading PostgreSQL 16 binaries (one time, ~50 MB) …`);
  const res = spawnSync('npm', ['install', PG_VERSION_PACKAGE, '--no-audit', '--no-fund', '--loglevel=error'], { cwd: tools, stdio: 'inherit', shell: isWin });
  const bin = binDir();
  if (res.status !== 0 || !bin) throw new Error('Could not download the local PostgreSQL binaries (is npm reachable?). Install Docker or PostgreSQL 16 instead.');
  return bin;
}

function portOpen(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 1500 });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('timeout', () => (s.destroy(), resolve(false)));
    s.once('error', () => resolve(false));
  });
}

const pgClient = () => createRequire(join(ROOT, 'packages', 'db', 'package.json'))('pg');

async function withAdmin(cfg, fn, database = 'postgres') {
  const { Client } = pgClient();
  const client = new Client({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database, connectionTimeoutMillis: 4000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** True when a server on that port accepts these credentials. */
export async function canConnect(url = databaseUrl()) {
  const cfg = parse(url);
  try {
    await withAdmin(cfg, (c) => c.query('SELECT 1'));
    return true;
  } catch {
    return false;
  }
}

async function ensureDatabase(cfg) {
  if (!SAFE_IDENT.test(cfg.db)) throw new Error(`Unsafe database name "${cfg.db}"`);
  await withAdmin(cfg, async (c) => {
    const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [cfg.db]);
    if (exists.rowCount === 0) await c.query(`CREATE DATABASE "${cfg.db}"`);
  });
}

/** Start (or reuse) a local PostgreSQL for DATABASE_URL. Returns { started, reused }. */
export async function startLocalPostgres({ log = console.log } = {}) {
  const cfg = parse(databaseUrl());
  if (!['localhost', '127.0.0.1', '::1'].includes(cfg.host)) {
    throw new Error(`DATABASE_URL points at ${cfg.host}; the local PostgreSQL only serves localhost.`);
  }

  if (await canConnect()) {
    await ensureDatabase(cfg);
    log(`A PostgreSQL that accepts these credentials is already running on port ${cfg.port} — reusing it.`);
    return { started: false, reused: true };
  }
  if (await portOpen(cfg.host === '::1' ? '::1' : '127.0.0.1', cfg.port)) {
    throw new Error(`Port ${cfg.port} is in use by something that does not accept the credentials in DATABASE_URL. Stop it, or change the port/credentials in .env.`);
  }

  const bin = ensureTools(log);
  const { data, logFile } = paths();
  if (!existsSync(join(data, 'PG_VERSION'))) {
    log('Initialising a new local database cluster …');
    mkdirSync(data, { recursive: true });
    const pwfile = join(tmpdir(), `vf-pw-${process.pid}-${Date.now()}`);
    writeFileSync(pwfile, cfg.password, { mode: 0o600 });
    try {
      const r = spawnSync(exe(bin, 'initdb'), [`--pgdata=${data}`, `--username=${cfg.user}`, `--pwfile=${pwfile}`, '--auth=password', '--encoding=UTF8', '--locale=C'], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`initdb failed:\n${r.stdout}\n${r.stderr}`);
    } catch (e) {
      rmSync(data, { recursive: true, force: true });
      throw e;
    } finally {
      rmSync(pwfile, { force: true });
    }
  }

  log(`Starting local PostgreSQL 16 on port ${cfg.port} …`);
  // stdio 'ignore', NOT pipes: the server outlives pg_ctl and would inherit a pipe, so spawnSync would wait for an
  // end-of-file that only comes when the database stops (a hang on Windows). Diagnostics go to the log file instead.
  const r = spawnSync(exe(bin, 'pg_ctl'), ['start', '-D', data, '-l', logFile, '-w', '-t', '60', '-o', `-p ${cfg.port} -c listen_addresses=127.0.0.1`], { stdio: 'ignore' });
  if (r.status !== 0) {
    const tail = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').slice(-12).join('\n') : '(no log)';
    throw new Error(`PostgreSQL did not start (pg_ctl exit ${r.status}). Last lines of ${logFile}:\n${tail}`);
  }
  await ensureDatabase(cfg);
  return { started: true, reused: false };
}

/** Stop the server WE started (synchronous, so it is safe inside an 'exit' handler). */
export function stopLocalPostgres() {
  const bin = binDir();
  const { data } = paths();
  if (!bin || !existsSync(join(data, 'PG_VERSION'))) return false;
  const r = spawnSync(exe(bin, 'pg_ctl'), ['stop', '-D', data, '-m', 'fast', '-w', '-t', '30'], { stdio: 'ignore' });
  return r.status === 0;
}

export function localPostgresStatus() {
  const bin = binDir();
  const { data } = paths();
  if (!bin || !existsSync(join(data, 'PG_VERSION'))) return 'not installed';
  const r = spawnSync(exe(bin, 'pg_ctl'), ['status', '-D', data], { stdio: 'ignore' });
  return r.status === 0 ? 'running' : 'stopped';
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'start') {
      const r = await startLocalPostgres();
      console.log(r.started ? 'Local PostgreSQL is running (stop it with: pnpm db:local stop).' : 'Nothing to do.');
    } else if (cmd === 'stop') {
      console.log(stopLocalPostgres() ? 'Local PostgreSQL stopped.' : 'No local PostgreSQL was running.');
    } else if (cmd === 'status') {
      console.log(`Local PostgreSQL: ${localPostgresStatus()}`);
    } else {
      console.error('Usage: node scripts/local-postgres.mjs <start|stop|status>');
      process.exit(2);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
