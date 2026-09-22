import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, formatMoney, parseMoney, type EntryDetailDto, type EntrySummaryDto, type FiscalYearDto, type JournalDto, type Page, type TrialBalanceDto } from '@victorflow/types';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, FLIP, Field, Input, Loading, Ltr, Modal, PageHeader, Pager, Select, Table, Td, Textarea, Th, cx, useDebounced, useToast } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { today } from '@/lib/format';

const PAGE_SIZE = 25;

function EntryLines({ id }: { id: string }) {
  const { t, fmt, lookup } = useI18n();
  const q = useQuery({ queryKey: ['entry', id], queryFn: () => api.get<EntryDetailDto>(`/finance/entries/${id}`) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} />;
  const head = 'py-1.5 text-start text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted';
  return (
    <div className="bg-surface2 px-7 py-4">
      <table className="w-full text-sm" aria-label={t('ledger.linesOf', { number: q.data.entryNumber ?? '' })}>
        <thead><tr><th className={head}>{t('ledger.account')}</th><th className={head}>{t('ledger.partner')}</th><th className={head}>{t('lines.description')}</th><th className={cx(head, 'text-end')}>{t('ledger.debit')}</th><th className={cx(head, 'text-end')}>{t('ledger.credit')}</th></tr></thead>
        <tbody>
          {q.data.lines.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="py-2"><Ltr className="tabular font-semibold">{l.accountCode}</Ltr> <span className="text-muted">{lookup(`account.${l.accountCode}`, l.accountName)}</span></td>
              <td>{l.partnerName ?? '—'}</td><td className="text-muted">{l.description ?? ''}</td>
              <td className="tabular text-end">{Number(l.debit) ? fmt.dzd(l.debit) : ''}</td><td className="tabular text-end">{Number(l.credit) ? fmt.dzd(l.credit) : ''}</td>
            </tr>
          ))}
          <tr className="border-t border-line-strong font-bold"><td className="py-2" colSpan={3}>{t('ledger.total')}</td><td className="tabular text-end">{fmt.dzd(q.data.totalDebit)}</td><td className="tabular text-end">{fmt.dzd(q.data.totalCredit)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function ReverseDialog({ entry, onClose }: { entry: EntrySummaryDto; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(today());
  const reverse = useMutation({
    mutationFn: () => api.post<EntryDetailDto>(`/finance/entries/${entry.id}/reverse`, { reason, entryDate: date }),
    onSuccess: (e) => { for (const k of ['entries', 'trial-balance', 'invoices', 'dashboard']) qc.invalidateQueries({ queryKey: [k] }); toast.ok(t('ledger.reversedBy', { number: e.entryNumber ?? '' })); onClose(); },
    onError: toast.error,
  });
  return (
    <Modal title={t('ledger.reverseTitle', { number: entry.entryNumber ?? '' })} onClose={onClose} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={reverse.isPending} onClick={() => reverse.mutate()}>{t('ledger.postReversal')}</Button></>}>
      <p className="mb-4 text-sm leading-relaxed text-muted">{t('ledger.reverseExplain')}</p>
      <div className="space-y-4">
        <Field label={t('invoice.reason')} required>{(id) => <Textarea id={id} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <Field label={t('ledger.reversalDate')}>{(id) => <Input id={id} type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function Entries() {
  const { can } = useAuth();
  const { t, fmt, lookup } = useI18n();
  const [journal, setJournal] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [reversing, setReversing] = useState<EntrySummaryDto | null>(null);
  const term = useDebounced(search);

  const journals = useQuery({ queryKey: ['journals'], queryFn: () => api.get<JournalDto[]>('/finance/journals'), staleTime: 60_000 });
  const q = useQuery({
    queryKey: ['entries', { journal, from, to, term, page }],
    queryFn: () => api.get<Page<EntrySummaryDto>>('/finance/entries', { journal, from, to, search: term, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-2 border-b border-line p-3.5">
        <Select aria-label={t('ledger.journal')} value={journal} onChange={(e) => { setJournal(e.target.value); setPage(1); }} className="w-56">
          <option value="">{t('ledger.allJournals')}</option>
          {journals.data?.map((j) => <option key={j.id} value={j.code}>{j.code} — {lookup(`journal.${j.code}`, j.name)}</option>)}
        </Select>
        <Input aria-label={t('ledger.fromDate')} type="date" dir="ltr" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="max-w-[10rem]" />
        <Input aria-label={t('ledger.toDate')} type="date" dir="ltr" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="max-w-[10rem]" />
        <div className="relative w-full max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" />
          <Input aria-label={t('ledger.searchLabel')} placeholder={t('ledger.searchPlaceholder')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="ps-9" />
        </div>
      </div>
      {q.isPending ? <Loading /> : q.isError ? <div className="p-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div> : q.data.items.length === 0 ? <Empty>{t('ledger.noEntries')}</Empty> : (
        <>
          <Table>
            <thead><tr><Th className="w-8" /><Th>{t('orders.number')}</Th><Th>{t('orders.date')}</Th><Th>{t('lines.description')}</Th><Th num>{t('ledger.debit')}</Th><Th num>{t('ledger.credit')}</Th><Th>{t('orders.status')}</Th><Th /></tr></thead>
            <tbody>
              {q.data.items.map((e) => (
                <Fragment key={e.id}>
                  <tr className="cursor-pointer transition hover:bg-surface2" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                    <Td className="text-muted">{open === e.id ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className={cx('size-4', FLIP)} />}</Td>
                    <Td className="tabular font-semibold"><Ltr>{e.entryNumber}</Ltr></Td>
                    <Td className="whitespace-nowrap">{fmt.day(e.entryDate)}</Td>
                    <Td className="max-w-md truncate">{e.description}</Td>
                    <Td num>{fmt.dzd(e.totalDebit)}</Td><Td num>{fmt.dzd(e.totalCredit)}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <Badge tone="green">{t('ledger.posted')}</Badge>
                        {e.reversedBy && <Badge tone="amber">{t('ledger.reversed')}</Badge>}
                        {e.reversalOf && <Badge tone="violet">{t('ledger.reversal')}</Badge>}
                      </div>
                    </Td>
                    <Td className="text-end">
                      {can(PERMISSIONS.FINANCE_ENTRY_REVERSE) && !e.reversedBy && !e.reversalOf && <Button size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); setReversing(e); }}>{t('ledger.reverse')}</Button>}
                    </Td>
                  </tr>
                  {open === e.id && <tr><td colSpan={8} className="p-0"><EntryLines id={e.id} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </Table>
          <Pager page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />
        </>
      )}
      {reversing && <ReverseDialog entry={reversing} onClose={() => setReversing(null)} />}
    </Card>
  );
}

function TrialBalance() {
  const { t, fmt, label, lookup } = useI18n();
  const years = useQuery({ queryKey: ['fiscal-years'], queryFn: () => api.get<FiscalYearDto[]>('/finance/fiscal-years'), staleTime: 60_000 });
  const [fy, setFy] = useState('');
  const selected = fy || years.data?.[0]?.code || '';
  const q = useQuery({ queryKey: ['trial-balance', selected], queryFn: () => api.get<TrialBalanceDto>('/finance/trial-balance', { fiscalYear: selected }), enabled: Boolean(selected) });

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-line p-3.5">
        <label className="text-sm text-muted" htmlFor="fy">{t('ledger.fiscalYear')}</label>
        <Select id="fy" value={selected} onChange={(e) => setFy(e.target.value)} className="w-44">
          {years.data?.map((y) => <option key={y.id} value={y.code}>{y.code}{y.status === 'CLOSED' ? ` (${t('ledger.closed')})` : ''}</option>)}
        </Select>
        {q.data && <Badge tone={q.data.balanced ? 'green' : 'red'}>{q.data.balanced ? t('ledger.balanced') : t('ledger.outOfBalance')}</Badge>}
      </div>
      {!selected || q.isPending ? <Loading /> : q.isError ? <div className="p-4"><ErrorBox error={q.error} /></div> : q.data.rows.length === 0 ? <Empty>{t('ledger.nothingPosted', { year: selected })}</Empty> : (
        <Table>
          <thead><tr><Th>{t('ledger.account')}</Th><Th>{t('ledger.name')}</Th><Th>{t('customers.type')}</Th><Th num>{t('ledger.debit')}</Th><Th num>{t('ledger.credit')}</Th><Th num>{t('ledger.balance')}</Th></tr></thead>
          <tbody>
            {q.data.rows.map((r) => (
              <tr key={r.accountCode}>
                <Td className="tabular font-semibold"><Ltr>{r.accountCode}</Ltr></Td><Td>{lookup(`account.${r.accountCode}`, r.accountName)}</Td><Td className="text-muted">{label('accountType', r.accountType)}</Td>
                <Td num>{fmt.dzd(r.debit)}</Td><Td num>{fmt.dzd(r.credit)}</Td><Td num className={cx('font-semibold', r.balance.startsWith('-') && 'text-warn')}>{fmt.dzd(r.balance)}</Td>
              </tr>
            ))}
            <tr className="bg-surface2 font-bold"><Td colSpan={3}>{t('ledger.total')}</Td><Td num>{fmt.dzd(q.data.totalDebit)}</Td><Td num>{fmt.dzd(q.data.totalCredit)}</Td><Td num>{fmt.dzd(formatMoney(parseMoney(q.data.totalDebit) - parseMoney(q.data.totalCredit)))}</Td></tr>
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function Ledger() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'entries' | 'tb'>('entries');
  return (
    <div>
      <PageHeader title={t('ledger.title')} subtitle={t('ledger.subtitle')} />
      <div role="tablist" className="mb-4 inline-flex rounded-md border border-line-strong bg-surface p-0.5 shadow-card">
        {([['entries', t('ledger.tabEntries')], ['tb', t('ledger.tabTrialBalance')]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('rounded px-4 py-1.5 text-sm font-semibold transition', tab === k ? 'bg-primary text-primaryink' : 'text-muted hover:text-ink')}>{label}</button>
        ))}
      </div>
      {tab === 'entries' ? <Entries /> : <TrialBalance />}
    </div>
  );
}
