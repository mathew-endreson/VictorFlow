import { Client } from 'pg';

const SAFE_NAME = /^[A-Za-z0-9_]+$/;

/**
 * Drop and re-create `<database>_<suffix>` on the same server as `baseUrl` and return its connection URL.
 * Used by the db package tests and the API's e2e global setup so tests never touch the dev database.
 * Needs a role that may CREATE DATABASE (the docker-compose user is a superuser).
 */
export async function recreateDatabase(baseUrl: string, suffix: string): Promise<string> {
  const target = new URL(baseUrl);
  const baseName = decodeURIComponent(target.pathname.slice(1));
  const testName = `${baseName}_${suffix}`;
  if (!SAFE_NAME.test(testName)) throw new Error(`Unsafe database name: ${testName}`);

  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [testName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${testName}"`);
    await admin.query(`CREATE DATABASE "${testName}"`);
  } finally {
    await admin.end();
  }

  target.pathname = `/${testName}`;
  return target.toString();
}
