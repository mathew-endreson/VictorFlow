import { useMutation, useQueryClient } from '@tanstack/react-query';
import { COMPANY_LOGO_MIME_TYPES, type CompanyProfileDto } from '@victorflow/types';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Monogram } from '@/components/Brand';
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Textarea, useToast } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { fromCompany, LOGO_MAX_LABEL, logoProblem, toCompanyPayload, useCompany } from '@/lib/company';

type LogoChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'new'; file: File; previewUrl: string };

export function Company() {
  const { t } = useI18n();
  const company = useCompany();
  return (
    <div>
      <PageHeader title={t('company.title')} subtitle={t('company.subtitle')} />
      {company.isPending ? <Loading /> : company.isError ? <ErrorBox error={company.error} onRetry={() => company.refetch()} /> : <CompanyForm profile={company.data} />}
    </div>
  );
}

function CompanyForm({ profile }: { profile: CompanyProfileDto }) {
  const { t, error: errorText } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState(() => fromCompany(profile));
  const [logo, setLogo] = useState<LogoChange>({ kind: 'keep' });
  const [logoError, setLogoError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const fieldError = (name: string) => (error instanceof ApiError ? error.issues.find((i) => i.path === name)?.message : undefined);

  useEffect(() => () => { if (logo.kind === 'new') URL.revokeObjectURL(logo.previewUrl); }, [logo]);

  const save = useMutation({
    // The details first (a logo can only be attached to a saved profile), then whatever happened to the logo.
    mutationFn: async () => {
      const saved = await api.put<CompanyProfileDto>('/company', toCompanyPayload(v));
      if (logo.kind === 'new') {
        const form = new FormData();
        form.append('logo', logo.file);
        await api.put<CompanyProfileDto>('/company/logo', form);
      } else if (logo.kind === 'remove') {
        await api.del<CompanyProfileDto>('/company/logo');
      }
      return saved;
    },
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: ['company'] });
      setV(fromCompany(saved)); // show what the server actually kept (trimmed, e-mail lower-cased)
      setLogo({ kind: 'keep' });
      setError(null);
      toast.ok(t('company.saved'));
    },
    onError: setError,
  });

  const shownLogo = logo.kind === 'new' ? logo.previewUrl : logo.kind === 'remove' ? null : profile.logoDataUrl;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again still fires onChange
    if (!file) return;
    const problem = logoProblem(file);
    if (problem) {
      setLogoError(problem === 'type' ? t('company.logoBadType') : t('company.logoTooBig', { max: LOGO_MAX_LABEL }));
      return;
    }
    setLogoError(null);
    setLogo({ kind: 'new', file, previewUrl: URL.createObjectURL(file) });
  }

  return (
    <Card className="p-6">
      <form
        aria-label={t('company.label')}
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={t('company.name')} required error={fieldError('name')}>{(id) => <Input id={id} required value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus />}</Field>
          </div>
          <Field label={t('customers.phone')} error={fieldError('phone')}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
          <Field label={t('common.email')} error={fieldError('email')}>{(id) => <Input id={id} dir="ltr" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />}</Field>
          <div className="sm:col-span-2">
            <Field label={t('customerForm.address')} error={fieldError('address')}>{(id) => <Textarea id={id} rows={3} value={v.address} onChange={(e) => set('address', e.target.value)} />}</Field>
          </div>
          <Field label={t('customerForm.nif')} error={fieldError('nif')}>{(id) => <Input id={id} dir="ltr" value={v.nif} onChange={(e) => set('nif', e.target.value)} />}</Field>
          <Field label={t('customerForm.nis')} error={fieldError('nis')}>{(id) => <Input id={id} dir="ltr" value={v.nis} onChange={(e) => set('nis', e.target.value)} />}</Field>
          <Field label={t('customerForm.rc')} error={fieldError('rc')}>{(id) => <Input id={id} dir="ltr" value={v.rc} onChange={(e) => set('rc', e.target.value)} />}</Field>
          <Field label={t('customerForm.ai')} error={fieldError('ai')}>{(id) => <Input id={id} dir="ltr" value={v.ai} onChange={(e) => set('ai', e.target.value)} />}</Field>
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold">{t('company.logo')}</div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-20 w-40 place-items-center rounded-md border border-line bg-white p-2 text-[#1f1e1f]">
              {shownLogo ? <img src={shownLogo} alt={t('company.logoAlt')} className="max-h-full max-w-full object-contain" /> : <Monogram className="w-10" />}
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-xs text-muted">{shownLogo ? t('company.logoHint', { max: LOGO_MAX_LABEL }) : t('company.logoFallback', { max: LOGO_MAX_LABEL })}</p>
              <div className="flex flex-wrap gap-2">
                <input ref={fileInput} type="file" hidden accept={COMPANY_LOGO_MIME_TYPES.join(',')} onChange={onPick} aria-label={t('company.logoChoose')} />
                <Button onClick={() => fileInput.current?.click()}><ImagePlus aria-hidden className="size-4" />{shownLogo ? t('company.logoChange') : t('company.logoChoose')}</Button>
                {shownLogo && <Button variant="ghost" onClick={() => setLogo(profile.logoDataUrl ? { kind: 'remove' } : { kind: 'keep' })}><Trash2 aria-hidden className="size-4" />{t('company.logoRemove')}</Button>}
              </div>
              {logoError && <p role="alert" className="text-xs text-bad">{logoError}</p>}
            </div>
          </div>
        </div>

        {error != null && <p role="alert" className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad">{errorText(error)}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>{t('common.save')}</Button>
        </div>
      </form>
    </Card>
  );
}
