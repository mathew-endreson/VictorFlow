import { describe, expect, it } from 'vitest';
import { apiEnv, databaseUrl, displayEnv, trackerEnv } from './env';
import { dataLayout } from './layout';
import { defaultConfig, type Secrets } from './store';

const config = { ...defaultConfig('SHOP-SERVER'), extraCorsOrigins: ['http://office-pc:5173'] };
const secrets: Secrets = { dbPassword: 'p@ss/w:rd#1', jwtAccessSecret: 'j'.repeat(43), trackingHmacSecret: 't'.repeat(43), adminPassword: 'a'.repeat(24) };
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
    // until licence activation exists (onboarding), the API runs in development mode with the dev licence
    expect(env).toMatchObject({ NODE_ENV: 'development', LICENSE_MODE: 'dev', LICENSE_ENFORCE: 'false' });
    expect(Object.values(env).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
  });
});

describe('tracker and displays', () => {
  it('listen on every interface for the LAN and read from the API on this same machine', () => {
    expect(trackerEnv(config)).toEqual({ NODE_ENV: 'production', PORT: '3001', HOSTNAME: '0.0.0.0', NEXT_TELEMETRY_DISABLED: '1', TRACKER_API_URL: 'http://127.0.0.1:3000/api/v1' });
    expect(displayEnv(config)).toMatchObject({ PORT: '3002', HOSTNAME: '0.0.0.0', DISPLAY_API_URL: 'http://127.0.0.1:3000/api/v1' });
  });
});
