// `vf-server run <component>`: what each Windows service executes (api, tracker, display), plus `run postgres` for
// running everything in terminals without services (development and testing). Each runs in the foreground until stopped.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { prepareDatabase } from './db';
import { apiEnv, displayEnv, trackerEnv } from './env';
import { VfError } from './errors';
import { dataLayout, type ProgramLayout } from './layout';
import { loadConfig, loadSecrets } from './store';

const requireHere = createRequire(import.meta.url);
const say = (line: string) => console.log(`[vf-server] ${line}`);

/** The API, in this very process (so stopping the service stops the API, with no orphan child). */
export async function runApi(layout: ProgramLayout, dataDir: string): Promise<void> {
  const data = dataLayout(dataDir);
  const config = loadConfig(data.config);
  const secrets = loadSecrets(data.secrets);
  mkdirSync(data.storage, { recursive: true });
  // Waits for PostgreSQL (up to 60 s), then migrates and writes the reference data; a failure exits non-zero and the
  // service restarts it.
  await prepareDatabase(layout, config, secrets, say);
  // VF_NODE_ENV=development is for running from the repository against a development licence key only.
  Object.assign(process.env, apiEnv(config, secrets, data, process.env.VF_NODE_ENV || 'production'));
  process.chdir(layout.serverDir);
  say(`starting the API on port ${config.apiPort}`);
  requireHere(path.join(layout.serverDir, 'dist', 'main.js'));
}

/** The tracker or the displays: a Next.js standalone server.js in this process, or `next start` from the repo. */
export function runWeb(layout: ProgramLayout, component: 'tracker' | 'display', dataDir: string): void {
  const config = loadConfig(dataLayout(dataDir).config);
  const env = component === 'tracker' ? trackerEnv(config) : displayEnv(config);
  Object.assign(process.env, env);
  const app = layout[component];
  if (app.entry) {
    if (!existsSync(app.entry)) throw new VfError('LAYOUT', `${app.entry} is missing — reinstall VictorFlow Server`);
    say(`starting the ${component} on port ${env.PORT}`);
    requireHere(app.entry); // standalone server.js changes into its own folder and reads PORT/HOSTNAME
    return;
  }
  // Repo without a standalone build: the regular `next build` output, served by `next start`.
  const nextBin = createRequire(path.join(app.dir, 'package.json')).resolve('next/dist/bin/next');
  say(`starting the ${component} on port ${env.PORT} (next start)`);
  const child = spawn(process.execPath, [nextBin, 'start', '-p', env.PORT, '-H', env.HOSTNAME], { cwd: app.dir, stdio: 'inherit', env: process.env });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));
}

/** PostgreSQL in the foreground (testing without services). Its port and address come from victorflow.conf. */
export function runPostgres(layout: ProgramLayout, dataDir: string): void {
  const data = dataLayout(dataDir);
  if (!existsSync(path.join(data.postgres, 'PG_VERSION'))) throw new VfError('CONFIG', `${data.postgres} has no database cluster — run "vf-server setup --no-services" first`);
  const postgres = path.join(layout.pgBin, process.platform === 'win32' ? 'postgres.exe' : 'postgres');
  say(`starting PostgreSQL from ${data.postgres}`);
  const child = spawn(postgres, ['-D', data.postgres], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));
}
