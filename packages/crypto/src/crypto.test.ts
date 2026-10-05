import { describe, expect, it } from 'vitest';
import { constantTimeEqual, trackingToken, verifyTrackingToken } from './index';

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
