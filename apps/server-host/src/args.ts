import { VfError } from './errors';

export const USAGE = `vf-server — VictorFlow Server for Windows

  vf-server setup [--data-dir <folder>] [--no-services]
      Install or update: data folder, database, Windows services, firewall. Run as administrator.
      Safe to run again at any time, e.g. after editing config.json in the data folder.
  vf-server status        Services, health and the addresses to give to desktop PCs
  vf-server start | stop  Start or stop all VictorFlow services
  vf-server remove        Unregister the services and firewall rules (the data folder is kept)
  vf-server run <api|tracker|display|postgres>
      Run one part in the foreground (what each service runs; postgres is for testing without services)

  --data-dir  defaults to the folder chosen at install (else %ProgramData%\\VictorFlow)`;

export interface Args {
  command: string;
  component?: string;
  dataDir?: string;
  services: boolean;
}

export function parseArgs(argv: string[]): Args {
  const rest: string[] = [];
  let dataDir: string | undefined;
  let services = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--data-dir') {
      dataDir = argv[++i];
      if (!dataDir) throw new VfError('USAGE', '--data-dir needs a folder');
    } else if (a === '--no-services') services = false;
    else if (a === '--help' || a === '-h') rest.unshift('help');
    else if (a.startsWith('--')) throw new VfError('USAGE', `unknown option ${a}`);
    else rest.push(a);
  }
  return { command: rest[0] ?? 'help', component: rest[1], dataDir, services };
}
