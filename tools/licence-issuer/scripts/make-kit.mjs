#!/usr/bin/env node
// Assembles licence-issuer-kit/ (gitignored) at the repo root: a folder to copy by USB to BluxTech's offline Windows PC.
//   node.exe (Node.js 22.23.2, checksum-verified)   cli.mjs (the issuer, every dependency bundled)
//   licence-issuer.cmd   README.txt   NODE-LICENSE.txt   KIT-INFO.txt
//
//   node tools/licence-issuer/scripts/make-kit.mjs [--cache <dir>]      (also: pnpm issuer:kit)
//
// Then proves the kit is self-contained: a copy OUTSIDE the repository (so nothing can resolve from its node_modules)
// runs keygen → codes → issue → transfer → inspect with its own node.exe. Holds no key: keys are made on the offline PC.
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_VERSION = '22.23.2'; // the version every VictorFlow build and test runs on
const here = path.dirname(fileURLToPath(import.meta.url));
const tool = path.resolve(here, '..');
const root = path.resolve(tool, '..', '..');
const kit = path.join(root, 'licence-issuer-kit');
const args = process.argv.slice(2);
const cache = args.includes('--cache') ? path.resolve(args[args.indexOf('--cache') + 1]) : path.join(root, '.local', 'licence-issuer-kit-cache');

const log = (msg) => console.log(`[issuer-kit] ${msg}`);
const fail = (msg) => {
  console.error(`[issuer-kit] FAILED: ${msg}`);
  process.exit(1);
};
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const crlf = (text) => text.replace(/\r?\n/g, '\r\n');

if (process.platform !== 'win32') fail('the kit carries the Windows node.exe and is assembled and checked on Windows');

// ── 1. the issuer, one bundled file ─────────────────────────────────────────────────────────────────────────────
log('building @victorflow/licence-issuer (and the packages it bundles) …');
execSync('pnpm turbo run build --filter=@victorflow/licence-issuer', { cwd: root, stdio: 'inherit' });
const bundle = path.join(tool, 'dist', 'licence-issuer.mjs');
if (!existsSync(bundle)) fail(`${bundle} was not built`);

// Self-contained = it imports nothing but Node's own modules. (Checked on the text: a stray bare import would only fail
// on the offline PC, where there is no node_modules to find it in.)
const code = readFileSync(bundle, 'utf8');
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const specifiers = [...code.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);
const foreign = [...new Set(specifiers.filter((s) => !builtins.has(s)))];
if (foreign.length) fail(`the bundle still imports ${foreign.join(', ')}: it would not run without node_modules`);
log(`bundle: ${(code.length / 1024).toFixed(0)} KB, imports only Node built-ins (${new Set(specifiers).size} distinct)`);

// ── 2. Node.js, verified against nodejs.org's SHASUMS256.txt ────────────────────────────────────────────────────
async function download(url, file) {
  if (existsSync(file)) return file;
  log(`downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) fail(`${url} → HTTP ${res.status}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}
const name = `node-v${NODE_VERSION}-win-x64`;
const zip = await download(`https://nodejs.org/dist/v${NODE_VERSION}/${name}.zip`, path.join(cache, `${name}.zip`));
const sums = await (await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`)).text();
const expected = sums.split('\n').find((l) => l.endsWith(`  ${name}.zip`))?.split(/\s+/)[0];
if (!expected || expected !== sha256(zip)) fail(`${name}.zip does not match nodejs.org's SHASUMS256.txt (delete ${zip} and run again)`);
const extract = path.join(cache, name);
if (!existsSync(path.join(extract, name, 'node.exe'))) {
  mkdirSync(extract, { recursive: true });
  // Windows' own bsdtar reads zip files (Git's tar on PATH would not).
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  if (spawnSync(tar, ['-xf', zip, '-C', extract], { stdio: 'inherit' }).status !== 0) fail('could not extract the Node.js zip');
}
log(`Node.js ${NODE_VERSION} (sha256 of the zip verified)`);

// ── 3. the folder ───────────────────────────────────────────────────────────────────────────────────────────────
rmSync(kit, { recursive: true, force: true });
mkdirSync(kit, { recursive: true });
copyFileSync(path.join(extract, name, 'node.exe'), path.join(kit, 'node.exe'));
writeFileSync(path.join(kit, 'NODE-LICENSE.txt'), crlf(readFileSync(path.join(extract, name, 'LICENSE'), 'utf8')));
copyFileSync(bundle, path.join(kit, 'cli.mjs'));
writeFileSync(path.join(kit, 'licence-issuer.cmd'), crlf('@echo off\n"%~dp0node.exe" "%~dp0cli.mjs" %*\nexit /b %ERRORLEVEL%\n'));
writeFileSync(path.join(kit, 'README.txt'), crlf(readFileSync(path.join(tool, 'kit', 'README.txt'), 'utf8')));
const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '?';
  }
};
const dirty = git('status --porcelain -- tools/licence-issuer packages/crypto packages/types') ? ' (with uncommitted changes in the issuer or its packages)' : '';
writeFileSync(
  path.join(kit, 'KIT-INFO.txt'),
  crlf(
    [
      `VictorFlow licence issuer kit, made ${new Date().toISOString()}`,
      `from commit ${git('rev-parse HEAD')} (branch ${git('rev-parse --abbrev-ref HEAD')})${dirty}`,
      `Node.js ${NODE_VERSION} for Windows x64`,
      '',
      'SHA-256 (check on the offline PC: certutil -hashfile <file> SHA256)',
      `  cli.mjs   ${sha256(path.join(kit, 'cli.mjs'))}`,
      `  node.exe  ${sha256(path.join(kit, 'node.exe'))}`,
      '',
    ].join('\n'),
  ),
);

// ── 4. prove it: a copy outside the repository, its own node.exe, a full cycle ──────────────────────────────────
const tmp = mkdtempSync(path.join(os.tmpdir(), 'vf-issuer-kit-check-'));
try {
  const copy = path.join(tmp, 'kit');
  cpSync(kit, copy, { recursive: true });
  const data = path.join(tmp, 'data');
  const run = (...a) => {
    const r = spawnSync(path.join(copy, 'node.exe'), [path.join(copy, 'cli.mjs'), ...a], { cwd: tmp, encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } });
    if (r.status !== 0) fail(`kit check: "${a[0]}" exited ${r.status}\n${r.stdout}${r.stderr}`);
    return r.stdout;
  };
  const cmd = spawnSync('cmd.exe', ['/d', '/c', path.join(copy, 'licence-issuer.cmd'), 'help'], { cwd: tmp, encoding: 'utf8' });
  if (cmd.status !== 0 || !cmd.stdout.includes('keygen')) fail(`kit check: licence-issuer.cmd help failed\n${cmd.stdout}${cmd.stderr}`);
  if (!run('help').includes('transfer')) fail('kit check: help does not list the commands');
  run('keygen', '--out', path.join(data, 'keys'));
  const ledger = path.join(data, 'ledger.json');
  const activation = run('codes', '--ledger', ledger, '--shop', 'Kit check').trim();
  // request codes as a shop's server would make them, for two "servers"
  const types = await import(new URL(`file:///${path.join(root, 'packages', 'types', 'dist', 'index.mjs').replace(/\\/g, '/')}`).href);
  const request = (hw) => types.encodeRequestCode({ activationCode: activation, hardwareId: hw });
  const key = path.join(data, 'keys', 'licence-private-key.pem');
  run('issue', '--key', key, '--ledger', ledger, '--request', request('a'.repeat(64)), '--modules', 'crm,sales', '--desktop-seats', '2', '--mobile-users', '1', '--updates-until', '2099-12-31');
  run('transfer', '--key', key, '--ledger', ledger, '--request', request('b'.repeat(64)));
  const issued = readdirSync(path.join(data, 'licences')).filter((f) => f.endsWith('.vfl'));
  if (issued.length !== 2) fail(`kit check: expected 2 licences, found ${issued.length}`);
  for (const f of issued) {
    if (!run('inspect', path.join(data, 'licences', f), '--public-key', path.join(data, 'keys', 'licence-public-key.pem')).includes('signature: VALID')) fail(`kit check: ${f} does not verify`);
  }
  log('kit check passed: help, keygen, codes, issue, transfer and inspect ran from a copy outside the repository with the bundled node.exe');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

for (const f of readdirSync(kit)) if (/\.pem$|ledger|\.vfl$/i.test(f)) fail(`the kit must not contain ${f}`);
log(`done: ${kit}`);
for (const f of readdirSync(kit)) log(`  ${f}`);
