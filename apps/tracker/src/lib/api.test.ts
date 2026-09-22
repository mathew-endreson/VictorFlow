import { describe, expect, it, vi } from 'vitest';
import { fetchTracking } from './api';

const sample = { orderNumber: 'ORD-2026-000001', status: { key: 'RECEIVED', label: 'Order received' }, steps: [], items: [] };
const respond = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('fetchTracking', () => {
  it('returns the timeline on 200 and asks for it with no-store caching', async () => {
    const f = respond(200, sample);
    const r = await fetchTracking('11111111-1111-1111-1111-111111111111', 'tok', f);
    expect(r).toEqual({ kind: 'ok', data: sample });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/public\/track\/11111111-1111-1111-1111-111111111111\/tok$/);
    expect(init.cache).toBe('no-store');
  });

  it('maps 404 to not-found (wrong token and unknown order are indistinguishable by design)', async () => {
    expect(await fetchTracking('x', 'y', respond(404))).toEqual({ kind: 'not-found' });
  });

  it('maps other failures and network errors to a temporary error, never throwing', async () => {
    expect(await fetchTracking('x', 'y', respond(500))).toEqual({ kind: 'error', status: 500 });
    expect(await fetchTracking('x', 'y', respond(429))).toEqual({ kind: 'error', status: 429 });
    const boom = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect(await fetchTracking('x', 'y', boom)).toEqual({ kind: 'error' });
  });

  it('URL-encodes path segments so a hostile token cannot alter the request path', async () => {
    const f = respond(404);
    await fetchTracking('a/b', '../../health?x=1', f);
    const [url] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).not.toContain('../');
    expect(url).toContain(encodeURIComponent('../../health?x=1'));
  });
});
