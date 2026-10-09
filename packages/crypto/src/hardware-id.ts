import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { arch, cpus, hostname, networkInterfaces, platform } from 'node:os';

/** Where the identity of this computer is read from — injectable, so tests can be "another machine". */
export interface HardwareReaders {
  platform(): string;
  /** A Windows registry string value, or null when it cannot be read. */
  registry(key: string, name: string): string | null;
  /** A file's text, or null. */
  file(path: string): string | null;
  /** The old, network-based material (last resort). */
  legacy(): string;
}

function readRegistry(key: string, name: string): string | null {
  try {
    // /reg:64: the 64-bit view, whatever this Node process is.
    const out = execFileSync('reg.exe', ['query', key, '/v', name, '/reg:64'], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`).exec(out);
    return m?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Host name, CPU and network cards: changes when a VPN or virtual adapter appears, so only used when nothing else exists. */
function legacyMaterial(): string {
  const macs = Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((i) => !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')
    .map((i) => i.mac)
    .sort();
  return ['legacy', hostname(), platform(), arch(), cpus()[0]?.model ?? 'cpu', ...new Set(macs)].join('|');
}

export const SYSTEM_READERS: HardwareReaders = { platform, registry: readRegistry, file: readText, legacy: legacyMaterial };

/** This computer's id, once computed (see hardwareId). */
let systemId: string | undefined;

/**
 * This server's hardware id: SHA-256 (64 hex characters) of what identifies the computer and its Windows installation.
 *   Windows: the MachineGuid (new with every Windows installation, so a new disk or server) and the SMBIOS system UUID
 *            (the motherboard, so a copied disk on another computer gets another id).
 *   Linux:   /etc/machine-id.
 * Network cards are NOT used: a VPN, a Wi-Fi dongle or a virtual switch must not change the id and lock the shop into
 * read-only mode. When none of these can be read, the old network-based material is the last resort.
 *
 * This computer's id is read once per process: each read starts reg.exe twice, which takes seconds on a cold machine
 * (seen on GitHub's Windows runners), and the id cannot change while the process runs. `readers` (tests) always re-read.
 */
export function hardwareId(readers?: HardwareReaders): string {
  if (!readers) return (systemId ??= computeHardwareId(SYSTEM_READERS));
  return computeHardwareId(readers);
}

function computeHardwareId(readers: HardwareReaders): string {
  let material: string | null = null;
  if (readers.platform() === 'win32') {
    const machineGuid = readers.registry('HKLM\\SOFTWARE\\Microsoft\\Cryptography', 'MachineGuid');
    const smbios = readers.registry('HKLM\\SYSTEM\\HardwareConfig', 'LastConfig');
    if (machineGuid) material = ['win', machineGuid.toLowerCase(), (smbios ?? '').toLowerCase()].join('|');
  } else {
    const machineId = readers.file('/etc/machine-id') ?? readers.file('/var/lib/dbus/machine-id');
    if (machineId) material = ['machine-id', machineId.toLowerCase()].join('|');
  }
  return createHash('sha256').update(`victorflow-hw-v2|${material ?? readers.legacy()}`).digest('hex');
}
