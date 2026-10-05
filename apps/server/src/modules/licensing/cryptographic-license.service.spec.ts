import crypto from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateLicenseKeyPair, LICENCE_BEGIN, signLicense, type LicensePayload } from '@victorflow/crypto';
import { activationCodeFrom, encodeRequestCode, LICENSE_FEATURES } from '@victorflow/types';
import type { AppConfig } from '../../config/config';
import { CryptographicLicenseService, type HardwareIdProvider } from './cryptographic-license.service';
import { DevLicenseService } from './dev-license.service';

const THIS_MACHINE = 'c'.repeat(64);
const CODE = activationCodeFrom([5, 18, 0, 19, 7, 22, 29, 8, 2, 25, 23]);
const RELEASE = '2026-10-05';
const keys = generateLicenseKeyPair();
const dir = mkdtempSync(path.join(tmpdir(), 'vf-license-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const payload = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  v: 2,
  licenceId: 'LIC-42',
  shop: 'Imprimerie El Djazair',
  activationCode: CODE,
  hardwareId: THIS_MACHINE,
  edition: 'Standard',
  seats: { desktop: 3, mobile: 5 },
  modules: ['crm', 'sales', 'production', 'finance'],
  issuedAt: '2026-10-01T00:00:00.000Z',
  updatesUntil: '2027-10-01',
  ...over,
});

let fileCounter = 0;
function service(opts: { token?: string | null; hardwareId?: string; enforce?: boolean; online?: boolean } = {}) {
  const file = path.join(dir, `license-${++fileCounter}.vfl`);
  if (opts.token !== null) writeFileSync(file, opts.token ?? signLicense(payload(), keys.privateKeyPem));
  const config = {
    licenseMode: 'crypto',
    licenseEnforce: opts.enforce ?? true,
    licensePublicKey: keys.publicKeyPem,
    licenseFile: file,
    licenseServerUrl: opts.online ? 'http://127.0.0.1:9/activate' : null,
  } as AppConfig;
  const hardware: HardwareIdProvider = { get: () => opts.hardwareId ?? THIS_MACHINE };
  return { file, svc: new CryptographicLicenseService(config, hardware, () => new Date('2026-10-05T12:00:00.000Z'), RELEASE) };
}

describe('CryptographicLicenseService', () => {
  it('VALID licence: entitlement, modules, seats, active, and the modules it lacks are reported missing', async () => {
    const { svc } = service();
    expect(await svc.getEntitlement()).toMatchObject({ licenceId: 'LIC-42', shop: 'Imprimerie El Djazair', seats: { desktop: 3, mobile: 5 }, updatesUntil: '2027-10-01', hardwareId: THIS_MACHINE });
    expect(await svc.status()).toMatchObject({ mode: 'crypto', valid: true, state: 'active', problem: null, enforced: true, hardwareId: THIS_MACHINE, activationCode: CODE, releaseDate: RELEASE, online: false });
    expect(await svc.summary()).toEqual({ mode: 'crypto', state: 'active', modules: ['crm', 'sales', 'production', 'finance'], problem: null });
    expect(await svc.hasModule('finance')).toBe(true);
    expect(await svc.hasModule('inventory')).toBe(false);
    expect(await svc.seats()).toEqual({ desktop: 3, mobile: 5 });
  });

  it('ignores module ids it does not know (a newer issuer), keeping the ones it does', async () => {
    const { svc } = service({ token: signLicense(payload({ modules: ['crm', 'teleportation'] }), keys.privateKeyPem) });
    expect((await svc.getEntitlement())?.modules).toEqual(['crm']);
  });

  it('TAMPERED file → read-only (BAD_SIGNATURE), every module still readable', async () => {
    const [, sig] = signLicense(payload(), keys.privateKeyPem).split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify(payload({ seats: { desktop: 99, mobile: 99 } }))).toString('base64url');
    const { svc } = service({ token: `${forged}.${sig}` });
    expect(await svc.getEntitlement()).toBeNull();
    expect(await svc.status()).toMatchObject({ valid: false, state: 'read_only', problem: { code: 'BAD_SIGNATURE' }, activationCode: null });
    expect(await svc.summary()).toEqual({ mode: 'crypto', state: 'read_only', modules: [...LICENSE_FEATURES], problem: 'BAD_SIGNATURE' });
    expect(await svc.seats()).toBeNull();
  });

  it('WRONG HARDWARE → read-only (HARDWARE_MISMATCH), but the activation code is known (for the transfer request)', async () => {
    const { svc } = service({ hardwareId: 'd'.repeat(64) });
    expect(await svc.status()).toMatchObject({ valid: false, state: 'read_only', problem: { code: 'HARDWARE_MISMATCH' }, activationCode: CODE });
  });

  it('UPDATES EXPIRED → read-only (this version was released after updatesUntil)', async () => {
    const { svc } = service({ token: signLicense(payload({ updatesUntil: '2026-10-04' }), keys.privateKeyPem) });
    expect(await svc.status()).toMatchObject({ valid: false, state: 'read_only', problem: { code: 'UPDATES_EXPIRED' } });
  });

  it('no file, garbage, a directory where the file should be — reported, never thrown', async () => {
    expect((await service({ token: null }).svc.status()).problem?.code).toBe('NO_LICENSE_FILE');
    expect((await service({ token: 'not a licence' }).svc.status()).problem?.code).toBe('MALFORMED');
    const { svc, file } = service({ token: null });
    mkdirSync(file);
    expect((await svc.status()).problem?.code).toBe('LICENSE_FILE_UNREADABLE');
  });

  it('enforcement off: still tells the truth, but nothing is read-only', async () => {
    const { svc } = service({ token: 'garbage', enforce: false });
    expect(await svc.status()).toMatchObject({ valid: false, state: 'active', enforced: false });
    expect((await svc.summary()).state).toBe('active');
  });

  it('install(): verifies, writes armoured text atomically, and the new licence applies at once (no stale cache)', async () => {
    const { svc, file } = service({ token: null });
    expect((await svc.status()).valid).toBe(false); // cached: invalid
    const after = await svc.install(signLicense(payload({ licenceId: 'LIC-NEW' }), keys.privateKeyPem));
    expect(after).toMatchObject({ valid: true, state: 'active', entitlement: { licenceId: 'LIC-NEW' } });
    expect(readFileSync(file, 'utf8')).toContain(LICENCE_BEGIN);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('install() refuses a licence that would not work HERE, and leaves the installed one alone', async () => {
    const { svc, file } = service();
    const before = readFileSync(file, 'utf8');
    for (const [bad, problem] of [
      [signLicense(payload({ hardwareId: 'e'.repeat(64) }), keys.privateKeyPem), 'HARDWARE_MISMATCH'],
      [signLicense(payload(), generateLicenseKeyPair().privateKeyPem), 'BAD_SIGNATURE'],
      [signLicense(payload({ updatesUntil: '2025-01-01' }), keys.privateKeyPem), 'UPDATES_EXPIRED'],
      ['hello', 'MALFORMED'],
    ] as const) {
      await expect(svc.install(bad)).rejects.toMatchObject({ response: { code: 'LICENCE_REJECTED', licenceProblem: problem } });
    }
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect((await svc.status()).valid).toBe(true);
  });

  it('requestCode(): validates the activation code and binds it to this hardware id', () => {
    const { svc } = service();
    expect(svc.requestCode(CODE.toLowerCase().replace(/-/g, ' '))).toEqual({
      activationCode: CODE,
      hardwareId: THIS_MACHINE,
      requestCode: encodeRequestCode({ activationCode: CODE, hardwareId: THIS_MACHINE }),
    });
    expect(() => svc.requestCode(CODE.replace(/.$/, CODE.endsWith('2') ? '3' : '2'))).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'ACTIVATION_CODE_INVALID' }) }));
  });

  it('verifies with crypto.verify(null, data, publicKey, signature) — NOT createVerify("SHA512")', async () => {
    const verifySpy = jest.spyOn(crypto, 'verify');
    const createVerifySpy = jest.spyOn(crypto, 'createVerify');
    try {
      expect((await service().svc.status()).valid).toBe(true);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      const [algorithm, data, , signature] = verifySpy.mock.calls[0]!;
      expect(algorithm).toBeNull(); // Ed25519 takes no digest algorithm
      expect(Buffer.isBuffer(data)).toBe(true);
      expect(Buffer.isBuffer(signature) && signature.length).toBe(64); // an Ed25519 signature is exactly 64 bytes
      expect(createVerifySpy).not.toHaveBeenCalled();
    } finally {
      verifySpy.mockRestore();
      createVerifySpy.mockRestore();
    }
  });

  it('verifies the EXACT signed bytes: re-ordering JSON keys in the payload breaks the signature', async () => {
    const p = payload();
    const [, sig] = signLicense(p, keys.privateKeyPem).split('.') as [string, string];
    const { shop, ...rest } = p;
    const reordered = Buffer.from(JSON.stringify({ shop, ...rest })).toString('base64url');
    expect((await service({ token: `${reordered}.${sig}` }).svc.status()).problem?.code).toBe('BAD_SIGNATURE');
  });
});

describe('DevLicenseService (development only)', () => {
  const dev = new DevLicenseService({ licenseMode: 'dev', licenseEnforce: false } as AppConfig, { get: () => THIS_MACHINE });

  it('everything unlocked, seats without limit, active, nothing to install', async () => {
    expect(await dev.status()).toMatchObject({ mode: 'dev', valid: true, state: 'active', problem: null, enforced: false });
    expect((await dev.summary()).modules).toEqual([...LICENSE_FEATURES]);
    expect((await dev.seats())!.desktop).toBeGreaterThan(1000);
    await expect(dev.install()).rejects.toMatchObject({ response: { code: 'LICENSE_DEV_MODE' } });
    expect(existsSync(path.join(dir, 'never-written.vfl'))).toBe(false);
  });

  it('has the same interface as the real service (so callers cannot tell them apart)', () => {
    const real = service().svc;
    for (const method of ['getEntitlement', 'status', 'summary', 'seats', 'hasModule', 'isEnforced', 'hardwareId', 'install', 'requestCode'] as const) {
      expect(typeof dev[method]).toBe('function');
      expect(typeof real[method]).toBe('function');
    }
  });
});
