import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { AuthError } from '../api/client';
import { SYNC_INTERVAL_MS } from '../config';
import type { Session } from '../session';
import { conflictCount, loadTaskViews, pendingCount } from './engine';
import { runSync } from './runtime';
import { NetworkError, type TaskView } from './types';

export interface SyncState {
  tasks: TaskView[];
  online: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  /** What went wrong, as data — the screen words it in the user's language. */
  error: { kind: 'offline' } | { kind: 'failed'; cause: unknown } | null;
  pending: number;
  conflicts: number;
}

/**
 * Keeps the task list fresh WITHOUT the UI ever waiting on the network: it always renders from local SQLite, and syncs
 *  - on start, when connectivity returns, when the app comes to the foreground, every 30 s, and on demand.
 */
export function useTaskSync(session: Session, onAuthExpired: () => void) {
  const { store, api, deviceId } = session;
  const [state, setState] = useState<SyncState>({ tasks: [], online: true, syncing: false, lastSyncAt: null, error: null, pending: 0, conflicts: 0 });
  const running = useRef(false);

  const reload = useCallback(async () => {
    const [tasks, outbox] = await Promise.all([loadTaskViews(store), store.listOutbox()]);
    setState((s) => ({ ...s, tasks, pending: pendingCount(outbox), conflicts: conflictCount(outbox) }));
  }, [store]);

  const syncNow = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setState((s) => ({ ...s, syncing: true }));
    try {
      await runSync(store, api, deviceId);
      setState((s) => ({ ...s, online: true, error: null, lastSyncAt: new Date().toISOString() }));
    } catch (e) {
      if (e instanceof NetworkError) setState((s) => ({ ...s, online: false, error: { kind: 'offline' } }));
      else if (e instanceof AuthError) onAuthExpired();
      else setState((s) => ({ ...s, error: { kind: 'failed', cause: e } }));
    } finally {
      running.current = false;
      setState((s) => ({ ...s, syncing: false }));
      await reload();
    }
  }, [store, api, deviceId, onAuthExpired, reload]);

  useEffect(() => {
    void reload();
    void syncNow();
  }, [reload, syncNow]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((net) => {
      const reachable = Boolean(net.isConnected) && net.isInternetReachable !== false;
      setState((s) => ({ ...s, online: reachable ? s.online : false }));
      if (reachable) void syncNow(); // connectivity returned → flush the queue
    });
    const appState = AppState.addEventListener('change', (s) => s === 'active' && void syncNow());
    const timer = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    return () => {
      unsubscribe();
      appState.remove();
      clearInterval(timer);
    };
  }, [syncNow]);

  return { ...state, reload, syncNow };
}
