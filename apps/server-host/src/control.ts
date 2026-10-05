// `vf-server remove | start | stop | status`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { addressesFor, addressesText } from './addresses';
import { VfError } from './errors';
import { fetchApiHealth, isHealthyApi, webAnswers } from './health';
import type { Host } from './host';
import { dataLayout, type ProgramLayout } from './layout';
import { NODE_SERVICES, portOf, serviceExe, START_ORDER, STOP_ORDER } from './services';
import { serviceInstalled, startServices, stopServices } from './setup';
import { loadConfig } from './store';
import { parseServiceStatus, PG_SERVICE, pgUnregisterArgs, powershellArgs, psRemoveFirewallRules, psServiceStatus, psStopServices, scDelete } from './windows';

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

function requireInstalled(layout: ProgramLayout) {
  if (layout.kind !== 'installed') throw new VfError('LAYOUT', 'This command manages the Windows services of an installed VictorFlow Server.');
}

/** Unregisters every service and firewall rule. The data folder is never touched: uninstalling must not lose a shop's data. */
export function remove(layout: ProgramLayout, dataDir: string, host: Host): void {
  requireInstalled(layout);
  if (!host.isAdmin()) throw new VfError('NOT_ADMIN', 'Run "vf-server remove" as an administrator.');
  host.run('powershell.exe', powershellArgs(psStopServices(STOP_ORDER, { bestEffort: true })));
  for (const svc of [...NODE_SERVICES].reverse()) {
    if (!serviceInstalled(host, svc.id)) continue;
    const wrapper = serviceExe(layout, svc.id);
    const r = existsSync(wrapper) ? host.run(wrapper, ['uninstall']) : { status: 1 };
    if (r.status !== 0) host.run('sc.exe', scDelete(svc.id));
  }
  if (serviceInstalled(host, PG_SERVICE)) {
    const r = host.run(path.join(layout.pgBin, exe('pg_ctl')), pgUnregisterArgs());
    if (r.status !== 0) host.run('sc.exe', scDelete(PG_SERVICE));
  }
  host.run('powershell.exe', powershellArgs(psRemoveFirewallRules));
  host.log(`VictorFlow services removed. The data folder was kept: ${dataDir}`);
}

export function start(layout: ProgramLayout, host: Host): void {
  requireInstalled(layout);
  startServices(host, START_ORDER);
  host.log('VictorFlow services started.');
}

export function stop(layout: ProgramLayout, host: Host): void {
  requireInstalled(layout);
  stopServices(host);
  host.log('VictorFlow services stopped.');
}

export interface StatusReport {
  healthy: boolean;
  text: string;
}

/** Each service's state, whether each part really answers, and the addresses to give out. */
export async function status(layout: ProgramLayout, dataDir: string, host: Host): Promise<StatusReport> {
  const data = dataLayout(dataDir);
  const config = loadConfig(data.config, host.hostname());
  const states = layout.kind === 'installed' ? parseServiceStatus(host.run('powershell.exe', powershellArgs(psServiceStatus)).stdout) : {};
  const api = await fetchApiHealth(config.apiPort);
  const answers = {
    api: isHealthyApi(api),
    tracker: await webAnswers(config.trackerPort),
    display: await webAnswers(config.displayPort),
  };
  const rows: Array<[string, string, string]> = [[PG_SERVICE, `127.0.0.1:${config.pgPort}`, api?.db === 'up' ? 'database up' : 'database not reachable through the API']];
  for (const svc of NODE_SERVICES) rows.push([svc.id, `port ${portOf(config, svc.component)}`, answers[svc.component] ? 'answers' : 'NOT ANSWERING']);
  const width = Math.max(...rows.map((r) => r[0].length));
  const lines = rows.map(([id, where, health]) => `  ${id.padEnd(width)}  ${(states[id] ?? (layout.kind === 'installed' ? 'NOT INSTALLED' : '-')).padEnd(13)}  ${where.padEnd(16)}  ${health}`);
  const addresses = addressesFor(config, { ips: host.lanAddresses(), hostname: host.hostname(), publicNetwork: layout.kind === 'installed' && host.publicNetwork() });
  const healthy = answers.api && answers.tracker && answers.display && api?.db === 'up';
  const version = existsSync(path.join(layout.root, 'VERSION')) ? readFileSync(path.join(layout.root, 'VERSION'), 'utf8').trim() : 'dev';
  const text = [
    `VictorFlow Server ${version} — data folder ${data.root}`,
    '',
    ...lines,
    '',
    addressesText(addresses),
    '',
    `Logs: ${data.logs}  (PostgreSQL: ${path.join(data.postgres, 'log')})`,
    healthy ? 'Everything answers.' : 'Something is not answering: check the logs above, or run "vf-server start".',
  ].join('\n');
  return { healthy, text };
}
