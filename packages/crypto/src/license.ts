import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

/**
 * A licence is  base64url(payloadJson) "." base64url(ed25519Signature),  usually wrapped in armour lines (see
 * formatLicenceText). The signature covers the exact payload bytes that are transmitted — the JSON is never
 * re-serialised before verifying, so key order or whitespace cannot be used to forge or break a licence.
 *
 * A licence is perpetual and bound to one server (its hardware id). `updatesUntil` limits which VERSIONS it covers:
 * a version released after that date runs read-only on it (UPDATES_EXPIRED).
 */
export interface LicensePayload {
  v: 2;
  licenceId: string;
  /** The shop's name, as BluxTech recorded it. */
  shop: string;
  /** "VF-XXXX-XXXX-XXXX": the activation code this licence was issued for. */
  activationCode: string;
  /** The server's hardware id (64 hex characters, see hardwareId()). */
  hardwareId: string;
  /** Display only, e.g. "Standard". */
  edition: string;
  seats: { desktop: number; mobile: number };
  /** Module ids (crm, sales, production …); unknown ids are ignored by the server. */
  modules: string[];
  issuedAt: string; // ISO-8601
  updatesUntil: string; // YYYY-MM-DD
}

export type LicenseFailureCode = 'MALFORMED' | 'BAD_SIGNATURE' | 'INVALID_PAYLOAD' | 'HARDWARE_MISMATCH' | 'NOT_YET_VALID' | 'UPDATES_EXPIRED';

export type LicenseVerdict =
  | { ok: true; payload: LicensePayload }
  /** `payload` is set when the signature was good (the licence is authentic but does not apply here). */
  | { ok: false; code: LicenseFailureCode; message: string; payload?: LicensePayload };

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

/** The public key as one line of base64 (DER SubjectPublicKeyInfo) — the form licence-public-key.ts holds. */
export function publicKeyLine(key: string | KeyObject): string {
  return toPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
}

export function generateLicenseKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Issuer side (tools/licence-issuer, tests). Ed25519 takes `null` as the digest algorithm. Returns the bare token. */
export function signLicense(payload: LicensePayload, privateKey: string | KeyObject): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = sign(null, data, toPrivateKey(privateKey));
  return `${b64u(data)}.${b64u(signature)}`;
}

// ── armour: the text pasted from WhatsApp and the .vfl file are the same thing ──────────────────────────────────────

export const LICENCE_BEGIN = '-----BEGIN VICTORFLOW LICENCE-----';
export const LICENCE_END = '-----END VICTORFLOW LICENCE-----';

/** The token wrapped at 64 characters between armour lines; `header` lines (for people) go above and are ignored. */
export function formatLicenceText(token: string, header: string[] = []): string {
  const lines = token.match(/.{1,64}/g) ?? [];
  return [...header, ...(header.length ? [''] : []), LICENCE_BEGIN, ...lines, LICENCE_END, ''].join('\n');
}

/** The bare token from armoured text (anything outside the armour is ignored) or from a bare token; whitespace removed. */
export function extractLicenceToken(text: string): string {
  const begin = text.indexOf(LICENCE_BEGIN);
  let body = text;
  if (begin >= 0) {
    const from = begin + LICENCE_BEGIN.length;
    const end = text.indexOf(LICENCE_END, from);
    body = end >= 0 ? text.slice(from, end) : text.slice(from);
  }
  return body.replace(/\s+/g, '');
}

/** The payload WITHOUT checking the signature — for support tools only (inspect). Never trust it. */
export function decodeLicensePayloadUnverified(text: string): unknown {
  const [p] = extractLicenceToken(text).split('.');
  try {
    return JSON.parse(Buffer.from(p ?? '', 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// ── verification ───────────────────────────────────────────────────────────────────────────────────────────────────

const ACTIVATION_CODE = /^VF-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;
const HARDWARE_ID = /^[0-9a-f]{64}$/;

export function isIsoDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const text = (v: unknown, max: number) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const count = (v: unknown, min: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 100_000;

export function isLicensePayload(v: unknown): v is LicensePayload {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  const seats = p.seats as Record<string, unknown> | null | undefined;
  return (
    p.v === 2 &&
    text(p.licenceId, 64) &&
    text(p.shop, 200) &&
    typeof p.activationCode === 'string' &&
    ACTIVATION_CODE.test(p.activationCode) &&
    typeof p.hardwareId === 'string' &&
    HARDWARE_ID.test(p.hardwareId) &&
    text(p.edition, 60) &&
    typeof seats === 'object' &&
    seats !== null &&
    count(seats.desktop, 1) &&
    count(seats.mobile, 0) &&
    Array.isArray(p.modules) &&
    p.modules.every((m) => typeof m === 'string' && m.length <= 40) &&
    typeof p.issuedAt === 'string' &&
    !Number.isNaN(Date.parse(p.issuedAt)) &&
    isIsoDay(p.updatesUntil)
  );
}

export interface VerifyLicenseOptions {
  /** Armoured licence text or a bare token. */
  token: string;
  publicKey: string | KeyObject;
  /** This server's hardware id (see hardwareId()). */
  hardwareId: string;
  /** YYYY-MM-DD release date of the running version (APP_RELEASE_DATE). */
  releaseDate: string;
  now?: Date;
}

/** A licence issued "in the future" by less than this is accepted: the shop's clock may be a little behind BluxTech's. */
const CLOCK_TOLERANCE_MS = 24 * 3600_000;

/**
 * Order matters: authenticity first (nothing in an unsigned payload is trusted or even parsed as policy), then the
 * payload's shape, the hardware binding, the issue date and finally whether the licence covers this version.
 */
export function verifyLicense(opts: VerifyLicenseOptions): LicenseVerdict {
  const parts = extractLicenceToken(opts.token).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !/^[\w-]+$/.test(parts[0]) || !/^[\w-]+$/.test(parts[1])) {
    return { ok: false, code: 'MALFORMED', message: 'This is not a VictorFlow licence' };
  }
  const data = Buffer.from(parts[0], 'base64url');
  const signature = Buffer.from(parts[1], 'base64url');

  let valid: boolean;
  try {
    // Ed25519: algorithm MUST be null. (createVerify('SHA512') is the wrong primitive for Ed25519.)
    valid = verify(null, data, toPublicKey(opts.publicKey), signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, code: 'BAD_SIGNATURE', message: 'The licence signature is invalid (the licence was changed, or not issued by BluxTech)' };

  let payload: unknown;
  try {
    payload = JSON.parse(data.toString('utf8'));
  } catch {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'The licence content is not readable' };
  }
  if (!isLicensePayload(payload)) return { ok: false, code: 'INVALID_PAYLOAD', message: 'The licence content is incomplete or of an unknown version' };

  if (payload.hardwareId !== opts.hardwareId) {
    return { ok: false, code: 'HARDWARE_MISMATCH', message: 'This licence is for another server', payload };
  }
  if (Date.parse(payload.issuedAt) > (opts.now ?? new Date()).getTime() + CLOCK_TOLERANCE_MS) {
    return { ok: false, code: 'NOT_YET_VALID', message: "The licence is dated in the future: check this server's date and time", payload };
  }
  if (payload.updatesUntil < opts.releaseDate) {
    return { ok: false, code: 'UPDATES_EXPIRED', message: `This licence covers versions released up to ${payload.updatesUntil}; this version was released on ${opts.releaseDate}`, payload };
  }
  return { ok: true, payload };
}
