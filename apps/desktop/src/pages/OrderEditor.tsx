import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type CustomerDto, type OrderDetailDto, type Page } from '@victorflow/types';
import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, Textarea, useToast } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { blankLine, lineProblem, previewLines, toItemsPayload, type LineDraft } from '@/lib/order-lines';

/** Create a DRAFT order, or edit an existing DRAFT. Lines are priced live with the server's own money maths. */
export function OrderEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { t, fmt, error: errorText } = useI18n();

  const customers = useQuery({ queryKey: ['customers', 'picker'], queryFn: () => api.get<Page<CustomerDto>>('/customers', { pageSize: 200, isActive: true }) });
  const existing = useQuery({ queryKey: ['order', id], queryFn: () => api.get<OrderDetailDto>(`/orders/${id}`), enabled: editing });

  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [blankLine()]);
  const [showProblems, setShowProblems] = useState(false);

  useEffect(() => {
    const o = existing.data;
    if (!o) return;
    setCustomerId(o.customerId);
    setDueDate(o.dueDate ?? '');
    setNotes(o.notes ?? '');
    // The API returns fixed-scale decimals ("1250.5000", "19.00"); show them the way a person would type them.
    setLines(o.items.map((i) => blankLine({ description: i.description, unit: i.unit, quantity: fmt.qty(i.quantity), unitPrice: fmt.qty(i.unitPrice), discountPct: fmt.qty(i.discountPct), tvaRate: fmt.qty(i.tvaRate) })));
    // fmt.qty does not depend on the language, so the form is seeded once per loaded order (not on every language switch)
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => previewLines(lines), [lines]);
  const problems = lines.map(lineProblem);
  const valid = customerId !== '' && lines.length > 0 && problems.every((p) => p === null);

  const save = useMutation({
    mutationFn: async (thenConfirm: boolean) => {
      const body = { customerId, dueDate: dueDate || null, notes: notes.trim() || null, items: toItemsPayload(lines) };
      const order = editing ? await api.patch<OrderDetailDto>(`/orders/${id}`, body) : await api.post<OrderDetailDto>('/orders', body);
      return thenConfirm ? api.post<OrderDetailDto>(`/orders/${order.id}/confirm`) : order;
    },
    onSuccess: (o, thenConfirm) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', o.id] });
      qc.invalidateQueries({ queryKey: ['board'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.ok(thenConfirm ? t('editor.confirmedReleased', { number: o.number }) : t('editor.saved', { number: o.number }));
      nav(`/orders/${o.id}`);
    },
    onError: toast.error,
  });

  if (editing && existing.isPending) return <Loading />;
  if (editing && existing.isError) return <ErrorBox error={existing.error} />;
  if (editing && existing.data && existing.data.status !== 'DRAFT') return <ErrorBox error={new Error(t('editor.onlyDraft', { status: existing.data.status }))} />;

  const setLine = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const submit = (thenConfirm: boolean) => {
    setShowProblems(true);
    if (valid) save.mutate(thenConfirm);
  };
  // numeric inputs read left-to-right in both languages; they keep their own text alignment
  const num = 'text-start';

  return (
    <div>
      <PageHeader title={editing ? t('editor.editTitle', { number: existing.data?.number ?? '' }) : t('editor.newTitle')} subtitle={t('editor.subtitle')} />

      <Card className="mb-4 grid gap-5 p-6 sm:grid-cols-3">
        <Field label={t('orders.customer')} required error={showProblems && !customerId ? t('editor.chooseCustomer') : null}>
          {(fid) => (
            <Select id={fid} value={customerId} onChange={(e) => setCustomerId(e.target.value)} autoFocus={!customerId}>
              <option value="">{t('editor.selectCustomer')}</option>
              {customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('editor.dueDate')}>{(fid) => <Input id={fid} type="date" dir="ltr" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
        <Field label={t('common.notes')}>{(fid) => <Textarea id={fid} rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[68rem] text-sm">
            <thead>
              <tr className="text-start text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted">
                <th className="min-w-[15rem] px-3.5 py-3 text-start">{t('lines.description')}</th><th className="w-20 px-1 py-3 text-start">{t('editor.unit')}</th><th className="w-24 px-1 py-3 text-start">{t('lines.qty')}</th>
                <th className="w-32 px-1 py-3 text-start">{t('editor.unitPriceHt')}</th><th className="w-24 px-1 py-3 text-start">{t('editor.discountPct')}</th><th className="w-24 px-1 py-3 text-start">{t('editor.tvaPct')}</th>
                <th className="w-36 px-3.5 py-3 text-end">{t('lines.lineHt')}</th><th className="w-36 px-3.5 py-3 text-end">{t('lines.lineTtc')}</th><th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className="border-t border-line align-top">
                  <td className="px-3.5 py-2.5">
                    <Input aria-label={t('editor.lineDescription', { n: i + 1 })} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder={t('editor.descriptionPlaceholder')} />
                    {showProblems && problems[i] && <p className="mt-1 text-xs text-bad">{t(`editor.problem.${problems[i]}` as const)}</p>}
                  </td>
                  <td className="px-1 py-2.5"><Input aria-label={t('editor.lineUnit', { n: i + 1 })} value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })} /></td>
                  <td className="px-1 py-2.5"><Input aria-label={t('editor.lineQuantity', { n: i + 1 })} dir="ltr" className={num} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} /></td>
                  <td className="px-1 py-2.5"><Input aria-label={t('editor.lineUnitPrice', { n: i + 1 })} dir="ltr" className={num} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} placeholder="0" /></td>
                  <td className="px-1 py-2.5"><Input aria-label={t('editor.lineDiscount', { n: i + 1 })} dir="ltr" className={num} inputMode="decimal" value={l.discountPct} onChange={(e) => setLine(l.key, { discountPct: e.target.value })} /></td>
                  <td className="px-1 py-2.5"><Input aria-label={t('editor.lineTva', { n: i + 1 })} dir="ltr" className={num} inputMode="decimal" value={l.tvaRate} onChange={(e) => setLine(l.key, { tvaRate: e.target.value })} /></td>
                  <td className="tabular px-3.5 py-2.5 pt-4 text-end">{preview.rows[i] ? fmt.dzd(preview.rows[i]!.ht) : '—'}</td>
                  <td className="tabular px-3.5 py-2.5 pt-4 text-end font-semibold">{preview.rows[i] ? fmt.dzd(preview.rows[i]!.ttc) : '—'}</td>
                  <td className="px-2 py-2.5"><Button size="sm" variant="ghost" className="h-9" aria-label={t('editor.removeLine', { n: i + 1 })} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><X aria-hidden className="size-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4 border-t border-line bg-surface2 p-5">
          <Button onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus aria-hidden className="size-4" />{t('editor.addLine')}</Button>
          <dl className="tabular w-80 max-w-full space-y-1.5 text-sm" aria-label={t('lines.totals')}>
            <div className="flex justify-between"><dt className="text-muted">{t('lines.totalHt')}</dt><dd>{fmt.dzd(preview.totalHt)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">{t('lines.tva')}</dt><dd>{fmt.dzd(preview.totalTva)}</dd></div>
            <div className="flex justify-between border-t border-line-strong pt-2 text-lg font-bold"><dt>{t('lines.totalTtc')}</dt><dd data-testid="total-ttc">{fmt.dzd(preview.totalTtc)}</dd></div>
          </dl>
        </div>
      </Card>

      {save.isError && <p role="alert" className="mt-3 text-sm text-bad">{errorText(save.error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={() => nav(-1)}>{t('common.cancel')}</Button>
        <Button variant={can(PERMISSIONS.SALES_ORDER_CONFIRM) ? 'secondary' : 'primary'} loading={save.isPending && !save.variables} onClick={() => submit(false)}>{t('editor.saveDraft')}</Button>
        {can(PERMISSIONS.SALES_ORDER_CONFIRM) && <Button variant="primary" loading={save.isPending && save.variables === true} onClick={() => submit(true)}>{t('editor.saveConfirm')}</Button>}
      </div>
    </div>
  );
}
