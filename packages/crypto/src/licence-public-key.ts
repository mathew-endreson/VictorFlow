import { createHash, createPublicKey, type KeyObject } from 'node:crypto';

/**
 * BluxTech's licence public key (Ed25519, DER SubjectPublicKeyInfo, base64 on ONE line).
 * The server trusts only this key in production; its private key never leaves BluxTech's offline machine.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ PLACEHOLDER — replace with the line printed by `licence-issuer keygen` on the offline BluxTech machine.     │
 * │ Nobody holds the private key of the placeholder (it was thrown away when it was made), so no licence can     │
 * │ ever be valid with it: the API refuses to start in production with it, and the release build fails on it    │
 * │ (apps/server-host/scripts/licence-key.mjs check). Tests and the CI smoke test swap in throwaway keys.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export const LICENCE_PUBLIC_KEY = 'MCowBQYDK2VwAyEApzSgGC/hHRZmG6pPoHo1DxqpboJjImVAnL+fAl+oWjk=';

/**
 * SHA-256 of the placeholder key's DER bytes. Compared by hash, not by the key's text: the CI test build replaces that
 * text with a throwaway key, and must then NOT be taken for the placeholder.
 */
const PLACEHOLDER_SHA256 = '64b9bc744732bab77c770a8313e6fcde3efe3a35251c511d04dec80525de093d';

/** Whether `key` (base64 DER or PEM) is the placeholder above. A key that cannot be parsed is not the placeholder. */
export function isPlaceholderLicenceKey(key: string | KeyObject): boolean {
  try {
    const obj = typeof key !== 'string' ? key : key.includes('-----BEGIN') ? createPublicKey(key) : createPublicKey({ key: Buffer.from(key.trim(), 'base64'), format: 'der', type: 'spki' });
    const der = obj.export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(der).digest('hex') === PLACEHOLDER_SHA256;
  } catch {
    return false;
  }
}
