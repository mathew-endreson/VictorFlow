#!/usr/bin/env node
/**
 * The embedded-backend launcher for the packaged desktop app.
 *
 * Spawned by Rust (src-tauri) as the ONE child process it manages. Everything below happens inside this
 * single Node process: bring up embedded PostgreSQL (init on first run, safely reuse or relocate on every
 * run after), migrate, then spawn the NestJS API as this process's own child and gate readiness on its
 * real /health endpoint. Progress and failures are reported as newline-delimited JSON on stdout — Rust
 * reads each line and forwards it to the webview as a `backend-status` event. Nothing here talks to the
 * webview directly, and nothing in the webview can reach this process directly either.
 *
 * Two resolution modes, so the same code path is exercised in dev/testing and in the real bundle:
 *   - VF_RESOURCES_DIR set  → read-only bundled resources (pg/, node/, server/, migrations/) from there.
 *   - VF_RESOURCES_DIR unset → resolve everything from this monorepo checkout instead (dev/testing).
 * VF_APP_DATA_DIR is always required: it's the one mutable directory (Postgres data, secrets, storage, logs).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const isWin = process.platform === 'win32';
const exe = (name) => (isWin ? `${name}.exe` : name);

function emit(status, extra = {}) {
  process.stdout.write(JSON.stringify({ status, t: new Date().toISOString(), ...extra }) + '\n');
}

class LauncherError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

// ── Resolution: monorepo checkout (dev/testing) vs bundled resources (real installer) ─────────────────
function findRepoRoot(start) {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new LauncherError('DEV_RESOLUTION_FAILED', 'Not inside the monorepo and VF_RESOURCES_DIR is not set');
    dir = parent;
  }
}

function resolvePaths() {
  const appData = process.env.VF_APP_DATA_DIR;
  if (!appData) throw new LauncherError('CONFIG', 'VF_APP_DATA_DIR is required');
  mkdirSync(appData, { recursive: true });

  const resources = process.env.VF_RESOURCES_DIR;
  let pgBin, nodeExe, serverDir, migrationsDir, dbModuleDir;

  if (resources) {
    pgBin = join(resources, 'pg', 'bin');
    nodeExe = join(resources, 'node', exe('node'));
    serverDir = join(resources, 'server');
    migrationsDir = join(resources, 'migrations');
    dbModuleDir = join(serverDir, 'node_modules', '@victorflow', 'db');
  } else {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = findRepoRoot(here);
    // Reuse the SAME embedded-postgres binaries `pnpm dev:up` already downloads — read-only, never the
    // running dev instance's data. Scans like local-postgres.mjs's binDir() so either platform package
    // layout (@embedded-postgres/windows-x64 or turbo-windows-64-style) is found without hardcoding it twice.
    const scope = join(repoRoot, '.local', 'pgtools', 'node_modules', '@embedded-postgres');
    const candidates = existsSync(scope) ? readdirSync(scope) : [];
    const found = candidates.map((d) => join(scope, d, 'native', 'bin')).find((b) => existsSync(join(b, exe('pg_ctl'))));
    if (!found) throw new LauncherError('DEV_RESOLUTION_FAILED', 'No embedded-postgres binaries found under .local/pgtools — run `pnpm dev:up` once first (dev/testing mode only)');
    pgBin = found;
    nodeExe = process.execPath; // dev/testing: reuse whichever node is already running this script
    serverDir = join(repoRoot, 'apps', 'server');
    migrationsDir = join(repoRoot, 'packages', 'db', 'migrations');
    dbModuleDir = join(repoRoot, 'packages', 'db');
  }

  return {
    appData,
    pgData: join(appData, 'postgres-data'),
    pgLog: join(appData, 'postgres.log'),
    storageDir: join(appData, 'storage'),
    secretsFile: join(appData, 'secrets.json'),
    pgBin,
    nodeExe,
    serverDir,
    serverMain: join(serverDir, 'dist', 'main.js'),
    migrationsDir,
    dbModuleDir,
  };
}

// ── Secrets: generated once on first launch, reused after ─────────────────────────────────────────────
function loadOrCreateSecrets(paths) {
  if (existsSync(paths.secretsFile)) return JSON.parse(readFileSync(paths.secretsFile, 'utf8'));
  const secrets = {
    dbPassword: randomBytes(24).toString('base64url'),
    jwtAccessSecret: randomBytes(32).toString('base64url'),
    trackingHmacSecret: randomBytes(32).toString('base64url'),
    pgPort: null, // filled in once a working port is proven; never trusted without re-verification
    apiPort: null,
  };
  writeSecrets(paths, secrets);
  return secrets;
}

function writeSecrets(paths, secrets) {
  writeFileSync(paths.secretsFile, JSON.stringify(secrets, null, 2), { mode: 0o600 });
}

// ── Low-level Postgres helpers (same proof-based checks local-postgres.mjs uses, not port/PID guessing) ─
// `pg` is a real dependency of @victorflow/db (dev: packages/db/node_modules; bundled: server's
// node_modules/@victorflow/db lives alongside its own resolvable node_modules tree) — anchor require()
// there rather than at this script's own location, which declares no dependencies of its own.
let PATHS;
function requirePg() {
  return createRequire(join(PATHS.dbModuleDir, 'package.json'))('pg');
}

async function withAdmin({ port, password }, database, fn) {
  const { Client } = requirePg();
  const client = new Client({ host: '127.0.0.1', port, user: 'victorflow', password, database, connectionTimeoutMillis: 4000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function canConnect(port, password, database = 'victorflow') {
  try {
    await withAdmin({ port, password }, database, (c) => c.query('SELECT 1'));
    return true;
  } catch {
    return false;
  }
}

async function ensureDatabase(port, password) {
  await withAdmin({ port, password }, 'postgres', async (c) => {
    const exists = await c.query("SELECT 1 FROM pg_database WHERE datname = 'victorflow'");
    if (exists.rowCount === 0) await c.query('CREATE DATABASE victorflow');
  });
}

async function pidAlive(pid) {
  if (!pid) return false;
  if (!isWin) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 && new RegExp(`\\b${pid}\\b`).test(r.stdout || '');
}

async function imagePathOf(pid) {
  if (!isWin) return null;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`], { encoding: 'utf8', windowsHide: true });
  return (r.stdout || '').trim() || null;
}

function samePath(a, b) {
  if (!a || !b) return false;
  return resolvePath(a).toLowerCase() === resolvePath(b).toLowerCase();
}

/** Is the process recorded in postmaster.pid actually OUR bundled postgres.exe (not a reused PID)? */
async function isOurPostgres(pid, ourPostgresExe) {
  if (!(await pidAlive(pid))) return false;
  return samePath(await imagePathOf(pid), ourPostgresExe);
}

/**
 * Parse postmaster.pid. Verified against this exact embedded-postgres/Windows build's real output:
 *   line 1 PID · line 2 data dir · line 3 start time (epoch seconds) · line 4 PORT · line 5 socket dir
 *   (empty on Windows) · line 6 listen address · line 7 shared-mem key (empty on Windows) · line 8 status
 * so "first small integer after line 2" correctly lands on line 4 (the epoch timestamp is always >65536).
 * Not load-bearing even if a future Postgres version reshuffles this: a wrong port here just fails the
 * canConnect() proof downstream and falls through to the safe "start fresh" path, never a false positive.
 */
function readPostmasterLock(pgData) {
  const file = join(pgData, 'postmaster.pid');
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').split('\n');
  const pid = Number(lines[0]);
  const port = lines.slice(2).map(Number).find((n) => Number.isInteger(n) && n > 0 && n < 65536);
  return { pid, port: port ?? null };
}

async function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 800 });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('timeout', () => (s.destroy(), resolve(false)));
    s.once('error', () => resolve(false));
  });
}

/** The API is stateless — no data-directory identity question, just "give me a working port." Try the
 * last one that worked (stable across restarts for anyone who bookmarked it), else ask the OS for a free one. */
async function resolveApiPort(secrets) {
  if (secrets.apiPort && !(await portInUse(secrets.apiPort))) return secrets.apiPort;
  return pickFreePort();
}

function pgCtlStart(paths, port, password) {
  mkdirSync(paths.appData, { recursive: true });
  const r = spawnSync(join(paths.pgBin, exe('pg_ctl')), ['start', '-D', paths.pgData, '-l', paths.pgLog, '-w', '-t', '60', '-o', `-p ${port} -c listen_addresses=127.0.0.1`], { stdio: 'ignore', windowsHide: true });
  if (r.status === 0) return { ok: true };
  const tail = existsSync(paths.pgLog) ? readFileSync(paths.pgLog, 'utf8').slice(-4000) : '';
  const addressInUse = /address already in use|could not bind .* socket/i.test(tail);
  return { ok: false, reason: addressInUse ? 'ADDRESS_IN_USE' : 'OTHER', log: tail };
}

function initdb(paths, password) {
  mkdirSync(paths.pgData, { recursive: true });
  const pwfile = join(paths.appData, `.initpw-${process.pid}`);
  writeFileSync(pwfile, password, { mode: 0o600 });
  try {
    const r = spawnSync(join(paths.pgBin, exe('initdb')), [`--pgdata=${paths.pgData}`, '--username=victorflow', `--pwfile=${pwfile}`, '--auth=password', '--encoding=UTF8', '--locale=C'], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new LauncherError('PG_INITDB_FAILED', 'Could not initialize the database', `${r.stdout}\n${r.stderr}`);
  } finally {
    rmSync(pwfile, { force: true });
  }
}

/**
 * The core safety logic: the DATA DIRECTORY is the source of truth for identity, never the port.
 * See conversation record for the full case analysis (A: free port / B: our own live instance /
 * C: a foreign process on the port / D: a genuinely stale lock from an unclean shutdown).
 */
async function resolveInstance(paths, secrets) {
  const lock = readPostmasterLock(paths.pgData);
  const ourPostgresExe = join(paths.pgBin, exe('postgres'));

  if (lock) {
    if (await isOurPostgres(lock.pid, ourPostgresExe)) {
      // Case B: our own previous instance is still alive. Trust the PORT RECORDED IN THE LOCK FILE,
      // not secrets.json's last-known port — the lock file reflects what's actually running right now.
      const port = lock.port ?? secrets.pgPort;
      if (port && (await canConnect(port, secrets.dbPassword))) return { port, started: false };
      // Alive and it's our binary, but our exact credentials don't work against it — don't guess further,
      // fall through to stale-lock handling below rather than trusting an unproven instance.
    }
    // Not alive, or alive-but-unproven above: safe to clear the lock only once we know it's not a live,
    // verified instance of ours. Case D.
    rmSync(join(paths.pgData, 'postmaster.pid'), { force: true });
  }

  // Case A/C: start fresh against the SAME data directory. Only the port may change; the directory never does.
  let port = secrets.pgPort ?? 55432;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = pgCtlStart(paths, port, secrets.dbPassword);
    if (r.ok) break;
    if (r.reason !== 'ADDRESS_IN_USE') throw new LauncherError('PG_START_FAILED', 'PostgreSQL did not start', r.log);
    if (attempt === 1) throw new LauncherError('PG_PORT_EXHAUSTED', `Port ${port} and one fallback port were both unavailable`);
    port = await pickFreePort(); // Case C: something else — never touched — owns the preferred port
  }

  // The only thing that proves readiness, regardless of which branch got here: a real query using OUR
  // generated, install-specific password. A stranger's fresh Postgres on a fallback port can never pass this.
  if (!(await canConnect(port, secrets.dbPassword, 'postgres'))) {
    throw new LauncherError('PG_NOT_READY', 'PostgreSQL started but did not accept our credentials');
  }
  return { port, started: true };
}

// ── Migrations ──────────────────────────────────────────────────────────────────────────────────────
async function runMigrations(paths, databaseUrl) {
  // require(), not import(): dist/index.js is a tsup CJS build with re-exports, and plain CJS require
  // always sees the real module.exports regardless of how well a bundler's re-export shape is statically
  // analyzable for ESM named-export interop.
  const dbModule = createRequire(join(paths.dbModuleDir, 'package.json'))(join(paths.dbModuleDir, 'dist', 'index.js'));
  const db = dbModule.createDb(databaseUrl, { max: 2 });
  try {
    const { applied } = await dbModule.migrateToLatest(db, paths.migrationsDir);
    return applied;
  } finally {
    await db.destroy();
  }
}

// ── The API server: a real child process, gated on its own /health, not on "the process exists" ──────
function spawnApi(paths, env) {
  const child = spawn(paths.nodeExe, [paths.serverMain], { cwd: paths.serverDir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  // Both streams MUST be drained even though we only act on stderr: an unconsumed pipe fills its OS
  // buffer (~64KB on Windows) and then blocks the child's own writes, which would eventually stall the
  // API under normal logging. Appending to launcher.log doubles as the "Export diagnostics" source.
  const logFile = join(paths.appData, 'launcher.log');
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (d) => {
      try {
        appendFileSync(logFile, d);
      } catch {}
    });
  }
  return child;
}

async function waitForHealth(port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let childExited = false;
  let exitInfo = null;
  child.once('exit', (code, signal) => {
    childExited = true;
    exitInfo = { code, signal };
  });

  let stderrTail = '';
  child.stderr.on('data', (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000);
  });

  while (Date.now() < deadline) {
    if (childExited) {
      // Don't wait out the rest of the timeout polling a process that's already gone — surface the
      // real failure immediately instead.
      throw new LauncherError('API_EXITED_EARLY', `API process exited before becoming healthy (code ${exitInfo.code}, signal ${exitInfo.signal})`, stderrTail);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 503) {
        const body = await res.json().catch(() => ({}));
        if (body.status === 'ok' || body.status === 'degraded') return body;
      }
    } catch {
      // not up yet — normal during boot, keep polling
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new LauncherError('API_HEALTH_TIMEOUT', `API did not become healthy within ${timeoutMs}ms`, stderrTail);
}

// ── Orchestration ───────────────────────────────────────────────────────────────────────────────────
let apiChild = null;
let pgPathsForShutdown = null;

async function main() {
  const paths = resolvePaths();
  PATHS = paths;
  const firstRun = !existsSync(join(paths.pgData, 'PG_VERSION'));
  pgPathsForShutdown = paths;

  emit(firstRun ? 'setting-up' : 'starting-db');
  const secrets = loadOrCreateSecrets(paths);

  if (firstRun) initdb(paths, secrets.dbPassword);
  const { port: pgPort, started } = await resolveInstance(paths, secrets);
  await ensureDatabase(pgPort, secrets.dbPassword);
  secrets.pgPort = pgPort;
  writeSecrets(paths, secrets);
  emit('db-ready', { port: pgPort, reusedRunningInstance: !started });

  emit('migrating');
  const databaseUrl = `postgresql://victorflow:${encodeURIComponent(secrets.dbPassword)}@127.0.0.1:${pgPort}/victorflow`;
  const applied = await runMigrations(paths, databaseUrl);
  emit('migrated', { applied });

  const apiPort = await resolveApiPort(secrets);
  mkdirSync(paths.storageDir, { recursive: true });

  emit('starting-api');
  // NODE_ENV stays 'development' for config-validation purposes only: production mode refuses to boot
  // without a real Ed25519 license file (config.ts), and license issuance has no onboarding UI yet
  // (Tier 1/2, not built). Everything else here — generated secrets, embedded DB, real migrations — is
  // exactly what a real production boot would do. Revisit once licensing onboarding exists.
  const env = {
    ...process.env,
    NODE_ENV: process.env.VF_NODE_ENV || 'development',
    PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    REDIS_ENABLED: 'false',
    QUEUE_ENABLED: 'false',
    JWT_ACCESS_SECRET: secrets.jwtAccessSecret,
    TRACKING_HMAC_SECRET: secrets.trackingHmacSecret,
    STORAGE_DIR: paths.storageDir,
    CORS_ORIGINS: 'http://tauri.localhost,tauri://localhost,http://localhost:1420',
    LICENSE_MODE: 'dev',
    LICENSE_ENFORCE: 'false',
  };
  apiChild = spawnApi(paths, env);
  const health = await waitForHealth(apiPort, apiChild, 30_000);

  secrets.apiPort = apiPort;
  writeSecrets(paths, secrets);
  emit('ready', { apiBase: `http://127.0.0.1:${apiPort}/api/v1`, health });
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (apiChild && !apiChild.killed) apiChild.kill();
  } catch {}
  try {
    // -m fast: rolls back in-flight transactions and shuts down cleanly, removing postmaster.pid — this
    // is what keeps the NEXT launch a plain warm start instead of a crash-recovery replay.
    if (pgPathsForShutdown) spawnSync(join(pgPathsForShutdown.pgBin, exe('pg_ctl')), ['stop', '-D', pgPathsForShutdown.pgData, '-m', 'fast', '-w', '-t', '30'], { stdio: 'ignore', windowsHide: true });
  } catch {}
}

// Primary shutdown path: Rust writes a "shutdown" line to our stdin and closes it. This is deliberately
// NOT signal-based — SIGTERM cannot be listened for on Windows (Node's own documented limitation), and a
// spawned-without-console child can't reliably receive a synthesized Ctrl+C either. SIGINT/SIGTERM are
// still registered as a courtesy for POSIX/manual-terminal use, but stdin is what production relies on.
let stdinBuf = '';
process.stdin.on('data', (d) => {
  stdinBuf += d.toString();
  if (stdinBuf.includes('shutdown')) {
    shutdown();
    process.exit(0);
  }
});
process.stdin.on('end', () => {
  shutdown();
  process.exit(0);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (shutdown(), process.exit(0)));
process.on('exit', shutdown);

main().catch((err) => {
  if (err instanceof LauncherError) {
    emit('error', { code: err.code, message: err.message, detail: err.detail });
  } else {
    emit('error', { code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) });
  }
  process.exitCode = 1;
});
