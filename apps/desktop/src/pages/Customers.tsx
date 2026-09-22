import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type CustomerDto, type Page } from '@victorflow/types';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, Ltr, Modal, PageHeader, Pager, Table, Td, Th, useDebounced, useToast } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { blankCustomer, CustomerForm, toPayload } from './CustomerForm';

const PAGE_SIZE = 20;

export function Customers() {
  const { can } = useAuth();
  const { t, label } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const term = useDebounced(search);

  const q = useQuery({
    queryKey: ['customers', { term, page }],
    queryFn: () => api.get<Page<CustomerDto>>('/customers', { search: term, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: (body: ReturnType<typeof toPayload>) => api.post<CustomerDto>('/customers', body),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.ok(t('customers.created', { code: c.code }));
      setCreating(false);
      nav(`/customers/${c.id}`);
    },
  });

  return (
    <div>
      <PageHeader
        title={t('customers.title')}
        subtitle={t('customers.subtitle')}
        actions={can(PERMISSIONS.CRM_CUSTOMER_WRITE) && <Button variant="primary" onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" />{t('customers.new')}</Button>}
      />
      <Card>
        <div className="border-b border-line p-3.5">
          <div className="relative max-w-sm">
            <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" />
            <Input aria-label={t('customers.searchLabel')} placeholder={t('customers.searchPlaceholder')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="ps-9" />
          </div>
        </div>
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <div className="p-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>
        ) : q.data.items.length === 0 ? (
          <Empty>{term ? t('customers.noMatch') : t('customers.none')}</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>{t('customers.code')}</Th><Th>{t('customers.name')}</Th><Th>{t('customers.type')}</Th><Th>{t('customers.wilaya')}</Th><Th>{t('customers.phone')}</Th><Th>{t('common.email')}</Th><Th>{t('customers.status')}</Th></tr>
              </thead>
              <tbody>
                {q.data.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer transition hover:bg-surface2" onClick={() => nav(`/customers/${c.id}`)}>
                    <Td className="tabular text-muted"><Ltr>{c.code}</Ltr></Td>
                    <Td className="font-semibold">{c.name}</Td>
                    <Td>{label('customerType', c.customerType)}</Td>
                    <Td>{c.wilaya ?? '—'}</Td>
                    <Td>{c.phone ? <Ltr>{c.phone}</Ltr> : '—'}</Td>
                    <Td>{c.email ? <Ltr>{c.email}</Ltr> : '—'}</Td>
                    <Td>{c.isActive ? <Badge tone="green">{t('customers.active')}</Badge> : <Badge>{t('customers.inactive')}</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      {creating && (
        <Modal title={t('customers.newTitle')} wide onClose={() => setCreating(false)}>
          <CustomerForm initial={blankCustomer()} submitLabel={t('customers.create')} onCancel={() => setCreating(false)} onSubmit={async (v) => { await create.mutateAsync(toPayload(v)); }} />
        </Modal>
      )}
    </div>
  );
}
