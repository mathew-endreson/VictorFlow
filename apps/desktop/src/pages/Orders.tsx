import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ORDER_STATUSES, PERMISSIONS, type OrderSummaryDto, type Page } from '@victorflow/types';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Empty, ErrorBox, Input, Loading, Ltr, PageHeader, Pager, Select, StatusBadge, Table, Td, Th, useDebounced } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const PAGE_SIZE = 20;

export function Orders() {
  const { can } = useAuth();
  const { t, fmt, status: statusLabel } = useI18n();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounced(search);

  const q = useQuery({
    queryKey: ['orders', { term, status, page }],
    queryFn: () => api.get<Page<OrderSummaryDto>>('/orders', { search: term, status, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader title={t('orders.title')} subtitle={t('orders.subtitle')} actions={can(PERMISSIONS.SALES_ORDER_WRITE) && <Button variant="primary" onClick={() => nav('/orders/new')}><Plus aria-hidden className="size-4" />{t('orders.new')}</Button>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3.5">
          <div className="relative w-full max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" />
            <Input aria-label={t('orders.searchLabel')} placeholder={t('orders.searchPlaceholder')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="ps-9" />
          </div>
          <Select aria-label={t('orders.filterStatus')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-48">
            <option value="">{t('orders.allStatuses')}</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </Select>
        </div>
        {q.isPending ? <Loading /> : q.isError ? <div className="p-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div> : q.data.items.length === 0 ? (
          <Empty>{t('orders.noMatch')} {can(PERMISSIONS.SALES_ORDER_WRITE) && t('orders.createFirst')}</Empty>
        ) : (
          <>
            <Table>
              <thead><tr><Th>{t('orders.number')}</Th><Th>{t('orders.customer')}</Th><Th>{t('orders.date')}</Th><Th>{t('orders.due')}</Th><Th>{t('orders.status')}</Th><Th num>{t('orders.totalHt')}</Th><Th num>{t('orders.totalTtc')}</Th></tr></thead>
              <tbody>
                {q.data.items.map((o) => (
                  <tr key={o.id} className="cursor-pointer transition hover:bg-surface2" onClick={() => nav(`/orders/${o.id}`)}>
                    <Td className="tabular font-semibold"><Ltr>{o.number}</Ltr></Td>
                    <Td>{o.customerName}</Td>
                    <Td className="whitespace-nowrap">{fmt.day(o.orderDate)}</Td>
                    <Td className="whitespace-nowrap">{fmt.day(o.dueDate)}</Td>
                    <Td><StatusBadge status={o.status} /></Td>
                    <Td num>{fmt.dzd(o.totalHt)}</Td>
                    <Td num className="font-semibold">{fmt.dzd(o.totalTtc)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
