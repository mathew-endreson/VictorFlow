// Where things are. Two kinds of program layout, one data layout:
//   installed — the folder the server installer fills (vf-server.mjs sits next to node\, pg\, server\ …)
//   repo      — this monorepo checkout, for development and testing (no services can be registered from it)
// and ONE data folder that holds everything that changes: config, secrets, the database, files and logs.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { VfError } from './errors';

export interface WebApp {
  /** Folder of the app (the standalone build, or the app's source folder in the repo). */
  dir: string;
  /** The Next.js standalone server.js (installed), or null in the repo: there the app runs with `next start`. */
  entry: string | null;
}

export interface ProgramLayout {
  kind: 'installed' | 'repo';
  root: string;
  nodeExe: string;
  /** PostgreSQL 16 bin/ (pg_ctl, initdb, postgres). */
  pgBin: string;
  serverDir: string;
  /** Where `@victorflow/db` (migrations runner, seed) and its `pg` dependency resolve from. */
  dbModuleDir: string;
  migrationsDir: string;
  tracker: WebApp;
  display: WebApp;
  /** WinSW service wrappers (<Id>.exe + <Id>.xml). Installed layout only. */
  servicesDir: string;
  /** This script, as the services must call it. */
  script: string;
}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

export function findRepoRoot(start: string, exists: (p: string) => boolean = existsSync): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (exists(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The PostgreSQL binaries `pnpm dev:up` already downloads (scripts/local-postgres.mjs), for the repo layout. */
function repoPgBin(repo: string): string {
  const scope = path.join(repo, '.local', 'pgtools', 'node_modules', '@embedded-postgres');
  const candidates = existsSync(scope) ? readdirSync(scope) : [];
  const found = candidates.map((d) => path.join(scope, d, 'native', 'bin')).find((b) => existsSync(path.join(b, exe('pg_ctl'))));
  return found ?? path.join(scope, 'windows-x64', 'native', 'bin');
}

// Standalone builds are only made inside the installer's staging (scripts/stage.mjs), never in the checkout.
const repoWebApp = (repo: string, name: 'tracker' | 'display'): WebApp => ({ dir: path.join(repo, 'apps', name), entry: null });

/** `scriptPath` is vf-server.mjs itself: in an install it sits at the root; in the repo it is apps/server-host/dist/. */
export function detectLayout(scriptPath: string, exists: (p: string) => boolean = existsSync): ProgramLayout {
  const here = path.dirname(scriptPath);
  if (exists(path.join(here, 'server', 'dist', 'main.js'))) {
    const app = (name: 'tracker' | 'display'): WebApp => ({ dir: path.join(here, name), entry: path.join(here, name, 'server.js') });
    return {
      kind: 'installed',
      root: here,
      nodeExe: path.join(here, 'node', exe('node')),
      pgBin: path.join(here, 'pg', 'bin'),
      serverDir: path.join(here, 'server'),
      dbModuleDir: path.join(here, 'server', 'node_modules', '@victorflow', 'db'),
      migrationsDir: path.join(here, 'migrations'),
      tracker: app('tracker'),
      display: app('display'),
      servicesDir: path.join(here, 'services'),
      script: scriptPath,
    };
  }
  const repo = findRepoRoot(here, exists);
  if (!repo) throw new VfError('LAYOUT', `vf-server is neither in an installed VictorFlow Server folder nor in the VictorFlow repository (${here})`);
  return {
    kind: 'repo',
    root: repo,
    nodeExe: process.execPath,
    pgBin: repoPgBin(repo),
    serverDir: path.join(repo, 'apps', 'server'),
    dbModuleDir: path.join(repo, 'packages', 'db'),
    migrationsDir: path.join(repo, 'packages', 'db', 'migrations'),
    tracker: repoWebApp(repo, 'tracker'),
    display: repoWebApp(repo, 'display'),
    servicesDir: path.join(repo, 'apps', 'server-host', '.services'),
    script: scriptPath,
  };
}

// ── the data folder ─────────────────────────────────────────────────────────────────────────────────────────────

export interface DataLayout {
  root: string;
  config: string;
  secrets: string;
  postgres: string;
  storage: string;
  logs: string;
  license: string;
  addresses: string;
  firstLogin: string;
  setupLog: string;
}

export function dataLayout(root: string): DataLayout {
  return {
    root,
    config: path.join(root, 'config.json'),
    secrets: path.join(root, 'secrets.json'),
    postgres: path.join(root, 'postgres'),
    storage: path.join(root, 'storage'),
    logs: path.join(root, 'logs'),
    license: path.join(root, 'license.vfl'),
    addresses: path.join(root, 'addresses.ini'),
    firstLogin: path.join(root, 'first-login.txt'),
    setupLog: path.join(root, 'logs', 'setup.log'),
  };
}

/** Written by `setup` into the install folder so the CLI (status, stop, remove …) finds the data folder later. */
export const INSTALL_INFO = 'install.json';

/**
 * Which data folder: --data-dir, then VF_DATA_DIR (every service sets it), then what setup recorded in the install
 * folder, then %ProgramData%\VictorFlow.
 */
export function resolveDataDir(opts: { flag?: string; env?: string; layout: ProgramLayout; programData?: string; read?: (p: string) => string | null }): string {
  if (opts.flag) return path.resolve(opts.flag);
  if (opts.env) return path.resolve(opts.env);
  const read = opts.read ?? ((p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null));
  const info = read(path.join(opts.layout.root, INSTALL_INFO));
  if (info) {
    try {
      const dataDir = (JSON.parse(info) as { dataDir?: unknown }).dataDir;
      if (typeof dataDir === 'string' && dataDir) return dataDir;
    } catch {
      /* unreadable → fall through to the default */
    }
  }
  return path.join(opts.programData ?? process.env.ProgramData ?? 'C:\\ProgramData', 'VictorFlow');
}

/**
 * A data folder must be a local, absolute, plain-ASCII path outside the program folder: PostgreSQL on Windows mishandles
 * non-ASCII paths, a network share cannot hold a live database, and the program folder is replaced on every upgrade.
 * Returns the problem in plain words, or null.
 */
export function dataDirProblem(dir: string, programRoot: string): string | null {
  if (/^\\\\|^\/\//.test(dir)) return 'a network path (\\\\server\\share) cannot hold the database — use a local disk';
  if (!path.win32.isAbsolute(dir) || !/^[a-zA-Z]:[\\/]/.test(dir)) return 'use a full local path such as C:\\ProgramData\\VictorFlow';
  if (!/^[\x20-\x7e]+$/.test(dir)) return 'use a path with only plain letters (no accents or other scripts) — PostgreSQL does not support them here';
  const rel = path.win32.relative(path.win32.resolve(programRoot), path.win32.resolve(dir));
  if (rel === '' || (!rel.startsWith('..') && !path.win32.isAbsolute(rel))) return 'the data folder cannot be inside the program folder (it is replaced on every upgrade)';
  return null;
}
