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
  logout: () => Promise<void>;
}

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

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.anon<LoginResponse>('/auth/login', { email, password });
      tokenStore.set({ accessToken: res.accessToken, refreshToken: res.refreshToken });
      qc.clear();
      setUser(res.user);
      setStatus('authed');
    },
    [qc],
  );

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
    return { status, user, login, logout, can: (...p) => p.every((x) => granted.has(x)) };
  }, [status, user, login, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
