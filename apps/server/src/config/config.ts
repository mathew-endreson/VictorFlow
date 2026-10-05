import { isPlaceholderLicenceKey, LICENCE_PUBLIC_KEY } from '@victorflow/crypto';
import { z } from 'zod';

export const APP_CONFIG = Symbol('APP_CONFIG');

const bool = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

/** "15m" | "2h" | "7d" | "900s" | "900" → seconds. */
export function parseDurationSeconds(input: string): number {
  const m = /^(\d+)\s*([smhd]?)$/.exec(input.trim());
  if (!m) throw new Error(`Invalid duration "${input}" (use e.g. 900, 15m, 2h, 7d)`);
  const n = Number(m[1]);
  const unit = m[2] || 's';
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[unit as 's' | 'm' | 'h' | 'd'];
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** false → never open a Redis connection (tests, or a machine with no Redis). Rate limiting and jobs are then off. */
  REDIS_ENABLED: bool('true'),
  CORS_ORIGINS: z.string().default('http://localhost:1420'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  TRACKING_HMAC_SECRET: z.string().min(32, 'TRACKING_HMAC_SECRET must be at least 32 characters'),
  TRACKER_BASE_URL: z.string().default('http://localhost:3001'),

  STORAGE_DIR: z.string().default('./storage'),
  /** Largest accepted proof photo, in bytes (default 10 MiB). */
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(10 * 1024 * 1024),

  QUEUE_ENABLED: bool('true'),
  /** Set when the API runs behind ONE reverse proxy (nginx, Caddy …): rate limits then see the real client address. */
  TRUST_PROXY: bool('false'),
  RATE_LIMIT_ENABLED: bool('true'),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),

  LICENSE_MODE: z.enum(['dev', 'crypto']).default('dev'),
  LICENSE_ENFORCE: bool('false'),
  /** Development and tests only: a public key to trust instead of the one built into @victorflow/crypto. */
  LICENSE_PUBLIC_KEY: z.string().optional(),
  LICENSE_FILE: z.string().default('./license.vfl'),
  /** Online activation (optional): the BluxTech licence server's address. Empty = off, activation is offline. */
  LICENSE_SERVER_URL: z
    .string()
    .trim()
    .default('')
    .refine((v) => v === '' || /^https?:\/\/[^\s/]+/.test(v), 'LICENSE_SERVER_URL must be an http(s) address'),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string;
  redisEnabled: boolean;
  corsOrigins: string[];
  jwtAccessSecret: string;
  jwtAccessTtlSeconds: number;
  refreshTokenTtlDays: number;
  trackingHmacSecret: string;
  trackerBaseUrl: string;
  storageDir: string;
  uploadMaxBytes: number;
  queueEnabled: boolean;
  trustProxy: boolean;
  rateLimitEnabled: boolean;
  loginMaxAttempts: number;
  licenseMode: 'dev' | 'crypto';
  licenseEnforce: boolean;
  /** The key licences are verified with: always the built-in one in production. */
  licensePublicKey: string;
  licenseFile: string;
  /** null = online activation is off. */
  licenseServerUrl: string | null;
}

/**
 * `embeddedPublicKey` is the licence key built into @victorflow/crypto (a parameter only so tests can stand in for the
 * real BluxTech key while the committed one is still the placeholder).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, embeddedPublicKey: string = LICENCE_PUBLIC_KEY): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}\n(copy .env.example to .env)`);
  }
  const e = parsed.data;

  if (e.NODE_ENV === 'production') {
    const insecure = [e.JWT_ACCESS_SECRET, e.TRACKING_HMAC_SECRET].some((s) => /change-me/i.test(s));
    if (insecure) throw new Error('Refusing to start in production with the placeholder secrets from .env.example');
    if (e.LICENSE_MODE === 'dev') {
      // dev licensing unlocks everything for everyone — never ship it.
      throw new Error('LICENSE_MODE=dev is not allowed in production');
    }
    if (!e.LICENSE_ENFORCE) throw new Error('LICENSE_ENFORCE=false is not allowed in production');
    if (isPlaceholderLicenceKey(embeddedPublicKey)) {
      throw new Error('This build carries the placeholder licence key (packages/crypto/src/licence-public-key.ts): a release must embed the BluxTech public key');
    }
  }

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    redisEnabled: e.REDIS_ENABLED,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    jwtAccessSecret: e.JWT_ACCESS_SECRET,
    jwtAccessTtlSeconds: parseDurationSeconds(e.JWT_ACCESS_TTL),
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    trackingHmacSecret: e.TRACKING_HMAC_SECRET,
    trackerBaseUrl: e.TRACKER_BASE_URL.replace(/\/+$/, ''),
    storageDir: e.STORAGE_DIR,
    uploadMaxBytes: e.UPLOAD_MAX_BYTES,
    queueEnabled: e.QUEUE_ENABLED,
    trustProxy: e.TRUST_PROXY,
    rateLimitEnabled: e.RATE_LIMIT_ENABLED,
    loginMaxAttempts: e.LOGIN_MAX_ATTEMPTS,
    licenseMode: e.LICENSE_MODE,
    licenseEnforce: e.LICENSE_ENFORCE,
    // In production only the built-in key is trusted, whatever the environment says.
    licensePublicKey: e.NODE_ENV === 'production' ? embeddedPublicKey : e.LICENSE_PUBLIC_KEY || embeddedPublicKey,
    licenseFile: e.LICENSE_FILE,
    licenseServerUrl: e.LICENSE_SERVER_URL ? e.LICENSE_SERVER_URL.replace(/\/+$/, '') : null,
  };
}
