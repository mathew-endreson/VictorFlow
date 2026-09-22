import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb, loadEnv, migrateToLatest, recreateDatabase, seed } from '@victorflow/db';

export const TEST_PASSWORD = 'Test-Password-1';

/**
 * Runs once before all e2e specs: throw-away database → migrations → seed.
 * The dev database is never touched. Requires Postgres (pnpm infra:up).
 */
export default async function globalSetup(): Promise<void> {
  loadEnv();
  const base = process.env.DATABASE_URL ?? 'postgresql://victorflow:victorflow@localhost:5432/victorflow';

  let url: string;
  try {
    url = await recreateDatabase(base, 'test');
  } catch (err) {
    const where = base.replace(/\/\/[^@]*@/, '//***@');
    throw new Error(
      `e2e tests need PostgreSQL but could not prepare a test database on ${where}: ${(err as Error).message}\n` +
        'Start it with `pnpm infra:up` (docker) and try again.',
    );
  }

  const db = createDb(url, { max: 2 });
  try {
    await migrateToLatest(db);
    // Fixed fiscal year: specs use 2026 dates and must not depend on the machine clock.
    await seed(db, { demoPassword: TEST_PASSWORD, fiscalYear: 2026 });
  } finally {
    await db.destroy();
  }

  // Photos written by the specs go to a throw-away directory, never into the repo's ./storage.
  const storageDir = mkdtempSync(path.join(tmpdir(), 'victorflow-e2e-storage-'));

  // Inherited by the specs (they run in this process with --runInBand, or in forked workers).
  Object.assign(process.env, {
    STORAGE_DIR: storageDir,
    // A small cap so the "file too large" test needs a ~100 KB upload, not 10 MB. (Aborting a multi-megabyte upload
    // mid-stream with client and server in ONE Windows process intermittently crashed Node itself; against a real,
    // separate server it is a clean 413 every time — verified 30/30 — so the test uses a tiny limit instead.)
    UPLOAD_MAX_BYTES: '65536',
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_ENABLED: 'false', // tests never open a Redis connection (no reconnect timers outliving a torn-down Jest context)
    QUEUE_ENABLED: 'false', // no BullMQ workers in tests
    RATE_LIMIT_ENABLED: 'false', // logins in tests must not depend on a shared Redis' counters
    LICENSE_MODE: 'dev',
    LICENSE_ENFORCE: 'false',
  });
  process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789abcdef0123456789';
  process.env.TRACKING_HMAC_SECRET ??= 'test-tracking-secret-0123456789abcdef0123456789';
}
