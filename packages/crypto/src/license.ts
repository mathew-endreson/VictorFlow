import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { hostname, arch, cpus, networkInterfaces, platform } from 'node:os';

/**
 * Licence file format:  base64url(payloadJson) "." base64url(ed25519Signature)
 * The signature covers the exact payload bytes that are transmitted — we never re-serialise
 * the JSON before verifying, so key order / whitespace cannot be used to forge or break a licence.
 */

export type LicenseTier = 'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE';

export interface LicensePayload {
  licenseId: string;
  customer: string;
  tier: LicenseTier;
  features: string[];
  maxUsers: number;
  /** null = not bound to a machine. */
  hardwareId: string | null;
  issuedAt: string; // ISO-8601
  expiresAt: string | null; // ISO-8601, null = perpetual
}

export type LicenseFailureCode =
  | 'MALFORMED'
  | 'BAD_SIGNATURE'
  | 'INVALID_PAYLOAD'
  | 'HARDWARE_MISMATCH'
  | 'NOT_YET_VALID'
  | 'EXPIRED';

export type LicenseVerdict =
  | { ok: true; payload: LicensePayload }
  | { ok: false; code: LicenseFailureCode; message: string };

const b64u = (buf: Buffer) => buf.toString('base64url');

function toPublicKey(key: string | KeyObject): KeyObject {
  if (typeof key !== 'string') return key;
  const trimmed = key.trim();
  if (trimmed.includes('-----BEGIN')) return createPublicKey(trimmed);
  return createPublicKey({ key: Buffer.from(trimmed, 'base64'), format: 'der', type: 'spki' });
}

function toPrivateKey(key: string | KeyObject): KeyObject {
  return typeof key === 'string' ? createPrivateKey(key) : key;
}

export function generateLicenseKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Issuer side (vendor tooling / tests). Ed25519 takes `null` as the digest algorithm. */
export function signLicense(payload: LicensePayload, privateKey: string | KeyObject): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = sign(null, data, toPrivateKey(privateKey));
  return `${b64u(data)}.${b64u(signature)}`;
}

function isPayload(v: unknown): v is LicensePayload {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.licenseId === 'string' &&
    typeof p.customer === 'string' &&
    (p.tier === 'BASIC' || p.tier === 'PROFESSIONAL' || p.tier === 'ENTERPRISE') &&
    Array.isArray(p.features) &&
    p.features.every((f) => typeof f === 'string') &&
    typeof p.maxUsers === 'number' &&
    Number.isInteger(p.maxUsers) &&
    p.maxUsers > 0 &&
    (p.hardwareId === null || typeof p.hardwareId === 'string') &&
    typeof p.issuedAt === 'string' &&
    !Number.isNaN(Date.parse(p.issuedAt)) &&
    (p.expiresAt === null || (typeof p.expiresAt === 'string' && !Number.isNaN(Date.parse(p.expiresAt))))
  );
}

export interface VerifyLicenseOptions {
  token: string;
  publicKey: string | KeyObject;
  /** This machine's fingerprint (see hardwareFingerprint()). */
  hardwareId: string;
  now?: Date;
}

/**
 * Verify order matters: authenticity first (so nothing in an unsigned payload is trusted or even
 * parsed as policy), then hardware binding, then validity window.
 */
export function verifyLicense(opts: VerifyLicenseOptions): LicenseVerdict {
  const parts = opts.token.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, code: 'MALFORMED', message: 'Licence must be "<payload>.<signature>"' };
  }

  let data: Buffer;
  let signature: Buffer;
  try {
    data = Buffer.from(parts[0], 'base64url');
    signature = Buffer.from(parts[1], 'base64url');
  } catch {
    return { ok: false, code: 'MALFORMED', message: 'Licence is not valid base64url' };
  }

  let valid = false;
  try {
    // Ed25519: algorithm MUST be null. (createVerify('SHA512') is the wrong primitive for Ed25519.)
    valid = verify(null, data, toPublicKey(opts.publicKey), signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, code: 'BAD_SIGNATURE', message: 'Licence signature is invalid' };

  let payload: unknown;
  try {
    payload = JSON.parse(data.toString('utf8'));
  } catch {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Licence payload is not JSON' };
  }
  if (!isPayload(payload)) return { ok: false, code: 'INVALID_PAYLOAD', message: 'Licence payload is malformed' };

  if (payload.hardwareId !== null && payload.hardwareId !== opts.hardwareId) {
    return { ok: false, code: 'HARDWARE_MISMATCH', message: 'Licence is bound to a different machine' };
  }

  const now = (opts.now ?? new Date()).getTime();
  if (Date.parse(payload.issuedAt) > now) {
    return { ok: false, code: 'NOT_YET_VALID', message: 'Licence is not valid yet' };
  }
  if (payload.expiresAt !== null && Date.parse(payload.expiresAt) <= now) {
    return { ok: false, code: 'EXPIRED', message: 'Licence has expired' };
  }

  return { ok: true, payload };
}

/**
 * MVP-NOTE: a real deployment should use the OS machine id / TPM-backed identifier and tolerate
 * a single changed component. This derives a stable-enough id from hostname, platform, CPU and MACs.
 */
export function hardwareFingerprint(): string {
  const macs = Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((i) => !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')
    .map((i) => i.mac)
    .sort();
  const material = [hostname(), platform(), arch(), cpus()[0]?.model ?? 'cpu', ...new Set(macs)].join('|');
  return createHash('sha256').update(material).digest('hex');
}
