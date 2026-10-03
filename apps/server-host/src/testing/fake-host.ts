// A Host that records what setup/remove would do to the machine instead of doing it. It simulates just enough of
// Windows to follow the real sequence: which services exist, what initdb leaves behind, which ports are taken.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CmdResult, Host } from '../host';
import { detectLayout, type ProgramLayout } from '../layout';

export interface Call {
  cmd: string;
  args: string[];
}

export interface FakeHost extends Host {
  calls: Call[];
  logs: string[];
  /** prepareDatabase / waitApi / waitWeb, in order, interleaved with the commands they came between. */
  events: string[];
  installed: Set<string>;
}

const ok = (stdout = ''): CmdResult => ({ status: 0, stdout, stderr: '' });
const name = (cmd: string) => path.basename(cmd).toLowerCase().replace(/\.exe$/, '');

export function fakeHost(opts: { admin?: boolean; installed?: string[]; busyPorts?: Record<number, string>; publicNetwork?: boolean; fail?: (call: Call) => CmdResult | undefined } = {}): FakeHost {
  const installed = new Set(opts.installed ?? []);
  const calls: Call[] = [];
  const logs: string[] = [];
  const events: string[] = [];
  return {
    calls,
    logs,
    events,
    installed,
    run(cmd, args) {
      const call = { cmd, args };
      calls.push(call);
      events.push(`${name(cmd)} ${args[0] ?? ''}`.trim());
      const failed = opts.fail?.(call);
      if (failed) return failed;
      switch (name(cmd)) {
        case 'sc':
          if (args[0] === 'query') return installed.has(args[1]!) ? ok() : { status: 1060, stdout: '', stderr: '' };
          if (args[0] === 'delete') installed.delete(args[1]!);
          return ok();
        case 'whoami':
          return ok('"shop-server\\\\installer","S-1-5-21-111-222-333-1001"\r\n');
        case 'initdb': {
          const pgdata = args[0]!.slice('--pgdata='.length);
          writeFileSync(path.join(pgdata, 'PG_VERSION'), '16\n');
          writeFileSync(path.join(pgdata, 'postgresql.conf'), '# initdb defaults\nport = 5432\n');
          return ok();
        }
        case 'pg_ctl':
          if (args[0] === 'register') installed.add(args[2]!);
          if (args[0] === 'unregister') installed.delete(args[2]!);
          return ok();
        default:
          if (/^victorflow/.test(name(cmd))) {
            const id = path.basename(cmd).replace(/\.exe$/i, '');
            if (args[0] === 'install') installed.add(id);
            if (args[0] === 'uninstall') installed.delete(id);
          }
          return ok();
      }
    },
    log: (line) => void logs.push(line),
    isAdmin: () => opts.admin ?? true,
    hostname: () => 'SHOP-SERVER',
    lanAddresses: () => ['192.168.1.10'],
    publicNetwork: () => opts.publicNetwork ?? false,
    portFree: async (port) => !(opts.busyPorts && port in opts.busyPorts),
    portOwner: (port) => opts.busyPorts?.[port] ?? null,
    prepareDatabase: async () => void events.push('prepareDatabase'),
    waitApi: async (port) => (events.push(`waitApi ${port}`), true),
    waitWeb: async (port) => (events.push(`waitWeb ${port}`), true),
  };
}

/** A throw-away installed program folder (server\dist\main.js marks it as installed) and a separate data folder. */
export function tempInstall(): { layout: ProgramLayout; dataDir: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vf-install-'));
  mkdirSync(path.join(root, 'server', 'dist'), { recursive: true });
  writeFileSync(path.join(root, 'server', 'dist', 'main.js'), '');
  mkdirSync(path.join(root, 'services'), { recursive: true });
  const dataDir = path.join(mkdtempSync(path.join(os.tmpdir(), 'vf-data-')), 'VictorFlow');
  return { layout: detectLayout(path.join(root, 'vf-server.mjs')), dataDir };
}
