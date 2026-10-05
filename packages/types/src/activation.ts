// Activation codes and request codes: what BluxTech sells and what the shop sends back. Pure TypeScript, so the desktop
// app checks a code as it is typed and the server and the issuer read it the same way.
//
//   activation code   VF-7K2M-9QXA-4TPL         11 random characters + 1 check character
//   request code      VFR1-XXXXX-XXXXX-…        the activation code + this server's hardware id + 1 check character
//
// One 32-character alphabet without 0/O and 1/I, so a code read out over the phone cannot be misheard as another.

export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const VALUE = new Map([...CODE_ALPHABET].map((c, i) => [c, i]));

/** Multiplication by 2 in GF(32) (polynomial x^5 + x^2 + 1). */
const times2 = (v: number) => ((v << 1) & 0x1f) ^ (v & 0x10 ? 0x05 : 0);

/**
 * The check character of `body` (characters of CODE_ALPHABET). Each character is added to twice the running value in
 * GF(32), so every single wrong character and every swap of two neighbouring characters gives a different result.
 */
export function checkCharacter(body: string): string {
  let acc = 0;
  for (const c of body) {
    const v = VALUE.get(c);
    if (v === undefined) throw new Error(`"${c}" is not a code character`);
    acc = times2(acc) ^ v;
  }
  return CODE_ALPHABET[times2(acc)]!;
}

/** Whether `withCheck` (body + its check character) is consistent. */
function hasValidCheck(withCheck: string): boolean {
  if (withCheck.length < 2 || ![...withCheck].every((c) => VALUE.has(c))) return false;
  return checkCharacter(withCheck.slice(0, -1)) === withCheck.slice(-1);
}

/** Upper case, without spaces, dashes or anything else that is not a letter or digit. */
const squash = (input: string) => input.toUpperCase().replace(/[^0-9A-Z]/g, '');

// ── activation code ─────────────────────────────────────────────────────────────────────────────────────────────

export const ACTIVATION_CODE_LENGTH = 12;

/** The 12 characters of an activation code typed in any form ("vf 7k2m 9qxa 4tpl", "VF-7K2M-9QXA-4TPL" …), or null. */
export function normalizeActivationCode(input: string): string | null {
  let s = squash(input);
  if (s.length === ACTIVATION_CODE_LENGTH + 2 && s.startsWith('VF')) s = s.slice(2);
  return s.length === ACTIVATION_CODE_LENGTH && hasValidCheck(s) ? s : null;
}

export const isValidActivationCode = (input: string): boolean => normalizeActivationCode(input) !== null;

/** "VF-7K2M-9QXA-4TPL" from any accepted form; throws on an invalid code. */
export function formatActivationCode(input: string): string {
  const s = normalizeActivationCode(input);
  if (!s) throw new Error('Invalid activation code');
  return `VF-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** A new code from 11 random alphabet indexes (0-31); the caller supplies the randomness (crypto on the issuer). */
export function activationCodeFrom(randomIndexes: readonly number[]): string {
  if (randomIndexes.length !== ACTIVATION_CODE_LENGTH - 1 || randomIndexes.some((i) => !Number.isInteger(i) || i < 0 || i > 31)) {
    throw new Error('An activation code needs 11 indexes from 0 to 31');
  }
  const body = randomIndexes.map((i) => CODE_ALPHABET[i]).join('');
  return formatActivationCode(body + checkCharacter(body));
}

// ── request code ────────────────────────────────────────────────────────────────────────────────────────────────

const REQUEST_PREFIX = 'VFR1';
const HARDWARE_ID = /^[0-9a-f]{64}$/;
/** 32 bytes = 256 bits → 52 characters of 5 bits (the last 4 bits are zero). */
const HW_CHARS = 52;

function hexToBase32(hex: string): string {
  let bits = '';
  for (const h of hex) bits += parseInt(h, 16).toString(2).padStart(4, '0');
  bits = bits.padEnd(HW_CHARS * 5, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += CODE_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32ToHex(s: string): string | null {
  let bits = '';
  for (const c of s) bits += VALUE.get(c)!.toString(2).padStart(5, '0');
  if (/1/.test(bits.slice(256))) return null; // the padding must be zero
  let hex = '';
  for (let i = 0; i < 256; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export interface ActivationRequest {
  /** "VF-XXXX-XXXX-XXXX" */
  activationCode: string;
  /** 64 lower-case hex characters (SHA-256). */
  hardwareId: string;
}

/** The code the shop sends to BluxTech (by WhatsApp, or read out over the phone), in groups of 5. */
export function encodeRequestCode(req: ActivationRequest): string {
  const code = normalizeActivationCode(req.activationCode);
  if (!code) throw new Error('Invalid activation code');
  if (!HARDWARE_ID.test(req.hardwareId)) throw new Error('A hardware id is 64 lower-case hex characters');
  const body = code + hexToBase32(req.hardwareId);
  const full = body + checkCharacter(body);
  return [REQUEST_PREFIX, ...(full.match(/.{1,5}/g) ?? [])].join('-');
}

/** Reads a request code back, in any spacing or case; null when it is incomplete, mistyped or not a request code. */
export function decodeRequestCode(input: string): ActivationRequest | null {
  const s = squash(input);
  if (!s.startsWith(REQUEST_PREFIX)) return null;
  const full = s.slice(REQUEST_PREFIX.length);
  if (full.length !== ACTIVATION_CODE_LENGTH + HW_CHARS + 1 || !hasValidCheck(full)) return null;
  const code = full.slice(0, ACTIVATION_CODE_LENGTH);
  if (!hasValidCheck(code)) return null;
  const hardwareId = base32ToHex(full.slice(ACTIVATION_CODE_LENGTH, ACTIVATION_CODE_LENGTH + HW_CHARS));
  return hardwareId ? { activationCode: formatActivationCode(code), hardwareId } : null;
}
