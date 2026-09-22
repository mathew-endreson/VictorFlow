import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/config';

/**
 * Redis is an accelerator here (rate limiting, background jobs), never a hard dependency:
 * the app boots and serves requests with Redis down, and callers degrade — the rate limiter switches to an in-process
 * counter (see RateLimitService), scheduled jobs pause or run in-process.
 * MVP-NOTE: if you later rely on Redis for correctness (sessions, locks), fail closed instead.
 *
 * With REDIS_ENABLED=false no connection is ever attempted and `client` is undefined.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private lastErrorLog = 0;
  readonly client: Redis | undefined;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (!config.redisEnabled) return;
    this.client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false, // commands fail immediately when disconnected instead of piling up
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    // An 'error' event with no listener would crash the process.
    this.client.on('error', (err) => {
      const now = Date.now();
      if (now - this.lastErrorLog > 30_000) {
        this.lastErrorLog = now;
        this.logger.warn(`Redis unavailable (${err.message}); rate limiting and jobs degrade gracefully`);
      }
    });
    this.client.on('ready', () => this.logger.log('Redis connected'));
  }

  onModuleInit(): void {
    // Never block boot on Redis.
    this.client?.connect().catch(() => undefined);
  }

  get enabled(): boolean {
    return this.client !== undefined;
  }

  get isReady(): boolean {
    return this.client?.status === 'ready';
  }

  async onModuleDestroy(): Promise<void> {
    this.client?.disconnect();
  }
}
