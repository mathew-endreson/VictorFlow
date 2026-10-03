import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataLayout, type ProgramLayout } from './layout';
import { firewallRules, NODE_SERVICES, quoteArg, START_ORDER, STOP_ORDER, winswXml } from './services';
import { defaultConfig } from './store';
import {
  icaclsLockDown,
  initdbArgs,
  managedPgConf,
  netshAddRule,
  parseServiceStatus,
  parseWhoamiSid,
  PG_INCLUDE_LINE,
  pgRegisterArgs,
  psStartServices,
  psStopServices,
  scFailureRestart,
  scSetAccount,
  withPgInclude,
} from './windows';

const root = 'C:\\Program Files\\VictorFlow Server';
const layout = {
  kind: 'installed',
  root,
  nodeExe: `${root}\\node\\node.exe`,
  serverDir: `${root}\\server`,
  tracker: { dir: `${root}\\tracker`, entry: null },
  display: { dir: `${root}\\display`, entry: null },
  servicesDir: `${root}\\services`,
  script: `${root}\\vf-server.mjs`,
} as ProgramLayout;
const data = dataLayout('C:\\ProgramData\\Victor & Flow');

describe('Windows commands (language-independent)', () => {
  it('locks the data folder to SYSTEM, Administrators and NetworkService by SID, in one command', () => {
    expect(icaclsLockDown('C:\\ProgramData\\VictorFlow')).toEqual(['C:\\ProgramData\\VictorFlow', '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-20:(OI)(CI)M']);
  });

  it('runs services as NetworkService (fixed alias, empty password) and restarts them when they fail', () => {
    expect(scSetAccount('VictorFlowApi')).toEqual(['config', 'VictorFlowApi', 'obj=', 'NT AUTHORITY\\NetworkService', 'password=', '']);
    expect(scFailureRestart('VictorFlowPostgres')).toEqual(['failure', 'VictorFlowPostgres', 'reset=', '3600', 'actions=', 'restart/10000/restart/30000/restart/60000']);
  });

  it('registers PostgreSQL as a native auto-start service and initialises it with scram passwords', () => {
    expect(pgRegisterArgs('D:\\vf\\postgres')).toEqual(['register', '-N', 'VictorFlowPostgres', '-U', 'NT AUTHORITY\\NetworkService', '-D', 'D:\\vf\\postgres', '-S', 'auto', '-w', '-t', '120']);
    expect(initdbArgs('D:\\vf\\postgres', 'C:\\tmp\\pw')).toEqual(['--pgdata=D:\\vf\\postgres', '--username=victorflow', '--pwfile=C:\\tmp\\pw', '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
  });

  it('opens one port to node.exe, on private and domain networks only', () => {
    expect(netshAddRule({ name: 'VictorFlow API (TCP 3000)', port: 3000 }, layout.nodeExe)).toEqual([
      'advfirewall', 'firewall', 'add', 'rule', 'name=VictorFlow API (TCP 3000)', 'dir=in', 'action=allow', 'protocol=TCP', 'localport=3000', `program=${layout.nodeExe}`, 'profile=private,domain',
    ]);
    expect(firewallRules(defaultConfig('pc')).map((r) => r.port)).toEqual([3000, 3001, 3002]); // never PostgreSQL
  });

  it("reads the installing user's SID from whoami", () => {
    expect(parseWhoamiSid('"shop-server\\\\karim","S-1-5-21-1004336348-1177238915-682003330-1001"\r\n')).toBe('S-1-5-21-1004336348-1177238915-682003330-1001');
    expect(parseWhoamiSid('')).toBeNull();
  });

  it('starts dependencies first and stops dependants first; reads states in any Windows language', () => {
    expect(START_ORDER).toEqual(['VictorFlowPostgres', 'VictorFlowApi', 'VictorFlowTracker', 'VictorFlowDisplay']);
    expect(STOP_ORDER).toEqual(['VictorFlowDisplay', 'VictorFlowTracker', 'VictorFlowApi', 'VictorFlowPostgres']);
    expect(psStartServices(['VictorFlowPostgres'])).toMatch(/^\$ErrorActionPreference='Stop'; foreach \(\$n in @\('VictorFlowPostgres'\)\)/);
    expect(psStopServices(STOP_ORDER, { bestEffort: true })).toMatch(/^\$ErrorActionPreference='Continue'.*Stop-Service -Name \$n -Force/);
    expect(parseServiceStatus('VictorFlowApi=Running\r\nVictorFlowPostgres=Stopped\r\nnoise\r\n')).toEqual({ VictorFlowApi: 'Running', VictorFlowPostgres: 'Stopped' });
  });
});

describe('PostgreSQL configuration', () => {
  it('owns its settings in victorflow.conf: our port, loopback only, rotating logs', () => {
    const conf = managedPgConf(55432);
    expect(conf).toContain('port = 55432');
    expect(conf).toContain("listen_addresses = '127.0.0.1'");
    expect(conf).toContain('logging_collector = on');
  });

  it('adds the include line to postgresql.conf exactly once', () => {
    const once = withPgInclude('# defaults\nport = 5432\n');
    expect(once.trimEnd().endsWith(PG_INCLUDE_LINE)).toBe(true);
    expect(withPgInclude(once)).toBe(once);
    expect(withPgInclude(once.replace(/\n/g, '\r\n'))).toBe(once.replace(/\n/g, '\r\n'));
  });
});

describe('WinSW service files', () => {
  const api = NODE_SERVICES.find((s) => s.component === 'api')!;
  const tracker = NODE_SERVICES.find((s) => s.component === 'tracker')!;

  it('runs the bundled node.exe on "vf-server.mjs run <component>", quoting paths with spaces', () => {
    const xml = winswXml(api, layout, data);
    expect(xml).toContain(`<executable>${root}\\node\\node.exe</executable>`);
    expect(xml).toContain(`<arguments>&quot;${root}\\vf-server.mjs&quot; run api</arguments>`);
    expect(xml).toContain(`<workingdirectory>${root}\\server</workingdirectory>`);
    expect(winswXml(tracker, layout, data)).toContain(`<workingdirectory>${root}\\tracker</workingdirectory>`);
  });

  it('passes only the data folder (escaped) — no secret ever goes into a file under Program Files', () => {
    const xml = winswXml(api, layout, data);
    expect(xml).toContain('<env name="VF_DATA_DIR" value="C:\\ProgramData\\Victor &amp; Flow"/>');
    expect(xml.match(/<env /g)).toHaveLength(1);
    expect(xml).not.toMatch(/secret|password|DATABASE_URL/i);
  });

  it('only the API depends on PostgreSQL; every service restarts on failure and logs to the data folder', () => {
    expect(winswXml(api, layout, data)).toContain('<depend>VictorFlowPostgres</depend>');
    expect(winswXml(tracker, layout, data)).not.toContain('<depend>');
    const xml = winswXml(tracker, layout, data);
    expect(xml.match(/<onfailure action="restart"/g)).toHaveLength(3);
    expect(xml).toContain(`<logpath>${path.join('C:\\ProgramData\\Victor &amp; Flow', 'logs')}</logpath>`);
    expect(xml).toContain('<startmode>Automatic</startmode>');
  });

  it('quotes command-line arguments the Windows way', () => {
    expect(quoteArg('run')).toBe('run');
    expect(quoteArg('C:\\Program Files\\x.mjs')).toBe('"C:\\Program Files\\x.mjs"');
    expect(quoteArg('say "hi"')).toBe('"say ""hi"""');
    expect(quoteArg('')).toBe('""');
  });
});
