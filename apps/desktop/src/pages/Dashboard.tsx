import { useQuery } from '@tanstack/react-query';
import type { DashboardSummaryDto } from '@victorflow/types';
import { ArrowRight, ClipboardList, Receipt, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, ErrorBox, FLIP, Loading, PageHeader, cx } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';

const STAGE_ORDER = ['DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'QUALITY_CHECK', 'COMPLETED', 'REJECTED'];
const STAGE_COLOR: Record<string, string> = {
  DRAFT: 'bg-muted/60', CONFIRMED: 'bg-info', IN_PRODUCTION: 'bg-warn', QUALITY_CHECK: 'bg-violet-500', COMPLETED: 'bg-ok', REJECTED: 'bg-bad',
};

function Stat({ label, value, sub, to, tone, icon: Icon }: { label: string; value: string; sub?: string; to?: string; tone?: 'warn'; icon: LucideIcon }) {
  const body = (
    <Card className={cx('relative h-full overflow-hidden p-5 transition', to && 'hover:-translate-y-px hover:border-ink/30 hover:shadow-pop')}>
      <span aria-hidden className="absolute inset-y-0 start-0 w-1 bg-brand/0 transition group-hover:bg-brand" />
      <div className="flex items-start justify-between gap-3">
        <div className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted">{label}</div>
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md bg-ink/5 text-ink/70">
          <Icon className="size-4" strokeWidth={1.9} />
        </span>
      </div>
      <div className={cx('tabular mt-3 text-[1.75rem] font-bold leading-none tracking-tight', tone === 'warn' && 'text-warn')}>{value}</div>
      {sub && <div className="mt-2.5 text-xs text-muted">{sub}</div>}
    </Card>
  );
  return to ? <Link to={to} className="group block rounded-lg">{body}</Link> : body;
}

export function Dashboard() {
  const { t, fmt, status } = useI18n();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardSummaryDto>('/dashboard/summary'), refetchInterval: 30_000 });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;

  const stages = STAGE_ORDER.filter((s) => (d.production.byStatus[s] ?? 0) > 0 || s !== 'REJECTED');
  const maxStage = Math.max(1, ...stages.map((s) => d.production.byStatus[s] ?? 0));
  const orderRows = Object.entries(d.orders.byStatus);

  return (
    <div>
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle', { month: fmt.month(d.revenue.month), time: fmt.time(d.generatedAt) })} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={TrendingUp} label={t('dashboard.revenue')} value={fmt.dzd(d.revenue.ttc)} sub={t('dashboard.revenueSub', { count: d.revenue.invoiceCount, ht: fmt.dzd(d.revenue.ht) })} to="/invoices" />
        <Stat icon={Wallet} label={t('dashboard.collected')} value={fmt.dzd(d.revenue.collected)} sub={t('dashboard.collectedSub', { tva: fmt.dzd(d.revenue.tva) })} />
        <Stat
          icon={Receipt}
          label={t('dashboard.unpaid')}
          value={fmt.number(d.invoices.unpaidCount)}
          sub={d.invoices.overdueCount ? t('dashboard.unpaidSubOverdue', { amount: fmt.dzd(d.invoices.balanceDue), count: d.invoices.overdueCount }) : t('dashboard.unpaidSub', { amount: fmt.dzd(d.invoices.balanceDue) })}
          tone={d.invoices.overdueCount ? 'warn' : undefined}
          to="/invoices"
        />
        <Stat icon={ClipboardList} label={t('dashboard.openOrders')} value={fmt.number(d.orders.open)} sub={t('dashboard.activeCustomers', { count: d.customers.active })} to="/orders" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <h2 className="mb-5 flex items-center gap-2.5 text-sm font-bold">
            <span aria-hidden className="slash text-sm" />
            {t('dashboard.pipeline')}
          </h2>
          <ul className="space-y-3.5">
            {stages.map((s) => {
              const n = d.production.byStatus[s] ?? 0;
              return (
                <li key={s} className="flex items-center gap-4 text-sm">
                  <span className="w-36 shrink-0 text-ink/80">{status(s)}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
                    <div className={cx('h-full rounded-full transition-all', STAGE_COLOR[s] ?? 'bg-muted/60')} style={{ width: `${(n / maxStage) * 100}%` }} />
                  </div>
                  <span className="tabular w-8 text-end font-semibold">{n}</span>
                </li>
              );
            })}
          </ul>
          <Link to="/production" className="mt-5 inline-flex items-center gap-1.5 text-xs font-bold text-brandfg hover:underline">
            {t('dashboard.openBoard')}
            <ArrowRight aria-hidden className={cx('size-3.5', FLIP)} />
          </Link>
        </Card>

        <Card className="p-6">
          <h2 className="mb-5 flex items-center gap-2.5 text-sm font-bold">
            <span aria-hidden className="slash text-sm" />
            {t('dashboard.ordersByStatus')}
          </h2>
          <ul className="space-y-2.5 text-sm">
            {orderRows.length === 0 && <li className="text-muted">{t('dashboard.noOrders')}</li>}
            {orderRows.map(([s, n]) => (
              <li key={s} className="flex justify-between">
                <span className="text-ink/80">{status(s)}</span>
                <span className="tabular font-semibold">{n}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 border-t border-line pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-ink/80">{t('dashboard.lowStock')}</span>
              <span className={cx('tabular font-semibold', d.lowStockItems > 0 && 'text-warn')}>{d.lowStockItems}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
