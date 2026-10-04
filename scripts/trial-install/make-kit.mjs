#!/usr/bin/env node
// Assembles trial-kit/ (gitignored) for a two-PC trial install: the latest successful server and desktop installers of
// a branch (downloaded from GitHub Actions with gh), the check scripts and the README. Copy the folder to a USB stick.
//
//   node scripts/trial-install/make-kit.mjs [--branch phase-1]      (also: pnpm trial:kit)
//
// Needs the GitHub CLI, logged in. Installers are never committed: they only ever land in trial-kit/.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const kit = path.join(root, 'trial-kit');
const args = process.argv.slice(2);
const branch = args.includes('--branch') ? args[args.indexOf('--branch') + 1] : 'phase-1';

const PARTS = [
  { folder: '1-server', workflow: 'server-build.yml', artifact: 'victorflow-server-windows-installer', scripts: ['check-server.ps1', 'check-server.cmd', 'check-server-after-uninstall.cmd'] },
  { folder: '2-client', workflow: 'desktop-build.yml', artifact: 'victorflow-desktop-windows-installer', scripts: ['check-client.ps1', 'check-client.cmd'] },
];

/** gh, retried: GitHub's API and artifact downloads time out now and then (seen: "TLS handshake timeout"). */
function gh(...a) {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync('gh', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`[kit] gh ${a[0]} ${a[1]} failed (${String(e.stderr ?? e.message).trim().split('\n').pop()}), retrying…`);
      execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
    }
  }
}
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

rmSync(kit, { recursive: true, force: true });
mkdirSync(kit, { recursive: true });
const info = [`VictorFlow trial kit — assembled ${new Date().toISOString()} from branch ${branch}`, ''];

for (const part of PARTS) {
  const runs = JSON.parse(gh('run', 'list', '--workflow', part.workflow, '--branch', branch, '--status', 'success', '--limit', '1', '--json', 'databaseId,headSha,createdAt,url'));
  if (runs.length === 0) throw new Error(`no successful ${part.workflow} run on ${branch}: start one from the Actions tab first`);
  const run = runs[0];
  const dir = path.join(kit, part.folder);
  mkdirSync(dir, { recursive: true });
  console.log(`[kit] ${part.workflow}: run ${run.databaseId} (${run.headSha.slice(0, 7)}, ${run.createdAt}) → ${part.folder}/`);
  gh('run', 'download', String(run.databaseId), '--name', part.artifact, '--dir', dir);
  const installers = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.exe'));
  if (installers.length !== 1) throw new Error(`${part.artifact}: expected one installer, found ${installers.join(', ') || 'none'}`);
  for (const s of part.scripts) copyFileSync(path.join(here, s), path.join(dir, s));
  const file = path.join(dir, installers[0]);
  info.push(
    `${part.folder}/${installers[0]}`,
    `  size     ${mb(statSync(file).size)}`,
    `  sha256   ${sha256(file)}`,
    `  built by ${part.workflow} run ${run.databaseId}, commit ${run.headSha}, ${run.createdAt}`,
    `  ${run.url}`,
    '',
  );
}

copyFileSync(path.join(here, 'README.md'), path.join(kit, 'README.md'));
writeFileSync(path.join(kit, 'KIT-INFO.txt'), `${info.join('\r\n')}\r\n`);
if (!existsSync(path.join(kit, '1-server', 'check-server.ps1'))) throw new Error('kit incomplete');
console.log(`[kit] ready: ${kit}`);
console.log(info.join('\n'));
