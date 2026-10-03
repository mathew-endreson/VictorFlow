// "Is it up?" answered by the component itself, never by "the process exists" or "the port is open".

/** The marker the API puts in every /health answer (apps/server/src/modules/health/health.controller.ts). */
export const HEALTH_SERVICE = 'victorflow-api';

export interface ApiHealth {
  service?: string;
  status?: string;
  db?: string;
}

/** The API is healthy when it names itself and reports ok (or degraded: running, with Redis down). */
export const isHealthyApi = (body: ApiHealth | null) => !!body && body.service === HEALTH_SERVICE && (body.status === 'ok' || body.status === 'degraded');

export async function fetchApiHealth(port: number, timeoutMs = 2000): Promise<ApiHealth | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return (await res.json()) as ApiHealth;
  } catch {
    return null;
  }
}

/** A Next.js app answers its home page (any status below 500 proves it is serving). */
export async function webAnswers(port: number, timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(timeoutMs) });
    await res.arrayBuffer();
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
