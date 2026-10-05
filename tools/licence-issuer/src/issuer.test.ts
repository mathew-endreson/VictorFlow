import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateLicenseKeyPair, verifyLicense } from '@victorflow/crypto';
import { APP_RELEASE_DATE, encodeRequestCode, isValidActivationCode } from '@victorflow/types';
import { afterAll, describe, expect, it } from 'vitest';
import { invokedDirectly, run } from './cli';
import { loadLedger, repositoryContaining } from './files';
import { createCodes, emptyLedger, FREE_TRANSFERS, issueLicence, transferLicence, type Ledger } from './issuer';

const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const work = mkdtempSync(path.join(tmpdir(), 'vf-issuer-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const keys = generateLicenseKeyPair();
const HW_A = 'a'.repeat(64);
const HW_B = 'b'.repeat(64);
const HW_C = 'c'.repeat(64);
const TERMS = { modules: ['crm', 'sales', 'production'], seats: { desktop: 3, mobile: 5 }, updatesUntil: '2027-10-05', edition: 'Standard' };

const verifyOn = (text: string, hardwareId: string) => verifyLicense({ token: text, publicKey: keys.publicKeyPem, hardwareId, releaseDate: APP_RELEASE_DATE });

function freshCode(ledger: Ledger = emptyLedger(), transferLimit?: number) {
  const [code] = createCodes(ledger, { shop: 'Imprimerie El Djazair', count: 1, transferLimit });
  return { ledger, code: code! };
}
const request = (code: string, hardwareId: string) => encodeRequestCode({ activationCode: code, hardwareId });

describe('codes', () => {
  it('creates valid single-use codes for a shop, recorded as unused', () => {
    const ledger = emptyLedger();
    const codes = createCodes(ledger, { shop: 'Victor Pub', count: 5 });
    expect(new Set(codes).size).toBe(5);
    for (const c of codes) {
      expect(isValidActivationCode(c)).toBe(true);
      expect(ledger.codes[c]).toMatchObject({ shop: 'Victor Pub', hardwareId: null, terms: null, licences: [], transfers: [], transferLimit: FREE_TRANSFERS });
    }
    expect(() => createCodes(ledger, { shop: ' ', count: 1 })).toThrow(/shop/);
    expect(() => createCodes(ledger, { shop: 'x', count: 0 })).toThrow(/count/);
  });
});

describe('issue', () => {
  it('signs a licence for the server in the request code, which the server accepts', () => {
    const { ledger, code } = freshCode();
    const { payload, text } = issueLicence(ledger, { request: request(code, HW_A), terms: TERMS, key: keys.privateKeyPem });
    expect(payload).toMatchObject({ v: 2, shop: 'Imprimerie El Djazair', activationCode: code, hardwareId: HW_A, ...TERMS });
    expect(payload.licenceId).toMatch(/^LIC-\d{8}-[2-9A-HJ-NP-Z]{6}$/);
    expect(verifyOn(text, HW_A).ok).toBe(true);
    expect(verifyOn(text, HW_B)).toMatchObject({ ok: false, code: 'HARDWARE_MISMATCH' });
    expect(ledger.codes[code]).toMatchObject({ hardwareId: HW_A, terms: TERMS, licences: [{ licenceId: payload.licenceId, hardwareId: HW_A, kind: 'issue' }] });
  });

  it('a code is SINGLE USE: refused a second time, even for the same server, unless --reissue', () => {
    const { ledger, code } = freshCode();
    issueLicence(ledger, { request: request(code, HW_A), terms: TERMS, key: keys.privateKeyPem });
    expect(() => issueLicence(ledger, { request: request(code, HW_A), terms: TERMS, key: keys.privateKeyPem })).toThrow(/already activated.*--reissue/);
    expect(() => issueLicence(ledger, { request: request(code, HW_B), terms: TERMS, key: keys.privateKeyPem })).toThrow(/already activated/);
  });

  it('--reissue: the same server again (lost file, changed terms), never another server', () => {
    const { ledger, code } = freshCode();
    issueLicence(ledger, { request: request(code, HW_A), terms: TERMS, key: keys.privateKeyPem });
    const again = issueLicence(ledger, { request: request(code, HW_A), terms: { seats: { desktop: 6, mobile: 5 } }, key: keys.privateKeyPem, reissue: true });
    expect(again.payload).toMatchObject({ hardwareId: HW_A, seats: { desktop: 6, mobile: 5 }, modules: TERMS.modules });
    expect(verifyOn(again.text, HW_A).ok).toBe(true);
    expect(() => issueLicence(ledger, { request: request(code, HW_B), key: keys.privateKeyPem, reissue: true })).toThrow(/another server.*transfer/);
    const unused = freshCode(ledger).code;
    expect(() => issueLicence(ledger, { request: request(unused, HW_A), terms: TERMS, key: keys.privateKeyPem, reissue: true })).toThrow(/never been activated/);
  });

  it('refuses unknown codes, mistyped request codes, missing or wrong terms', () => {
    const { ledger, code } = freshCode();
    const other = createCodes(emptyLedger(), { shop: 'Elsewhere', count: 1 })[0]!;
    expect(() => issueLicence(ledger, { request: request(other, HW_A), terms: TERMS, key: keys.privateKeyPem })).toThrow(/Unknown activation code/);
    expect(() => issueLicence(ledger, { request: request(code, HW_A).slice(0, -2), terms: TERMS, key: keys.privateKeyPem })).toThrow(/mistyped/);
    expect(() => issueLicence(ledger, { request: request(code, HW_A), terms: { modules: ['crm'] }, key: keys.privateKeyPem })).toThrow(/needs --modules/);
    expect(() => issueLicence(ledger, { request: request(code, HW_A), terms: { ...TERMS, modules: ['crm', 'payrol'] }, key: keys.privateKeyPem })).toThrow(/unknown payrol/);
    expect(() => issueLicence(ledger, { request: request(code, HW_A), terms: { ...TERMS, seats: { desktop: 0, mobile: 1 } }, key: keys.privateKeyPem })).toThrow(/desktop-seats/);
    expect(() => issueLicence(ledger, { request: request(code, HW_A), terms: { ...TERMS, updatesUntil: '2020-01-01' }, key: keys.privateKeyPem })).toThrow(/read-only at once/);
    expect(ledger.codes[code]!.hardwareId).toBeNull(); // nothing was recorded by the refusals
  });
});

describe('transfer', () => {
  it('moves the licence to the new server with the same terms, and records where it came from', () => {
    const { ledger, code } = freshCode();
    const first = issueLicence(ledger, { request: request(code, HW_A), terms: TERMS, key: keys.privateKeyPem });
    const t = transferLicence(ledger, { request: request(code, HW_B), key: keys.privateKeyPem });
    expect(t.payload).toMatchObject({ activationCode: code, hardwareId: HW_B, ...TERMS });
    expect(t.payload.licenceId).not.toBe(first.payload.licenceId);
    expect(verifyOn(t.text, HW_B).ok).toBe(true);
    expect(verifyOn(t.text, HW_A)).toMatchObject({ ok: false, code: 'HARDWARE_MISMATCH' });
    expect(t.transfersUsed).toBe(1);
    expect(ledger.codes[code]).toMatchObject({ hardwareId: HW_B, transfers: [{ fromHardwareId: HW_A, toHardwareId: HW_B, licenceId: t.payload.licenceId, forced: false }] });
    expect(ledger.codes[code]!.licences.map((l) => l.kind)).toEqual(['issue', 'transfer']);
  });

  it('may change the terms while moving', () => {
    const { ledger, code } = freshCode();
    issueLicence(ledger, { request: request(code, HW_A), terms: TERMS, key: keys.privateKeyPem });
    const t = transferLicence(ledger, { request: request(code, HW_B), terms: { modules: ['crm'], updatesUntil: '2028-01-01' }, key: keys.privateKeyPem });
    expect(t.payload).toMatchObject({ modules: ['crm'], updatesUntil: '2028-01-01', seats: TERMS.seats });
  });

  it('refuses after the free transfers unless --force, which is recorded', () => {
    const { ledger, code } = freshCode(emptyLedger(), 1);
    issueLicence(ledger, { request: request(code, HW_A), terms: TERMS, key: keys.privateKeyPem });
    transferLicence(ledger, { request: request(code, HW_B), key: keys.privateKeyPem });
    expect(() => transferLicence(ledger, { request: request(code, HW_C), key: keys.privateKeyPem })).toThrow(/used its 1 free transfer.*--force/);
    expect(ledger.codes[code]!.hardwareId).toBe(HW_B);
    const forced = transferLicence(ledger, { request: request(code, HW_C), key: keys.privateKeyPem, force: true });
    expect(forced.transfer).toMatchObject({ fromHardwareId: HW_B, toHardwareId: HW_C, forced: true });
    expect(forced.transfersUsed).toBe(2);
    expect(verifyOn(forced.text, HW_C).ok).toBe(true);
  });

  it('refuses a code never activated, the same server, and an unknown code', () => {
    const { ledger, code } = freshCode();
    expect(() => transferLicence(ledger, { request: request(code, HW_B), key: keys.privateKeyPem })).toThrow(/never been activated.*issue/);
    issueLicence(ledger, { request: request(code, HW_A), terms: TERMS, key: keys.privateKeyPem });
    expect(() => transferLicence(ledger, { request: request(code, HW_A), key: keys.privateKeyPem })).toThrow(/already on this server.*--reissue/);
    const other = createCodes(emptyLedger(), { shop: 'Elsewhere', count: 1 })[0]!;
    expect(() => transferLicence(ledger, { request: request(other, HW_B), key: keys.privateKeyPem })).toThrow(/Unknown activation code/);
  });
});

describe('the CLI, with files', () => {
  const keyDir = path.join(work, 'keys');
  const ledger = path.join(work, 'ledger', 'ledger.json');

  it('keygen writes the pair once, prints the public key line, and refuses a folder inside a repository', () => {
    const out = run(['keygen', '--out', keyDir]);
    expect(out).toMatch(/MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=/);
    expect(out).not.toMatch(/PRIVATE KEY-----\n/);
    expect(() => run(['keygen', '--out', keyDir])).toThrow(/never replaces a key/);
    expect(() => run(['keygen', '--out', path.join(REPO, 'keys-here')])).toThrow(/inside a repository/);
    expect(existsSync(path.join(REPO, 'keys-here'))).toBe(false);
    expect(repositoryContaining(REPO)).toBe(REPO);
    expect(repositoryContaining(work)).toBeNull();
  });

  it('codes → issue → transfer → inspect, end to end, with the licence files written', () => {
    const [code] = run(['codes', '--ledger', ledger, '--shop', 'Victor Pub', '--count', '1']).split('\n');
    expect(isValidActivationCode(code!)).toBe(true);
    const key = path.join(keyDir, 'licence-private-key.pem');
    const printed = run(['issue', '--key', key, '--ledger', ledger, '--request', request(code!, HW_A), '--modules', 'crm,sales', '--desktop-seats', '2', '--mobile-users', '4', '--updates-until', '2027-10-05']);
    expect(printed).toContain('-----BEGIN VICTORFLOW LICENCE-----');
    const out = path.join(path.dirname(ledger), 'licences');
    const vfl = readdirSync(out).find((f) => f.endsWith('.vfl'))!;
    const pub = path.join(keyDir, 'licence-public-key.pem');
    const text = readFileSync(path.join(out, vfl), 'utf8');
    expect(verifyLicense({ token: text, publicKey: readFileSync(pub, 'utf8'), hardwareId: HW_A, releaseDate: APP_RELEASE_DATE }).ok).toBe(true);
    expect(readFileSync(path.join(out, vfl.replace('.vfl', '.txt')), 'utf8')).toContain('\r\n'); // Windows-friendly text version
    expect(run(['inspect', path.join(out, vfl), '--public-key', pub])).toMatch(/"shop": "Victor Pub"[\s\S]*signature: VALID/);

    const moved = run(['transfer', '--key', key, '--ledger', ledger, '--request', request(code!, HW_B)]);
    expect(moved).toMatch(/Transfer 1 of 2 free/);
    expect(loadLedger(ledger).codes[code!]).toMatchObject({ hardwareId: HW_B, transfers: [{ fromHardwareId: HW_A, toHardwareId: HW_B }] });
    expect(readdirSync(out).filter((f) => f.endsWith('.vfl'))).toHaveLength(2);
  });

  it('refuses a private key or a ledger inside a repository', () => {
    expect(() => run(['issue', '--key', path.join(REPO, 'k.pem'), '--ledger', ledger, '--request', 'x'])).toThrow(/private key must not be inside a repository/);
    expect(() => run(['codes', '--ledger', path.join(REPO, 'ledger.json'), '--shop', 'X'])).toThrow(/ledger must not be inside a repository/);
  });

  it('runs when started directly under any file name (dist/licence-issuer.mjs, the kit cli.mjs), not when imported', () => {
    const file = path.join(work, 'kit', 'cli.mjs');
    expect(invokedDirectly(file, pathToFileURL(file).href)).toBe(true);
    expect(invokedDirectly(path.relative(process.cwd(), file), pathToFileURL(file).href)).toBe(true);
    expect(invokedDirectly(path.join(work, 'vitest.mjs'), pathToFileURL(file).href)).toBe(false);
    expect(invokedDirectly(undefined, pathToFileURL(file).href)).toBe(false);
  });

  it('explains its usage, and refuses unknown commands and missing values', () => {
    expect(run(['help'])).toContain('keygen');
    expect(() => run(['frobnicate'])).toThrow(/unknown command/);
    expect(() => run(['codes', '--ledger'])).toThrow(/needs a value/);
  });
});

describe('never shipped', () => {
  it('no app or package of the product depends on the issuer, and the server installer does not stage it', () => {
    for (const group of ['apps', 'packages']) {
      for (const name of readdirSync(path.join(REPO, group))) {
        const pkg = path.join(REPO, group, name, 'package.json');
        if (!existsSync(pkg)) continue;
        expect(readFileSync(pkg, 'utf8'), `${group}/${name}`).not.toContain('licence-issuer');
      }
    }
    expect(readFileSync(path.join(REPO, 'apps', 'server-host', 'scripts', 'stage.mjs'), 'utf8')).not.toContain('licence-issuer');
  });
});
