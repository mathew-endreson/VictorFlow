import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type ProductionBoardDto, type ProductionCardDto, type ProductionOrderDetailDto, type WorkOrderDto } from '@victorflow/types';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, ErrorBox, Eyebrow, FLIP, Field, Loading, Ltr, Modal, PageHeader, StatusBadge, Textarea, cx, useToast } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isLikelyAllowed, moveLabel, planDrop, transitionErrorText } from '@/lib/kanban';

interface Move { id: string; to: string; note?: string }

function useTransition() {
  const qc = useQueryClient();
  const toast = useToast();
  const i18n = useI18n();
  return useMutation({
    mutationFn: ({ id, to, note }: Move) => api.post<ProductionOrderDetailDto>(`/production/orders/${id}/transition`, { to, ...(note ? { note } : {}) }),
    onSuccess: (po) => {
      for (const key of ['board', 'production-order', 'orders', 'order', 'dashboard']) qc.invalidateQueries({ queryKey: [key] });
      toast.ok(i18n.t('production.moved', { number: po.number, status: i18n.status(po.status) }));
    },
    // the server's refusal IS the feedback: illegal move / missing permission / guard failed (with the blocking work orders)
    onError: (e) => toast.error(new Error(transitionErrorText(e, i18n))),
  });
}

function NoteDialog({ title, onCancel, onSubmit, busy }: { title: string; onCancel: () => void; onSubmit: (note: string) => void; busy: boolean }) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  return (
    <Modal title={title} onClose={onCancel} footer={<><Button onClick={onCancel}>{t('common.cancel')}</Button><Button variant="primary" disabled={!note.trim()} loading={busy} onClick={() => onSubmit(note.trim())}>{t('production.confirm')}</Button></>}>
      <Field label={t('production.noteRequired')}>{(id) => <Textarea id={id} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
    </Modal>
  );
}

function WorkOrderRow({ wo, canWrite }: { wo: WorkOrderDto; canWrite: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t, fmt } = useI18n();
  const update = useMutation({
    mutationFn: (status: 'IN_PROGRESS' | 'COMPLETED') => api.patch<WorkOrderDto>(`/production/work-orders/${wo.id}`, { status }),
    onSuccess: () => {
      for (const key of ['production-order', 'board']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: toast.error,
  });
  const meta = [t('production.plannedHours', { hours: wo.plannedHours }), wo.assignedToName, wo.completedAt ? t('production.doneOn', { date: fmt.dateTime(wo.completedAt) }) : null].filter(Boolean).join(' · ');
  return (
    <li className="flex items-center justify-between gap-3 py-3 text-sm">
      <div className="min-w-0">
        <div className="truncate font-semibold">{wo.title}</div>
        <div className="mt-0.5 text-xs text-muted">{meta}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge status={wo.status} />
        {canWrite && wo.status === 'PENDING' && <Button size="sm" loading={update.isPending} onClick={() => update.mutate('IN_PROGRESS')}>{t('production.start')}</Button>}
        {canWrite && (wo.status === 'PENDING' || wo.status === 'IN_PROGRESS') && <Button size="sm" variant="primary" loading={update.isPending} onClick={() => update.mutate('COMPLETED')}>{t('production.complete')}</Button>}
      </div>
    </li>
  );
}

function Drawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const i18n = useI18n();
  const { t, fmt, status } = i18n;
  const q = useQuery({ queryKey: ['production-order', id], queryFn: () => api.get<ProductionOrderDetailDto>(`/production/orders/${id}`) });
  const move = useTransition();
  const [asking, setAsking] = useState<{ to: string; label: string } | null>(null);

  return (
    <Modal title={q.data ? `${q.data.number} · ${q.data.customerName}` : t('production.orderTitle')} wide onClose={onClose}>
      {q.isPending ? <Loading /> : q.isError ? <ErrorBox error={q.error} /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={q.data.status} />
            <Link className="font-semibold text-brandfg hover:underline" to={`/orders/${q.data.orderId}`}>{t('production.orderLink', { number: q.data.orderNumber })}</Link>
            {q.data.dueDate && <span className="text-muted">{t('production.dueOn', { date: fmt.day(q.data.dueDate) })}</span>}
            <Badge>{t('production.priority', { n: q.data.priority })}</Badge>
          </div>
          {q.data.rejectionReason && <p className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad"><b>{t('production.rejected')}</b> {q.data.rejectionReason}</p>}

          <div>
            <Eyebrow>{t('production.moveTo')}</Eyebrow>
            {q.data.allowedTransitions.length === 0 ? <p className="text-sm text-muted">{t('production.noMoves')}</p> : (
              <div className="flex flex-wrap gap-2">
                {q.data.allowedTransitions.map((tr) => {
                  const label = moveLabel(i18n, q.data.status, tr);
                  return (
                    <Button key={tr.to} variant="primary" loading={move.isPending && move.variables?.to === tr.to} onClick={() => (tr.requiresNote ? setAsking({ to: tr.to, label }) : move.mutate({ id, to: tr.to }))}>
                      {label}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <Eyebrow className="mb-0">{t('production.workOrders')}</Eyebrow>
            <ul className="divide-y divide-line">{q.data.workOrders.map((w) => <WorkOrderRow key={w.id} wo={w} canWrite={can(PERMISSIONS.PRODUCTION_WORKORDER_WRITE)} />)}</ul>
          </div>

          <div>
            <Eyebrow>{t('production.history')}</Eyebrow>
            <ol className="space-y-2 text-sm">
              {[...q.data.events].reverse().map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-muted">
                  <span className="tabular">{fmt.dateTime(e.createdAt)}</span>
                  <span className="flex items-center gap-1.5 text-ink">
                    {e.fromStatus && <>{status(e.fromStatus)} <ArrowRight aria-hidden className={cx('size-3.5 text-muted', FLIP)} /></>}
                    {status(e.toStatus)}
                  </span>
                  {e.actorName && <span>{t('production.by', { name: e.actorName })}</span>}
                  {e.note && <span className="italic">“{e.note}”</span>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {asking && <NoteDialog title={asking.label} busy={move.isPending} onCancel={() => setAsking(null)} onSubmit={(note) => move.mutate({ id, to: asking.to, note }, { onSuccess: () => setAsking(null) })} />}
    </Modal>
  );
}

function CardView({ card, dragging, onOpen, onDragStart, onDragEnd }: { card: ProductionCardDto; dragging: boolean; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void }) {
  const { t, fmt } = useI18n();
  const done = card.workOrdersTotal > 0 && card.workOrdersCompleted === card.workOrdersTotal;
  return (
    <article
      draggable
      data-card={card.number}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', card.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cx('cursor-grab rounded-lg border border-line bg-surface p-3.5 text-sm shadow-card transition hover:-translate-y-px hover:border-ink/30 hover:shadow-pop active:cursor-grabbing', dragging && 'opacity-40')}
    >
      <div className="flex items-center justify-between gap-2">
        <Ltr className="tabular font-bold">{card.number}</Ltr>
        {card.priority <= 2 && <Badge tone="red">{t('production.priorityShort', { n: card.priority })}</Badge>}
      </div>
      <div className="mt-1 truncate text-ink/70">{card.customerName}</div>
      <div className="mt-3 flex items-center gap-2.5 text-xs text-muted">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/[0.07]"><div className={cx('h-full rounded-full', done ? 'bg-ok' : 'bg-brand')} style={{ width: card.workOrdersTotal ? `${(card.workOrdersCompleted / card.workOrdersTotal) * 100}%` : '0%' }} /></div>
        <span className="tabular">{card.workOrdersCompleted}/{card.workOrdersTotal}</span>
      </div>
      {card.dueDate && <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted"><CalendarDays aria-hidden className="size-3.5" />{t('production.dueOn', { date: fmt.day(card.dueDate) })}</div>}
    </article>
  );
}

export function Production() {
  const [params, setParams] = useSearchParams();
  const i18n = useI18n();
  const { t, status } = i18n;
  const board = useQuery({ queryKey: ['board'], queryFn: () => api.get<ProductionBoardDto>('/production/board'), refetchInterval: 15_000 });
  const move = useTransition();
  const [dragCard, setDragCard] = useState<ProductionCardDto | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ card: ProductionCardDto; to: string; label: string } | null>(null);
  const openId = params.get('open');

  function drop(colCode: string) {
    const card = dragCard;
    setDragCard(null);
    setOverCol(null);
    if (!card) return;
    const plan = planDrop(card, colCode);
    if (plan.kind === 'noop') return;
    if (plan.kind === 'ask-note') return setAsking({ card, to: colCode, label: moveLabel(i18n, card.status, plan.transition) });
    move.mutate({ id: card.id, to: colCode });
  }

  if (board.isPending) return <Loading />;
  if (board.isError) return <ErrorBox error={board.error} onRetry={() => board.refetch()} />;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('production.title')} subtitle={t('production.subtitle')} />
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-3" aria-label={t('production.boardLabel')}>
        {board.data.columns.map((col) => {
          const hint = dragCard ? isLikelyAllowed(dragCard, col.code) : false;
          const colLabel = status(col.code, col.label);
          return (
            <section
              key={col.code}
              data-column={col.code}
              aria-label={colLabel}
              onDragOver={(e) => { if (dragCard) { e.preventDefault(); setOverCol(col.code); } }}
              onDragLeave={() => setOverCol((c) => (c === col.code ? null : c))}
              onDrop={(e) => { e.preventDefault(); drop(col.code); }}
              className={cx('flex w-72 shrink-0 flex-col rounded-xl border bg-ink/[0.035] transition', overCol === col.code ? 'border-brand ring-2 ring-brand/30' : hint ? 'border-ok/50' : 'border-line')}
            >
              <header className="flex items-center justify-between px-3.5 py-3">
                <div className="flex items-center gap-2.5 text-sm font-bold"><span aria-hidden className="h-3.5 w-1 -skew-x-[30deg] rounded-[1px]" style={{ background: col.color ?? '#94a3b8' }} />{colLabel}</div>
                <span className="tabular rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-muted shadow-card">{col.cards.length}</span>
              </header>
              <div className="flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-2.5">
                {col.cards.map((c) => <CardView key={c.id} card={c} dragging={dragCard?.id === c.id} onOpen={() => setParams({ open: c.id })} onDragStart={() => setDragCard(c)} onDragEnd={() => { setDragCard(null); setOverCol(null); }} />)}
                {col.cards.length === 0 && <p className="rounded-lg border border-dashed border-line-strong px-2 py-8 text-center text-xs text-muted">{t('production.empty')}</p>}
              </div>
            </section>
          );
        })}
      </div>

      {openId && <Drawer id={openId} onClose={() => setParams({})} />}
      {asking && (
        <NoteDialog
          title={`${asking.label} — ${asking.card.number}`}
          busy={move.isPending}
          onCancel={() => setAsking(null)}
          onSubmit={(note) => move.mutate({ id: asking.card.id, to: asking.to, note }, { onSettled: () => setAsking(null) })}
        />
      )}
    </div>
  );
}
