import { beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny in-memory localStorage, installed before the module under test is loaded.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function load() {
  vi.resetModules();
  return import('./api');
}

beforeEach(() => {
  store.clear();
  vi.restoreAllMocks();
});

describe('api client', () => {
  it('sends the bearer token and JSON body, and builds the query string (skipping empty values)', async () => {
    const { api, tokenStore } = await load();
    tokenStore.set({ accessToken: 'AT', refreshToken: 'RT' });
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(200, { ok: true })); // a fresh Response per call: a body can be read once
    await api.get('/customers', { search: 'ab c', page: 2, empty: '', nothing: undefined });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/customers\?search=ab\+c&page=2$/);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer AT');

    await api.post('/orders', { a: 1 });
    const [, init2] = f.mock.calls[1] as [string, RequestInit];
    expect(init2.body).toBe('{"a":1}');
    expect((init2.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('turns an error response into an ApiError carrying the server message, code and field issues', async () => {
    const { api, ApiError } = await load();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(400, { message: 'Validation failed', code: 'VALIDATION_FAILED', issues: [{ path: 'name', message: 'Too short' }] }));
    const err = (await api.get('/x').catch((e: unknown) => e)) as InstanceType<typeof ApiError>;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, message: 'Validation failed', code: 'VALIDATION_FAILED' });
    expect(err.issues).toEqual([{ path: 'name', message: 'Too short' }]);
  });

  it('a 401 triggers ONE refresh, stores the rotated tokens, and retries the request', async () => {
    const { api, tokenStore } = await load();
    tokenStore.set({ accessToken: 'OLD', refreshToken: 'RT1' });
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(401, { message: 'expired' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'NEW', refreshToken: 'RT2', expiresIn: 900, user: {} }))
      .mockResolvedValueOnce(json(200, { data: 1 }));
    expect(await api.get('/me')).toEqual({ data: 1 });
    expect(f.mock.calls.map((c) => (c[0] as string).split('/api/v1')[1] ?? c[0])).toEqual(['/me', '/auth/refresh', '/me']);
    expect(((f.mock.calls[2] as [string, RequestInit])[1].headers as Record<string, string>).authorization).toBe('Bearer NEW');
    expect(tokenStore.get()).toEqual({ accessToken: 'NEW', refreshToken: 'RT2' });
  });

  it('concurrent 401s share a SINGLE refresh call (the server rotates refresh tokens — two would kill the session)', async () => {
    const { api, tokenStore } = await load();
    tokenStore.set({ accessToken: 'OLD', refreshToken: 'RT1' });
    let refreshCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const u = String(input);
      if (u.endsWith('/auth/refresh')) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return json(200, { accessToken: 'NEW', refreshToken: 'RT2', expiresIn: 900, user: {} });
      }
      const auth = ((init as RequestInit).headers as Record<string, string>).authorization;
      return auth === 'Bearer NEW' ? json(200, { ok: u }) : json(401, { message: 'expired' });
    });
    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c'), api.get('/d')]);
    expect(results).toHaveLength(4);
    expect(refreshCalls).toBe(1);
  });

  it('a failed refresh clears the session, notifies listeners, and surfaces the original 401', async () => {
    const { api, tokenStore, onSessionExpired } = await load();
    tokenStore.set({ accessToken: 'OLD', refreshToken: 'DEAD' });
    const expired = vi.fn();
    onSessionExpired(expired);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => (String(input).endsWith('/auth/refresh') ? json(401, { message: 'revoked' }) : json(401, { message: 'expired' })));
    await expect(api.get('/me')).rejects.toMatchObject({ status: 401 });
    expect(tokenStore.get()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    expect(store.has('vf.tokens')).toBe(false);
  });

  it('never tries to refresh for an unauthenticated call (login) and reports bad credentials as-is', async () => {
    const { api } = await load();
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { message: 'Invalid email or password' }));
    await expect(api.anon('/auth/login', { email: 'a', password: 'b' })).rejects.toMatchObject({ status: 401, message: 'Invalid email or password' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('reports an unreachable server with a friendly message', async () => {
    const { api } = await load();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(api.get('/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK', message: expect.stringContaining('Cannot reach') });
  });

  it('restores tokens from storage on load; 204 responses resolve to undefined', async () => {
    store.set('vf.tokens', JSON.stringify({ accessToken: 'A', refreshToken: 'R' }));
    const { api, tokenStore } = await load();
    expect(tokenStore.get()).toEqual({ accessToken: 'A', refreshToken: 'R' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(204, null));
    expect(await api.del('/customers/1')).toBeUndefined();
  });

  it('survives corrupt stored tokens', async () => {
    store.set('vf.tokens', '{not json');
    const { tokenStore } = await load();
    expect(tokenStore.get()).toBeNull();
  });
});

describe('server address (a runtime setting)', () => {
  it('normalises what a person would type into the API base, and rejects what is not an http(s) address', async () => {
    const { normalizeApiBase } = await load();
    expect(normalizeApiBase('192.168.1.10:3000')).toBe('http://192.168.1.10:3000/api/v1');
    expect(normalizeApiBase('  office-pc:3000/  ')).toBe('http://office-pc:3000/api/v1');
    expect(normalizeApiBase('http://localhost:3000/api/v1/')).toBe('http://localhost:3000/api/v1');
    expect(normalizeApiBase('https://erp.example.dz')).toBe('https://erp.example.dz/api/v1');
    expect(normalizeApiBase('https://erp.example.dz/vf/api/v1')).toBe('https://erp.example.dz/vf/api/v1');
    for (const bad of ['', '   ', 'ftp://host/api', 'javascript:alert(1)', 'http://', 'http://user:pw@host:3000', '::::']) expect(normalizeApiBase(bad), bad).toBeNull();
  });

  it('is used for every request, survives a restart, and can be reset to the default', async () => {
    let m = await load();
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(200, {}));
    expect(m.setApiBase('192.168.1.10:3000')).toBe('http://192.168.1.10:3000/api/v1');
    await m.api.get('/customers');
    expect((f.mock.calls[0] as [string])[0]).toBe('http://192.168.1.10:3000/api/v1/customers');

    m = await load(); // "restart": a fresh module reads the saved address
    expect(m.getApiBase()).toBe('http://192.168.1.10:3000/api/v1');

    expect(m.setApiBase('nonsense://x')).toBeNull(); // refused: the current address stays
    expect(m.getApiBase()).toBe('http://192.168.1.10:3000/api/v1');

    m.setApiBase(null);
    expect(m.getApiBase()).toBe(m.defaultApiBase());
    expect((await load()).getApiBase()).toBe(m.defaultApiBase());
  });
});
