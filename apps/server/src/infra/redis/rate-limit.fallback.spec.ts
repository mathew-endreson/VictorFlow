import type { AppConfig } from '../../config/config';
import { MemoryWindowCounter, RateLimitService } from './rate-limit.service';
import type { RedisService } from './redis.service';

describe('MemoryWindowCounter (the limiter used when there is no healthy Redis)', () => {
  it('allows `limit` hits per window, then refuses, and says how long to wait', () => {
    let now = 1_000_000;
    const c = new MemoryWindowCounter(() => now);
    const hits = Array.from({ length: 6 }, () => c.hit('login:1.2.3.4:a@b.c', 5, 900));
    expect(hits.map((h) => h.allowed)).toEqual([true, true, true, true, true, false]);
    expect(hits[0]).toMatchObject({ remaining: 4 });
    expect(hits[5]).toMatchObject({ remaining: 0, retryAfterSeconds: 900 });

    now += 600_000; // 10 minutes later: still the same window
    expect(c.hit('login:1.2.3.4:a@b.c', 5, 900)).toMatchObject({ allowed: false, retryAfterSeconds: 300 });
  });

  it('starts a fresh window once the old one has expired, and keeps keys independent', () => {
    let now = 0;
    const c = new MemoryWindowCounter(() => now);
    for (let i = 0; i < 3; i++) c.hit('a', 2, 60);
    expect(c.hit('a', 2, 60).allowed).toBe(false);
    expect(c.hit('b', 2, 60).allowed).toBe(true); // another key is unaffected
    now += 61_000;
    expect(c.hit('a', 2, 60)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('never remembers more than maxKeys keys, whatever an attacker sends', () => {
    let now = 0;
    const c = new MemoryWindowCounter(() => now, 100);
    for (let i = 0; i < 1_000; i++) c.hit(`k${i}`, 5, 60);
    expect(c.size).toBeLessThanOrEqual(100);
    now += 120_000; // everything expired: the next hit sweeps the dead windows
    c.hit('fresh', 5, 60);
    expect(c.size).toBe(1);
  });
});

describe('RateLimitService without a working Redis', () => {
  const service = (redis: Partial<RedisService>, rateLimitEnabled = true) => new RateLimitService(redis as RedisService, { rateLimitEnabled } as AppConfig);

  it('still limits when Redis is not configured at all (brute-force protection must not depend on Redis)', async () => {
    const s = service({ client: undefined, isReady: false });
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await s.hit('login:ip:user', 5, 900));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, true, false]);
  });

  it('falls back to the in-process limiter when Redis is down or errors — it does not fail open', async () => {
    const broken = {
      client: {
        multi: () => ({ incr() { return this; }, ttl() { return this; }, exec: async () => { throw new Error('ECONNREFUSED'); } }),
        expire: async () => undefined,
      },
      isReady: true,
    };
    const s = service(broken as unknown as Partial<RedisService>);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await s.hit('track:ip', 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);

    const notReady = service({ client: broken.client as never, isReady: false });
    expect((await notReady.hit('x', 1, 60)).allowed).toBe(true);
    expect((await notReady.hit('x', 1, 60)).allowed).toBe(false);
  });

  it('is off only when RATE_LIMIT_ENABLED=false', async () => {
    const off = service({ client: undefined, isReady: false }, false);
    for (let i = 0; i < 50; i++) expect((await off.hit('k', 1, 60)).allowed).toBe(true);
  });
});
