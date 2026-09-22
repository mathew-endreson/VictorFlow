import * as SecureStore from 'expo-secure-store';
import type { LoginResponse, ProofDto, SyncPullResponse, SyncPushResponse } from '@victorflow/types';
import { REQUEST_TIMEOUT_MS } from '../config';
import { NetworkError, PermanentError, type LocalProof, type PushMutation, type SyncApi } from '../sync/types';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** The refresh token was rejected: the user must sign in again. */
export class AuthError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message);
    this.name = 'AuthError';
  }
}

/** A non-retryable HTTP error carrying the server's message (bad credentials, validation …). */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

const TOKENS_KEY = 'vf.tokens';
export const tokenVault = {
  load: async (): Promise<Tokens | null> => {
    try {
      const raw = await SecureStore.getItemAsync(TOKENS_KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  },
  save: (t: Tokens) => SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(t)),
  clear: () => SecureStore.deleteItemAsync(TOKENS_KEY),
};

export class ApiClient implements SyncApi {
  private refreshing: Promise<boolean> | null = null;

  constructor(
    public readonly baseUrl: string,
    private tokens: Tokens | null,
  ) {}

  get hasSession() {
    return this.tokens !== null;
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const res = await this.raw('POST', '/auth/login', { json: { email, password }, auth: false });
    const data = (await this.ok(res)) as LoginResponse;
    this.tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken };
    await tokenVault.save(this.tokens);
    return data;
  }

  async logout(): Promise<void> {
    const t = this.tokens;
    this.tokens = null;
    await tokenVault.clear();
    if (t) await this.raw('POST', '/auth/logout', { json: { refreshToken: t.refreshToken }, auth: false }).catch(() => undefined);
  }

  me = async () => (await this.ok(await this.authed('GET', '/auth/me'))) as LoginResponse['user'];

  // ── SyncApi ────────────────────────────────────────────────────────────────

  async push(deviceId: string, mutations: PushMutation[]): Promise<SyncPushResponse> {
    return (await this.ok(await this.authed('POST', '/sync/push', { json: { deviceId, mutations } }))) as SyncPushResponse;
  }

  async pull(cursor: string, limit: number): Promise<SyncPullResponse> {
    return (await this.ok(await this.authed('GET', `/sync/pull?cursor=${encodeURIComponent(cursor)}&limit=${limit}`))) as SyncPullResponse;
  }

  async uploadProof(proof: LocalProof): Promise<ProofDto> {
    const form = new FormData();
    form.append('proofId', proof.id);
    form.append('taskId', proof.taskId);
    if (proof.latitude !== null && proof.longitude !== null) {
      form.append('latitude', String(proof.latitude));
      form.append('longitude', String(proof.longitude));
    }
    form.append('capturedAt', proof.capturedAt);
    // React Native's FormData accepts a { uri, name, type } descriptor and streams the file from disk.
    form.append('photo', { uri: proof.fileUri, name: `${proof.id}.${proof.mimeType === 'image/png' ? 'png' : 'jpg'}`, type: proof.mimeType } as unknown as Blob);

    const res = await this.authed('POST', '/sync/proofs', { form });
    if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
      throw new PermanentError((await this.message(res)) ?? `Upload refused (${res.status})`, res.status);
    }
    return (await this.ok(res)) as ProofDto;
  }

  // ── plumbing ───────────────────────────────────────────────────────────────

  private async raw(method: string, path: string, opts: { json?: unknown; form?: FormData; auth?: boolean } = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    if (opts.json !== undefined) headers['content-type'] = 'application/json';
    if (opts.auth !== false && this.tokens) headers.authorization = `Bearer ${this.tokens.accessToken}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${this.baseUrl}${path}`, { method, headers, body: opts.form ?? (opts.json === undefined ? undefined : JSON.stringify(opts.json)), signal: ctrl.signal });
    } catch {
      throw new NetworkError(); // offline, DNS, refused, timeout — all the same to the sync engine: try again later
    } finally {
      clearTimeout(timer);
    }
  }

  private async authed(method: string, path: string, opts: { json?: unknown; form?: FormData } = {}): Promise<Response> {
    let res = await this.raw(method, path, opts);
    if (res.status === 401 && this.tokens) {
      if (await this.refresh()) res = await this.raw(method, path, opts);
    }
    if (res.status === 401) throw new AuthError();
    return res;
  }

  /** One refresh at a time: the server rotates refresh tokens, so two in flight would revoke the session. */
  private refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const res = await this.raw('POST', '/auth/refresh', { json: { refreshToken: this.tokens?.refreshToken }, auth: false });
        if (!res.ok) {
          this.tokens = null;
          await tokenVault.clear();
          return false;
        }
        const data = (await res.json()) as LoginResponse;
        this.tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken };
        await tokenVault.save(this.tokens);
        return true;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async message(res: Response): Promise<string | undefined> {
    try {
      const body = (await res.json()) as { message?: string };
      return typeof body.message === 'string' ? body.message : undefined;
    } catch {
      return undefined;
    }
  }

  private async ok(res: Response): Promise<unknown> {
    if (res.ok) return res.status === 204 ? undefined : res.json();
    throw new HttpError(res.status, (await this.message(res)) ?? `Request failed (${res.status})`);
  }
}
