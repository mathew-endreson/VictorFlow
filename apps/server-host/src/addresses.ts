// What people need to connect: the server address for desktop PCs, the tracker and TV addresses, and where the first
// sign-in is. Written to addresses.ini in the data folder — readable by people and by the installer's finish page —
// and printed by `vf-server status`.
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
  firstLogin: string;
}

export function addressesFor(config: ServerConfig, info: { ips: string[]; hostname: string; publicNetwork: boolean; firstLoginFile: string }): Addresses {
  const host = info.ips[0] ?? info.hostname;
  return {
    api: `${host}:${config.apiPort}`,
    apiByName: `${info.hostname}:${config.apiPort}`,
    tracker: `http://${host}:${config.trackerPort}`,
    display: `http://${host}:${config.displayPort}`,
    hostname: info.hostname,
    publicNetwork: info.publicNetwork,
    firstLogin: info.firstLoginFile,
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
    `firstLogin=${a.firstLogin}`,
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
    `First sign-in (temporary):                        ${a.firstLogin}`,
    ...(a.publicNetwork ? ['', PUBLIC_NETWORK_WARNING] : []),
  ].join('\n');
}

/** The seeded admin account's credentials, for whoever installs the server (the file is readable by administrators only). */
export function firstLoginText(adminPassword: string): string {
  return [
    'VictorFlow — first sign-in / première connexion / أول تسجيل دخول',
    '',
    'E-mail: admin@victorflow.local',
    `Password / Mot de passe / كلمة المرور: ${adminPassword}`,
    '',
    'Temporary: this account exists until the onboarding (licence -> company -> first administrator) ships.',
    "Temporaire : ce compte existe jusqu'à la mise en service guidée (licence -> entreprise -> premier administrateur).",
    'مؤقت: هذا الحساب موجود إلى أن تتوفر خطوات التهيئة (الترخيص ← المؤسسة ← أول مسؤول).',
    '',
  ].join('\r\n');
}
