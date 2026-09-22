import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { AuditVerifyDto } from '@victorflow/types';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { AuditService } from './audit.service';

const QUEUE_NAME = 'audit';
const JOB_NAME = 'verify-chain';
const EVERY_MS = 60 * 60 * 1000; // hourly
const FIRST_RUN_DELAY_MS = 60 * 1000; // shortly after boot, not during it

/** The job body, kept pure so it is unit-testable without Redis. A broken chain is a tamper alarm. */
export async function runChainVerification(verify: () => Promise<AuditVerifyDto>, log: Pick<Logger, 'log' | 'error'>): Promise<AuditVerifyDto> {
  const result = await verify();
  if (result.ok) log.log(`Audit chain intact (${result.checked} rows checked)`);
  else log.error(`AUDIT CHAIN BROKEN at trail id ${result.firstBrokenId}: ${result.reason} (${result.checked} rows checked before the break)`);
  return result;
}

function connectionFrom(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    // BullMQ workers require unlimited retries per request; the connection retries quietly until Redis appears.
    maxRetriesPerRequest: null,
  };
}

/**
 * Periodically re-verifies the audit hash chain in a BullMQ worker (Redis-backed).
 * Starts only when QUEUE_ENABLED and REDIS_ENABLED are true; it never blocks boot, and a missing Redis only means the
 * scheduled check does not run (the on-demand GET /audit/verify still works).
 */
@Injectable()
export class AuditChainJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('AuditChainJob');
  private queue?: Queue;
  private worker?: Worker;
  private timer?: ReturnType<typeof setInterval>;
  private firstRun?: ReturnType<typeof setTimeout>;
  private lastErrorLog = 0;

  constructor(
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.queueEnabled || !this.config.redisEnabled) return this.startInProcessSchedule();
    const quietError = (err: Error) => {
      const now = Date.now();
      if (now - this.lastErrorLog > 30_000) {
        this.lastErrorLog = now;
        this.logger.warn(`Queue unavailable (${err.message}); scheduled audit verification is paused`);
      }
    };
    try {
      const connection = connectionFrom(this.config.redisUrl);
      this.queue = new Queue(QUEUE_NAME, { connection });
      this.queue.on('error', quietError);
      this.worker = new Worker(QUEUE_NAME, async () => runChainVerification(() => this.audit.verifyChain(), this.logger), { connection });
      this.worker.on('error', quietError);
      // Idempotent: the same scheduler id is upserted, never duplicated, across restarts.
      this.queue.upsertJobScheduler(JOB_NAME, { every: EVERY_MS }, { name: JOB_NAME }).catch(quietError);
    } catch (err) {
      quietError(err as Error);
    }
  }

  /**
   * No Redis (or the queue is switched off): verify from a plain in-process timer instead. VictorFlow is one API process
   * per installation, so nothing can run it twice — and the tamper check must not vanish just because Redis is absent.
   * (Off under NODE_ENV=test, where a timer would fire into whichever test database happens to be open.)
   */
  private startInProcessSchedule(): void {
    if (this.config.nodeEnv === 'test') return;
    const run = () => void runChainVerification(() => this.audit.verifyChain(), this.logger).catch((err: Error) => this.logger.error(`Audit verification failed to run: ${err.message}`));
    this.firstRun = setTimeout(run, FIRST_RUN_DELAY_MS);
    this.timer = setInterval(run, EVERY_MS);
    this.firstRun.unref();
    this.timer.unref();
    this.logger.log('Redis/queue not in use: the audit chain is verified hourly by an in-process timer');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }
}
