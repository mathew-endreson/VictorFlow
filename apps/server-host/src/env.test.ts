import { describe, expect, it } from 'vitest';
import { apiEnv, databaseUrl, displayEnv, trackerEnv } from './env';
import { dataLayout } from './layout';
import { defaultConfig, type Secrets } from './store';

const config = { ...defaultConfig('SHOP-SERVER'), extraCorsOrigins: ['http://office-pc:5173'] };
const secrets: Secrets = { dbPassword: 'p@ss/w:rd#1', jwtAccessSecret: 'j'.repeat(43), trackingHmacSecret: 't'.repeat(43) };
const data = dataLayout('C:\\ProgramData\\VictorFlow');

describe('API environment', () => {
  it('points at this install’s PostgreSQL on loopback, with the password URL-encoded', () => {
    expect(databaseUrl(config, secrets)).toBe('postgresql://victorflow:p%40ss%2Fw%3Ard%231@127.0.0.1:55432/victorflow');
  });

  it('keeps files and the licence in the data folder, allows the desktop app, and builds tracking links from config', () => {
    const env = apiEnv(config, secrets, data);
    expect(env).toMatchObject({
      PORT: '3000',
      STORAGE_DIR: 'C:\\ProgramData\\VictorFlow\\storage',
      LICENSE_FILE: 'C:\\ProgramData\\VictorFlow\\license.vfl',
      TRACKER_BASE_URL: 'http://shop-server:3001',
      CORS_ORIGINS: 'http://tauri.localhost,tauri://localhost,http://office-pc:5173',
      JWT_ACCESS_SECRET: secrets.jwtAccessSecret,
      TRACKING_HMAC_SECRET: secrets.trackingHmacSecret,
      REDIS_ENABLED: 'false',
      QUEUE_ENABLED: 'false',
    });
    // a shop's server: production, the signed licence, always enforced (a failed check means read-only)
    expect(env).toMatchObject({ NODE_ENV: 'production', LICENSE_MODE: 'crypto', LICENSE_ENFORCE: 'true' });
    expect(env).not.toHaveProperty('LICENSE_PUBLIC_KEY'); // production trusts only the key built into the API
    expect(env).not.toHaveProperty('LICENSE_SERVER_URL'); // offline activation unless config.json names a licence server
    expect(Object.values(env).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
  });

  it('passes the licence server address on when config.json sets one (online activation)', () => {
    expect(apiEnv({ ...config, licenceServerUrl: 'https://licence.bluxtech.dz/activate' }, secrets, data)).toMatchObject({ LICENSE_SERVER_URL: 'https://licence.bluxtech.dz/activate' });
  });
});

describe('tracker and displays', () => {
  it('listen on every interface for the LAN and read from the API on this same machine', () => {
    expect(trackerEnv(config)).toEqual({ NODE_ENV: 'production', PORT: '3001', HOSTNAME: '0.0.0.0', NEXT_TELEMETRY_DISABLED: '1', TRACKER_API_URL: 'http://127.0.0.1:3000/api/v1' });
    expect(displayEnv(config)).toMatchObject({ PORT: '3002', HOSTNAME: '0.0.0.0', DISPLAY_API_URL: 'http://127.0.0.1:3000/api/v1' });
  });
});
