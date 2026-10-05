// The files around the issuer: the key pair, the ledger, and the licences it writes — and the rule that the private
// key and the ledger never live inside a repository (where they could be committed by accident).
import { createPrivateKey, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { publicKeyLine } from '@victorflow/crypto';
import { IssuerError, emptyLedger, type Ledger } from './issuer';

/** The repository (a VictorFlow checkout or any git repo) that contains `p`, or null. */
export function repositoryContaining(p: string, exists: (f: string) => boolean = existsSync): string | null {
  let dir = path.resolve(p);
  for (;;) {
    if (exists(path.join(dir, 'pnpm-workspace.yaml')) || exists(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function refuseInsideRepository(p: string, what: string): void {
  const repo = repositoryContaining(p);
  if (repo) throw new IssuerError(`${what} must not be inside a repository (${repo}): keep it on the offline BluxTech machine, outside any checkout`);
}

export const PRIVATE_KEY_FILE = 'licence-private-key.pem';
export const PUBLIC_KEY_FILE = 'licence-public-key.pem';

/** Creates the key pair in `dir`. Never overwrites: losing the private key means re-keying every future release. */
export function keygen(dir: string): { privateKeyFile: string; publicKeyFile: string; publicKeyLine: string } {
  refuseInsideRepository(dir, 'The key folder');
  mkdirSync(dir, { recursive: true });
  const privateKeyFile = path.join(dir, PRIVATE_KEY_FILE);
  const publicKeyFile = path.join(dir, PUBLIC_KEY_FILE);
  for (const f of [privateKeyFile, publicKeyFile]) if (existsSync(f)) throw new IssuerError(`${f} already exists: keygen never replaces a key`);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(privateKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  writeFileSync(publicKeyFile, publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
  return { privateKeyFile, publicKeyFile, publicKeyLine: publicKeyLine(publicKey) };
}

export function loadPrivateKey(file: string): KeyObject {
  refuseInsideRepository(file, 'The private key');
  let key: KeyObject;
  try {
    key = createPrivateKey(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new IssuerError(`${file} is not a readable private key (${(e as Error).message})`);
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new IssuerError(`${file} is a ${key.asymmetricKeyType} key, not Ed25519`);
  return key;
}

export function loadLedger(file: string, { create = false } = {}): Ledger {
  refuseInsideRepository(file, 'The ledger');
  if (!existsSync(file)) {
    if (create) return emptyLedger();
    throw new IssuerError(`${file} does not exist: create codes first ("codes --ledger ${file} …")`);
  }
  const data = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Ledger;
  if (data?.version !== 1 || typeof data.codes !== 'object') throw new IssuerError(`${file} is not a licence-issuer ledger`);
  return data;
}

/** Written next to the old one, then renamed over it: a crash never leaves half a ledger. */
export function saveLedger(file: string, ledger: Ledger): void {
  refuseInsideRepository(file, 'The ledger');
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

/** <licenceId>.vfl (opened on the server) and <licenceId>.txt (pasted into WhatsApp): the same armoured text. */
export function writeLicenceFiles(dir: string, licenceId: string, text: string): { vfl: string; txt: string } {
  mkdirSync(dir, { recursive: true });
  const vfl = path.join(dir, `${licenceId}.vfl`);
  const txt = path.join(dir, `${licenceId}.txt`);
  writeFileSync(vfl, text, { flag: 'wx' });
  writeFileSync(txt, text.replace(/\n/g, '\r\n'), { flag: 'wx' });
  return { vfl, txt };
}
