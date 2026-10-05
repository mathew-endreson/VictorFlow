import { Field, Input, Textarea } from '@/components/ui';
import { useI18n } from '@/i18n';
import type { CompanyFormValues } from '@/lib/company';

/** The company's details, as on the Company page and in the onboarding's company step. */
export function CompanyFields({ v, set, fieldError }: { v: CompanyFormValues; set: (k: keyof CompanyFormValues, val: string) => void; fieldError: (name: string) => string | undefined }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label={t('company.name')} required error={fieldError('name')}>{(id) => <Input id={id} required value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus />}</Field>
      </div>
      <Field label={t('customers.phone')} error={fieldError('phone')}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
      <Field label={t('common.email')} error={fieldError('email')}>{(id) => <Input id={id} dir="ltr" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />}</Field>
      <div className="sm:col-span-2">
        <Field label={t('customerForm.address')} error={fieldError('address')}>{(id) => <Textarea id={id} rows={3} value={v.address} onChange={(e) => set('address', e.target.value)} />}</Field>
      </div>
      <Field label={t('customerForm.nif')} error={fieldError('nif')}>{(id) => <Input id={id} dir="ltr" value={v.nif} onChange={(e) => set('nif', e.target.value)} />}</Field>
      <Field label={t('customerForm.nis')} error={fieldError('nis')}>{(id) => <Input id={id} dir="ltr" value={v.nis} onChange={(e) => set('nis', e.target.value)} />}</Field>
      <Field label={t('customerForm.rc')} error={fieldError('rc')}>{(id) => <Input id={id} dir="ltr" value={v.rc} onChange={(e) => set('rc', e.target.value)} />}</Field>
      <Field label={t('customerForm.ai')} error={fieldError('ai')}>{(id) => <Input id={id} dir="ltr" value={v.ai} onChange={(e) => set('ai', e.target.value)} />}</Field>
    </div>
  );
}
