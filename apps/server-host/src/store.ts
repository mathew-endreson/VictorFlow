// config.json (ports and public addresses — safe to read and edit) and secrets.json (generated once, never edited,
// readable only by Administrators, SYSTEM and the service account through the data folder's permissions).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { VfError } from './errors';

export interface ServerConfig {
  apiPort: number;
  trackerPort: number;
  displayPort: number;
  /** PostgreSQL listens on 127.0.0.1 only; never opened in the firewall. */
  pgPort: number;
  /**
   * The base of tracking links and QR codes on documents (later: the Cloudflare Tunnel address). Empty in config.json
   * means automatic: http://<this computer's name>:<trackerPort>. In memory it is always the resolved address.
   */
  trackerPublicUrl: string;
  /** Origins allowed to call the API from a browser, beyond the desktop app's own (http://tauri.localhost, tauri://localhost). */
  extraCorsOrigins: string[];
  /** Online licence activation: BluxTech's licence server address. Empty (the default) = offline activation only. */
  licenceServerUrl: string;
}

const trackerUrl = (hostname: string, port: number) => `http://${hostname.toLowerCase()}:${port}`;

export function defaultConfig(hostname: string): ServerConfig {
  return {
    apiPort: 3000,
    trackerPort: 3001,
    displayPort: 3002,
    pgPort: 55432,
    trackerPublicUrl: trackerUrl(hostname, 3001),
    extraCorsOrigins: [],
    licenceServerUrl: '',
  };
}

const isPort = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 65535;

/** Existing values win; anything missing gets its default; anything malformed is refused with the field's name. */
export function mergeConfig(existing: unknown, hostname: string): ServerConfig {
  const src = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
  const merged = { ...defaultConfig(hostname), ...src } as Record<string, unknown>;
  // Tracking links follow the tracker's port unless an address was set on purpose (e.g. the Cloudflare Tunnel one).
  if ((src.trackerPublicUrl === undefined || src.trackerPublicUrl === '') && isPort(merged.trackerPort)) merged.trackerPublicUrl = trackerUrl(hostname, merged.trackerPort);
  if (typeof merged.licenceServerUrl === 'string') merged.licenceServerUrl = merged.licenceServerUrl.trim();
  const problems: string[] = [];
  for (const key of ['apiPort', 'trackerPort', 'displayPort', 'pgPort'] as const) if (!isPort(merged[key])) problems.push(`${key} must be a port number (1-65535)`);
  if (typeof merged.trackerPublicUrl !== 'string' || !/^https?:\/\/[^\s/]+/.test(merged.trackerPublicUrl)) problems.push('trackerPublicUrl must be an http(s) address');
  if (!Array.isArray(merged.extraCorsOrigins) || !merged.extraCorsOrigins.every((o) => typeof o === 'string')) problems.push('extraCorsOrigins must be a list of addresses');
  if (typeof merged.licenceServerUrl !== 'string' || (merged.licenceServerUrl !== '' && !/^https?:\/\/[^\s/]+/.test(merged.licenceServerUrl))) problems.push('licenceServerUrl must be empty or an http(s) address');
  const ports = [merged.apiPort, merged.trackerPort, merged.displayPort, merged.pgPort];
  if (problems.length === 0 && new Set(ports).size !== ports.length) problems.push('apiPort, trackerPort, displayPort and pgPort must all be different');
  if (problems.length) throw new VfError('CONFIG', `config.json is not valid: ${problems.join('; ')}`);
  return {
    apiPort: merged.apiPort as number,
    trackerPort: merged.trackerPort as number,
    displayPort: merged.displayPort as number,
    pgPort: merged.pgPort as number,
    trackerPublicUrl: (merged.trackerPublicUrl as string).replace(/\/+$/, ''),
    extraCorsOrigins: merged.extraCorsOrigins as string[],
    licenceServerUrl: merged.licenceServerUrl as string,
  };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); // tolerate a BOM from Notepad
  } catch (e) {
    throw new VfError('CONFIG', `${file} could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const writeJson = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });

/** Reads config.json, filling in (and writing back) any setting it lacks. An automatic tracker address stays "". */
export function loadOrCreateConfig(file: string, hostname: string = os.hostname()): { config: ServerConfig; created: boolean } {
  const created = !existsSync(file);
  const existing = created ? {} : readJson(file);
  const config = mergeConfig(existing, hostname);
  const onDisk = { ...config, trackerPublicUrl: config.trackerPublicUrl === trackerUrl(hostname, config.trackerPort) ? '' : config.trackerPublicUrl };
  if (created || JSON.stringify(existing) !== JSON.stringify(onDisk)) writeJson(file, onDisk);
  return { config, created };
}

export function loadConfig(file: string, hostname: string = os.hostname()): ServerConfig {
  if (!existsSync(file)) throw new VfError('CONFIG', `${file} does not exist — run "vf-server setup" first`);
  return mergeConfig(readJson(file), hostname);
}

// ── secrets ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Secrets {
  dbPassword: string;
  jwtAccessSecret: string;
  trackingHmacSecret: string;
}

const token = (bytes: number) => randomBytes(bytes).toString('base64url');

export function freshSecrets(): Secrets {
  return { dbPassword: token(24), jwtAccessSecret: token(32), trackingHmacSecret: token(32) };
}

/**
 * Generated once; on later runs, only keys added to the schema since are generated — existing values are never replaced,
 * and keys an older version wrote are left as they are (e.g. the adminPassword of the trial installs before onboarding).
 */
export function loadOrCreateSecrets(file: string): { secrets: Secrets; created: boolean } {
  if (!existsSync(file)) {
    const secrets = freshSecrets();
    writeJson(file, secrets);
    return { secrets, created: true };
  }
  const existing = readJson(file) as Partial<Secrets>;
  const merged = { ...freshSecrets(), ...existing } as Secrets;
  if (Object.keys(merged).length !== Object.keys(existing).length) writeJson(file, merged);
  return { secrets: merged, created: false };
}

export function loadSecrets(file: string): Secrets {
  if (!existsSync(file)) throw new VfError('CONFIG', `${file} does not exist — run "vf-server setup" first`);
  return readJson(file) as Secrets;
}
