import { useQueryClient } from '@tanstack/react-query';
import type { LoginResponse, OnboardingStatusDto } from '@victorflow/types';
import { Check } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ActivationPanel, type ActivationTransport } from '@/components/ActivationPanel';
import { BrandLockup } from '@/components/Brand';
import { CompanyFields } from '@/components/CompanyFields';
import { cx } from '@/components/cx';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { ServerAddress } from '@/components/ServerAddress';
import { Button, Card, Field, Input, Ltr } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toCompanyPayload, type CompanyFormValues } from '@/lib/company';
import { ONBOARDING_ORDER, stepState } from '@/lib/licence';

/** The public onboarding routes: nobody can sign in yet. Every answer is the new onboarding status. */
const onboardingTransport = (save: (s: OnboardingStatusDto) => void): ActivationTransport => ({
  request: (code) => api.anon('/onboarding/request', { code }),
  install: async (licence) => save(await api.anon<OnboardingStatusDto>('/onboarding/licence', { licence })),
  online: async (code) => save(await api.anon<OnboardingStatusDto>('/onboarding/online', { code })),
});

/**
 * First run of a shop's server: licence → company → owner. Shown instead of the sign-in screen until it is done;
 * `onDone` is called once the owner is signed in.
 */
export function Onboarding({ status, onDone }: { status: OnboardingStatusDto; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const save = (s: OnboardingStatusDto) => qc.setQueryData(['onboarding'], s);

  return (
    <div className="min-h-full bg-bg">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <BrandLockup />
          <LanguageSwitch />
        </div>
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight">
            <span aria-hidden className="slash text-2xl" />
            {t('onboarding.title')}
          </h1>
          <p className="mt-1.5 text-sm text-muted">{t('onboarding.subtitle')}</p>
        </div>

        <ol aria-label={t('onboarding.steps')} className="grid grid-cols-3 gap-2">
          {ONBOARDING_ORDER.map((step, i) => {
            const state = stepState(status.step, step);
            return (
              <li key={step} aria-current={state === 'current' ? 'step' : undefined} className={cx('flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm font-semibold', state === 'current' ? 'border-ink bg-surface' : 'border-line text-muted')}>
                <span aria-hidden className={cx('grid size-6 shrink-0 place-items-center rounded-full text-xs', state === 'done' ? 'bg-ok text-white' : state === 'current' ? 'bg-brand text-white' : 'bg-ink/8')}>
                  {state === 'done' ? <Check className="size-3.5" /> : i + 1}
                </span>
                {t(`onboarding.step.${step}`)}
              </li>
            );
          })}
        </ol>

        <Card className="p-6">
          {status.step === 'licence' && <LicenceStep status={status} onSaved={save} />}
          {status.step === 'company' && <CompanyStep status={status} onSaved={save} />}
          {status.step === 'owner' && <OwnerStep status={status} onSaved={save} onDone={onDone} />}
        </Card>

        <div className="max-w-sm">
          <ServerAddress />
        </div>
      </div>
    </div>
  );
}

function StepTitle({ title, intro }: { title: string; intro: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{intro}</p>
    </div>
  );
}

function LicenceStep({ status, onSaved }: { status: OnboardingStatusDto; onSaved: (s: OnboardingStatusDto) => void }) {
  const { t } = useI18n();
  return (
    <div>
      <StepTitle title={t('onboarding.licenceTitle')} intro={t('onboarding.licenceIntro')} />
      <ActivationPanel transport={onboardingTransport(onSaved)} online={!!status.online} onInstalled={() => undefined} />
      <p className="mt-5 text-xs text-muted">
        {t('onboarding.serverId')}: <Ltr className="break-all font-mono">{status.hardwareId}</Ltr>
      </p>
    </div>
  );
}

/** Who the licence was issued to, so the shop sees at once that the right licence was installed. */
function LicenceLine({ status, onSaved }: { status: OnboardingStatusDto; onSaved: (s: OnboardingStatusDto) => void }) {
  const { t, fmt } = useI18n();
  const [replace, setReplace] = useState(false);
  const l = status.licence;
  if (!l) return null;
  return (
    <div className="mb-6 rounded-md border border-ok/30 bg-ok/8 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{t('onboarding.licensedTo', { shop: l.shop })}</div>
          <div className="text-xs text-muted">{t('onboarding.licenceSummary', { desktop: fmt.number(l.seats.desktop), mobile: fmt.number(l.seats.mobile), date: fmt.day(l.updatesUntil) })}</div>
        </div>
        {!replace && <Button size="sm" variant="ghost" onClick={() => setReplace(true)}>{t('onboarding.changeLicence')}</Button>}
      </div>
      {replace && (
        <div className="mt-4 border-t border-line pt-4">
          <ActivationPanel transport={onboardingTransport(onSaved)} online={!!status.online} initialCode={l.activationCode} onInstalled={() => setReplace(false)} />
        </div>
      )}
    </div>
  );
}

const EMPTY_COMPANY: CompanyFormValues = { name: '', address: '', phone: '', email: '', nif: '', nis: '', rc: '', ai: '' };

function CompanyStep({ status, onSaved }: { status: OnboardingStatusDto; onSaved: (s: OnboardingStatusDto) => void }) {
  const { t, error: errorText } = useI18n();
  const [v, setV] = useState<CompanyFormValues>(() => ({ ...EMPTY_COMPANY, name: status.licence?.shop ?? '' }));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fieldError = (name: string) => (error instanceof ApiError ? error.issues.find((i) => i.path === name)?.message : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.anonPut<OnboardingStatusDto>('/onboarding/company', toCompanyPayload(v)));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <LicenceLine status={status} onSaved={onSaved} />
      <StepTitle title={t('onboarding.companyTitle')} intro={t('onboarding.companyIntro')} />
      <form onSubmit={submit} className="space-y-6" aria-label={t('onboarding.companyTitle')}>
        <CompanyFields v={v} set={(k, val) => setV((s) => ({ ...s, [k]: val }))} fieldError={fieldError} />
        {error != null && <p role="alert" className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad">{errorText(error)}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy}>{t('onboarding.continue')}</Button>
        </div>
      </form>
    </div>
  );
}

function OwnerStep({ status, onSaved, onDone }: { status: OnboardingStatusDto; onSaved: (s: OnboardingStatusDto) => void; onDone: () => void }) {
  const { t, error: errorText } = useI18n();
  const { adoptSession } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm !== '' && confirm !== password;
  const fieldError = (name: string) => (error instanceof ApiError ? error.issues.find((i) => i.path === name)?.message : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.anon<LoginResponse>('/onboarding/owner', { fullName: fullName.trim(), email: email.trim(), password });
      // signing in clears the query cache, so the end of the onboarding is told directly, not through the cache
      adoptSession(session);
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div>
      <LicenceLine status={status} onSaved={onSaved} />
      <StepTitle title={t('onboarding.ownerTitle')} intro={t('onboarding.ownerIntro')} />
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" aria-label={t('onboarding.ownerTitle')}>
        <div className="sm:col-span-2">
          <Field label={t('onboarding.fullName')} required error={fieldError('fullName')}>{(id) => <Input id={id} required minLength={2} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />}</Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t('common.email')} required error={fieldError('email')}>{(id) => <Input id={id} required dir="ltr" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        </div>
        <Field label={t('onboarding.password')} required hint={t('onboarding.passwordHint')} error={fieldError('password')}>{(id) => <Input id={id} required minLength={8} dir="ltr" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Field label={t('onboarding.confirm')} required error={mismatch ? t('onboarding.mismatch') : null}>{(id) => <Input id={id} required dir="ltr" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
        {error != null && <p role="alert" className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad sm:col-span-2">{errorText(error)}</p>}
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" variant="primary" loading={busy} disabled={mismatch}>{t('onboarding.finish')}</Button>
        </div>
      </form>
    </div>
  );
}
