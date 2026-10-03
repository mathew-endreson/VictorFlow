// The environment each component runs with. Everything comes from config.json, secrets.json and the data folder —
// nothing from a .env file (when run from the repo, the API's loadEnv() only fills in what is NOT set here).
import type { DataLayout } from './layout';
import type { Secrets, ServerConfig } from './store';

/** The desktop app's own origins (Tauri on Windows serves the UI from http://tauri.localhost). */
export const DESKTOP_ORIGINS = ['http://tauri.localhost', 'tauri://localhost'];

export const databaseUrl = (config: ServerConfig, secrets: Secrets, database = 'victorflow') =>
  `postgresql://victorflow:${encodeURIComponent(secrets.dbPassword)}@127.0.0.1:${config.pgPort}/${database}`;

export const apiBaseUrl = (config: ServerConfig) => `http://127.0.0.1:${config.apiPort}/api/v1`;

export function apiEnv(config: ServerConfig, secrets: Secrets, data: DataLayout, nodeEnv = 'development'): Record<string, string> {
  return {
    // development, not production: production refuses LICENSE_MODE=dev, and licence activation (onboarding) is not built
    // yet. Everything else is a real production setup: generated secrets, a dedicated database, real migrations.
    NODE_ENV: nodeEnv,
    PORT: String(config.apiPort),
    DATABASE_URL: databaseUrl(config, secrets),
    REDIS_ENABLED: 'false',
    QUEUE_ENABLED: 'false',
    JWT_ACCESS_SECRET: secrets.jwtAccessSecret,
    TRACKING_HMAC_SECRET: secrets.trackingHmacSecret,
    TRACKER_BASE_URL: config.trackerPublicUrl,
    STORAGE_DIR: data.storage,
    LICENSE_FILE: data.license,
    LICENSE_MODE: 'dev',
    LICENSE_ENFORCE: 'false',
    CORS_ORIGINS: [...DESKTOP_ORIGINS, ...config.extraCorsOrigins].join(','),
  };
}

export interface WebEnv {
  NODE_ENV: string;
  PORT: string;
  HOSTNAME: string;
  NEXT_TELEMETRY_DISABLED: string;
}

/** A Next.js standalone server: PORT and HOSTNAME pick where it listens (all interfaces, for the LAN). */
function webEnv(port: number): WebEnv {
  return { NODE_ENV: 'production', PORT: String(port), HOSTNAME: '0.0.0.0', NEXT_TELEMETRY_DISABLED: '1' };
}

/** The tracker reads orders through the API on this same machine. */
export const trackerEnv = (config: ServerConfig) => ({ ...webEnv(config.trackerPort), TRACKER_API_URL: apiBaseUrl(config) });

export const displayEnv = (config: ServerConfig) => ({ ...webEnv(config.displayPort), DISPLAY_API_URL: apiBaseUrl(config) });
