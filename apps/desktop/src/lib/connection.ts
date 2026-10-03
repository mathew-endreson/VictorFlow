// Is the configured VictorFlow server there? One health probe, classified into something a person can act on.
// Pure (fetch is injected) so every outcome is unit-tested without a server.

/** What the API puts in every /health answer (apps/server/src/modules/health/health.controller.ts). */
export const HEALTH_SERVICE = 'victorflow-api';

/** How often the "cannot reach the server" screen and the "connection lost" banner check again. */
export const RETRY_SECONDS = 10;

export type ServerProblem = 'unreachable' | 'timeout' | 'not-victorflow' | 'database-down';
export type ServerCheck = { ok: true } | { ok: false; problem: ServerProblem };

/** The message key that explains each problem (desktop catalogues, `server.reason.*`). */
export const PROBLEM_KEY = {
  unreachable: 'server.reason.unreachable',
  timeout: 'server.reason.timeout',
  'not-victorflow': 'server.reason.notVictorflow',
  'database-down': 'server.reason.databaseDown',
} as const satisfies Record<ServerProblem, string>;

const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

/** "http://192.168.1.10:3000/api/v1" → "192.168.1.10:3000": the part a person typed and recognises. */
export const displayHost = (base: string) => base.replace(/^https?:\/\//, '').replace(/\/api\/v1$/, '');

export async function checkServer(base: string, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<ServerCheck> {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = opts.timeoutMs ?? 5000;
  const url = `${base}/health`;

  let res: Response;
  try {
    res = await f(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (isTimeout(e)) return { ok: false, problem: 'timeout' };
    // A browser reports "nothing listening" and "something answered without our CORS headers" as the same TypeError.
    // An opaque no-cors request tells them apart: it only succeeds when *something* answered at that address.
    try {
      await f(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
      return { ok: false, problem: 'not-victorflow' };
    } catch (e2) {
      return { ok: false, problem: isTimeout(e2) ? 'timeout' : 'unreachable' };
    }
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, problem: 'not-victorflow' };
  }
  if (!body || typeof body !== 'object' || (body as { service?: unknown }).service !== HEALTH_SERVICE) return { ok: false, problem: 'not-victorflow' };
  // The API answers 503 (with the same named body) only when it cannot reach its database.
  if (!res.ok || (body as { db?: unknown }).db === 'down') return { ok: false, problem: 'database-down' };
  return { ok: true };
}
