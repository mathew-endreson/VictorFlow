import { createPublicKey, sign, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LICENCE_BEGIN,
  LICENCE_END,
  LICENCE_PUBLIC_KEY,
  decodeLicensePayloadUnverified,
  extractLicenceToken,
  formatLicenceText,
  generateLicenseKeyPair,
  hardwareId,
  isPlaceholderLicenceKey,
  publicKeyLine,
  signLicense,
  verifyLicense,
  type HardwareReaders,
  type LicensePayload,
} from './index';

describe('Ed25519 licence (v2)', () => {
  const { publicKeyPem, privateKeyPem } = generateLicenseKeyPair();
  const HW = 'a'.repeat(64);
  const RELEASE = '2026-10-05';
  const base: LicensePayload = {
    v: 2,
    licenceId: 'LIC-0001',
    shop: 'Imprimerie El Djazair',
    activationCode: 'VF-7K2M-9QXA-4TPL',
    hardwareId: HW,
    edition: 'Standard',
    seats: { desktop: 3, mobile: 5 },
    modules: ['crm', 'sales', 'finance'],
    issuedAt: '2026-10-01T00:00:00.000Z',
    updatesUntil: '2027-10-01',
  };
  const now = new Date('2026-10-05T12:00:00.000Z');
  const check = (token: string, over: Partial<{ hardwareId: string; releaseDate: string; now: Date; publicKey: string }> = {}) =>
    verifyLicense({ token, publicKey: publicKeyPem, hardwareId: HW, releaseDate: RELEASE, now, ...over });

  it('accepts a VALID licence, as a bare token and as armoured text with a header', () => {
    const token = signLicense(base, privateKeyPem);
    const v = check(token);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.payload).toEqual(base);
    const armoured = formatLicenceText(token, ['VictorFlow licence for Imprimerie El Djazair', 'Paste everything below']);
    expect(armoured).toContain(LICENCE_BEGIN);
    const body = armoured.slice(armoured.indexOf(LICENCE_BEGIN) + LICENCE_BEGIN.length, armoured.indexOf(LICENCE_END)).trim().split('\n');
    expect(body.every((l) => l.length <= 64)).toBe(true);
    expect(check(armoured).ok).toBe(true);
    // Windows line ends and chat text around it change nothing
    expect(check(`  chat noise\r\n${armoured.replace(/\n/g, '\r\n')}\nmore noise`).ok).toBe(true);
    expect(extractLicenceToken(armoured)).toBe(token);
  });

  it('accepts the public key as one line of base64 DER as well as PEM', () => {
    const line = publicKeyLine(publicKeyPem);
    expect(line).toMatch(/^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/);
    expect(check(signLicense(base, privateKeyPem), { publicKey: line }).ok).toBe(true);
  });

  it('rejects a TAMPERED licence (more seats, more modules)', () => {
    const [, sig] = signLicense(base, privateKeyPem).split('.');
    const forged = Buffer.from(JSON.stringify({ ...base, seats: { desktop: 99, mobile: 99 }, modules: ['crm', 'sales', 'finance', 'inventory'] })).toString('base64url');
    expect(check(`${forged}.${sig}`)).toMatchObject({ ok: false, code: 'BAD_SIGNATURE' });
  });

  it('rejects a flipped signature bit, and a licence signed by a different key', () => {
    const [p, s] = signLicense(base, privateKeyPem).split('.') as [string, string];
    const sig = Buffer.from(s, 'base64url');
    sig[0] = (sig[0] ?? 0) ^ 0x01;
    expect(check(`${p}.${sig.toString('base64url')}`)).toMatchObject({ ok: false, code: 'BAD_SIGNATURE' });
    expect(check(signLicense(base, generateLicenseKeyPair().privateKeyPem))).toMatchObject({ ok: false, code: 'BAD_SIGNATURE' });
  });

  it('rejects a licence for ANOTHER server (wrong hardware), but says what it is', () => {
    const v = check(signLicense(base, privateKeyPem), { hardwareId: 'b'.repeat(64) });
    expect(v).toMatchObject({ ok: false, code: 'HARDWARE_MISMATCH', payload: { activationCode: 'VF-7K2M-9QXA-4TPL' } });
  });

  it("UPDATES EXPIRED: a licence whose updatesUntil is before this version's release date does not cover it", () => {
    const token = signLicense({ ...base, updatesUntil: '2026-10-04' }, privateKeyPem);
    expect(check(token)).toMatchObject({ ok: false, code: 'UPDATES_EXPIRED' });
    expect(check(token, { releaseDate: '2026-10-04' }).ok).toBe(true); // the version released that very day is covered
    expect(check(signLicense(base, privateKeyPem), { now: new Date('2040-01-01') }).ok).toBe(true); // perpetual: time alone never expires it
  });

  it('rejects a licence dated more than a day in the future (24 h clock tolerance)', () => {
    expect(check(signLicense({ ...base, issuedAt: '2026-10-06T06:00:00.000Z' }, privateKeyPem)).ok).toBe(true);
    expect(check(signLicense({ ...base, issuedAt: '2026-10-07T00:00:00.000Z' }, privateKeyPem))).toMatchObject({ ok: false, code: 'NOT_YET_VALID' });
  });

  it('rejects garbage without throwing', () => {
    for (const token of ['', 'abc', 'a.b.c', '.', 'not base64!.also not', LICENCE_BEGIN, `${LICENCE_BEGIN}\n${LICENCE_END}`]) {
      expect(check(token)).toMatchObject({ ok: false, code: 'MALFORMED' });
    }
  });

  it('rejects a correctly signed but structurally invalid or old-format payload', () => {
    const signed = (payload: unknown) => {
      const data = Buffer.from(JSON.stringify(payload));
      return `${data.toString('base64url')}.${sign(null, data, privateKeyPem).toString('base64url')}`;
    };
    expect(check(signed({ hello: 'world' }))).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(check(signed({ ...base, v: 1 }))).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(check(signed({ ...base, seats: { desktop: 0, mobile: 1 } }))).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(check(signed({ ...base, updatesUntil: '2027-02-30' }))).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(check(signed({ ...base, hardwareId: 'ABC' }))).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(check(signed({ ...base, activationCode: 'VF-0000-0000-0000' }))).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
  });

  it('decodes a payload without trusting it (support tool), and never throws', () => {
    expect(decodeLicensePayloadUnverified(signLicense(base, privateKeyPem))).toEqual(base);
    expect(decodeLicensePayloadUnverified('garbage')).toBeNull();
  });
});

describe('the committed licence public key', () => {
  // Every encoding of an Ed25519 point of small order: such a "key" would let anyone forge signatures.
  const SMALL_ORDER = [
    '0100000000000000000000000000000000000000000000000000000000000000',
    'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    '0000000000000000000000000000000000000000000000000000000000000000',
    '0000000000000000000000000000000000000000000000000000000000000080',
    '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
    '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
    'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
    'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
  ];
  const key = () => createPublicKey({ key: Buffer.from(LICENCE_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' });

  it('is one line of base64 that parses as an Ed25519 key of large order', () => {
    expect(LICENCE_PUBLIC_KEY).toMatch(/^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/);
    expect(key().asymmetricKeyType).toBe('ed25519');
    expect(SMALL_ORDER).not.toContain(Buffer.from(LICENCE_PUBLIC_KEY, 'base64').subarray(-32).toString('hex'));
    // the classic small-order forgery (R = identity, S = 0) never verifies
    const forged = Buffer.concat([Buffer.from(SMALL_ORDER[0]!, 'hex'), Buffer.alloc(32)]);
    for (let i = 0; i < 64; i++) expect(verify(null, Buffer.from(`message ${i}`), key(), forged)).toBe(false);
  });

  it('isPlaceholderLicenceKey recognises the placeholder in any form, and nothing else', () => {
    const pem = key().export({ type: 'spki', format: 'pem' }).toString();
    // While the committed key IS the placeholder both are true; once BluxTech's key is committed both are false.
    expect(isPlaceholderLicenceKey(pem)).toBe(isPlaceholderLicenceKey(LICENCE_PUBLIC_KEY));
    expect(isPlaceholderLicenceKey(key())).toBe(isPlaceholderLicenceKey(LICENCE_PUBLIC_KEY));
    expect(isPlaceholderLicenceKey(generateLicenseKeyPair().publicKeyPem)).toBe(false);
    expect(isPlaceholderLicenceKey(publicKeyLine(generateLicenseKeyPair().publicKeyPem))).toBe(false);
    expect(isPlaceholderLicenceKey('not a key')).toBe(false);
  });
});

describe('hardware id', () => {
  const WIN = { MachineGuid: '851879EC-9337-4245-8E57-6D1E3A6F17B0', LastConfig: '{ab7a2b8e-bfa1-11ec-80f2-6c24083f09d8}' };
  const readers = (values: Record<string, string> = WIN, over: Partial<HardwareReaders> = {}): HardwareReaders => ({
    platform: () => 'win32',
    registry: (_key, name) => values[name] ?? null,
    file: () => null,
    legacy: () => 'legacy|aa:bb:cc:dd:ee:ff',
    ...over,
  });

  it('is 64 hex characters and stable', () => {
    expect(hardwareId(readers())).toMatch(/^[0-9a-f]{64}$/);
    expect(hardwareId(readers())).toBe(hardwareId(readers()));
  });

  // The real registry: reg.exe started twice can take several seconds on a cold GitHub Windows runner (it timed out at 5 s).
  it('on this machine: read once, then the same id from memory', () => {
    const first = hardwareId();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    const t = performance.now();
    expect(hardwareId()).toBe(first);
    expect(performance.now() - t).toBeLessThan(50); // no second reg.exe
  }, 60_000);

  it('does not depend on network adapters: a VPN appearing changes nothing', () => {
    expect(hardwareId(readers(WIN, { legacy: () => 'legacy|aa:bb' }))).toBe(hardwareId(readers(WIN, { legacy: () => 'legacy|aa:bb|cc:dd' })));
  });

  it('changes with a new Windows installation (MachineGuid) or another motherboard (SMBIOS UUID), not with letter case', () => {
    const base = hardwareId(readers());
    expect(hardwareId(readers({ ...WIN, MachineGuid: '00000000-9337-4245-8e57-6d1e3a6f17b0' }))).not.toBe(base);
    expect(hardwareId(readers({ ...WIN, LastConfig: '{00000000-bfa1-11ec-80f2-6c24083f09d8}' }))).not.toBe(base);
    expect(hardwareId(readers({ MachineGuid: WIN.MachineGuid.toLowerCase(), LastConfig: WIN.LastConfig.toUpperCase() }))).toBe(base);
  });

  it('uses /etc/machine-id on Linux, and the old material only when nothing else can be read', () => {
    const linux = (id: string) => readers({}, { platform: () => 'linux', file: (p) => (p === '/etc/machine-id' ? id : null) });
    expect(hardwareId(linux('abc'))).toBe(hardwareId(linux('abc')));
    expect(hardwareId(linux('abc'))).not.toBe(hardwareId(linux('abd')));
    expect(hardwareId(readers({}, { legacy: () => 'legacy|x' }))).not.toBe(hardwareId(readers({}, { legacy: () => 'legacy|y' })));
  });
});
