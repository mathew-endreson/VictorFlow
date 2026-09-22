import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type ContactDto, type CustomerDetailDto, type CustomerDto, type OrderSummaryDto, type Page } from '@victorflow/types';
import { ArrowLeft, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorBox, Eyebrow, FLIP, Field, Input, Loading, Ltr, Modal, PageHeader, StatusBadge, Table, Td, Th, cx, useToast } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CustomerForm, fromCustomer, toPayload } from './CustomerForm';

function ContactForm({ customerId, contact, onDone }: { customerId: string; contact?: ContactDto; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t, error: errorText } = useI18n();
  const [v, setV] = useState({ fullName: contact?.fullName ?? '', jobTitle: contact?.jobTitle ?? '', phone: contact?.phone ?? '', email: contact?.email ?? '', isPrimary: contact?.isPrimary ?? false });
  const save = useMutation({
    mutationFn: () => (contact ? api.patch(`/contacts/${contact.id}`, v) : api.post(`/customers/${customerId}/contacts`, v)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', customerId] });
      toast.ok(contact ? t('customer.contactUpdated') : t('customer.contactAdded'));
      onDone();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label={t('customer.fullName')} required>{(id) => <Input id={id} required value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} autoFocus />}</Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('customer.jobTitle')}>{(id) => <Input id={id} value={v.jobTitle} onChange={(e) => setV({ ...v, jobTitle: e.target.value })} />}</Field>
        <Field label={t('customers.phone')}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
      </div>
      <Field label={t('common.email')}>{(id) => <Input id={id} dir="ltr" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--brand)]" checked={v.isPrimary} onChange={(e) => setV({ ...v, isPrimary: e.target.checked })} /> {t('customer.primaryContact')}</label>
      {save.isError && <p role="alert" className="text-sm text-bad">{errorText(save.error)}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>{t('customer.saveContact')}</Button>
      </div>
    </form>
  );
}

export function CustomerDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { t, fmt, label } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<ContactDto | 'new' | null>(null);

  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<CustomerDetailDto>(`/customers/${id}`) });
  const orders = useQuery({
    queryKey: ['orders', { customerId: id }],
    queryFn: () => api.get<Page<OrderSummaryDto>>('/orders', { customerId: id, pageSize: 10 }),
    enabled: can(PERMISSIONS.SALES_ORDER_READ),
  });

  const update = useMutation({
    mutationFn: (body: ReturnType<typeof toPayload>) => api.patch<CustomerDto>(`/customers/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.ok(t('customer.saved'));
      setEditing(false);
    },
  });
  const removeContact = useMutation({
    mutationFn: (cid: string) => api.del(`/contacts/${cid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer', id] }),
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/customers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.ok(t('customer.deleted'));
      nav('/customers');
    },
    onError: (e) => toast.error(e), // 409 when the customer has orders/invoices — the message explains
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const canWrite = can(PERMISSIONS.CRM_CUSTOMER_WRITE);
  const ltrValue = (v: string | null) => (v ? <Ltr>{v}</Ltr> : null);
  const info: Array<[string, ReturnType<typeof ltrValue> | string]> = [
    [t('customers.type'), label('customerType', c.customerType)], [t('customers.phone'), ltrValue(c.phone)], [t('common.email'), ltrValue(c.email)],
    [t('customers.wilaya'), c.wilaya ?? ''], [t('customerForm.city'), c.city ?? ''], [t('customerForm.address'), c.address ?? ''],
    [t('customerForm.nif'), ltrValue(c.nif)], [t('customerForm.nis'), ltrValue(c.nis)], [t('customerForm.rc'), ltrValue(c.rc)], [t('customerForm.ai'), ltrValue(c.ai)],
  ];

  return (
    <div>
      <PageHeader
        title={c.name}
        subtitle={<span className="flex items-center gap-2"><Ltr className="tabular">{c.code}</Ltr> {c.isActive ? <Badge tone="green">{t('customers.active')}</Badge> : <Badge>{t('customers.inactive')}</Badge>}</span>}
        actions={
          <>
            <Link to="/customers" className="me-1 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft aria-hidden className={cx('size-4', FLIP)} />{t('customer.allCustomers')}</Link>
            {canWrite && <Button onClick={() => setEditing(true)}><Pencil aria-hidden className="size-3.5" />{t('common.edit')}</Button>}
            {can(PERMISSIONS.SALES_ORDER_WRITE) && <Button variant="primary" onClick={() => nav(`/orders/new?customerId=${c.id}`)}><Plus aria-hidden className="size-4" />{t('customer.newOrder')}</Button>}
            {can(PERMISSIONS.CRM_CUSTOMER_DELETE) && <Button variant="danger" loading={remove.isPending} onClick={() => confirm(t('customer.confirmDelete', { name: c.name })) && remove.mutate()}><Trash2 aria-hidden className="size-3.5" />{t('common.delete')}</Button>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <Eyebrow>{t('customer.details')}</Eyebrow>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
            {info.map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 font-semibold">{v || '—'}</dd></div>
            ))}
          </dl>
          {Object.keys(c.customFields).length > 0 && (
            <>
              <Eyebrow className="mt-6">{t('customerForm.customFields')}</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {Object.entries(c.customFields).map(([k, v]) => <Badge key={k} tone="blue">{k}: {String(v)}</Badge>)}
              </div>
            </>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-3 flex items-center justify-between">
            <Eyebrow className="mb-0">{t('customer.contacts')}</Eyebrow>
            {canWrite && <Button size="sm" onClick={() => setContact('new')}><Plus aria-hidden className="size-3.5" />{t('common.add')}</Button>}
          </div>
          {c.contacts.length === 0 ? <p className="text-sm text-muted">{t('customer.noContacts')}</p> : (
            <ul className="divide-y divide-line">
              {c.contacts.map((ct) => (
                <li key={ct.id} className="flex items-start justify-between gap-2 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">{ct.fullName} {ct.isPrimary && <Badge tone="blue">{t('customer.primary')}</Badge>}</div>
                    <div className="mt-0.5 break-words text-xs text-muted">{[ct.jobTitle, ct.phone, ct.email].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setContact(ct)}>{t('common.edit')}</Button>
                      <Button size="sm" variant="ghost" aria-label={t('common.remove')} onClick={() => confirm(t('customer.confirmRemoveContact', { name: ct.fullName })) && removeContact.mutate(ct.id)}><X aria-hidden className="size-4" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {can(PERMISSIONS.SALES_ORDER_READ) && (
        <Card className="mt-4">
          <div className="border-b border-line px-6 py-3.5 text-sm font-bold">{t('customer.recentOrders')}</div>
          {orders.isPending ? <Loading /> : !orders.data || orders.data.items.length === 0 ? <Empty>{t('customer.noOrders')}</Empty> : (
            <Table>
              <thead><tr><Th>{t('orders.number')}</Th><Th>{t('orders.date')}</Th><Th>{t('orders.status')}</Th><Th num>{t('orders.totalTtc')}</Th></tr></thead>
              <tbody>
                {orders.data.items.map((o) => (
                  <tr key={o.id} className="cursor-pointer transition hover:bg-surface2" onClick={() => nav(`/orders/${o.id}`)}>
                    <Td className="tabular font-semibold"><Ltr>{o.number}</Ltr></Td><Td className="whitespace-nowrap">{fmt.day(o.orderDate)}</Td><Td><StatusBadge status={o.status} /></Td><Td num>{fmt.dzd(o.totalTtc)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {editing && (
        <Modal title={t('customer.editTitle', { name: c.name })} wide onClose={() => setEditing(false)}>
          <CustomerForm initial={fromCustomer(c)} submitLabel={t('customer.saveChanges')} onCancel={() => setEditing(false)} onSubmit={async (v) => { await update.mutateAsync(toPayload(v)); }} />
        </Modal>
      )}
      {contact && (
        <Modal title={contact === 'new' ? t('customer.addContact') : t('customer.editContact')} onClose={() => setContact(null)}>
          <ContactForm customerId={id} contact={contact === 'new' ? undefined : contact} onDone={() => setContact(null)} />
        </Modal>
      )}
    </div>
  );
}
