import type { PublicTrackingDto } from '@victorflow/types';

/** Server-side (Next.js) URL of the VictorFlow API. Never exposed to the browser. */
export const apiBase = (): string => (process.env.TRACKER_API_URL ?? 'http://localhost:3000/api/v1').replace(/\/+$/, '');

export type TrackingResult =
  | { kind: 'ok'; data: PublicTrackingDto }
  | { kind: 'not-found' }
  | { kind: 'error'; status?: number };

/**
 * Ask the API for the sanitised timeline. 404 means "no such link" (wrong token and unknown order look identical
 * on purpose); anything else non-2xx, or a network failure, is a temporary error to show as such.
 */
export async function fetchTracking(orderId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<TrackingResult> {
  try {
    const res = await fetchImpl(`${apiBase()}/public/track/${encodeURIComponent(orderId)}/${encodeURIComponent(token)}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (res.status === 404) return { kind: 'not-found' };
    if (!res.ok) return { kind: 'error', status: res.status };
    return { kind: 'ok', data: (await res.json()) as PublicTrackingDto };
  } catch {
    return { kind: 'error' };
  }
}
