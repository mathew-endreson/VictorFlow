// The four Windows services and the WinSW configuration of the three that run Node.
// PostgreSQL is a native service (pg_ctl register); the API, tracker and display are node.exe processes wrapped by
// WinSW (one copy of WinSW.exe per service, named after it, with an .xml of the same name beside it).
import path from 'node:path';
import type { DataLayout, ProgramLayout } from './layout';
import type { ServerConfig } from './store';
import { PG_SERVICE, type FirewallRule } from './windows';

export type NodeComponent = 'api' | 'tracker' | 'display';

export interface NodeService {
  component: NodeComponent;
  id: string;
  name: string;
  description: string;
  depends: string[];
}

export const NODE_SERVICES: readonly NodeService[] = [
  { component: 'api', id: 'VictorFlowApi', name: 'VictorFlow API', description: 'VictorFlow API server (NestJS). Desktop apps and the mobile app connect here.', depends: [PG_SERVICE] },
  { component: 'tracker', id: 'VictorFlowTracker', name: 'VictorFlow Tracker', description: 'VictorFlow order-tracking website for clients (read-only).', depends: [] },
  { component: 'display', id: 'VictorFlowDisplay', name: 'VictorFlow Displays', description: 'VictorFlow TV screens (production room and client board).', depends: [] },
];

/** Start dependencies first; stop dependants first (Windows refuses to stop PostgreSQL while the API depends on it). */
export const START_ORDER = [PG_SERVICE, 'VictorFlowApi', 'VictorFlowTracker', 'VictorFlowDisplay'] as const;
export const STOP_ORDER = [...START_ORDER].reverse();

export const serviceExe = (layout: ProgramLayout, id: string) => path.join(layout.servicesDir, `${id}.exe`);
export const serviceXml = (layout: ProgramLayout, id: string) => path.join(layout.servicesDir, `${id}.xml`);

export const portOf = (config: ServerConfig, component: NodeComponent) =>
  component === 'api' ? config.apiPort : component === 'tracker' ? config.trackerPort : config.displayPort;

/** Opened to the LAN (private/domain networks). PostgreSQL never is. */
export function firewallRules(config: ServerConfig): FirewallRule[] {
  return [
    { name: `VictorFlow API (TCP ${config.apiPort})`, port: config.apiPort },
    { name: `VictorFlow Tracker (TCP ${config.trackerPort})`, port: config.trackerPort },
    { name: `VictorFlow Displays (TCP ${config.displayPort})`, port: config.displayPort },
  ];
}

// ── WinSW ──────────────────────────────────────────────────────────────────────────────────────────────────────

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
/** One command-line argument, quoted when it has spaces (Windows rules: double quotes, inner quotes doubled). */
export const quoteArg = (a: string) => (a === '' || /[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);

/**
 * The service's WinSW configuration. It carries no secret: the process reads secrets.json from the data folder itself
 * (VF_DATA_DIR), so this file can sit in Program Files where every user can read it. The account is set separately
 * (sc config … obj= NetworkService) after install. WinSW re-reads this file at every start, so an upgrade just
 * rewrites it.
 */
export function winswXml(svc: NodeService, layout: ProgramLayout, data: DataLayout): string {
  const args = [layout.script, 'run', svc.component].map(quoteArg).join(' ');
  const workdir = svc.component === 'api' ? layout.serverDir : (svc.component === 'tracker' ? layout.tracker : layout.display).dir;
  const lines = [
    '<!-- Written by vf-server setup. Changes are overwritten on the next setup or upgrade: edit config.json instead. -->',
    '<service>',
    `  <id>${xml(svc.id)}</id>`,
    `  <name>${xml(svc.name)}</name>`,
    `  <description>${xml(svc.description)}</description>`,
    `  <executable>${xml(layout.nodeExe)}</executable>`,
    `  <arguments>${xml(args)}</arguments>`,
    `  <workingdirectory>${xml(workdir)}</workingdirectory>`,
    `  <env name="VF_DATA_DIR" value="${xml(data.root)}"/>`,
    ...svc.depends.map((d) => `  <depend>${xml(d)}</depend>`),
    '  <startmode>Automatic</startmode>',
    '  <onfailure action="restart" delay="10 sec"/>',
    '  <onfailure action="restart" delay="30 sec"/>',
    '  <onfailure action="restart" delay="60 sec"/>',
    '  <resetfailure>1 hour</resetfailure>',
    '  <stoptimeout>30 sec</stoptimeout>',
    `  <logpath>${xml(data.logs)}</logpath>`,
    '  <log mode="roll-by-size">',
    '    <sizeThreshold>10240</sizeThreshold>',
    '    <keepFiles>8</keepFiles>',
    '  </log>',
    '</service>',
    '',
  ];
  return lines.join('\r\n');
}
