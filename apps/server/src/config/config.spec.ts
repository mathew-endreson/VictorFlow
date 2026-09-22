import { loadConfig, parseDurationSeconds } from './config';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  TRACKING_HMAC_SECRET: 'y'.repeat(40),
};

describe('parseDurationSeconds', () => {
  it.each([
    ['900', 900],
    ['15m', 900],
    ['2h', 7200],
    ['7d', 604800],
    ['30s', 30],
  ])('%s → %i seconds', (input, expected) => {
    expect(parseDurationSeconds(input)).toBe(expected);
  });

  it('rejects nonsense', () => {
    expect(() => parseDurationSeconds('soon')).toThrow(/Invalid duration/);
    expect(() => parseDurationSeconds('-5m')).toThrow();
  });
});

describe('loadConfig', () => {
  it('applies defaults and splits CORS origins', () => {
    const c = loadConfig({ ...valid, CORS_ORIGINS: 'http://a.test, http://b.test ' } as NodeJS.ProcessEnv);
    expect(c).toMatchObject({
      port: 3000,
      jwtAccessTtlSeconds: 900,
      refreshTokenTtlDays: 7,
      queueEnabled: true,
      licenseMode: 'dev',
      licenseEnforce: false,
      corsOrigins: ['http://a.test', 'http://b.test'],
    });
  });

  it('fails fast with a readable message on a bad environment', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...valid, JWT_ACCESS_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadConfig({ ...valid, PORT: 'abc' } as NodeJS.ProcessEnv)).toThrow(/PORT/);
  });

  it('parses booleans strictly', () => {
    expect(loadConfig({ ...valid, LICENSE_ENFORCE: 'true' } as NodeJS.ProcessEnv).licenseEnforce).toBe(true);
    expect(() => loadConfig({ ...valid, LICENSE_ENFORCE: 'yes' } as NodeJS.ProcessEnv)).toThrow(/LICENSE_ENFORCE/);
  });

  it('refuses to run in production with placeholder secrets or the dev licence', () => {
    const prod = { ...valid, NODE_ENV: 'production', LICENSE_MODE: 'crypto' };
    expect(() => loadConfig({ ...prod, JWT_ACCESS_SECRET: 'dev-access-secret-change-me-please-0123456789' } as NodeJS.ProcessEnv)).toThrow(/placeholder/);
    expect(() => loadConfig({ ...prod, LICENSE_MODE: 'dev' } as NodeJS.ProcessEnv)).toThrow(/LICENSE_MODE=dev/);
    expect(() => loadConfig(prod as NodeJS.ProcessEnv)).not.toThrow();
  });
});
