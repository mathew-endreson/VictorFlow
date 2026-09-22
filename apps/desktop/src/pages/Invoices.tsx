import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INVOICE_STATUSES, PAYMENT_METHODS, PERMISSIONS, type InvoiceDetailDto, type InvoiceSummaryDto, type OrderSummaryDto, type Page } from '@victorflow/types';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, Empty, ErrorBox, Eyebrow, Field, Input, Loading, Ltr, Modal, PageHeader, Pager, Select, StatusBadge, Table, Td, Textarea, Th, cx, useDebounced, useToast } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { today } from '@/lib/format';

const PAGE_SIZE = 20;

function useRefreshFinance() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['invoices', 'invoice', 'entries', 'trial-balance', 'orders', 'order', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
  };
}

function PaymentForm({ invoice, onDone }: { invoice: InvoiceDetailDto; onDone: () => void }) {
  const refresh = useRefreshFinance();
  const toast = useToast();
  const { t, fmt, label, lookup, error: errorText } = useI18n();
  const [amount, setAmount] = useState(String(Number(invoice.balanceDue)) === invoice.balanceDue ? invoice.balanceDue : fmt.qty(invoice.balanceDue));
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('CASH');
  const [paidAt, setPaidAt] = useState(today());
  const [reference, setReference] = useState('');
  const pay = useMutation({
    mutationFn: () => api.post<InvoiceDetailDto>(`/finance/invoices/${invoice.id}/payments`, { amount, method, paidAt, ...(reference.trim() ? { reference: reference.trim() } : {}) }),
    onSuccess: (inv) => { refresh(); toast.ok(inv.status === 'PAID' ? t('payment.nowPaid', { number: inv.number }) : t('payment.recorded', { due: fmt.dzd(inv.balanceDue) })); onDone(); },
  });
  const cashAccount = method === 'CASH' ? '530' : '512';
  const account = (code: string, name: string) => `${code} ${lookup(`account.${code}`, name)}`;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); pay.mutate(); }} aria-label={t('payment.formLabel')}>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('payment.amount', { due: fmt.dzd(invoice.balanceDue) })}>{(id) => <Input id={id} dir="ltr" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}</Field>
        <Field label={t('payment.method')}>
          {(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label('paymentMethod', m)}</option>)}</Select>}
        </Field>
        <Field label={t('payment.dateReceived')}>{(id) => <Input id={id} type="date" dir="ltr" required value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />}</Field>
        <Field label={t('payment.reference')}>{(id) => <Input id={id} placeholder={t('payment.referencePlaceholder')} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
      </div>
      <p className="text-xs text-muted">{t('payment.posts', { debit: account(cashAccount, method === 'CASH' ? 'Caisse' : 'Banque'), credit: account('411', 'Clients') })}</p>
      {pay.isError && <p role="alert" className="text-sm text-bad">{errorText(pay.error)}</p>}
      <div className="flex justify-end gap-2"><Button onClick={onDone}>{t('common.cancel')}</Button><Button type="submit" variant="primary" loading={pay.isPending}>{t('payment.record')}</Button></div>
    </form>
  );
}

function InvoiceModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const refresh = useRefreshFinance();
  const toast = useToast();
  const { t, fmt, label } = useI18n();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<InvoiceDetailDto>(`/finance/invoices/${id}`) });
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const cancel = useMutation({
    mutationFn: () => api.post<InvoiceDetailDto>(`/finance/invoices/${id}/cancel`, { reason, entryDate: today() }),
    onSuccess: (inv) => { refresh(); toast.ok(t('invoice.cancelled', { number: inv.number, entry: inv.cancelEntry?.entryNumber ?? '' })); setCancelling(false); },
    onError: toast.error,
  });

  const inv = q.data;
  return (
    <Modal title={inv ? t('invoice.title', { number: inv.number }) : t('invoice.titleShort')} wide onClose={onClose}>
      {q.isPending ? <Loading /> : q.isError ? <ErrorBox error={q.error} /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <StatusBadge status={inv!.status} />
            <Link to={`/customers/${inv!.customerId}`} className="font-semibold text-brandfg hover:underline">{inv!.customerName}</Link>
            <Link to={`/orders/${inv!.orderId}`} className="font-semibold text-brandfg hover:underline">{t('invoice.orderLink', { number: inv!.orderNumber })}</Link>
            <span className="text-muted">{t('invoice.issuedOn', { date: fmt.day(inv!.invoiceDate) })}{inv!.dueDate ? ` · ${t('invoice.dueOn', { date: fmt.day(inv!.dueDate) })}` : ''}</span>
          </div>

          <div className="overflow-hidden rounded-lg border border-line">
            <Table>
              <thead><tr><Th>{t('lines.description')}</Th><Th num>{t('lines.qty')}</Th><Th num>{t('lines.unitPrice')}</Th><Th num>{t('lines.tva')}</Th><Th num>{t('lines.lineHt')}</Th><Th num>{t('lines.lineTtc')}</Th></tr></thead>
              <tbody>
                {inv!.items.map((i) => <tr key={i.id}><Td>{i.description}</Td><Td num><Ltr>{fmt.qty(i.quantity)} {i.unit}</Ltr></Td><Td num>{fmt.dzd(i.unitPrice)}</Td><Td num><Ltr>{fmt.qty(i.tvaRate)} %</Ltr></Td><Td num>{fmt.dzd(i.lineHt)}</Td><Td num>{fmt.dzd(i.lineTtc)}</Td></tr>)}
              </tbody>
            </Table>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="text-sm">
              <Eyebrow>{t('invoice.ledger')}</Eyebrow>
              <ul className="space-y-1.5 text-muted">
                {inv!.journalEntry && <li>{t('invoice.entry')} <b className="tabular text-ink"><Ltr>{inv!.journalEntry.entryNumber}</Ltr></b> <span className="text-xs">({t('invoice.entryPattern')})</span></li>}
                {inv!.cancelEntry && <li>{t('invoice.reversal')} <b className="tabular text-ink"><Ltr>{inv!.cancelEntry.entryNumber}</Ltr></b></li>}
                {inv!.payments.map((p) => <li key={p.id}>{t('invoice.payment')} <b className="tabular text-ink">{fmt.dzd(p.amount)}</b> · {label('paymentMethod', p.method)} · {fmt.day(p.paidAt)}{p.reference ? ` · ${p.reference}` : ''}</li>)}
                {!inv!.payments.length && !inv!.cancelEntry && <li>{t('invoice.noPayments')}</li>}
              </ul>
            </div>
            <dl className="tabular space-y-1.5 text-sm" aria-label={t('invoice.totals')}>
              <div className="flex justify-between"><dt className="text-muted">{t('lines.totalHt')}</dt><dd>{fmt.dzd(inv!.totalHt)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">{t('lines.tva')}</dt><dd>{fmt.dzd(inv!.totalTva)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 font-bold"><dt>{t('lines.totalTtc')}</dt><dd>{fmt.dzd(inv!.totalTtc)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">{t('invoice.paid')}</dt><dd>{fmt.dzd(inv!.amountPaid)}</dd></div>
              <div className={cx('flex justify-between text-base font-bold', Number(inv!.balanceDue) > 0 && inv!.status !== 'CANCELLED' && 'text-warn')}><dt>{t('invoice.balanceDue')}</dt><dd data-testid="balance-due">{inv!.status === 'CANCELLED' ? fmt.dzd('0') : fmt.dzd(inv!.balanceDue)}</dd></div>
            </dl>
          </div>

          {!paying && !cancelling && (
            <div className="flex justify-end gap-2">
              {['ISSUED', 'PARTIALLY_PAID'].includes(inv!.status) && can(PERMISSIONS.FINANCE_PAYMENT_RECORD) && <Button variant="primary" onClick={() => setPaying(true)}>{t('payment.record')}</Button>}
              {inv!.status === 'ISSUED' && can(PERMISSIONS.FINANCE_INVOICE_CANCEL) && <Button variant="danger" onClick={() => setCancelling(true)}>{t('invoice.cancelInvoice')}</Button>}
            </div>
          )}
          {paying && <div className="rounded-lg border border-line bg-surface2 p-5"><PaymentForm invoice={inv!} onDone={() => setPaying(false)} /></div>}
          {cancelling && (
            <div className="space-y-3 rounded-lg border border-bad/30 bg-bad/5 p-5">
              <p className="text-sm">{t('invoice.cancelExplain')}</p>
              <Field label={t('invoice.reason')} required>{(fid) => <Textarea id={fid} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
              <div className="flex justify-end gap-2"><Button onClick={() => setCancelling(false)}>{t('invoice.keep')}</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate()}>{t('invoice.cancelInvoice')}</Button></div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function GenerateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const refresh = useRefreshFinance();
  const toast = useToast();
  const { t, fmt, lookup } = useI18n();
  const orders = useQuery({ queryKey: ['orders', 'uninvoiced'], queryFn: () => api.get<Page<OrderSummaryDto>>('/orders', { uninvoiced: true, pageSize: 100 }) });
  const [orderId, setOrderId] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<InvoiceDetailDto>(`/finance/invoices/from-order/${orderId}`, {}),
    onSuccess: (inv) => { refresh(); toast.ok(t('invoice.issued', { number: inv.number })); onCreated(inv.id); },
    onError: toast.error,
  });
  const chosen = orders.data?.items.find((o) => o.id === orderId);
  const posting = chosen && [
    { side: t('ledger.dr'), account: `411 ${lookup('account.411', 'Clients')}`, amount: chosen.totalTtc },
    { side: t('ledger.cr'), account: `701 ${lookup('account.701', 'Ventes')}`, amount: chosen.totalHt },
    { side: t('ledger.cr'), account: `44571 ${lookup('account.44571', 'TVA collectée 19 %')}`, amount: chosen.totalTva },
  ];
  return (
    <Modal title={t('invoice.generateTitle')} onClose={onClose} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!orderId} loading={create.isPending} onClick={() => create.mutate()}>{t('invoice.issue')}</Button></>}>
      {orders.isPending ? <Loading /> : orders.isError ? <ErrorBox error={orders.error} /> : orders.data.items.length === 0 ? <Empty>{t('invoice.noneWaiting')}</Empty> : (
        <div className="space-y-4">
          <Field label={t('invoice.order')}>
            {(id) => (
              <Select id={id} value={orderId} onChange={(e) => setOrderId(e.target.value)} autoFocus>
                <option value="">{t('invoice.selectOrder')}</option>
                {orders.data.items.map((o) => <option key={o.id} value={o.id}>{o.number} — {o.customerName} — {fmt.dzd(o.totalTtc)}</option>)}
              </Select>
            )}
          </Field>
          {posting && (
            <div className="rounded-lg bg-surface2 p-4 text-sm">
              <div className="mb-2 text-muted">{t('invoice.willPost')}</div>
              <ul className="space-y-1">
                {posting.map((p) => <li key={p.account} className="flex justify-between gap-3"><span><b>{p.side}</b> {p.account}</span><span className="tabular font-semibold">{fmt.dzd(p.amount)}</span></li>)}
              </ul>
              <div className="mt-2 text-xs text-muted">{t('invoice.immutable')}</div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function Invoices() {
  const { can } = useAuth();
  const { t, fmt, status: statusLabel } = useI18n();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [generating, setGenerating] = useState(false);
  const term = useDebounced(search);
  const openId = params.get('open');

  const q = useQuery({
    queryKey: ['invoices', { status, term, page }],
    queryFn: () => api.get<Page<InvoiceSummaryDto>>('/finance/invoices', { status, search: term, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader title={t('invoices.title')} subtitle={t('invoices.subtitle')} actions={can(PERMISSIONS.FINANCE_INVOICE_CREATE) && <Button variant="primary" onClick={() => setGenerating(true)}><Plus aria-hidden className="size-4" />{t('invoices.generate')}</Button>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3.5">
          <div className="relative w-full max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" />
            <Input aria-label={t('invoices.searchLabel')} placeholder={t('invoices.searchPlaceholder')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="ps-9" />
          </div>
          <Select aria-label={t('orders.filterStatus')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-48">
            <option value="">{t('orders.allStatuses')}</option>
            {INVOICE_STATUSES.filter((s) => s !== 'DRAFT').map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </Select>
        </div>
        {q.isPending ? <Loading /> : q.isError ? <div className="p-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div> : q.data.items.length === 0 ? <Empty>{t('invoices.none')}</Empty> : (
          <>
            <Table>
              <thead><tr><Th>{t('orders.number')}</Th><Th>{t('orders.customer')}</Th><Th>{t('invoices.order')}</Th><Th>{t('orders.date')}</Th><Th>{t('orders.due')}</Th><Th>{t('orders.status')}</Th><Th num>{t('orders.totalTtc')}</Th><Th num>{t('invoice.balanceDue')}</Th></tr></thead>
              <tbody>
                {q.data.items.map((i) => (
                  <tr key={i.id} className="cursor-pointer transition hover:bg-surface2" onClick={() => setParams({ open: i.id })}>
                    <Td className="tabular font-semibold"><Ltr>{i.number}</Ltr></Td><Td>{i.customerName}</Td><Td className="tabular text-muted"><Ltr>{i.orderNumber}</Ltr></Td>
                    <Td className="whitespace-nowrap">{fmt.day(i.invoiceDate)}</Td><Td className="whitespace-nowrap">{fmt.day(i.dueDate)}</Td><Td><StatusBadge status={i.status} /></Td>
                    <Td num>{fmt.dzd(i.totalTtc)}</Td><Td num className={cx('font-semibold', i.status !== 'CANCELLED' && Number(i.balanceDue) > 0 && 'text-warn')}>{i.status === 'CANCELLED' ? '—' : fmt.dzd(i.balanceDue)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {openId && <InvoiceModal id={openId} onClose={() => setParams({})} />}
      {generating && <GenerateDialog onClose={() => setGenerating(false)} onCreated={(id) => { setGenerating(false); setParams({ open: id }); }} />}
    </div>
  );
}
