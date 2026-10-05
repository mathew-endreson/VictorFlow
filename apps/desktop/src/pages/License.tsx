import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type LicenceRequestDto, type LicenseStatusDto } from '@victorflow/types';
import { TriangleAlert } from 'lucide-react';
import { ActivationPanel, type ActivationTransport } from '@/components/ActivationPanel';
import { Badge, Card, ErrorBox, Eyebrow, Loading, Ltr, PageHeader, useToast } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** A signed-in owner: the licence routes (they stay open in read-only mode — installing a licence is the way out). */
const ownerTransport: ActivationTransport = {
  request: (code) => api.post<LicenceRequestDto>('/license/request', { code }),
  install: (licence) => api.put('/license', { licence }),
  online: (code) => api.post('/license/online', { code }),
};

export function License() {
  const { t, fmt, label, lookup } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
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
            <h2 className="me-1 flex items-center gap-2.5 text-sm font-bold"><span aria-hidden className="slash text-sm" />{t('license.title')}</h2>
            <Badge tone={s.state === 'active' ? 'green' : 'red'}>{s.state === 'active' ? t('license.stateActive') : t('license.stateReadOnly')}</Badge>
            {!s.enforced && <Badge tone="neutral">{t('license.notEnforced')}</Badge>}
          </div>
          {s.problem && (
            <div role="alert" className="mb-5 rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad">
              <b>{t('license.problemTitle')}</b> — {lookup(`license.problem.${s.problem.code}`, s.problem.message)}
            </div>
          )}
          {e && (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
                {([
                  [t('license.shop'), e.shop],
                  [t('license.edition'), e.edition],
                  [t('license.id'), <Ltr key="id">{e.licenceId}</Ltr>],
                  [t('license.desktopSeats'), fmt.number(e.seats.desktop)],
                  [t('license.mobileUsers'), fmt.number(e.seats.mobile)],
                  [t('license.updatesUntil'), fmt.day(e.updatesUntil)],
                  [t('license.activationCode'), <Ltr key="code">{e.activationCode}</Ltr>],
                  [t('license.issued'), fmt.dateTime(e.issuedAt)],
                ] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 font-semibold">{v}</dd></div>
                ))}
              </dl>
              <Eyebrow className="mt-6">{t('license.modules')}</Eyebrow>
              <div className="flex flex-wrap gap-2">{e.modules.map((m) => <Badge key={m} tone="green">{label('feature', m)}</Badge>)}</div>
            </>
          )}
          <p className="mt-6 text-xs text-muted">{t('license.releaseDate', { date: fmt.day(s.releaseDate) })}</p>
        </Card>
        <Card className="p-6">
          <h2 className="mb-2 flex items-center gap-2.5 text-sm font-bold"><span aria-hidden className="slash text-sm" />{t('license.thisServer')}</h2>
          <p className="mb-3 text-xs leading-relaxed text-muted">{t('license.serverHelp')}</p>
          <code data-testid="hardware-id" dir="ltr" className="block break-all rounded-md bg-surface2 p-3 text-xs">{s.hardwareId}</code>
        </Card>
      </div>

      {s.mode === 'crypto' && can(PERMISSIONS.CORE_LICENSE_MANAGE) && (
        <Card className="mt-4 p-6">
          <h2 className="mb-1 flex items-center gap-2.5 text-sm font-bold"><span aria-hidden className="slash text-sm" />{t('license.install')}</h2>
          <p className="mb-5 text-xs text-muted">{t('license.installHelp')}</p>
          <ActivationPanel
            transport={ownerTransport}
            online={s.online}
            initialCode={s.activationCode}
            onInstalled={() => {
              void qc.invalidateQueries({ queryKey: ['license'] });
              void qc.invalidateQueries({ queryKey: ['licence-summary'] });
              toast.ok(t('license.installed'));
            }}
          />
        </Card>
      )}
    </div>
  );
}
