import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser } from '@victorflow/types';
import { ApiClient, AuthError, tokenVault } from './api/client';
import { SqliteSyncStore } from './db/store';
import { NetworkError } from './sync/types';

export interface Session {
  api: ApiClient;
  store: SqliteSyncStore;
  user: AuthUser;
  deviceId: string;
}

interface SessionState {
  status: 'loading' | 'signed-out' | 'signed-in';
  session: Session | null;
  signIn: (apiUrl: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  lastApiUrl: string | null;
}

const Ctx = createContext<SessionState | null>(null);

const KEYS = { apiUrl: 'vf.apiUrl', user: 'vf.user', deviceId: 'vf.deviceId' } as const;

async function deviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEYS.deviceId);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(KEYS.deviceId, id);
  return id;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [lastApiUrl, setLastApiUrl] = useState<string | null>(null);

  // Restore on start. With no network we still open the app from the cached user + local database: a field agent
  // in a basement must be able to see and edit today's tasks.
  useEffect(() => {
    (async () => {
      const [tokens, apiUrl, cachedUser] = await Promise.all([tokenVault.load(), SecureStore.getItemAsync(KEYS.apiUrl), SecureStore.getItemAsync(KEYS.user)]);
      setLastApiUrl(apiUrl);
      if (!tokens || !apiUrl || !cachedUser) return setStatus('signed-out');

      const api = new ApiClient(apiUrl, tokens);
      let user = JSON.parse(cachedUser) as AuthUser;
      try {
        user = await api.me();
        await SecureStore.setItemAsync(KEYS.user, JSON.stringify(user));
      } catch (e) {
        if (e instanceof AuthError) return setStatus('signed-out');
        if (!(e instanceof NetworkError)) return setStatus('signed-out');
        // NetworkError: offline start — carry on with the cached user
      }
      const store = await SqliteSyncStore.open();
      setSession({ api, store, user, deviceId: await deviceId() });
      setStatus('signed-in');
    })().catch(() => setStatus('signed-out'));
  }, []);

  const signIn = useCallback(async (apiUrl: string, email: string, password: string) => {
    const api = new ApiClient(apiUrl.replace(/\/+$/, ''), null);
    const { user } = await api.login(email, password);
    const store = await SqliteSyncStore.open();
    const previous = await SecureStore.getItemAsync(KEYS.user);
    // A different person signing in must not inherit the previous person's tasks or unsynced edits.
    if (previous && (JSON.parse(previous) as AuthUser).id !== user.id) await store.clearAll();
    await SecureStore.setItemAsync(KEYS.apiUrl, api.baseUrl);
    await SecureStore.setItemAsync(KEYS.user, JSON.stringify(user));
    setLastApiUrl(api.baseUrl);
    setSession({ api, store, user, deviceId: await deviceId() });
    setStatus('signed-in');
  }, []);

  const signOut = useCallback(async () => {
    const s = session;
    setSession(null);
    setStatus('signed-out');
    if (s) {
      // MVP-NOTE: signing out discards unsynced edits and unsent photos. A production build should warn first
      // ("3 changes have not been synced") or refuse until they are.
      await s.store.clearAll();
      await s.api.logout();
    }
    await SecureStore.deleteItemAsync(KEYS.user);
  }, [session]);

  const value = useMemo(() => ({ status, session, signIn, signOut, lastApiUrl }), [status, session, signIn, signOut, lastApiUrl]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
