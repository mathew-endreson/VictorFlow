#!/usr/bin/env node
// Assembles everything the VictorFlow Server installer ships, into:
//   <out>/app/     → the program folder ({app}): node\, pg\, server\, tracker\, display\, migrations\, services\,
//                    vf-server.mjs, vf-server.cmd, VERSION, victorflow.ico, THIRD-PARTY.txt
//   <out>/redist/  → vc_redist.x64.exe (the Microsoft C++ runtime PostgreSQL's binaries need)
//
//   node apps/server-host/scripts/stage.mjs [--out <dir>] [--cache <dir>] [--skip-web | --web-only [--apps tracker,display]]
//
// Run after `pnpm install` and a build of the server, server-host and the tracker's packages
// (.github/actions/server-deps). The tracker and the displays are built here, each inside its own `pnpm deploy` copy.
// --skip-web leaves out the tracker and displays.
// --web-only builds, stages and starts only the web apps: the check verify.yml runs on every push (no downloads).
import { execSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_VERSION = '22.23.2'; // the version every VictorFlow build and test runs on (README: Node 24 crashes Jest on Windows)
const PG_PACKAGE = 'embedded-postgres@16.14.0-beta.17'; // PostgreSQL 16, the same binaries `pnpm dev:up` uses
const WINSW = {
  url: 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe',
  sha256: 'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f',
  license: 'https://raw.githubusercontent.com/winsw/winsw/v2.12.0/LICENSE.txt',
};
const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
const SERVICES = ['VictorFlowApi', 'VictorFlowTracker', 'VictorFlowDisplay'];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : fallback;
};
const out = opt('--out', path.join(root, 'apps', 'server-host', '.stage'));
const cache = opt('--cache', path.join(root, 'apps', 'server-host', '.stage-cache'));
const skipWeb = args.includes('--skip-web');
const webOnly = args.includes('--web-only');
const appsArg = args.indexOf('--apps');
const webApps = appsArg >= 0 && args[appsArg + 1] ? args[appsArg + 1].split(',') : ['tracker', 'display'];
const app = path.join(out, 'app');
const isWin = process.platform === 'win32';

const log = (msg) => console.log(`[stage] ${msg}`);
const fail = (msg) => {
  console.error(`[stage] FAILED: ${msg}`);
  process.exit(1);
};
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sh = (command, opts = {}) => execSync(command, { stdio: 'inherit', cwd: root, ...opts });

async function download(url, file) {
  if (existsSync(file)) return file;
  log(`downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) fail(`${url} → HTTP ${res.status}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// ── Node.js runtime: node.exe only (npm and corepack are not needed to run anything) ─────────────────────────────
async function stageNode() {
  const name = `node-v${NODE_VERSION}-win-x64`;
  const zip = await download(`https://nodejs.org/dist/v${NODE_VERSION}/${name}.zip`, path.join(cache, `${name}.zip`));
  const sums = await (await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`)).text();
  const expected = sums.split('\n').find((l) => l.endsWith(`  ${name}.zip`))?.split(/\s+/)[0];
  if (!expected || expected !== sha256(zip)) fail(`${name}.zip does not match nodejs.org's SHASUMS256.txt`);
  const extract = path.join(cache, name);
  if (!existsSync(path.join(extract, name, 'node.exe'))) {
    mkdirSync(extract, { recursive: true });
    // Windows' own bsdtar reads zip files (Git's tar on PATH would not).
    const tar = isWin ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const r = spawnSync(tar, ['-xf', zip, '-C', extract], { stdio: 'inherit' });
    if (r.status !== 0) fail('could not extract the Node.js zip');
  }
  mkdirSync(path.join(app, 'node'), { recursive: true });
  for (const f of ['node.exe', 'LICENSE']) copyFileSync(path.join(extract, name, f), path.join(app, 'node', f));
  log(`Node.js ${NODE_VERSION} (sha256 verified)`);
}

// ── PostgreSQL 16: the whole native/ folder (initdb needs share/ and lib/ beside bin/) ───────────────────────────
function stagePostgres() {
  const tools = path.join(cache, 'pgtools');
  mkdirSync(tools, { recursive: true });
  if (!existsSync(path.join(tools, 'package.json'))) writeFileSync(path.join(tools, 'package.json'), '{"name":"vf-pgtools","private":true}\n');
  const scope = path.join(tools, 'node_modules', '@embedded-postgres');
  if (!existsSync(scope)) sh(`npm install ${PG_PACKAGE} --no-audit --no-fund --loglevel=error`, { cwd: tools });
  const native = readdirSync(scope).map((d) => path.join(scope, d, 'native')).find((d) => existsSync(path.join(d, 'bin', isWin ? 'pg_ctl.exe' : 'pg_ctl')));
  if (!native) fail('embedded-postgres native/ folder not found');
  cpSync(native, path.join(app, 'pg'), { recursive: true });
  log(`PostgreSQL from ${PG_PACKAGE}`);
}

// ── WinSW: one copy per service, named after it (WinSW reads <name>.xml beside <name>.exe) ───────────────────────
async function stageWinsw() {
  const exe = await download(WINSW.url, path.join(cache, 'WinSW.NET461.exe'));
  if (sha256(exe) !== WINSW.sha256) fail('WinSW.NET461.exe does not match its pinned SHA-256');
  mkdirSync(path.join(app, 'services'), { recursive: true });
  for (const id of SERVICES) copyFileSync(exe, path.join(app, 'services', `${id}.exe`));
  copyFileSync(await download(WINSW.license, path.join(cache, 'WinSW-LICENSE.txt')), path.join(app, 'services', 'WinSW-LICENSE.txt'));
  log('WinSW 2.12.0 (sha256 verified)');
}

// ── Microsoft Visual C++ runtime, verified by its Microsoft signature (the aka.ms link always serves the latest) ──
async function stageVcRedist() {
  const exe = await download(VC_REDIST_URL, path.join(cache, 'vc_redist.x64.exe'));
  if (isWin) {
    const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$s = Get-AuthenticodeSignature -FilePath '${exe.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`], { encoding: 'utf8' });
    const [status, subject = ''] = (ps.stdout ?? '').trim().split('|');
    if (status !== 'Valid' || !/O=Microsoft Corporation/.test(subject)) fail(`vc_redist.x64.exe is not validly signed by Microsoft (${status} ${subject})`);
  }
  mkdirSync(path.join(out, 'redist'), { recursive: true });
  copyFileSync(exe, path.join(out, 'redist', 'vc_redist.x64.exe'));
  log('Microsoft Visual C++ runtime (signature verified)');
}

// ── The API: a self-contained `pnpm deploy` with a flat node_modules (no symlinks for the installer to mangle) ───
function stageServer() {
  const target = path.join(app, 'server');
  // --legacy: deploy without requiring inject-workspace-packages repo-wide. Hoisted: a plain node_modules tree.
  sh(`pnpm --filter @victorflow/server deploy --legacy --prod "${target}"`, { env: { ...process.env, npm_config_node_linker: 'hoisted' } });
  cpSync(path.join(root, 'packages', 'db', 'migrations'), path.join(app, 'migrations'), { recursive: true, filter: (src) => statSync(src).isDirectory() || src.endsWith('.sql') });
  log('API (pnpm deploy) and migrations');
}

// ── Tracker and displays: Next.js standalone servers, each built in its own self-contained copy ──────────────────
// Not in the workspace itself: pnpm's links cannot go into the installer, and a flat install of the whole workspace
// mixes the mobile app's react 19.2.3 with everyone else's 19.3.0 (two Reacts, "reading 'useRef'" of null). A
// `pnpm deploy` copy has a flat node_modules with only this app's dependencies, so its standalone build has real
// files and exactly one React (checkSingleReact proves it).
function stageWeb(name) {
  const work = path.join(cache, 'web-build', name);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(path.dirname(work), { recursive: true });
  // With devDependencies (TypeScript, types) because the copy is built; the standalone output keeps only what runs.
  sh(`pnpm --filter @victorflow/${name} deploy --legacy "${work}"`, { env: { ...process.env, npm_config_node_linker: 'hoisted' } });
  const env = { ...process.env, VF_NEXT_STANDALONE: '1', NEXT_TELEMETRY_DISABLED: '1' };
  delete env.NEXT_DIST_DIR;
  sh(`node "${path.join(work, 'node_modules', 'next', 'dist', 'bin', 'next')}" build`, { cwd: work, env });
  const target = path.join(app, name);
  cpSync(path.join(work, '.next', 'standalone'), target, { recursive: true, dereference: true });
  // A standalone build leaves out the static assets and public/ on purpose: they go beside server.js.
  cpSync(path.join(work, '.next', 'static'), path.join(target, '.next', 'static'), { recursive: true });
  if (existsSync(path.join(work, 'public'))) cpSync(path.join(work, 'public'), path.join(target, 'public'), { recursive: true });
  log(`${name} (Next.js standalone, built in ${work})`);
}

/** Starts a staged web app on a free port and expects its home page — proves the copied tree resolves its modules. */
async function smokeWeb(name) {
  // Read the port while the probe is still listening: address() is null once the socket is closed.
  const port = await new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port: free } = s.address();
      s.close(() => resolve(free));
    });
  });
  const entry = path.join(app, name, 'server.js');
  const child = spawn(process.execPath, [entry], { env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production', NODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  try {
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
        if (res.status === 200) return log(`${name}: the staged server answers`);
      } catch {
        /* still starting */
      }
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    fail(`${name}: the staged server did not answer\n${output}`);
  } finally {
    child.kill();
  }
}

function stageHost() {
  const bundle = path.join(root, 'apps', 'server-host', 'dist', 'vf-server.mjs');
  if (!existsSync(bundle)) fail('apps/server-host/dist/vf-server.mjs is missing — run "pnpm build" first');
  copyFileSync(bundle, path.join(app, 'vf-server.mjs'));
  copyFileSync(path.join(root, 'apps', 'server-host', 'installer', 'vf-server.cmd'), path.join(app, 'vf-server.cmd'));
  copyFileSync(path.join(root, 'apps', 'server-host', 'installer', 'THIRD-PARTY.txt'), path.join(app, 'THIRD-PARTY.txt'));
  copyFileSync(path.join(root, 'apps', 'desktop', 'src-tauri', 'icons', 'icon.ico'), path.join(app, 'victorflow.ico'));
  writeFileSync(path.join(app, 'VERSION'), `${JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version}\n`);
}

function findLinks(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) found.push(p);
    else if (st.isDirectory()) findLinks(p, found);
  }
  return found;
}

/**
 * One React per web app. A second copy (e.g. react 19.2.3 from the mobile app's Expo tree next to react-dom 19.3.0, which a
 * flat install of the whole workspace produces) leaves hooks without a dispatcher: "Cannot read properties of null
 * (reading 'useRef')" at build time or, worse, only at runtime.
 */
function checkSingleReact(name) {
  const versions = { react: new Set(), 'react-dom': new Set() };
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const p = path.join(dir, entry.name);
      if (path.basename(dir) === 'node_modules' && entry.name in versions && existsSync(path.join(p, 'package.json'))) {
        versions[entry.name].add(JSON.parse(readFileSync(path.join(p, 'package.json'), 'utf8')).version);
      }
      walk(p);
    }
  };
  walk(path.join(app, name));
  const found = Object.entries(versions).map(([pkg, set]) => `${pkg} ${[...set].join(' + ') || 'none'}`).join(', ');
  const all = new Set([...versions.react, ...versions['react-dom']]);
  if (versions.react.size !== 1 || versions['react-dom'].size !== 1 || all.size !== 1) fail(`${name}: expected exactly one React, found ${found}`);
  log(`${name}: one React (${[...all][0]})`);
}

function verify() {
  const expected = webOnly ? [] : [
    'app/node/node.exe',
    'app/pg/bin/pg_ctl.exe',
    'app/pg/bin/initdb.exe',
    'app/pg/bin/postgres.exe',
    'app/pg/share/postgres.bki', // initdb's bootstrap catalog: missing it once broke a real install
    'app/server/dist/main.js',
    'app/server/node_modules/@victorflow/db/dist/index.js',
    'app/server/node_modules/pg/package.json',
    'app/server/node_modules/argon2/package.json',
    'app/migrations/0001_core.sql',
    ...SERVICES.map((id) => `app/services/${id}.exe`),
    'app/vf-server.mjs',
    'app/vf-server.cmd',
    'app/VERSION',
    'app/victorflow.ico',
    'redist/vc_redist.x64.exe',
  ];
  if (!skipWeb) for (const name of webApps) expected.push(`app/${name}/server.js`, `app/${name}/.next/static`);
  const missing = expected.filter((f) => !existsSync(path.join(out, f)));
  if (missing.length) fail(`incomplete, missing:\n  ${missing.join('\n  ')}`);
  const links = findLinks(app);
  if (links.length) fail(`symlinks left in the payload (the installer cannot carry them):\n  ${links.slice(0, 10).join('\n  ')}`);
  log(`verified ${expected.length} required files, no symlinks`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
log(`staging into ${out}`);
if (!webOnly) {
  await stageNode();
  stagePostgres();
  await stageWinsw();
  await stageVcRedist();
  stageServer();
}
if (!skipWeb) for (const name of webApps) stageWeb(name);
if (!webOnly) stageHost();
verify();
if (!skipWeb) {
  for (const name of webApps) checkSingleReact(name);
  for (const name of webApps) await smokeWeb(name);
}
log('done');
