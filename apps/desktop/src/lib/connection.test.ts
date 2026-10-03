import { describe, expect, it, vi } from 'vitest';
import { checkServer, displayHost, HEALTH_SERVICE, PROBLEM_KEY } from './connection';
import { enMessages } from '@/i18n';

const BASE = 'http://192.168.1.10:3000/api/v1';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const named = (extra: Record<string, unknown> = {}) => ({ service: HEALTH_SERVICE, status: 'ok', db: 'up', redis: 'disabled', time: '2026-10-01T00:00:00Z', ...extra });
const timeoutError = () => Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });

describe('checkServer', () => {
  it('ok: a named health answer with the database up — and it asks /health on the configured server, uncached', async () => {
    const f = vi.fn(async () => json(200, named()));
    expect(await checkServer(BASE, { fetch: f })).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/health`);
    expect(init.cache).toBe('no-store');
  });

  it('database-down: the API is up but answers 503 because its database is not', async () => {
    const f = vi.fn(async () => json(503, { statusCode: 503, error: 'Service Unavailable', ...named({ status: 'down', db: 'down' }) }));
    expect(await checkServer(BASE, { fetch: f })).toEqual({ ok: false, problem: 'database-down' });
  });

  it('not-victorflow: JSON without our name, or not JSON at all', async () => {
    expect(await checkServer(BASE, { fetch: vi.fn(async () => json(200, { status: 'ok' })) })).toEqual({ ok: false, problem: 'not-victorflow' });
    expect(await checkServer(BASE, { fetch: vi.fn(async () => new Response('<html>router login</html>', { status: 200 })) })).toEqual({ ok: false, problem: 'not-victorflow' });
  });

  it('not-victorflow: the normal request fails (no CORS headers) but an opaque no-cors probe gets an answer', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.mode === 'no-cors') return new Response(null, { status: 200 });
      throw new TypeError('Failed to fetch');
    });
    expect(await checkServer(BASE, { fetch: f as unknown as typeof fetch })).toEqual({ ok: false, problem: 'not-victorflow' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('unreachable: both the request and the no-cors probe fail — nothing is listening there', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await checkServer(BASE, { fetch: f })).toEqual({ ok: false, problem: 'unreachable' });
  });

  it('timeout: the server never answers in time (no second probe needed)', async () => {
    const f = vi.fn(async () => {
      throw timeoutError();
    });
    expect(await checkServer(BASE, { fetch: f, timeoutMs: 10 })).toEqual({ ok: false, problem: 'timeout' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('every problem has an explanation in the catalogue', () => {
    for (const key of Object.values(PROBLEM_KEY)) expect(enMessages[key], key).toBeTruthy();
  });
});

describe('displayHost', () => {
  it('shows the address the way a person typed it', () => {
    expect(displayHost(BASE)).toBe('192.168.1.10:3000');
    expect(displayHost('https://erp.example.dz/api/v1')).toBe('erp.example.dz');
    expect(displayHost('https://erp.example.dz/vf/api/v1')).toBe('erp.example.dz/vf');
  });
});
