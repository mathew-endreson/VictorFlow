import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type OrderDetailDto, type Page, type TaskDto, type TrackingLinkDto, type UserSummary } from '@victorflow/types';
import { ArrowLeft, Check, Copy, ExternalLink, Pencil, Plus, ReceiptText, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Empty, ErrorBox, Eyebrow, FLIP, Loading, Ltr, Modal, PageHeader, StatusBadge, Table, Td, Th, cx, useToast } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inNativeShell, openExternal } from '@/lib/external';
import { TaskForm, toTaskPayload } from './TaskForm';

function TrackingCard({ orderId }: { orderId: string }) {
  const toast = useToast();
  const { t } = useI18n();
  const link = useQuery({ queryKey: ['tracking-link', orderId], queryFn: () => api.get<TrackingLinkDto>(`/orders/${orderId}/tracking-link`), staleTime: Infinity });
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!link.data) return;
    let cancelled = false;
    QRCode.toDataURL(link.data.url, { margin: 1, width: 220, errorCorrectionLevel: 'M' }).then((u) => !cancelled && setQr(u)).catch(() => setQr(null));
    return () => { cancelled = true; };
  }, [link.data]);

  if (link.isPending) return <Loading />;
  if (link.isError) return <ErrorBox error={link.error} />;
  return (
    <Card className="p-6">
      <h2 className="mb-1.5 flex items-center gap-2.5 text-sm font-bold"><span aria-hidden className="slash text-sm" />{t('order.tracking')}</h2>
      <p className="mb-4 text-xs leading-relaxed text-muted">{t('order.trackingHelp')}</p>
      <div className="flex flex-wrap items-start gap-4">
        {qr && <img src={qr} alt={t('order.qrAlt')} width={140} height={140} className="rounded-lg border border-line bg-white p-1.5" />}
        <div className="min-w-[12rem] flex-1">
          <input readOnly dir="ltr" aria-label={t('order.trackingUrl')} value={link.data.url} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border border-line bg-surface2 px-2.5 py-2 text-xs" />
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigator.clipboard?.writeText(link.data.url).then(() => toast.ok(t('order.linkCopied')))}><Copy aria-hidden className="size-3.5" />{t('order.copyLink')}</Button>
            <a href={link.data.url} target="_blank" rel="noreferrer" onClick={(e) => { if (inNativeShell()) { e.preventDefault(); void openExternal(link.data.url); } }} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-xs font-semibold shadow-card transition hover:border-ink/50 hover:bg-surface2"><ExternalLink aria-hidden className={cx('size-3.5', FLIP)} />{t('order.open')}</a>
          </div>
        </div>
      </div>
    </Card>
  );
}

function TasksCard({ orderId }: { orderId: string }) {
  const { can } = useAuth();
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const canManage = can(PERMISSIONS.WORKFORCE_TASK_CREATE);

  const users = useQuery({ queryKey: ['employees'], queryFn: () => api.get<UserSummary[]>('/users'), enabled: canManage });
  const tasks = useQuery({ queryKey: ['tasks', { orderId }], queryFn: () => api.get<Page<TaskDto>>('/workforce/tasks', { orderId, page: 1, pageSize: 50 }) });
  const byId = new Map((users.data ?? []).map((u) => [u.id, u.fullName]));

  const create = useMutation({
    mutationFn: (body: ReturnType<typeof toTaskPayload>) => api.post<TaskDto>('/workforce/tasks', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks', { orderId }] }); toast.ok(t('tasks.created')); setCreating(false); },
  });

  if (tasks.isPending) return <Loading />;
  if (tasks.isError) return <ErrorBox error={tasks.error} />;

  return (
    <Card className="p-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 text-sm font-bold"><span aria-hidden className="slash text-sm" />{t('tasks.title')}</h2>
        {canManage && <Button size="sm" onClick={() => setCreating(true)}><Plus aria-hidden className="size-3.5" />{t('tasks.new')}</Button>}
      </div>
      {tasks.data.items.length === 0 ? (
        <p className="text-sm text-muted">{t('tasks.noneForOrder')}</p>
      ) : (
        <ul className="space-y-2.5">
          {tasks.data.items.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{task.title}</div>
                <div className="text-xs text-muted">{task.assignedTo ? (byId.get(task.assignedTo) ?? t('tasks.unassigned')) : t('tasks.unassigned')}{task.dueDate ? ` · ${task.dueDate}` : ''}</div>
              </div>
              <StatusBadge status={task.status} />
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <Modal title={t('tasks.newTitle')} onClose={() => setCreating(false)}>
          <TaskForm users={users.data ?? []} submitLabel={t('tasks.create')} onCancel={() => setCreating(false)} onSubmit={async (v) => { await create.mutateAsync(toTaskPayload(v, orderId)); }} />
        </Modal>
      )}
    </Card>
  );
}

export function OrderDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { t, fmt } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const q = useQuery({ queryKey: ['order', id], queryFn: () => api.get<OrderDetailDto>(`/orders/${id}`) });
  const refresh = () => {
    for (const key of ['order', 'orders', 'board', 'dashboard', 'invoices']) qc.invalidateQueries({ queryKey: [key] });
  };

  const confirmOrder = useMutation({
    mutationFn: () => api.post<OrderDetailDto>(`/orders/${id}/confirm`),
    onSuccess: (o) => { refresh(); toast.ok(t('order.confirmed', { number: o.number, production: o.productionOrder?.number ?? '' })); },
    onError: toast.error,
  });
  const cancelOrder = useMutation({
    mutationFn: () => api.post<OrderDetailDto>(`/orders/${id}/cancel`),
    onSuccess: (o) => { refresh(); toast.ok(t('order.cancelled', { number: o.number })); },
    onError: toast.error,
  });
  const invoice = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>(`/finance/invoices/from-order/${id}`, {}),
    onSuccess: (inv) => { refresh(); toast.ok(t('order.invoiceIssued', { number: inv.number })); nav(`/invoices?open=${inv.id}`); },
    onError: toast.error,
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const invoiceable = ['CONFIRMED', 'IN_PRODUCTION', 'COMPLETED'].includes(o.status) && !o.invoice;

  return (
    <div>
      <PageHeader
        title={<Ltr>{o.number}</Ltr>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge status={o.status} />
            <Link className="font-semibold text-brandfg hover:underline" to={`/customers/${o.customerId}`}>{o.customerName}</Link>
            <span>· {t('order.orderedOn', { date: fmt.day(o.orderDate) })}{o.dueDate ? ` · ${t('order.dueOn', { date: fmt.day(o.dueDate) })}` : ''}</span>
          </span>
        }
        actions={
          <>
            <Link to="/orders" className="me-1 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft aria-hidden className={cx('size-4', FLIP)} />{t('order.allOrders')}</Link>
            {o.status === 'DRAFT' && can(PERMISSIONS.SALES_ORDER_WRITE) && <Button onClick={() => nav(`/orders/${o.id}/edit`)}><Pencil aria-hidden className="size-3.5" />{t('common.edit')}</Button>}
            {['DRAFT', 'CONFIRMED'].includes(o.status) && can(PERMISSIONS.SALES_ORDER_CANCEL) && <Button variant="danger" loading={cancelOrder.isPending} onClick={() => confirm(t('order.confirmCancel', { number: o.number })) && cancelOrder.mutate()}><X aria-hidden className="size-4" />{t('order.cancelOrder')}</Button>}
            {o.status === 'DRAFT' && can(PERMISSIONS.SALES_ORDER_CONFIRM) && <Button variant="primary" loading={confirmOrder.isPending} onClick={() => confirmOrder.mutate()}><Check aria-hidden className="size-4" />{t('order.confirmOrder')}</Button>}
            {invoiceable && can(PERMISSIONS.FINANCE_INVOICE_CREATE) && <Button variant="primary" loading={invoice.isPending} onClick={() => invoice.mutate()}><ReceiptText aria-hidden className="size-4" />{t('order.generateInvoice')}</Button>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Table>
            <thead><tr><Th>#</Th><Th>{t('lines.description')}</Th><Th num>{t('lines.qty')}</Th><Th num>{t('lines.unitPrice')}</Th><Th num>{t('lines.discount')}</Th><Th num>{t('lines.tva')}</Th><Th num>{t('lines.lineHt')}</Th><Th num>{t('lines.lineTtc')}</Th></tr></thead>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.id}>
                  <Td className="text-muted">{i.position}</Td><Td className="font-semibold">{i.description}</Td>
                  <Td num><Ltr>{fmt.qty(i.quantity)} {i.unit}</Ltr></Td><Td num>{fmt.dzd(i.unitPrice)}</Td><Td num>{Number(i.discountPct) ? <Ltr>{fmt.qty(i.discountPct)} %</Ltr> : '—'}</Td><Td num><Ltr>{fmt.qty(i.tvaRate)} %</Ltr></Td>
                  <Td num>{fmt.dzd(i.lineHt)}</Td><Td num className="font-semibold">{fmt.dzd(i.lineTtc)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <dl className="tabular ms-auto w-[26rem] max-w-full space-y-1.5 p-5 text-sm" aria-label={t('lines.totals')}>
            <div className="flex justify-between"><dt className="text-muted">{t('lines.totalHt')}</dt><dd>{fmt.dzd(o.totalHt)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">{t('lines.tva')}</dt><dd>{fmt.dzd(o.totalTva)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>{t('lines.totalTtc')}</dt><dd>{fmt.dzd(o.totalTtc)}</dd></div>
          </dl>
          {o.notes && <p className="border-t border-line px-6 py-3.5 text-sm text-muted"><span className="font-semibold text-ink">{t('common.notes')}: </span>{o.notes}</p>}
        </Card>

        <div className="space-y-4">
          <Card className="p-6">
            <Eyebrow>{t('order.progress')}</Eyebrow>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3"><dt className="text-muted">{t('order.confirmedAt')}</dt><dd>{o.confirmedAt ? fmt.dateTime(o.confirmedAt) : '—'}</dd></div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t('order.production')}</dt>
                <dd>{o.productionOrder ? <Link className="flex flex-wrap items-center justify-end gap-2 font-semibold text-brandfg hover:underline" to={`/production?open=${o.productionOrder.id}`}><Ltr>{o.productionOrder.number}</Ltr> <StatusBadge status={o.productionOrder.status} /></Link> : '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t('order.invoice')}</dt>
                <dd>{o.invoice ? <Link className="flex flex-wrap items-center justify-end gap-2 font-semibold text-brandfg hover:underline" to={`/invoices?open=${o.invoice.id}`}><Ltr>{o.invoice.number}</Ltr> <StatusBadge status={o.invoice.status} /></Link> : '—'}</dd>
              </div>
            </dl>
          </Card>
          {o.status !== 'CANCELLED' && <TrackingCard orderId={o.id} />}
          <TasksCard orderId={o.id} />
        </div>
      </div>
    </div>
  );
}
