// What people need to connect: the server address for desktop PCs, and the tracker and TV addresses. Written to
// addresses.ini in the data folder — readable by people and by the installer's finish page — and printed by
// `vf-server status`.
import type { ServerConfig } from './store';

export interface Addresses {
  /** What a desktop PC types on its sign-in screen (host:port). */
  api: string;
  /** The same through the computer's name, which survives an IP change. */
  apiByName: string;
  tracker: string;
  display: string;
  hostname: string;
  /** Windows calls this machine's network "Public": the firewall then blocks every other PC. */
  publicNetwork: boolean;
}

export function addressesFor(config: ServerConfig, info: { ips: string[]; hostname: string; publicNetwork: boolean }): Addresses {
  const host = info.ips[0] ?? info.hostname;
  return {
    api: `${host}:${config.apiPort}`,
    apiByName: `${info.hostname}:${config.apiPort}`,
    tracker: `http://${host}:${config.trackerPort}`,
    display: `http://${host}:${config.displayPort}`,
    hostname: info.hostname,
    publicNetwork: info.publicNetwork,
  };
}

export function addressesIni(a: Addresses): string {
  return [
    '; VictorFlow Server addresses, written by "vf-server setup". Desktop PCs: sign-in screen -> Server -> Change -> api.',
    '[server]',
    `api=${a.api}`,
    `apiByName=${a.apiByName}`,
    `tracker=${a.tracker}`,
    `display=${a.display}`,
    `hostname=${a.hostname}`,
    `publicNetwork=${a.publicNetwork ? 1 : 0}`,
    '',
  ].join('\r\n');
}

export const PUBLIC_NETWORK_WARNING =
  'WARNING: this computer\'s network is set to "Public", so Windows blocks the other PCs from connecting. Set it to Private: Settings > Network & internet > your network > Private network.';

export function addressesText(a: Addresses): string {
  return [
    `Desktop PCs (sign-in screen > Server > Change):  ${a.api}   or   ${a.apiByName}`,
    `Tracking website:                                 ${a.tracker}`,
    `TV screens:                                       ${a.display}`,
    'First-time setup:                                 open VictorFlow on a company PC (licence, company, owner account)',
    ...(a.publicNetwork ? ['', PUBLIC_NETWORK_WARNING] : []),
  ].join('\n');
}
