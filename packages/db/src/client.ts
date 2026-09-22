import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import type { Database } from './schema';

// `date` columns stay 'YYYY-MM-DD' strings. Left alone, pg turns them into a JS Date at local midnight,
// which silently shifts the accounting day in any timezone east of UTC (Algeria is UTC+1).
types.setTypeParser(1082, (v: string) => v);

export interface CreateDbOptions {
  max?: number;
}

export function createDb(connectionString: string, opts: CreateDbOptions = {}): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, max: opts.max ?? 10 }),
    }),
  });
}
