import crypto from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateLicenseKeyPair, signLicense, type LicensePayload } from '@victorflow/crypto';
import type { AppConfig } from '../../config/config';
import { CryptographicLicenseService, type HardwareIdProvider } from './cryptographic-license.service';
import { DevLicenseService } from './dev-license.service';

const THIS_MACHINE = 'hw-this-machine-0123456789abcdef';
const keys = generateLicenseKeyPair();
const dir = mkdtempSync(path.join(tmpdir(), 'vf-license-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const payload = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  licenseId: 'LIC-42',
  customer: 'Imprimerie El Djazair',
  tier: 'PROFESSIONAL',
  features: ['crm', 'sales', 'production', 'finance'],
  maxUsers: 5,
  hardwareId: THIS_MACHINE,
  issuedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2030-01-01T00:00:00.000Z',
  ...over,
});

let fileCounter = 0;
function service(opts: { token?: string | null; publicKey?: string | null; hardwareId?: string; now?: Date; enforce?: boolean } = {}) {
  const file = path.join(dir, `license-${++fileCounter}.vfl`);
  if (opts.token !== null) writeFileSync(file, opts.token ?? signLicense(payload(), keys.privateKeyPem));
  const config = {
    licenseMode: 'crypto',
    licenseEnforce: opts.enforce ?? true,
    licensePublicKey: opts.publicKey === null ? undefined : (opts.publicKey ?? keys.publicKeyPem),
    licenseFile: file,
  } as AppConfig;
  const hardware: HardwareIdProvider = { get: () => opts.hardwareId ?? THIS_MACHINE };
  return new CryptographicLicenseService(config, hardware, () => opts.now ?? new Date('2026-06-01T00:00:00.000Z'));
}

describe('CryptographicLicenseService — Ed25519', () => {
  it('VALID licence passes: entitlement, features, tier, seats, hardware binding', async () => {
    const s = service();
    const e = await s.getEntitlement();
    expect(e).toMatchObject({ licenseId: 'LIC-42', tier: 'PROFESSIONAL', maxUsers: 5, hardwareBound: true, expiresAt: '2030-01-01T00:00:00.000Z' });
    expect(e!.features).toEqual(['crm', 'sales', 'production', 'finance']);
    expect(await s.hasFeature('finance')).toBe(true);
    expect(await s.hasFeature('inventory')).toBe(false); // not in this licence
    expect(await s.status()).toMatchObject({ mode: 'crypto', valid: true, problem: null, enforced: true, hardwareId: THIS_MACHINE });
  });

  it('TAMPERED licence is rejected — a BASIC licence upgraded to ENTERPRISE by editing the payload', async () => {
    const basic = signLicense(payload({ tier: 'BASIC', features: ['crm'] }), keys.privateKeyPem);
    const [, signature] = basic.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify(payload({ tier: 'ENTERPRISE', features: ['crm', 'finance'], maxUsers: 9999 }))).toString('base64url');
    const s = service({ token: `${forged}.${signature}` });
    expect(await s.getEntitlement()).toBeNull();
    expect(await s.hasFeature('finance')).toBe(false);
    expect(await s.status()).toMatchObject({ valid: false, entitlement: null, problem: { code: 'BAD_SIGNATURE' } });
  });

  it('a single flipped signature bit is rejected', async () => {
    const [p, sig] = signLicense(payload(), keys.privateKeyPem).split('.') as [string, string];
    const bytes = Buffer.from(sig, 'base64url');
    bytes[10] = (bytes[10] ?? 0) ^ 0x80;
    expect((await service({ token: `${p}.${bytes.toString('base64url')}` }).status()).problem?.code).toBe('BAD_SIGNATURE');
  });

  it('licence signed by a DIFFERENT key is rejected', async () => {
    const attacker = generateLicenseKeyPair();
    const s = service({ token: signLicense(payload({ tier: 'ENTERPRISE' }), attacker.privateKeyPem) });
    expect((await s.status()).problem?.code).toBe('BAD_SIGNATURE');
  });

  it('HARDWARE MISMATCH is rejected — a licence bound to another machine does not work here', async () => {
    const s = service({ hardwareId: 'a-completely-different-machine' });
    expect(await s.getEntitlement()).toBeNull();
    expect((await s.status()).problem).toMatchObject({ code: 'HARDWARE_MISMATCH' });
  });

  it('an unbound licence (hardwareId: null) works on any machine', async () => {
    const token = signLicense(payload({ hardwareId: null }), keys.privateKeyPem);
    const s = service({ token, hardwareId: 'whatever' });
    expect((await s.getEntitlement())?.hardwareBound).toBe(false);
  });

  it('rejects an expired licence and one that is not valid yet', async () => {
    expect((await service({ now: new Date('2031-01-01T00:00:00Z') }).status()).problem?.code).toBe('EXPIRED');
    expect((await service({ now: new Date('2025-01-01T00:00:00Z') }).status()).problem?.code).toBe('NOT_YET_VALID');
  });

  it('reports a missing licence file, a missing public key, and garbage — without throwing', async () => {
    expect((await service({ token: null }).status()).problem?.code).toBe('NO_LICENSE_FILE');
    expect((await service({ publicKey: null }).status()).problem?.code).toBe('NO_PUBLIC_KEY');
    expect((await service({ token: 'not a licence' }).status()).problem?.code).toBe('MALFORMED');
    expect((await service({ token: '' }).status()).valid).toBe(false);
  });

  it('enforces the seat limit from the licence', async () => {
    const s = service();
    expect(await s.canAddUser(4)).toBe(true);
    expect(await s.canAddUser(5)).toBe(false); // maxUsers: 5
    expect(await service({ token: null }).canAddUser(0)).toBe(false); // no licence, no seats
  });

  it('accepts the public key as base64 DER as well as PEM', async () => {
    const der = Buffer.from(keys.publicKeyPem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, ''), 'base64').toString('base64');
    expect((await service({ publicKey: der }).status()).valid).toBe(true);
  });

  it('verifies with crypto.verify(null, data, publicKey, signature) — NOT createVerify("SHA512")', async () => {
    const verifySpy = jest.spyOn(crypto, 'verify');
    const createVerifySpy = jest.spyOn(crypto, 'createVerify');
    try {
      expect((await service().status()).valid).toBe(true);
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
    const { customer, ...rest } = p;
    const reorderedJson = JSON.stringify({ customer, ...rest }); // identical data, `customer` moved to the front
    expect(reorderedJson).not.toBe(JSON.stringify(p)); // different bytes…
    expect(JSON.parse(reorderedJson)).toEqual(p); // …same meaning
    const reordered = Buffer.from(reorderedJson).toString('base64url');
    expect((await service({ token: `${reordered}.${sig}` }).status()).problem?.code).toBe('BAD_SIGNATURE');
  });
});

describe('DevLicenseService (MVP stub)', () => {
  const dev = new DevLicenseService({ licenseMode: 'dev', licenseEnforce: false } as AppConfig);

  it('always returns a valid PROFESSIONAL entitlement with no hardware check and no expiry', async () => {
    const e = await dev.getEntitlement();
    expect(e).toMatchObject({ tier: 'PROFESSIONAL', hardwareBound: false, expiresAt: null, licenseId: 'DEV-LOCAL' });
    for (const f of ['crm', 'sales', 'production', 'finance', 'inventory', 'workforce', 'audit'] as const) expect(await dev.hasFeature(f)).toBe(true);
    expect(await dev.canAddUser()).toBe(true);
    expect(await dev.status()).toMatchObject({ mode: 'dev', valid: true, problem: null, enforced: false });
  });

  it('has the same interface as the real service (so callers cannot tell them apart)', () => {
    const real = service();
    for (const method of ['getEntitlement', 'hasFeature', 'status', 'isEnforced', 'canAddUser'] as const) {
      expect(typeof dev[method]).toBe('function');
      expect(typeof real[method]).toBe('function');
    }
  });
});
