import { useQuery } from '@tanstack/react-query';
import type { LicenseStatusDto } from '@victorflow/types';
import { TriangleAlert } from 'lucide-react';
import { Badge, Card, ErrorBox, Eyebrow, Loading, Ltr, PageHeader } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';

export function License() {
  const { t, fmt, label } = useI18n();
  const q = useQuery({ queryKey: ['license'], queryFn: () => api.get<LicenseStatusDto>('/license') });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const e = s.entitlement;

  // the dev-mode note names a setting: split around the placeholder so the setting is set in a code face
  const [before, after = ''] = t('license.devBody', { code: '\u0000' }).split('\u0000');

  return (
    <div>
      <PageHeader title={t('license.title')} subtitle={t('license.subtitle')} />
      {s.mode === 'dev' && (
        <div role="note" className="mb-4 flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
          <p><b>{t('license.devTitle')}</b> {before}<code dir="ltr" className="rounded bg-ink/8 px-1.5 py-0.5 text-xs">LICENSE_MODE=crypto</code>{after}</p>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <h2 className="me-1 flex items-center gap-2.5 text-sm font-bold"><span aria-hidden className="slash text-sm" />{t('license.entitlement')}</h2>
            <Badge tone={s.valid ? 'green' : 'red'}>{s.valid ? t('license.valid') : t('license.invalid')}</Badge>
            <Badge tone={s.enforced ? 'amber' : 'neutral'}>{s.enforced ? t('license.enforced') : t('license.notEnforced')}</Badge>
            <Badge tone="blue">{s.mode === 'dev' ? t('license.devStub') : t('license.signed')}</Badge>
          </div>
          {e ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              {([
                [t('license.customer'), e.customer],
                [t('license.tier'), label('tier', e.tier)],
                [t('license.id'), <Ltr key="id">{e.licenseId}</Ltr>],
                [t('license.maxUsers'), fmt.number(e.maxUsers)],
                [t('license.bound'), e.hardwareBound ? t('license.yes') : t('license.no')],
                [t('license.issued'), fmt.dateTime(e.issuedAt)],
                [t('license.expires'), e.expiresAt ? fmt.dateTime(e.expiresAt) : t('license.never')],
              ] as const).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 font-semibold">{v}</dd></div>
              ))}
            </dl>
          ) : (
            <div role="alert" className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad">
              <b>{s.problem?.code}</b> — {s.problem?.message}
            </div>
          )}
          {e && (
            <>
              <Eyebrow className="mt-6">{t('license.modules')}</Eyebrow>
              <div className="flex flex-wrap gap-2">{e.features.map((f) => <Badge key={f} tone="green">{label('feature', f)}</Badge>)}</div>
            </>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="mb-2 flex items-center gap-2.5 text-sm font-bold"><span aria-hidden className="slash text-sm" />{t('license.thisMachine')}</h2>
          <p className="mb-3 text-xs leading-relaxed text-muted">{t('license.machineHelp')}</p>
          <code data-testid="hardware-id" dir="ltr" className="block break-all rounded-md bg-surface2 p-3 text-xs">{s.hardwareId}</code>
        </Card>
      </div>
    </div>
  );
}
