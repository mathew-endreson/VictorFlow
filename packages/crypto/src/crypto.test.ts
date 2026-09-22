import { sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  generateLicenseKeyPair,
  hardwareFingerprint,
  signLicense,
  trackingToken,
  verifyLicense,
  verifyTrackingToken,
  type LicensePayload,
} from './index';

const ORDER = '6f1c2b1e-0d34-4d59-8d6a-1f7a6d0d2a11';
const CUSTOMER = 'a3f9b7c4-59c2-4e0f-93a5-0d8f1d3e7b22';

describe('tracking token', () => {
  it('is deterministic and secret-dependent', () => {
    const t = trackingToken('secret-A', ORDER, CUSTOMER);
    expect(t).toBe(trackingToken('secret-A', ORDER, CUSTOMER));
    expect(t).not.toBe(trackingToken('secret-B', ORDER, CUSTOMER));
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/); // sha256 → 32 bytes → 43 base64url chars
  });

  it('binds both the order and the customer', () => {
    const t = trackingToken('s', ORDER, CUSTOMER);
    expect(t).not.toBe(trackingToken('s', ORDER, 'b3f9b7c4-59c2-4e0f-93a5-0d8f1d3e7b22'));
    expect(t).not.toBe(trackingToken('s', '7f1c2b1e-0d34-4d59-8d6a-1f7a6d0d2a11', CUSTOMER));
  });

  it('verifies only the exact token', () => {
    const t = trackingToken('s', ORDER, CUSTOMER);
    expect(verifyTrackingToken('s', ORDER, CUSTOMER, t)).toBe(true);
    expect(verifyTrackingToken('s', ORDER, CUSTOMER, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBe(false);
    expect(verifyTrackingToken('s', ORDER, CUSTOMER, t.slice(0, -1))).toBe(false); // wrong length must not throw
    expect(verifyTrackingToken('s', ORDER, CUSTOMER, '')).toBe(false);
  });

  it('constantTimeEqual handles unequal lengths without throwing', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('refuses an empty server secret', () => {
    expect(() => trackingToken('', ORDER, CUSTOMER)).toThrow();
  });
});

describe('Ed25519 licence', () => {
  const { publicKeyPem, privateKeyPem } = generateLicenseKeyPair();
  const HW = hardwareFingerprint();
  const base: LicensePayload = {
    licenseId: 'LIC-0001',
    customer: 'Imprimerie El Djazair',
    tier: 'PROFESSIONAL',
    features: ['crm', 'sales', 'finance'],
    maxUsers: 10,
    hardwareId: HW,
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2030-01-01T00:00:00.000Z',
  };
  const now = new Date('2026-06-01T00:00:00.000Z');

  it('accepts a valid licence', () => {
    const v = verifyLicense({ token: signLicense(base, privateKeyPem), publicKey: publicKeyPem, hardwareId: HW, now });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.payload.customer).toBe('Imprimerie El Djazair');
  });

  it('accepts the public key as base64 DER as well as PEM', () => {
    const der = Buffer.from(
      publicKeyPem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, ''),
      'base64',
    ).toString('base64');
    expect(verifyLicense({ token: signLicense(base, privateKeyPem), publicKey: der, hardwareId: HW, now }).ok).toBe(true);
  });

  it('rejects a tampered payload (tier upgrade)', () => {
    const [, sig] = signLicense({ ...base, tier: 'BASIC' }, privateKeyPem).split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...base, tier: 'ENTERPRISE' })).toString('base64url');
    const v = verifyLicense({ token: `${forgedPayload}.${sig}`, publicKey: publicKeyPem, hardwareId: HW, now });
    expect(v).toMatchObject({ ok: false, code: 'BAD_SIGNATURE' });
  });

  it('rejects a flipped signature bit', () => {
    const token = signLicense(base, privateKeyPem);
    const [p, s] = token.split('.') as [string, string];
    const sig = Buffer.from(s, 'base64url');
    sig[0] = (sig[0] ?? 0) ^ 0x01;
    expect(verifyLicense({ token: `${p}.${sig.toString('base64url')}`, publicKey: publicKeyPem, hardwareId: HW, now })).toMatchObject({
      ok: false,
      code: 'BAD_SIGNATURE',
    });
  });

  it('rejects a licence signed by a different key', () => {
    const other = generateLicenseKeyPair();
    const v = verifyLicense({ token: signLicense(base, other.privateKeyPem), publicKey: publicKeyPem, hardwareId: HW, now });
    expect(v).toMatchObject({ ok: false, code: 'BAD_SIGNATURE' });
  });

  it('rejects a hardware mismatch', () => {
    const v = verifyLicense({ token: signLicense(base, privateKeyPem), publicKey: publicKeyPem, hardwareId: 'some-other-machine', now });
    expect(v).toMatchObject({ ok: false, code: 'HARDWARE_MISMATCH' });
  });

  it('accepts an unbound (hardwareId: null) licence on any machine', () => {
    const token = signLicense({ ...base, hardwareId: null }, privateKeyPem);
    expect(verifyLicense({ token, publicKey: publicKeyPem, hardwareId: 'anything', now }).ok).toBe(true);
  });

  it('rejects expired and not-yet-valid licences', () => {
    const expired = signLicense({ ...base, expiresAt: '2026-02-01T00:00:00.000Z' }, privateKeyPem);
    expect(verifyLicense({ token: expired, publicKey: publicKeyPem, hardwareId: HW, now })).toMatchObject({ ok: false, code: 'EXPIRED' });
    const future = signLicense({ ...base, issuedAt: '2027-01-01T00:00:00.000Z' }, privateKeyPem);
    expect(verifyLicense({ token: future, publicKey: publicKeyPem, hardwareId: HW, now })).toMatchObject({ ok: false, code: 'NOT_YET_VALID' });
  });

  it('rejects garbage without throwing', () => {
    for (const token of ['', 'abc', 'a.b.c', '.', 'not base64!.also not']) {
      const v = verifyLicense({ token, publicKey: publicKeyPem, hardwareId: HW, now });
      expect(v.ok).toBe(false);
    }
  });

  it('rejects a correctly signed but structurally invalid payload', () => {
    const data = Buffer.from(JSON.stringify({ hello: 'world' }));
    const sig = sign(null, data, privateKeyPem);
    const v = verifyLicense({ token: `${data.toString('base64url')}.${sig.toString('base64url')}`, publicKey: publicKeyPem, hardwareId: HW, now });
    expect(v).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
  });

  it('hardwareFingerprint is stable within a process', () => {
    expect(hardwareFingerprint()).toBe(hardwareFingerprint());
    expect(hardwareFingerprint()).toMatch(/^[0-9a-f]{64}$/);
  });
});
