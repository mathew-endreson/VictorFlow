import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthUser, LoginResponse } from '@victorflow/types';
import { api, onSessionExpired, tokenStore } from './api';

type Status = 'loading' | 'authed' | 'anon';

interface AuthState {
  status: Status;
  user: AuthUser | null;
  /** Permission check used everywhere in the UI. The server enforces the same permissions — this only hides what would 403. */
  can: (...permissions: string[]) => boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Signs in with a session the server already opened (the owner's account, at the end of the onboarding). */
  adoptSession: (res: LoginResponse) => void;
  logout: () => Promise<void>;
}

/** An open desktop app renews its session well inside the server's idle window, so it keeps its licence seat. */
const KEEP_ALIVE_MS = 5 * 60_000;

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>(tokenStore.get() ? 'loading' : 'anon');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api
      .get<AuthUser>('/auth/me')
      .then((u) => {
        setUser(u);
        setStatus('authed');
      })
      .catch(() => {
        // a dead session or an unreachable server both land on the login screen (which explains the difference)
        setStatus('anon');
      });
  }, []);

  useEffect(
    () =>
      onSessionExpired(() => {
        qc.clear();
        setUser(null);
        setStatus('anon');
      }),
    [qc],
  );

  const adoptSession = useCallback(
    (res: LoginResponse) => {
      tokenStore.set({ accessToken: res.accessToken, refreshToken: res.refreshToken });
      qc.clear();
      setUser(res.user);
      setStatus('authed');
    },
    [qc],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      // "desktop": this sign-in takes one of the licence's desktop seats (the mobile app sends "mobile")
      adoptSession(await api.anon<LoginResponse>('/auth/login', { email, password, client: 'desktop' }));
    },
    [adoptSession],
  );

  useEffect(() => {
    if (status !== 'authed') return;
    const timer = setInterval(() => void api.get('/auth/me').catch(() => undefined), KEEP_ALIVE_MS);
    return () => clearInterval(timer);
  }, [status]);

  const logout = useCallback(async () => {
    const t = tokenStore.get();
    if (t) await api.post('/auth/logout', { refreshToken: t.refreshToken }).catch(() => undefined);
    tokenStore.clear();
    qc.clear();
    setUser(null);
    setStatus('anon');
  }, [qc]);

  const value = useMemo<AuthState>(() => {
    const granted = new Set(user?.permissions ?? []);
    return { status, user, login, adoptSession, logout, can: (...p) => p.every((x) => granted.has(x)) };
  }, [status, user, login, adoptSession, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
