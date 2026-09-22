import { describe, expect, it } from 'vitest';
import { DEV_SEED_PASSWORD, seedPassword } from './seed-guard';

describe('seed password policy', () => {
  it('keeps the documented default in development and test', () => {
    expect(seedPassword({ NODE_ENV: 'development' })).toBe(DEV_SEED_PASSWORD);
    expect(seedPassword({})).toBe(DEV_SEED_PASSWORD);
    expect(seedPassword({ NODE_ENV: 'test', SEED_DEMO_PASSWORD: 'Whatever-1' })).toBe('Whatever-1');
  });

  it('refuses to leave a public, known administrator password on a production installation', () => {
    for (const SEED_DEMO_PASSWORD of [undefined, '', DEV_SEED_PASSWORD, 'short-pw-1']) {
      expect(() => seedPassword({ NODE_ENV: 'production', SEED_DEMO_PASSWORD }), String(SEED_DEMO_PASSWORD)).toThrow(/Refusing to seed a production database/);
    }
  });

  it('accepts a password the operator chose on purpose', () => {
    expect(seedPassword({ NODE_ENV: 'production', SEED_DEMO_PASSWORD: 'A-long-unique-passphrase-9' })).toBe('A-long-unique-passphrase-9');
  });
});
