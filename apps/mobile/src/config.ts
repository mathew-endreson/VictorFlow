import Constants from 'expo-constants';

/**
 * Where the API lives. On a phone, "localhost" is the phone itself, so unless EXPO_PUBLIC_API_URL says otherwise we
 * use the address of the machine running `expo start` (Metro's host) — which is where the dev API runs too.
 */
export function defaultApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host ?? 'localhost'}:3000/api/v1`;
}

export const SYNC_INTERVAL_MS = 30_000;
export const REQUEST_TIMEOUT_MS = 20_000;
