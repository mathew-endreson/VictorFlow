import { useEffect, useState, type ReactNode } from 'react';
import { setApiBase } from '../lib/api';
import { Loading } from './ui';
import { Monogram } from './Brand';

/** One line of the launcher's newline-delimited JSON status stream — see src-tauri/sidecar/launcher.mjs. */
interface BackendStatus {
  status: 'setting-up' | 'starting-db' | 'db-ready' | 'migrating' | 'migrated' | 'seeding' | 'seeded' | 'starting-api' | 'ready' | 'error';
  apiBase?: string;
  code?: string;
  message?: string;
  detail?: string;
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Gates the app behind the embedded backend's own boot sequence when running inside the packaged shell —
 * see the sidecar design: a splash while Postgres/migrations/the API come up, a plain-language error
 * screen (never a stack trace) if any step fails, never an infinite spinner.
 *
 * Outside Tauri (plain browser dev server, the desktop test suite) there is no sidecar to wait for, so
 * this renders its children immediately — `pnpm dev`'s "same UI in your browser" workflow is unaffected.
 *
 * TODO (Tier 0 polish, not this checkpoint): these strings are plain English, not wired into
 * packages/i18n — every other user-facing string in this app goes through t()/error(), but adding new
 * catalog keys here means touching the EN+AR catalogs (and their completeness tests) in the same change
 * that's proving the backend boot sequence works; deliberately deferred rather than rushed.
 */
export function BackendGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [ready, setReady] = useState(() => !isTauri());

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    function apply(line: string) {
      let parsed: BackendStatus;
      try {
        parsed = JSON.parse(line);
      } catch {
        return; // not a status line — ignore rather than crash the gate over unrelated stdout noise
      }
      if (cancelled) return;
      setStatus(parsed);
      if (parsed.status === 'ready') {
        // Never override a server address the user explicitly chose (e.g. this machine is a pure LAN
        // client of another machine's server) — only default to the local embedded backend when no
        // explicit choice has been made.
        let hasExplicitOverride = false;
        try {
          hasExplicitOverride = globalThis.localStorage?.getItem('vf.apiBase') != null;
        } catch {
          /* storage blocked — treat as no override */
        }
        if (!hasExplicitOverride && parsed.apiBase) setApiBase(parsed.apiBase);
        setReady(true);
      }
    }

    (async () => {
      const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
      // Pull the current status on mount first, in case "ready" (or an error) already happened before
      // this component subscribed — the event stream alone could otherwise be missed by a slow mount.
      const initial = await invoke<string | null>('get_backend_status');
      if (initial) apply(initial);
      unlisten = await listen<string>('backend-status', (event) => apply(event.payload));
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (ready) return <>{children}</>;
  if (status?.status === 'error') return <BackendError status={status} />;
  return <BackendSplash status={status} />;
}

function BackendSplash({ status }: { status: BackendStatus | null }) {
  const label = status?.status === 'setting-up' ? 'Setting up VictorFlow for the first time — this can take up to a minute…' : undefined;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-ink">
      <Monogram className="h-12 text-ink" title="VictorFlow" />
      <Loading label={label} />
    </div>
  );
}

function BackendError({ status }: { status: BackendStatus }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-ink">
      <Monogram className="h-10 text-ink" title="VictorFlow" />
      <h1 className="text-lg font-semibold">Something went wrong starting VictorFlow</h1>
      <p className="max-w-md text-sm text-muted">{status.message ?? 'The backend could not start.'}</p>
      {status.code && <p className="font-mono text-xs text-muted">{status.code}</p>}
      {status.detail && (
        <pre className="max-h-40 w-full max-w-md overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface-2 p-2 text-left font-mono text-[11px] text-muted">
          {status.detail}
        </pre>
      )}
      <button className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-ink" onClick={() => globalThis.location.reload()}>
        Try again
      </button>
    </div>
  );
}
