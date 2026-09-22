import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { RedisService } from './redis.service';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** The small slice of ioredis this service needs — lets unit tests use a fake. */
export interface RateLimitRedis {
  multi(): { incr(key: string): unknown; ttl(key: string): unknown; exec(): Promise<Array<[Error | null, unknown]> | null> };
  expire(key: string, seconds: number): Promise<unknown>;
}

/**
 * The same fixed-window counter, kept in this process's memory. VictorFlow is one API process per installation, so this
 * is exact — not an approximation — whenever Redis is absent or unhealthy. It is what keeps the login and tracking
 * limits (brute-force protection) alive on an installation that has no Redis at all.
 */
export class MemoryWindowCounter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    /** Upper bound on remembered keys, so a flood of distinct keys cannot grow memory without limit. */
    private readonly maxKeys = 10_000,
  ) {}

  hit(key: string, limit: number, windowSeconds: number): RateLimitResult {
    const now = this.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      if (this.windows.size >= this.maxKeys) this.makeRoom(now);
      w = { count: 0, resetAt: now + windowSeconds * 1000 };
      this.windows.set(key, w);
    }
    w.count += 1;
    return { allowed: w.count <= limit, remaining: Math.max(0, limit - w.count), retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }

  get size(): number {
    return this.windows.size;
  }

  private makeRoom(now: number): void {
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    // still full of live windows: drop the oldest ones (Map iterates in insertion order)
    for (const k of this.windows.keys()) {
      if (this.windows.size < this.maxKeys) break;
      this.windows.delete(k);
    }
  }
}

const OPEN: RateLimitResult = { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterSeconds: 0 };

/**
 * Fixed-window rate limiting. Redis when it is healthy; otherwise the in-process counter — it never silently lets
 * everything through (a limiter that fails open is no limiter). Only `RATE_LIMIT_ENABLED=false` switches it off.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly memory = new MemoryWindowCounter();
  private warnedAt = 0;

  constructor(
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    if (!this.config.rateLimitEnabled) return { ...OPEN, remaining: limit };

    if (this.redis.client && this.redis.isReady) {
      let failed = false;
      const result = await consume(this.redis.client as unknown as RateLimitRedis, {
        key,
        limit,
        windowSeconds,
        onError: (err) => {
          failed = true;
          this.warnOnce(`Redis rate limiting failed (${err.message}); using the in-process limiter`);
        },
      });
      if (!failed) return result;
    } else if (this.redis.client) {
      this.warnOnce('Redis is not connected; using the in-process rate limiter');
    }
    return this.memory.hit(`rl:${key}`, limit, windowSeconds);
  }

  private warnOnce(message: string): void {
    const now = Date.now();
    if (now - this.warnedAt > 60_000) {
      this.warnedAt = now;
      this.logger.warn(message);
    }
  }
}

/**
 * One Redis round trip: INCR + TTL in a transaction. Reports trouble through `onError` and answers "allowed" in that
 * case — the caller decides what to do about a Redis failure (RateLimitService switches to the in-process counter).
 */
export async function consume(
  redis: RateLimitRedis,
  opts: { key: string; limit: number; windowSeconds: number; enabled?: boolean; onError?: (e: Error) => void },
): Promise<RateLimitResult> {
  const open: RateLimitResult = { allowed: true, remaining: opts.limit, retryAfterSeconds: 0 };
  if (opts.enabled === false) return open;

  const key = `rl:${opts.key}`;
  try {
    const pipeline = redis.multi();
    pipeline.incr(key);
    pipeline.ttl(key);
    const replies = await pipeline.exec();
    if (!replies) throw new Error('Redis transaction was aborted');
    const [[incrErr, count], [ttlErr, ttl]] = replies as [[Error | null, number], [Error | null, number]];
    if (incrErr) throw incrErr;
    if (ttlErr) throw ttlErr;
    if (ttl < 0) await redis.expire(key, opts.windowSeconds); // first hit in the window (or a key that lost its TTL)
    const retryAfterSeconds = ttl > 0 ? ttl : opts.windowSeconds;
    return { allowed: count <= opts.limit, remaining: Math.max(0, opts.limit - count), retryAfterSeconds };
  } catch (err) {
    opts.onError?.(err as Error);
    return open;
  }
}
