import { consume, type RateLimitRedis } from './rate-limit.service';

/** Minimal in-memory stand-in for the ioredis calls the limiter makes. */
function fakeRedis() {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  const redis: RateLimitRedis = {
    multi() {
      const ops: Array<() => number> = [];
      const chain = {
        incr(key: string) {
          ops.push(() => {
            counts.set(key, (counts.get(key) ?? 0) + 1);
            return counts.get(key)!;
          });
          return chain;
        },
        ttl(key: string) {
          ops.push(() => ttls.get(key) ?? -1);
          return chain;
        },
        exec: async () => ops.map((op) => [null, op()] as [Error | null, unknown]),
      };
      return chain;
    },
    async expire(key: string, seconds: number) {
      ttls.set(key, seconds);
    },
  };
  return { redis, counts, ttls };
}

describe('rate limiter', () => {
  it('allows up to the limit, then blocks, and reports remaining', async () => {
    const { redis } = fakeRedis();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consume(redis, { key: 'k', limit: 3, windowSeconds: 60 }));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
  });

  it('sets the window TTL on the first hit only, and keeps keys independent', async () => {
    const { redis, ttls } = fakeRedis();
    await consume(redis, { key: 'a', limit: 5, windowSeconds: 900 });
    expect(ttls.get('rl:a')).toBe(900);
    await consume(redis, { key: 'b', limit: 1, windowSeconds: 900 });
    expect((await consume(redis, { key: 'a', limit: 5, windowSeconds: 900 })).allowed).toBe(true);
    expect((await consume(redis, { key: 'b', limit: 1, windowSeconds: 900 })).allowed).toBe(false);
  });

  it('fails OPEN when Redis errors, and reports the error', async () => {
    const boom: RateLimitRedis = {
      multi: () => {
        throw new Error('Stream isn\'t writeable and enableOfflineQueue options is false');
      },
      expire: async () => undefined,
    };
    const onError = jest.fn();
    const r = await consume(boom, { key: 'k', limit: 1, windowSeconds: 60, onError });
    expect(r.allowed).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('fails open when a pipeline reply carries an error', async () => {
    const bad: RateLimitRedis = {
      multi: () => {
        const chain = { incr: () => chain, ttl: () => chain, exec: async () => [[new Error('READONLY'), null], [null, -1]] as Array<[Error | null, unknown]> };
        return chain;
      },
      expire: async () => undefined,
    };
    expect((await consume(bad, { key: 'k', limit: 1, windowSeconds: 60 })).allowed).toBe(true);
  });

  it('is a no-op when disabled', async () => {
    const { redis, counts } = fakeRedis();
    await consume(redis, { key: 'k', limit: 1, windowSeconds: 60, enabled: false });
    await consume(redis, { key: 'k', limit: 1, windowSeconds: 60, enabled: false });
    expect(counts.size).toBe(0);
  });
});
