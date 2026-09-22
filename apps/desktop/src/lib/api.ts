import type { LoginResponse } from '@victorflow/types';

const DEFAULT_BASE = (import.meta.env?.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api/v1';
const STORAGE_KEY = 'vf.tokens';
const BASE_KEY = 'vf.apiBase';

/**
 * "192.168.1.10:3000", "http://office-pc:3000/" or a full "https://erp.example.dz/api/v1" → "http://…/api/v1" (no trailing
 * slash). Returns null for anything that is not an http(s) address. A bare host:port means the VictorFlow API on the
 * customer's own network, so it is assumed to be plain http and to live under /api/v1.
 */
export function normalizeApiBase(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || url.username || url.password) return null;
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path === '' ? '/api/v1' : path}`;
  } catch {
    return null;
  }
}

/**
 * A desktop client is installed on employees' PCs and talks to the API on the customer's server, whose address is only
 * known at install time — so it is a setting (kept on this machine), with the build-time VITE_API_URL as the default.
 */
let base: string = (() => {
  try {
    const saved = globalThis.localStorage?.getItem(BASE_KEY);
    if (saved) return normalizeApiBase(saved) ?? normalizeApiBase(DEFAULT_BASE) ?? 'http://localhost:3000/api/v1';
  } catch {
    /* storage blocked → default */
  }
  return normalizeApiBase(DEFAULT_BASE) ?? 'http://localhost:3000/api/v1';
})();

export const getApiBase = () => base;
export const defaultApiBase = () => normalizeApiBase(DEFAULT_BASE) ?? 'http://localhost:3000/api/v1';

/** Point this client at another server (null = back to the default). Returns the normalised address, or null if invalid. */
export function setApiBase(input: string | null): string | null {
  const next = input === null ? defaultApiBase() : normalizeApiBase(input);
  if (!next) return null;
  base = next;
  try {
    if (input === null || next === defaultApiBase()) globalThis.localStorage?.removeItem(BASE_KEY);
    else globalThis.localStorage?.setItem(BASE_KEY, next);
  } catch {
    /* the choice just won't survive a restart */
  }
  return next;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** A failed API call. `message` is the server's own explanation, safe to show to the user. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** Field-level problems from zod validation (400). */
  get issues(): Array<{ path: string; message: string }> {
    return (this.body?.issues as Array<{ path: string; message: string }>) ?? [];
  }
}

// ── token storage ────────────────────────────────────────────────────────────
// MVP-NOTE: localStorage in the webview. A hardened build would keep the refresh token in the OS keychain
// (Tauri stronghold / keyring plugin) so it is never readable by page scripts.

const safeStorage = {
  get: (): string | null => {
    try {
      return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  },
  set: (v: string) => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, v);
    } catch {
      /* private mode etc. — the session simply won't survive a reload */
    }
  },
  clear: () => {
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};

let tokens: Tokens | null = (() => {
  const raw = safeStorage.get();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Tokens;
  } catch {
    return null;
  }
})();

const expiredListeners = new Set<() => void>();
export const onSessionExpired = (fn: () => void): (() => void) => {
  expiredListeners.add(fn);
  return () => {
    expiredListeners.delete(fn);
  };
};

export const tokenStore = {
  get: () => tokens,
  set(t: Tokens) {
    tokens = t;
    safeStorage.set(JSON.stringify(t));
  },
  clear() {
    tokens = null;
    safeStorage.clear();
  },
};

// ── requests ─────────────────────────────────────────────────────────────────

/** All concurrent 401s share ONE refresh call — the server rotates refresh tokens, so two in flight would kill the session. */
let refreshing: Promise<boolean> | null = null;

function refreshTokens(): Promise<boolean> {
  refreshing ??= (async () => {
    const current = tokens;
    if (!current) return false;
    try {
      const res = await fetch(`${base}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!res.ok) {
        tokenStore.clear();
        expiredListeners.forEach((fn) => fn());
        return false;
      }
      const data = (await res.json()) as LoginResponse;
      tokenStore.set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      return true;
    } catch {
      return false; // network trouble: keep the tokens, the caller's error will say "cannot reach the server"
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

type Params = Record<string, string | number | boolean | undefined | null>;

function url(path: string, params?: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return `${base}${path}${s ? `?${s}` : ''}`;
}

async function toError(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> | undefined;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  const message = typeof body?.message === 'string' ? body.message : `Request failed (${res.status})`;
  return new ApiError(res.status, message, typeof body?.code === 'string' ? body.code : undefined, body);
}

async function request<T>(method: string, path: string, opts: { params?: Params; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.auth !== false && tokens) headers.authorization = `Bearer ${tokens.accessToken}`;
    return fetch(url(path, opts.params), { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  };

  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, 'Cannot reach the VictorFlow server. Is it running?', 'NETWORK');
  }

  if (res.status === 401 && opts.auth !== false && tokens) {
    if (await refreshTokens()) {
      try {
        res = await send();
      } catch {
        throw new ApiError(0, 'Cannot reach the VictorFlow server. Is it running?', 'NETWORK');
      }
    }
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, params?: Params) => request<T>('GET', path, { params }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  del: <T = void>(path: string) => request<T>('DELETE', path),
  /** Unauthenticated call (login). */
  anon: <T>(path: string, body: unknown) => request<T>('POST', path, { body, auth: false }),
};


