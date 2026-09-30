#!/usr/bin/env node
// One-command local bring-up:
//   infra (Docker, or a local PostgreSQL when Docker is missing) → build packages → migrate → seed → turbo dev
//
//   SKIP_DOCKER=1   you already run Postgres/Redis yourself (DATABASE_URL / REDIS_URL from .env)
//   LOCAL_DB=1      force the Docker-free local PostgreSQL even if Docker is installed (also: --local-db)
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPortOwner, startLocalPostgres, stopLocalPostgres } from './local-postgres.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const composeFile = join(root, 'infrastructure', 'docker', 'docker-compose.yml');

const log = (msg) => console.log(`\n\x1b[36m[dev-up]\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\n\x1b[31m[dev-up] ${msg}\x1b[0m`);
  process.exit(1);
};

// `pnpm` / `docker` are .cmd shims on Windows, which only resolve through a shell. But Node's DEP0190
// deprecates passing an `args` array together with `shell: true` (it naively space-joins them, which can
// misquote) — so on Windows we fold cmd+args into ONE already-quoted string and hand that whole string to
// the shell, exactly as Node's own deprecation notice recommends. Non-Windows needs no shell at all.
const winQuote = (s) => (/[\s"^&|<>()]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const shellCmd = (cmd, args) => [cmd, ...args].map(winQuote).join(' ');

function run(cmd, args, opts = {}) {
  const res = isWin
    ? spawnSync(shellCmd(cmd, args), { cwd: root, stdio: 'inherit', shell: true, ...opts })
    : spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
  if (res.status !== 0) fail(`"${cmd} ${args.join(' ')}" failed (exit ${res.status}).`);
}

function capture(cmd, args) {
  const res = isWin
    ? spawnSync(shellCmd(cmd, args), { cwd: root, encoding: 'utf8', shell: true })
    : spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
  return { ok: res.status === 0, out: (res.stdout ?? '').trim() };
}

/** Reads a KEY=value from process.env, else from .env (dev-up doesn't otherwise load .env into the process). */
function envVar(name, fallback) {
  if (process.env[name]) return process.env[name];
  const p = join(root, '.env');
  if (existsSync(p)) {
    const m = new RegExp(`^${name}\\s*=\\s*(.*)$`, 'm').exec(readFileSync(p, 'utf8'));
    if (m) return m[1].trim();
  }
  return fallback;
}

/** Fails with a named process instead of letting `docker compose up` die with a bare "bind: permission denied". */
function checkPortFree(port, label, envKey) {
  const owner = findPortOwner(port);
  if (!owner) return;
  fail(
    `Port ${port} (needed for ${label}) is already used by ${owner.name} (PID ${owner.pid}).\n` +
      `  Either stop it, or edit .env: set ${envKey} to a free port (and update DATABASE_URL/REDIS_URL to match), then re-run.`,
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. .env ---------------------------------------------------------------------
if (!existsSync(join(root, '.env'))) {
  log('No .env found — copying .env.example');
  copyFileSync(join(root, '.env.example'), join(root, '.env'));
}
mkdirSync(join(root, 'storage'), { recursive: true });
if (!existsSync(join(root, 'storage', '.gitkeep'))) writeFileSync(join(root, 'storage', '.gitkeep'), '');

// 2. Infra --------------------------------------------------------------------
let localPgStarted = false;
const forceLocal = process.env.LOCAL_DB === '1' || process.argv.includes('--local-db');
const dockerReady = capture('docker', ['--version']).ok && capture('docker', ['info']).ok; // installed AND the daemon is up

if (process.env.SKIP_DOCKER === '1') {
  log('SKIP_DOCKER=1 — assuming Postgres and Redis are already reachable.');
} else if (forceLocal || !dockerReady) {
  if (!forceLocal) log('Docker is not available (not installed, or Docker Desktop is not running) — using a local PostgreSQL 16 instead.');
  try {
    const r = await startLocalPostgres({ log: (m) => log(m) });
    localPgStarted = r.started;
  } catch (e) {
    fail(`${e instanceof Error ? e.message : e}\n\nAlternatives: install Docker Desktop and re-run, or install PostgreSQL 16 yourself and run with SKIP_DOCKER=1.`);
  }
  // The Docker-free path has no Redis. The API runs fine without it: rate limiting and the hourly audit check are simply off.
  process.env.REDIS_ENABLED = 'false';
  log('Redis is not started in this mode (REDIS_ENABLED=false): login rate limiting and the scheduled audit check are off.');
} else {
  // Only a container that ISN'T already ours needs the port free — re-running dev:up against an already-up
  // stack must stay a harmless no-op, not a false "port taken" failure against our own running container.
  const isRunning = (name) => capture('docker', ['inspect', '--format', '{{.State.Running}}', name]).out === 'true';
  for (const [container, port, label, envKey] of [
    ['victorflow-postgres', Number(envVar('POSTGRES_PORT', '5433')), 'PostgreSQL', 'POSTGRES_PORT'],
    ['victorflow-redis', Number(envVar('REDIS_PORT', '6379')), 'Redis', 'REDIS_PORT'],
  ]) {
    if (!isRunning(container)) checkPortFree(port, label, envKey);
  }

  const envArgs = existsSync(join(root, '.env')) ? ['--env-file', join(root, '.env')] : [];
  log('Starting Postgres 16 + Redis 7 …');
  run('docker', ['compose', '-f', composeFile, ...envArgs, 'up', '-d']);

  log('Waiting for healthchecks …');
  const containers = ['victorflow-postgres', 'victorflow-redis'];
  const deadline = Date.now() + 120_000;
  for (const name of containers) {
    for (;;) {
      const { out } = capture('docker', ['inspect', '--format', '{{.State.Health.Status}}', name]);
      if (out === 'healthy') break;
      if (Date.now() > deadline) fail(`${name} did not become healthy in time (last status: "${out}").`);
      await sleep(1500);
    }
    log(`${name} is healthy`);
  }
}

// Stop the local PostgreSQL we started when dev-up ends (a pre-existing one is left alone).
process.on('exit', () => {
  if (localPgStarted) stopLocalPostgres();
});

// 3. Build shared packages, migrate, seed --------------------------------------
log('Building shared packages …');
run('pnpm', ['turbo', 'run', 'build', '--filter=./packages/*']);
log('Applying migrations …');
run('pnpm', ['db:migrate']);
log('Seeding demo data …');
run('pnpm', ['db:seed']);

// 4. Apps ---------------------------------------------------------------------
log('Starting server + desktop + tracker (Ctrl+C to stop). Mobile: see README → `pnpm --filter @victorflow/mobile start`.');
console.log('\n  Desktop  http://localhost:1420   (admin@victorflow.local / Admin123!)\n  API      http://localhost:3000/api/v1\n  Tracker  http://localhost:3001\n');
const dev = isWin
  ? spawn(shellCmd('pnpm', ['dev']), { cwd: root, stdio: 'inherit', shell: true, env: process.env })
  : spawn('pnpm', ['dev'], { cwd: root, stdio: 'inherit', env: process.env });
dev.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    dev.kill(sig);
    setTimeout(() => process.exit(0), 3000).unref(); // the 'exit' handler then stops the local database
  });
}
