// What BluxTech does with codes and licences, as pure functions over the ledger (no files, no console): the CLI reads
// and writes the files around them, the tests call them directly.
import { randomInt } from 'node:crypto';
import { formatLicenceText, signLicense, type LicensePayload } from '@victorflow/crypto';
import { activationCodeFrom, APP_RELEASE_DATE, CODE_ALPHABET, decodeRequestCode, LICENSE_FEATURES } from '@victorflow/types';
import type { KeyObject } from 'node:crypto';

/** Free transfers to a new server per activation code, unless `codes --transfers` says otherwise. */
export const FREE_TRANSFERS = 2;

export interface Terms {
  edition: string;
  modules: string[];
  seats: { desktop: number; mobile: number };
  updatesUntil: string;
}

export interface LicenceRecord {
  licenceId: string;
  hardwareId: string;
  issuedAt: string;
  kind: 'issue' | 'reissue' | 'transfer';
}

export interface TransferRecord {
  at: string;
  fromHardwareId: string;
  toHardwareId: string;
  licenceId: string;
  forced: boolean;
}

export interface CodeRecord {
  shop: string;
  createdAt: string;
  transferLimit: number;
  /** The server the code is activated on (null until the first licence). */
  hardwareId: string | null;
  terms: Terms | null;
  licences: LicenceRecord[];
  transfers: TransferRecord[];
}

export interface Ledger {
  version: 1;
  codes: Record<string, CodeRecord>;
}

export const emptyLedger = (): Ledger => ({ version: 1, codes: {} });

export class IssuerError extends Error {}

const isIsoDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Checks terms typed on the command line. Unknown modules are refused: a typo would silently lock a module. */
export function checkTerms(t: Terms): Terms {
  const unknown = t.modules.filter((m) => !(LICENSE_FEATURES as readonly string[]).includes(m));
  if (t.modules.length === 0) throw new IssuerError(`--modules: name at least one of ${LICENSE_FEATURES.join(', ')}`);
  if (unknown.length) throw new IssuerError(`--modules: unknown ${unknown.join(', ')} (known: ${LICENSE_FEATURES.join(', ')})`);
  if (!Number.isInteger(t.seats.desktop) || t.seats.desktop < 1) throw new IssuerError('--desktop-seats must be a whole number of at least 1');
  if (!Number.isInteger(t.seats.mobile) || t.seats.mobile < 0) throw new IssuerError('--mobile-users must be a whole number (0 or more)');
  if (!isIsoDay(t.updatesUntil)) throw new IssuerError('--updates-until must be a date as YYYY-MM-DD');
  if (t.updatesUntil < APP_RELEASE_DATE) throw new IssuerError(`--updates-until ${t.updatesUntil} is before this version's release (${APP_RELEASE_DATE}): the shop would be read-only at once`);
  if (!t.edition.trim() || t.edition.length > 60) throw new IssuerError('--edition must be 1 to 60 characters');
  return { ...t, modules: [...new Set(t.modules)] };
}

/** New activation codes for a shop, recorded as unused. */
export function createCodes(ledger: Ledger, opts: { shop: string; count: number; transferLimit?: number; now?: Date }): string[] {
  const shop = opts.shop.trim();
  if (!shop || shop.length > 200) throw new IssuerError('--shop: the shop name (1 to 200 characters)');
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > 100) throw new IssuerError('--count must be 1 to 100');
  const transferLimit = opts.transferLimit ?? FREE_TRANSFERS;
  if (!Number.isInteger(transferLimit) || transferLimit < 0) throw new IssuerError('--transfers must be 0 or more');
  const out: string[] = [];
  while (out.length < opts.count) {
    const code = activationCodeFrom(Array.from({ length: 11 }, () => randomInt(32)));
    if (ledger.codes[code]) continue; // astronomically unlikely, but a code must never be handed out twice
    ledger.codes[code] = { shop, createdAt: (opts.now ?? new Date()).toISOString(), transferLimit, hardwareId: null, terms: null, licences: [], transfers: [] };
    out.push(code);
  }
  return out;
}

export interface Issued {
  payload: LicensePayload;
  /** Armoured text: the .vfl file's content, and what is pasted on the shop's server. */
  text: string;
}

function newLicenceId(now: Date): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `LIC-${day}-${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(32)]).join('')}`;
}

function sign(code: string, rec: CodeRecord, hardwareId: string, terms: Terms, key: KeyObject | string, now: Date): Issued {
  const payload: LicensePayload = {
    v: 2,
    licenceId: newLicenceId(now),
    shop: rec.shop,
    activationCode: code,
    hardwareId,
    edition: terms.edition,
    seats: { ...terms.seats },
    modules: [...terms.modules],
    issuedAt: now.toISOString(),
    updatesUntil: terms.updatesUntil,
  };
  const header = [`VictorFlow licence ${payload.licenceId} - ${rec.shop}`, 'Paste everything below on the activation screen (or open this file there).', 'Collez tout ce qui suit sur l’écran d’activation (ou ouvrez ce fichier).'];
  return { payload, text: formatLicenceText(signLicense(payload, key), header) };
}

function parseRequest(ledger: Ledger, requestCode: string) {
  const req = decodeRequestCode(requestCode);
  if (!req) throw new IssuerError('This request code is incomplete or mistyped: ask the shop to send it again (copy and paste)');
  const rec = ledger.codes[req.activationCode];
  if (!rec) throw new IssuerError(`Unknown activation code ${req.activationCode}: it was not generated with this ledger`);
  return { req, rec };
}

/**
 * A licence for the server in the request code. A code is single use: once activated it is refused, except
 * `reissue` for the SAME server (the shop lost its file, or the terms changed). Another server is a transfer.
 */
export function issueLicence(ledger: Ledger, opts: { request: string; terms?: Partial<Terms>; key: KeyObject | string; reissue?: boolean; now?: Date }): Issued {
  const now = opts.now ?? new Date();
  const { req, rec } = parseRequest(ledger, opts.request);
  if (rec.hardwareId !== null) {
    const when = rec.licences[rec.licences.length - 1]?.issuedAt.slice(0, 10) ?? '?';
    if (!opts.reissue) throw new IssuerError(`${req.activationCode} was already activated on ${when} (server ${rec.hardwareId.slice(0, 12)}…). Same server: add --reissue. Another server: use "transfer".`);
    if (req.hardwareId !== rec.hardwareId) throw new IssuerError(`${req.activationCode} is activated on another server (${rec.hardwareId.slice(0, 12)}…): use "transfer" to move it`);
  } else if (opts.reissue) {
    throw new IssuerError(`${req.activationCode} has never been activated: issue it without --reissue`);
  }
  const base = rec.terms;
  const t = opts.terms ?? {};
  if (!base && (t.modules === undefined || t.seats?.desktop === undefined || t.seats?.mobile === undefined || t.updatesUntil === undefined)) {
    throw new IssuerError('A first licence needs --modules, --desktop-seats, --mobile-users and --updates-until');
  }
  const terms = checkTerms({
    edition: t.edition ?? base?.edition ?? 'Standard',
    modules: t.modules ?? base!.modules,
    seats: { desktop: t.seats?.desktop ?? base!.seats.desktop, mobile: t.seats?.mobile ?? base!.seats.mobile },
    updatesUntil: t.updatesUntil ?? base!.updatesUntil,
  });
  const issued = sign(req.activationCode, rec, req.hardwareId, terms, opts.key, now);
  rec.hardwareId = req.hardwareId;
  rec.terms = terms;
  rec.licences.push({ licenceId: issued.payload.licenceId, hardwareId: req.hardwareId, issuedAt: issued.payload.issuedAt, kind: opts.reissue ? 'reissue' : 'issue' });
  return issued;
}

/**
 * The shop's server was replaced (new computer, new disk, Windows reinstalled): a licence for the NEW hardware id in
 * the request code, with the same terms unless overridden. Counted against the code's free transfers; `force` goes
 * beyond them (and is recorded). The old server's licence cannot be revoked offline — it keeps working there.
 */
export function transferLicence(ledger: Ledger, opts: { request: string; terms?: Partial<Terms>; key: KeyObject | string; force?: boolean; now?: Date }): Issued & { transfer: TransferRecord; transfersUsed: number } {
  const now = opts.now ?? new Date();
  const { req, rec } = parseRequest(ledger, opts.request);
  if (rec.hardwareId === null || !rec.terms) throw new IssuerError(`${req.activationCode} has never been activated: use "issue"`);
  if (req.hardwareId === rec.hardwareId) throw new IssuerError(`${req.activationCode} is already on this server: use "issue --reissue" to send its licence again`);
  if (rec.transfers.length >= rec.transferLimit && !opts.force) {
    throw new IssuerError(`${req.activationCode} has used its ${rec.transferLimit} free transfer(s). Add --force to transfer anyway (it is recorded).`);
  }
  const t = opts.terms ?? {};
  const terms = checkTerms({
    edition: t.edition ?? rec.terms.edition,
    modules: t.modules ?? rec.terms.modules,
    seats: { desktop: t.seats?.desktop ?? rec.terms.seats.desktop, mobile: t.seats?.mobile ?? rec.terms.seats.mobile },
    updatesUntil: t.updatesUntil ?? rec.terms.updatesUntil,
  });
  const issued = sign(req.activationCode, rec, req.hardwareId, terms, opts.key, now);
  const transfer: TransferRecord = { at: now.toISOString(), fromHardwareId: rec.hardwareId, toHardwareId: req.hardwareId, licenceId: issued.payload.licenceId, forced: rec.transfers.length >= rec.transferLimit };
  rec.transfers.push(transfer);
  rec.hardwareId = req.hardwareId;
  rec.terms = terms;
  rec.licences.push({ licenceId: issued.payload.licenceId, hardwareId: req.hardwareId, issuedAt: issued.payload.issuedAt, kind: 'transfer' });
  return { ...issued, transfer, transfersUsed: rec.transfers.length };
}
