// `vf-server setup`: makes this machine the shop's VictorFlow server, or brings an existing one up to date after an
// upgrade. Idempotent: run it again at any time (after editing config.json, for example). Order matters:
//   data folder (locked down once) → config + secrets → PostgreSQL cluster (once) → PostgreSQL service → database
//   (migrate + seed) → API / tracker / display services → firewall → health → addresses.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addressesFor, addressesIni, addressesText, firstLoginText, type Addresses } from './addresses';
import { VfError } from './errors';
import type { Host } from './host';
import { dataDirProblem, dataLayout, INSTALL_INFO, type DataLayout, type ProgramLayout } from './layout';
import { firewallRules, NODE_SERVICES, portOf, serviceExe, serviceXml, START_ORDER, STOP_ORDER, winswXml } from './services';
import { loadOrCreateConfig, loadOrCreateSecrets, type Secrets, type ServerConfig } from './store';
import {
  icaclsGrantFull,
  icaclsGrantUsersRead,
  icaclsLockDown,
  icaclsRemoveGrant,
  initdbArgs,
  managedPgConf,
  netshAddRule,
  parseWhoamiSid,
  PG_SERVICE,
  pgRegisterArgs,
  powershellArgs,
  psRemoveFirewallRules,
  psStartServices,
  psStopServices,
  SC_NOT_INSTALLED,
  scFailureRestart,
  scQuery,
  scSetAccount,
  withPgInclude,
} from './windows';

export interface SetupOptions {
  layout: ProgramLayout;
  dataDir: string;
  /** false (--no-services): prepare the data folder and the database cluster only — for running from the repo. */
  services: boolean;
}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

function must(host: Host, code: VfError['code'], what: string, cmd: string, args: string[]) {
  const r = host.run(cmd, args);
  if (r.status !== 0) throw new VfError(code, what, `${cmd} ${args.join(' ')} → exit ${r.status}\n${r.stdout}${r.stderr}`.trim());
  return r;
}
const powershell = (host: Host, code: VfError['code'], what: string, command: string) => must(host, code, what, 'powershell.exe', powershellArgs(command));
export const serviceInstalled = (host: Host, id: string) => host.run('sc.exe', scQuery(id)).status !== SC_NOT_INSTALLED;
export const stopServices = (host: Host) => powershell(host, 'SERVICE', 'The running VictorFlow services could not be stopped', psStopServices(STOP_ORDER));
export const startServices = (host: Host, ids: readonly string[] = START_ORDER) => powershell(host, 'SERVICE', `Could not start ${ids.join(', ')}`, psStartServices(ids));

async function checkPorts(config: ServerConfig, host: Host, data: DataLayout) {
  const wanted: Array<[string, number]> = [['apiPort', config.apiPort], ['trackerPort', config.trackerPort], ['displayPort', config.displayPort], ['pgPort', config.pgPort]];
  for (const [key, port] of wanted) {
    if (await host.portFree(port)) continue;
    const owner = host.portOwner(port) ?? 'another program';
    throw new VfError('PORT_IN_USE', `Port ${port} (${key}) is already used by ${owner}. Stop that program, or choose another ${key} in ${data.config}, then run "vf-server setup" again.`);
  }
}

/** Creates the PostgreSQL 16 cluster, once. initdb runs with this user's own rights (see parseWhoamiSid). */
function initCluster(layout: ProgramLayout, data: DataLayout, secrets: Secrets, services: boolean, host: Host) {
  // A folder without PG_VERSION is the leftover of a failed earlier attempt: never a usable cluster, but kept aside, not deleted.
  if (existsSync(data.postgres) && readdirSync(data.postgres).length > 0) {
    const aside = `${data.postgres}.incomplete-${Date.now()}`;
    renameSync(data.postgres, aside);
    host.log(`an incomplete database folder from an earlier attempt was moved to ${aside}`);
  }
  mkdirSync(data.postgres, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'vf-initdb-'));
  const pwfile = path.join(tmp, 'pw');
  writeFileSync(pwfile, secrets.dbPassword, { mode: 0o600 });
  let sid: string | null = null;
  try {
    if (services) {
      sid = parseWhoamiSid(host.run('whoami.exe', ['/user', '/fo', 'csv', '/nh']).stdout);
      if (sid) host.run('icacls.exe', icaclsGrantFull(data.postgres, sid));
    }
    host.log('creating the PostgreSQL 16 database cluster (first install only) …');
    must(host, 'PG_INIT', 'PostgreSQL could not create its database cluster', path.join(layout.pgBin, exe('initdb')), initdbArgs(data.postgres, pwfile));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    if (sid) host.run('icacls.exe', icaclsRemoveGrant(data.postgres, sid));
  }
}

function configurePostgres(config: ServerConfig, data: DataLayout) {
  writeFileSync(path.join(data.postgres, 'victorflow.conf'), managedPgConf(config.pgPort));
  const confFile = path.join(data.postgres, 'postgresql.conf');
  const conf = readFileSync(confFile, 'utf8');
  const next = withPgInclude(conf);
  if (next !== conf) writeFileSync(confFile, next);
}

function writeAddresses(config: ServerConfig, secrets: Secrets, data: DataLayout, host: Host, services: boolean): Addresses {
  const addresses = addressesFor(config, { ips: host.lanAddresses(), hostname: host.hostname(), publicNetwork: services && host.publicNetwork(), firstLoginFile: data.firstLogin });
  writeFileSync(data.addresses, addressesIni(addresses));
  writeFileSync(data.firstLogin, firstLoginText(secrets.adminPassword), { mode: 0o600 });
  return addresses;
}

export async function setup(opts: SetupOptions, host: Host): Promise<Addresses> {
  const { layout, services } = opts;
  const problem = dataDirProblem(opts.dataDir, layout.root);
  if (problem) throw new VfError('DATA_DIR', `Data folder "${opts.dataDir}": ${problem}`);
  if (services && layout.kind !== 'installed') throw new VfError('LAYOUT', 'Windows services can only be set up from an installed VictorFlow Server. In the repository, use "setup --no-services" and "run <component>".');
  if (services && !host.isAdmin()) throw new VfError('NOT_ADMIN', 'Run "vf-server setup" as an administrator: it registers Windows services and firewall rules.');

  const data = dataLayout(opts.dataDir);
  const fresh = !existsSync(data.config);
  mkdirSync(data.root, { recursive: true });
  host.log(`VictorFlow Server setup — data folder ${data.root}${fresh ? ' (new)' : ''}`);
  if (services && fresh) must(host, 'DATA_DIR', 'Could not restrict access to the data folder', 'icacls.exe', icaclsLockDown(data.root));
  for (const dir of [data.storage, data.logs]) mkdirSync(dir, { recursive: true });

  const { config } = loadOrCreateConfig(data.config, host.hostname());
  const { secrets } = loadOrCreateSecrets(data.secrets);

  if (services) {
    // Our own services hold these ports while they run (setup run again, or an upgrade): stop them, then check.
    stopServices(host);
    await checkPorts(config, host, data);
  }

  if (!existsSync(path.join(data.postgres, 'PG_VERSION'))) initCluster(layout, data, secrets, services, host);
  configurePostgres(config, data);

  if (!services) {
    const addresses = writeAddresses(config, secrets, data, host, false);
    host.log('data folder ready. Start each part in its own terminal: vf-server run postgres | run api | run tracker | run display');
    return addresses;
  }

  // PostgreSQL: a native Windows service. Its program and data paths never change across upgrades, so an existing
  // registration is kept as it is.
  if (!serviceInstalled(host, PG_SERVICE)) must(host, 'PG_SERVICE', 'Could not register the PostgreSQL service', path.join(layout.pgBin, exe('pg_ctl')), pgRegisterArgs(data.postgres));
  host.run('sc.exe', scFailureRestart(PG_SERVICE));
  host.log('starting PostgreSQL …');
  startServices(host, [PG_SERVICE]);

  // The database is brought up to date here, in the foreground, so a failure shows in the installer — not only later
  // in a service log. The API repeats this (idempotently) every time it starts.
  host.log('preparing the database (migrations) …');
  await host.prepareDatabase(layout, config, secrets);

  for (const svc of NODE_SERVICES) {
    writeFileSync(serviceXml(layout, svc.id), winswXml(svc, layout, data));
    if (!serviceInstalled(host, svc.id)) must(host, 'SERVICE', `Could not register the ${svc.name} service`, serviceExe(layout, svc.id), ['install']);
    must(host, 'SERVICE', `Could not set the account of the ${svc.name} service`, 'sc.exe', scSetAccount(svc.id));
  }

  host.run('powershell.exe', powershellArgs(psRemoveFirewallRules));
  for (const rule of firewallRules(config)) must(host, 'SERVICE', `Could not open port ${rule.port} in the firewall`, 'netsh.exe', netshAddRule(rule, layout.nodeExe));

  host.log('starting the API, the tracker and the displays …');
  startServices(host, NODE_SERVICES.map((s) => s.id));
  if (!(await host.waitApi(config.apiPort, 120_000))) throw new VfError('API_HEALTH', `The API did not become healthy on port ${config.apiPort}. See ${path.join(data.logs, 'VictorFlowApi.err.log')}`);
  for (const svc of NODE_SERVICES.filter((s) => s.component !== 'api')) {
    const port = portOf(config, svc.component);
    if (!(await host.waitWeb(port, 90_000))) throw new VfError('WEB_HEALTH', `${svc.name} did not answer on port ${port}. See ${path.join(data.logs, `${svc.id}.err.log`)}`);
  }

  writeFileSync(path.join(layout.root, INSTALL_INFO), `${JSON.stringify({ dataDir: data.root }, null, 2)}\n`);
  const addresses = writeAddresses(config, secrets, data, host, true);
  for (const file of [data.config, data.addresses]) host.run('icacls.exe', icaclsGrantUsersRead(file));
  host.log('VictorFlow Server is running.');
  host.log(addressesText(addresses));
  return addresses;
}
