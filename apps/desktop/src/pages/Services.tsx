import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type Page, type ServiceDto } from '@victorflow/types';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, Table, Td, Th, useToast } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { blankService, fromService, ServiceForm, toCreatePayload, toUpdatePayload } from './ServiceForm';

export function Services() {
  const { can } = useAuth();
  const { t, label, fmt } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServiceDto | null>(null);

  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get<Page<ServiceDto>>('/services', { pageSize: 200 }) });

  const create = useMutation({
    mutationFn: (body: ReturnType<typeof toCreatePayload>) => api.post<ServiceDto>('/services', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); toast.ok(t('services.created')); setCreating(false); },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReturnType<typeof toUpdatePayload> }) => api.patch<ServiceDto>(`/services/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); toast.ok(t('services.updated')); setEditing(null); },
  });

  return (
    <div>
      <PageHeader
        title={t('services.title')}
        subtitle={t('services.subtitle')}
        actions={can(PERMISSIONS.SALES_SERVICE_WRITE) && <Button variant="primary" onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" />{t('services.new')}</Button>}
      />
      <Card>
        {services.isPending ? (
          <Loading />
        ) : services.isError ? (
          <div className="p-4"><ErrorBox error={services.error} onRetry={() => services.refetch()} /></div>
        ) : services.data.items.length === 0 ? (
          <Empty>{t('services.none')}</Empty>
        ) : (
          <Table>
            <thead><tr><Th>{t('services.code')}</Th><Th>{t('services.name')}</Th><Th>{t('services.pricingUnit')}</Th><Th>{t('services.priceRatio')}</Th><Th>{t('services.batchSize')}</Th><Th>{t('customers.status')}</Th><Th /></tr></thead>
            <tbody>
              {services.data.items.map((s) => (
                <tr key={s.id}>
                  <Td className="tabular text-muted">{s.code}</Td>
                  <Td className="font-semibold">{s.name}</Td>
                  <Td>{label('pricingUnit', s.pricingUnit)}</Td>
                  <Td className="tabular">{fmt.dzd(s.priceRatio)}</Td>
                  <Td className="tabular text-muted">{s.pricingUnit === 'per_item' ? fmt.qty(s.batchSize) : '—'}</Td>
                  <Td>{s.isActive ? <Badge tone="green">{t('services.active')}</Badge> : <Badge>{t('services.inactive')}</Badge>}</Td>
                  <Td>{can(PERMISSIONS.SALES_SERVICE_WRITE) && <Button size="sm" onClick={() => setEditing(s)}><Pencil aria-hidden className="size-3.5" />{t('common.edit')}</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {creating && (
        <Modal title={t('services.newTitle')} onClose={() => setCreating(false)}>
          <ServiceForm initial={blankService()} isEdit={false} submitLabel={t('services.create')} onCancel={() => setCreating(false)} onSubmit={async (v) => { await create.mutateAsync(toCreatePayload(v)); }} />
        </Modal>
      )}
      {editing && (
        <Modal title={editing.name} onClose={() => setEditing(null)}>
          <ServiceForm initial={fromService(editing)} isEdit submitLabel={t('common.save')} onCancel={() => setEditing(null)} onSubmit={async (v) => { await update.mutateAsync({ id: editing.id, body: toUpdatePayload(v) }); }} />
        </Modal>
      )}
    </div>
  );
}

