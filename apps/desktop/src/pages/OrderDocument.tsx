import type { OrderDetailDto } from '@victorflow/types';
import { ByCreative, Monogram } from '@/components/Brand';
import { Ltr } from '@/components/ui';
import { useI18n } from '@/i18n';

/**
 * The printable order sheet: never visible on screen, it is what "Export PDF" prints (the interactive page is
 * `print:hidden`). No responsive `sm:`/`lg:` variants in here — an A4 page is narrower than the `lg` breakpoint.
 */
export function OrderDocument({ order: o }: { order: OrderDetailDto }) {
  const { t, fmt, status } = useI18n();
  const th = 'px-2 py-2 text-start text-[0.7rem] font-semibold uppercase tracking-wide text-muted';
  const thNum = `${th} text-end`;
  const td = 'px-2 py-2 align-top';
  const tdNum = `${td} tabular whitespace-nowrap text-end`;

  return (
    <section className="hidden text-ink print:block">
      <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-4">
        <div className="flex items-center gap-3">
          <Monogram className="w-10" />
          <div className="leading-tight">
            <div className="text-lg font-bold tracking-tight">VictorFlow</div>
            <ByCreative className="mt-1 text-[0.55rem]" />
          </div>
        </div>
        <div className="text-end leading-tight">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted">{t('order.documentTitle')}</div>
          <div className="mt-1 text-2xl font-bold"><Ltr>{o.number}</Ltr></div>
          <div className="mt-1 text-xs text-muted">{status(o.status)}</div>
        </div>
      </header>

      <dl className="mt-5 grid grid-cols-3 gap-4 text-sm">
        <div><dt className="text-xs text-muted">{t('orders.customer')}</dt><dd className="font-semibold">{o.customerName}</dd></div>
        <div><dt className="text-xs text-muted">{t('orders.date')}</dt><dd>{fmt.day(o.orderDate)}</dd></div>
        <div><dt className="text-xs text-muted">{t('orders.due')}</dt><dd>{o.dueDate ? fmt.day(o.dueDate) : '—'}</dd></div>
      </dl>

      <table className="mt-6 w-full border-collapse text-xs">
        <thead>
          <tr className="border-y border-line-strong bg-surface2">
            <th className={th}>#</th><th className={th}>{t('lines.description')}</th><th className={thNum}>{t('lines.qty')}</th><th className={thNum}>{t('lines.unitPrice')}</th>
            <th className={thNum}>{t('lines.discount')}</th><th className={thNum}>{t('lines.tva')}</th><th className={thNum}>{t('lines.lineHt')}</th><th className={thNum}>{t('lines.lineTtc')}</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.id} className="break-inside-avoid border-b border-line">
              <td className={`${td} text-muted`}>{i.position}</td>
              <td className={`${td} font-semibold`}>{i.description}</td>
              <td className={tdNum}><Ltr>{fmt.qty(i.quantity)} {i.unit}</Ltr></td>
              <td className={tdNum}>{fmt.dzd(i.unitPrice)}</td>
              <td className={tdNum}>{Number(i.discountPct) ? <Ltr>{fmt.qty(i.discountPct)} %</Ltr> : '—'}</td>
              <td className={tdNum}><Ltr>{fmt.qty(i.tvaRate)} %</Ltr></td>
              <td className={tdNum}>{fmt.dzd(i.lineHt)}</td>
              <td className={`${tdNum} font-semibold`}>{fmt.dzd(i.lineTtc)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="tabular ms-auto mt-4 w-72 max-w-full break-inside-avoid space-y-1.5 text-sm" aria-label={t('lines.totals')}>
        <div className="flex justify-between gap-4"><dt className="text-muted">{t('lines.totalHt')}</dt><dd>{fmt.dzd(o.totalHt)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">{t('lines.tva')}</dt><dd>{fmt.dzd(o.totalTva)}</dd></div>
        <div className="flex justify-between gap-4 border-t-2 border-ink pt-2 text-base font-bold"><dt>{t('lines.totalTtc')}</dt><dd>{fmt.dzd(o.totalTtc)}</dd></div>
      </dl>

      {o.notes && <p className="mt-6 break-inside-avoid border-t border-line pt-3 text-sm"><span className="font-semibold">{t('common.notes')}: </span><span className="text-muted">{o.notes}</span></p>}
    </section>
  );
}
