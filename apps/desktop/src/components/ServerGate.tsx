import { WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { getApiBase, onConnectionChange, reportConnection } from '@/lib/api';
import { checkServer, displayHost, PROBLEM_KEY, RETRY_SECONDS, type ServerProblem } from '@/lib/connection';
import { useI18n } from '@/i18n';
import { Monogram } from './Brand';
import { LanguageSwitch } from './LanguageSwitch';
import { ServerAddress } from './ServerAddress';
import { Button, Loading, Ltr } from './ui';

type Phase = { state: 'checking' } | { state: 'ready' } | { state: 'failed'; problem: ServerProblem; base: string };

/**
 * The desktop app is a client of the shop's VictorFlow server (on the LAN). Before anything else it checks that the
 * configured server answers; if not, it says so plainly — which address, what went wrong, what to check — retries on
 * its own, and lets the address be corrected right there. Once running, a lost connection shows a banner instead of
 * unmounting the app, so nothing typed into an open form is lost.
 */
export function ServerGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ state: 'checking' });
  const [busy, setBusy] = useState(false);
  const [lost, setLost] = useState(false);
  const run = useRef(0);

  const check = useCallback(async () => {
    const id = ++run.current;
    const base = getApiBase();
    setBusy(true);
    const result = await checkServer(base);
    if (id !== run.current) return; // a newer check (e.g. after the address changed) has started
    setBusy(false);
    reportConnection(result.ok);
    if (result.ok) {
      setLost(false);
      setPhase({ state: 'ready' });
    } else {
      setPhase((p) => (p.state === 'ready' ? p : { state: 'failed', problem: result.problem, base }));
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // Not reachable yet: try again on a timer (the server PC may still be booting).
  useEffect(() => {
    if (phase.state !== 'failed') return;
    const timer = setInterval(() => void check(), RETRY_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [phase.state, check]);

  // Running: a request that cannot reach the server raises the banner; health checks clear it.
  useEffect(() => {
    if (phase.state !== 'ready') return;
    return onConnectionChange((online) => setLost(!online));
  }, [phase.state]);
  useEffect(() => {
    if (!lost) return;
    const timer = setInterval(() => void check(), RETRY_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [lost, check]);

  if (phase.state === 'checking') return <Splash />;
  if (phase.state === 'failed') return <Unreachable problem={phase.problem} base={phase.base} busy={busy} onRetry={check} />;
  return (
    <>
      {lost && <LostBanner busy={busy} onRetry={check} />}
      {children}
    </>
  );
}

function Splash() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-ink">
      <Monogram className="h-12 text-ink" title="VictorFlow" />
      <Loading label={t('server.checking')} />
    </div>
  );
}

function Unreachable({ problem, base, busy, onRetry }: { problem: ServerProblem; base: string; busy: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="relative grid min-h-screen place-items-center bg-bg px-6 py-10 text-ink">
      <LanguageSwitch className="absolute end-5 top-5" />
      <main role="alert" className="w-full max-w-md space-y-5 text-center">
        <Monogram className="mx-auto h-10 text-ink" title="VictorFlow" />
        <div className="space-y-2">
          <h1 className="flex items-center justify-center gap-2 text-xl font-semibold">
            <WifiOff aria-hidden className="size-5 text-bad" />
            {t('server.unreachable.title')}
          </h1>
          <p className="text-sm text-muted">
            {t('server.unreachable.tried')} <Ltr className="font-semibold text-ink">{displayHost(base)}</Ltr>
          </p>
        </div>
        <p className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-start text-sm text-bad">{t(PROBLEM_KEY[problem])}</p>
        <p className="text-start text-sm text-muted">{t('server.help')}</p>
        <div className="space-y-2">
          <Button variant="primary" className="h-10 w-full text-sm" loading={busy} onClick={onRetry}>
            {t('common.retry')}
          </Button>
          <p className="text-xs text-muted">{t('server.autoRetry', { seconds: RETRY_SECONDS })}</p>
        </div>
        <ServerAddress onSaved={onRetry} />
      </main>
    </div>
  );
}

function LostBanner({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warn/40 bg-warn/12 px-4 py-2 text-sm text-warn">
      <WifiOff aria-hidden className="size-4 shrink-0" />
      <span>
        {t('server.lost')} <Ltr className="font-semibold">{displayHost(getApiBase())}</Ltr>
      </span>
      <button type="button" className="font-semibold underline underline-offset-2 disabled:opacity-60" disabled={busy} onClick={onRetry}>
        {t('common.retry')}
      </button>
    </div>
  );
}
