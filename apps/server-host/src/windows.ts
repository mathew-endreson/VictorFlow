// Argument lists for the Windows tools setup and remove call (sc, net, icacls, netsh, pg_ctl, whoami, WinSW).
// Pure, so every command a real install runs is pinned by a unit test. Rules that keep them working on a French or
// Arabic Windows: accounts and groups by SID or by the fixed "NT AUTHORITY\NetworkService" alias, never by their
// localised names; success read from exit codes, never from text.

/** The account every VictorFlow service runs as: no password, no admin rights, network access as the machine. */
export const SERVICE_ACCOUNT = 'NT AUTHORITY\\NetworkService';

export const SID = {
  system: 'S-1-5-18',
  administrators: 'S-1-5-32-544',
  users: 'S-1-5-32-545',
  networkService: 'S-1-5-20',
} as const;

// sc.exe

export const scQuery = (id: string) => ['query', id];
/** `sc query` exit code for "no such service". */
export const SC_NOT_INSTALLED = 1060;
export const scSetAccount = (id: string) => ['config', id, 'obj=', SERVICE_ACCOUNT, 'password=', ''];
export const scFailureRestart = (id: string) => ['failure', id, 'reset=', '3600', 'actions=', 'restart/10000/restart/30000/restart/60000'];
export const scDelete = (id: string) => ['delete', id];

// PowerShell — for what has no exit-code-clean command line tool. Start-/Stop-Service wait for the new state and are
// no-ops when the service is already there (`net start` returns the same code for "already running" and "failed").

export const powershellArgs = (command: string) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command];
const psNames = (ids: readonly string[]) => ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
/** Starts each installed service in order; skips ones that are not installed. */
export const psStartServices = (ids: readonly string[]) =>
  `$ErrorActionPreference='Stop'; foreach ($n in @(${psNames(ids)})) { if (Get-Service -Name $n -ErrorAction SilentlyContinue) { Start-Service -Name $n } }`;
/**
 * Stops each installed service in order (dependants first); -Force so a service stuck restarting cannot block it.
 * bestEffort carries on past a failure (removing a broken install must still work).
 */
export const psStopServices = (ids: readonly string[], opts: { bestEffort?: boolean } = {}) =>
  `$ErrorActionPreference='${opts.bestEffort ? 'Continue' : 'Stop'}'; foreach ($n in @(${psNames(ids)})) { if (Get-Service -Name $n -ErrorAction SilentlyContinue) { Stop-Service -Name $n -Force } }`;
/** "VictorFlowApi=Running" lines; the status names are the same in every Windows language. */
export const psServiceStatus = "Get-Service -Name 'VictorFlow*' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + '=' + $_.Status }";
/** Removes every inbound rule this tool created, whatever port it was for. */
export const psRemoveFirewallRules = "Get-NetFirewallRule -DisplayName 'VictorFlow * (TCP *)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule";

export function parseServiceStatus(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .split(/\r?\n/)
      .map((l) => /^(\w+)=(\w+)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1]!, m[2]!]),
  );
}

// icacls

/**
 * Locks the data folder down when it is first created: only SYSTEM, Administrators (full) and the service account
 * (modify). Inheritance from %ProgramData% is removed so ordinary users cannot read secrets.json. One command, so
 * there is never a moment with no grant at all.
 */
export const icaclsLockDown = (dir: string) => [dir, '/inheritance:r', '/grant:r', `*${SID.system}:(OI)(CI)F`, `*${SID.administrators}:(OI)(CI)F`, `*${SID.networkService}:(OI)(CI)M`];
export const icaclsGrantFull = (dir: string, sid: string) => [dir, '/grant', `*${sid}:(OI)(CI)F`];
/** Lets ordinary users read one file holding no secret (config.json, addresses.ini), so `vf-server status` works unelevated. */
export const icaclsGrantUsersRead = (file: string) => [file, '/grant', `*${SID.users}:R`];
export const icaclsRemoveGrant = (dir: string, sid: string) => [dir, '/remove:g', `*${sid}`];

/**
 * `whoami /user /fo csv /nh` → `"pc\\user","S-1-5-21-…"`. initdb, started by an elevated installer, drops the
 * Administrators group from its own token (PostgreSQL refuses to run as an administrator), so it needs this user's own
 * SID granted on the cluster folder while it runs.
 */
export function parseWhoamiSid(stdout: string): string | null {
  const m = /"(S-1-[\d-]+)"/.exec(stdout);
  return m ? m[1]! : null;
}

// netsh (keywords are identical in every Windows language)

export interface FirewallRule {
  name: string;
  port: number;
}
/** Inbound TCP to one port of the bundled node.exe, on private and domain networks only (never public Wi-Fi). */
export const netshAddRule = (rule: FirewallRule, program: string) => [
  'advfirewall', 'firewall', 'add', 'rule', `name=${rule.name}`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${rule.port}`, `program=${program}`, 'profile=private,domain',
];

// PostgreSQL

export const PG_SERVICE = 'VictorFlowPostgres';

export const initdbArgs = (pgData: string, pwfile: string) => [`--pgdata=${pgData}`, '--username=victorflow', `--pwfile=${pwfile}`, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C'];
/** A native PostgreSQL service (pg_ctl runservice): starts with Windows, waits up to 2 minutes for crash recovery. */
export const pgRegisterArgs = (pgData: string) => ['register', '-N', PG_SERVICE, '-U', SERVICE_ACCOUNT, '-D', pgData, '-S', 'auto', '-w', '-t', '120'];
export const pgUnregisterArgs = () => ['unregister', '-N', PG_SERVICE];

/** Port, address and logging live in a file VictorFlow owns, pulled into postgresql.conf by one include line. */
export function managedPgConf(pgPort: number): string {
  return [
    '# Written by vf-server setup on every run — edit config.json (pgPort) instead, then run "vf-server setup".',
    `port = ${pgPort}`,
    "listen_addresses = '127.0.0.1'",
    'logging_collector = on',
    "log_directory = 'log'",
    "log_filename = 'postgresql-%a.log'",
    'log_truncate_on_rotation = on',
    'log_rotation_age = 1d',
    'log_rotation_size = 0',
    '',
  ].join('\n');
}

export const PG_INCLUDE_LINE = "include_if_exists = 'victorflow.conf'";

/** postgresql.conf with the include line added once at the end (later settings win, so ours override initdb's). */
export function withPgInclude(conf: string): string {
  if (conf.split(/\r?\n/).some((l) => l.trim() === PG_INCLUDE_LINE)) return conf;
  return `${conf.replace(/\s*$/, '')}\n\n# VictorFlow\n${PG_INCLUDE_LINE}\n`;
}
