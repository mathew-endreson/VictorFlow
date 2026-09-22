import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { CustomerDto } from '@victorflow/types';
import { Button, Field, Input, Select } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';

export interface CustomerFormValues {
  name: string;
  customerType: 'COMPANY' | 'INDIVIDUAL';
  phone: string;
  email: string;
  wilaya: string;
  city: string;
  address: string;
  nif: string;
  nis: string;
  rc: string;
  ai: string;
  customFields: Array<{ key: string; value: string }>;
}

export const blankCustomer = (): CustomerFormValues => ({ name: '', customerType: 'COMPANY', phone: '', email: '', wilaya: '', city: '', address: '', nif: '', nis: '', rc: '', ai: '', customFields: [] });

export const fromCustomer = (c: CustomerDto): CustomerFormValues => ({
  name: c.name,
  customerType: c.customerType,
  phone: c.phone ?? '', email: c.email ?? '', wilaya: c.wilaya ?? '', city: c.city ?? '', address: c.address ?? '',
  nif: c.nif ?? '', nis: c.nis ?? '', rc: c.rc ?? '', ai: c.ai ?? '',
  customFields: Object.entries(c.customFields).map(([key, value]) => ({ key, value: String(value ?? '') })),
});

/** '' → null clears a field on the server; keys with no name are dropped. */
export function toPayload(v: CustomerFormValues) {
  const cf: Record<string, string> = {};
  for (const { key, value } of v.customFields) if (key.trim()) cf[key.trim()] = value;
  const opt = (s: string) => s.trim();
  return {
    name: v.name.trim(),
    customerType: v.customerType,
    phone: opt(v.phone), email: opt(v.email), wilaya: opt(v.wilaya), city: opt(v.city), address: opt(v.address),
    nif: opt(v.nif), nis: opt(v.nis), rc: opt(v.rc), ai: opt(v.ai),
    customFields: cf,
  };
}

export function CustomerForm({ initial, submitLabel, onSubmit, onCancel }: { initial: CustomerFormValues; submitLabel: string; onSubmit: (v: CustomerFormValues) => Promise<void>; onCancel: () => void }) {
  const { t, label, error: errorText } = useI18n();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof CustomerFormValues>(k: K, val: CustomerFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const fieldError = (name: string) => (error instanceof ApiError ? error.issues.find((i) => i.path === name)?.message : undefined);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(v);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" aria-label={t('customerForm.label')}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label={t('customers.name')} required error={fieldError('name')}>{(id) => <Input id={id} required value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus />}</Field>
        </div>
        <Field label={t('customers.type')}>
          {(id) => (
            <Select id={id} value={v.customerType} onChange={(e) => set('customerType', e.target.value as CustomerFormValues['customerType'])}>
              <option value="COMPANY">{label('customerType', 'COMPANY')}</option>
              <option value="INDIVIDUAL">{label('customerType', 'INDIVIDUAL')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('customers.phone')} error={fieldError('phone')}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
        <div className="sm:col-span-2">
          <Field label={t('common.email')} error={fieldError('email')}>{(id) => <Input id={id} dir="ltr" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />}</Field>
        </div>
        <Field label={t('customers.wilaya')}>{(id) => <Input id={id} value={v.wilaya} onChange={(e) => set('wilaya', e.target.value)} />}</Field>
        <Field label={t('customerForm.city')}>{(id) => <Input id={id} value={v.city} onChange={(e) => set('city', e.target.value)} />}</Field>
        <Field label={t('customerForm.address')}>{(id) => <Input id={id} value={v.address} onChange={(e) => set('address', e.target.value)} />}</Field>
        <Field label={t('customerForm.nif')}>{(id) => <Input id={id} dir="ltr" value={v.nif} onChange={(e) => set('nif', e.target.value)} />}</Field>
        <Field label={t('customerForm.nis')}>{(id) => <Input id={id} dir="ltr" value={v.nis} onChange={(e) => set('nis', e.target.value)} />}</Field>
        <Field label={t('customerForm.rc')}>{(id) => <Input id={id} dir="ltr" value={v.rc} onChange={(e) => set('rc', e.target.value)} />}</Field>
        <Field label={t('customerForm.ai')}>{(id) => <Input id={id} dir="ltr" value={v.ai} onChange={(e) => set('ai', e.target.value)} />}</Field>
      </div>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1.5 text-xs font-bold text-muted">{t('customerForm.customFields')}</legend>
        {v.customFields.map((f, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <Input aria-label={t('customerForm.fieldName')} placeholder={t('customerForm.fieldNamePlaceholder')} value={f.key} onChange={(e) => set('customFields', v.customFields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
            <Input aria-label={t('customerForm.fieldValue')} placeholder={t('customerForm.fieldValuePlaceholder')} value={f.value} onChange={(e) => set('customFields', v.customFields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" className="h-9" aria-label={t('customerForm.removeField')} onClick={() => set('customFields', v.customFields.filter((_, j) => j !== i))}><X aria-hidden className="size-4" /></Button>
          </div>
        ))}
        <Button size="sm" onClick={() => set('customFields', [...v.customFields, { key: '', value: '' }])}><Plus aria-hidden className="size-3.5" />{t('customerForm.addField')}</Button>
      </fieldset>

      {error != null && <p role="alert" className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad">{errorText(error)}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
