import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createDb, sql, type Database, type Kysely, type Transaction } from '@victorflow/db';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { currentUserId } from '../../common/request-context';

export type Trx = Transaction<Database>;

const RETRYABLE = new Set(['40P01', '40001']); // deadlock_detected, serialization_failure
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  /** Use directly for reads. Writes should go through transaction() so the audit actor is recorded. */
  readonly db: Kysely<Database>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.db = createDb(config.databaseUrl, { max: 10 });
  }

  /**
   * Run `fn` in a transaction.
   *  - Sets `app.user_id` (transaction-local) from the request context so audit triggers know the actor.
   *  - Retries on deadlock / serialisation failure (the audit chain lock and the change_seq lock make
   *    those possible, if rare, for transactions that touch several tables in different orders).
   *    `fn` may therefore run more than once: keep it free of side effects outside the database.
   */
  async transaction<T>(fn: (trx: Trx) => Promise<T>, opts: { actorId?: string | null } = {}): Promise<T> {
    const actor = opts.actorId === undefined ? currentUserId() : (opts.actorId ?? undefined);
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.transaction().execute(async (trx) => {
          if (actor) await sql`SELECT set_config('app.user_id', ${actor}, true)`.execute(trx);
          return fn(trx);
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (attempt < 4 && code && RETRYABLE.has(code)) {
          this.logger.warn(`Transaction retry ${attempt} after ${code}`);
          await sleep(15 * attempt + Math.random() * 40);
          continue;
        }
        throw err;
      }
    }
  }

  async ping(): Promise<boolean> {
    try {
      await sql`SELECT 1`.execute(this.db);
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }
}
