import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrandLockup, ByCreative, Monogram } from '@/components/Brand';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { ServerAddress } from '@/components/ServerAddress';
import { Button, Field, Input, Ltr } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/i18n';

export function Login() {
  const { login, status } = useAuth();
  const { t, error: errorText } = useI18n();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState(import.meta.env.DEV ? 'admin@victorflow.local' : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authed') nav(from, { replace: true });
  }, [status, from, nav]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      // a 401 here means "wrong e-mail or password", not "session expired"
      setError(err instanceof ApiError && err.status === 401 ? t('error.invalidCredentials') : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Brand panel: the black of the logo, its mark large and cropped, the red slash as the only colour. */}
      <aside className="relative hidden overflow-hidden bg-side text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Monogram className="pointer-events-none absolute -bottom-24 w-[46rem] text-white/[0.06] ltr:-right-40 rtl:-left-40" />
        <div aria-hidden className="pointer-events-none absolute -top-10 h-[130%] w-16 rotate-0 bg-brand/90 ltr:right-24 rtl:left-24" style={{ transform: 'skewX(-30deg)' }} />
        <BrandLockup />
        <div className="relative max-w-md">
          <h2 className="text-4xl font-bold leading-[1.15] tracking-tight">{t('login.headline')}</h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">{t('login.tagline')}</p>
        </div>
        <ByCreative className="relative text-xs text-white/70" />
      </aside>

      <div className="relative grid place-items-center p-6">
        <LanguageSwitch className="absolute end-5 top-5" />
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" aria-label={t('login.formLabel')}>
          <div className="lg:hidden">
            <BrandLockup />
          </div>
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight">
              <span aria-hidden className="slash text-2xl" />
              {t('login.title')}
            </h1>
            <p className="mt-1.5 text-sm text-muted">{t('login.subtitle')}</p>
          </div>
          <Field label={t('common.email')}>{(id) => <Input id={id} dir="ltr" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label={t('common.password')}>{(id) => <Input id={id} dir="ltr" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={!!email} />}</Field>
          {error && (
            <p role="alert" className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" className="h-10 w-full text-sm" loading={busy}>
            {t('common.signIn')}
          </Button>
          <ServerAddress />
          {import.meta.env.DEV && (
            <p className="text-center text-xs text-muted">
              {t('login.devSeed')} <Ltr>admin@victorflow.local / Admin123!</Ltr>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
