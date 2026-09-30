import type { OrderDetailDto } from '@victorflow/types';
import { ByCreative, Monogram } from '@/components/Brand';
import { Ltr } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useCompany } from '@/lib/company';

/**
 * The printable order sheet: never visible on screen, it is what "Export PDF" prints (the interactive page is
 * `print:hidden`). No responsive `sm:`/`lg:` variants in here — an A4 page is narrower than the `lg` breakpoint.
 * The header is the company's own (Company page); until one is saved, or when it has no logo, VictorFlow's stands in.
 */
export function OrderDocument({ order: o }: { order: OrderDetailDto }) {
  const { t, fmt, status } = useI18n();
  const profile = useCompany().data;
  const company = profile?.configured ? profile : null;
  const contact = [company?.phone, company?.email].filter((v): v is string => !!v);
  const fiscal = company
    ? ([['customerForm.nif', company.nif], ['customerForm.nis', company.nis], ['customerForm.rc', company.rc], ['customerForm.ai', company.ai]] as const).filter(([, value]) => value)
    : [];
  const th = 'px-2 py-2 text-start text-[0.7rem] font-semibold uppercase tracking-wide text-muted';
  const thNum = `${th} text-end`;
  const td = 'px-2 py-2 align-top';
  const tdNum = `${td} tabular whitespace-nowrap text-end`;

  return (
    <section className="hidden text-ink print:block">
      <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-4">
        <div className="flex min-w-0 items-start gap-3">
          {company?.logoDataUrl ? <img src={company.logoDataUrl} alt="" className="max-h-16 max-w-36 shrink-0 object-contain" /> : <Monogram className="w-10" />}
          <div className="min-w-0 leading-snug">
            {company ? (
              <>
                <div className="text-lg font-bold leading-tight tracking-tight">{company.name}</div>
                <div className="mt-0.5 space-y-px text-[0.7rem] text-muted">
                  {/* <bdi>: a Latin address inside an Arabic page keeps reading left-to-right ("12 rue …", not "rue … 12") */}
                  {company.address && <div><bdi className="whitespace-pre-line">{company.address}</bdi></div>}
                  {contact.length > 0 && <div className="flex flex-wrap gap-x-3">{contact.map((v) => <Ltr key={v}>{v}</Ltr>)}</div>}
                  {fiscal.length > 0 && <div className="flex flex-wrap gap-x-3">{fiscal.map(([key, value]) => <span key={key} className="whitespace-nowrap">{t(key)} <Ltr>{value}</Ltr></span>)}</div>}
                </div>
              </>
            ) : (
              <>
                <div className="text-lg font-bold leading-tight tracking-tight">VictorFlow</div>
                <ByCreative className="mt-1 text-[0.55rem]" />
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-end leading-tight">
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
