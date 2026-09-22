import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Kysely, Migrator, sql, type Migration, type MigrationProvider, type MigrationResult } from 'kysely';
import { APP_SCHEMAS } from './schema';

// dist/index.js and src/*.ts both sit one level below the package root, next to /migrations.
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

/**
 * Migrations are plain .sql files (triggers and functions read far better as SQL than as strings
 * inside TypeScript). Forward-only — MVP-NOTE: add `down` scripts if you need rollbacks.
 */
class SqlFileMigrationProvider implements MigrationProvider {
  constructor(private readonly dir: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.sql')).sort();
    const migrations: Record<string, Migration> = {};
    for (const file of files) {
      const text = await fs.readFile(path.join(this.dir, file), 'utf8');
      migrations[file.replace(/\.sql$/, '')] = {
        // No bind parameters → pg uses the simple-query protocol, which allows many statements per call.
        up: async (db) => {
          await sql.raw(text).execute(db);
        },
      };
    }
    return migrations;
  }
}

export interface MigrateOutcome {
  applied: string[];
}

export async function migrateToLatest(db: Kysely<any>, dir: string = MIGRATIONS_DIR): Promise<MigrateOutcome> {
  const migrator = new Migrator({ db, provider: new SqlFileMigrationProvider(dir) });
  const { error, results } = await migrator.migrateToLatest();
  const failed = (results ?? []).find((r: MigrationResult) => r.status === 'Error');
  if (error || failed) {
    const which = failed ? ` (${failed.migrationName})` : '';
    throw new Error(`Migration failed${which}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  return { applied: (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName) };
}

/** Dev-only: drop every app schema and the migration bookkeeping, so migrate + seed start from zero. */
export async function resetDatabase(db: Kysely<any>): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
  for (const schema of APP_SCHEMAS) {
    await sql`DROP SCHEMA IF EXISTS ${sql.id(schema)} CASCADE`.execute(db);
  }
  await sql`DROP TABLE IF EXISTS public.kysely_migration, public.kysely_migration_lock`.execute(db);
}
