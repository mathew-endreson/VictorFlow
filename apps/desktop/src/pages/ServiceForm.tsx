import { useState } from 'react';
import { PRICING_UNITS, type PricingUnit, type ServiceDto } from '@victorflow/types';
import { Button, Field, Input, Select } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';

export interface ServiceFormValues {
  code: string;
  name: string;
  pricingUnit: PricingUnit;
  priceRatio: string;
  batchSize: string;
  isActive: boolean;
}

export const blankService = (): ServiceFormValues => ({ code: '', name: '', pricingUnit: 'm2', priceRatio: '', batchSize: '1', isActive: true });

export const fromService = (s: ServiceDto): ServiceFormValues => ({ code: s.code, name: s.name, pricingUnit: s.pricingUnit, priceRatio: s.priceRatio, batchSize: s.batchSize, isActive: s.isActive });

/** Code and pricing unit are set once at creation and never change — a service priced differently is a
 * different service, so editing only ever touches name / price / batch size / active. */
export const toCreatePayload = (v: ServiceFormValues) => ({ code: v.code.trim(), name: v.name.trim(), pricingUnit: v.pricingUnit, priceRatio: v.priceRatio, batchSize: v.pricingUnit === 'per_item' ? v.batchSize : '1' });
export const toUpdatePayload = (v: ServiceFormValues) => ({ name: v.name.trim(), priceRatio: v.priceRatio, batchSize: v.pricingUnit === 'per_item' ? v.batchSize : '1', isActive: v.isActive });

export function ServiceForm({
  initial,
  isEdit,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ServiceFormValues;
  isEdit: boolean;
  submitLabel: string;
  onSubmit: (v: ServiceFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, label, error: errorText } = useI18n();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ServiceFormValues>(k: K, val: ServiceFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const fieldError = (name: string) => (error instanceof ApiError ? error.issues.find((i) => i.path === name)?.message : undefined);

  const ratioHint =
    v.pricingUnit === 'm2' ? t('serviceForm.priceRatioHintM2') : v.pricingUnit === 'per_linear_m' ? t('serviceForm.priceRatioHintPerLinearM') : t('serviceForm.priceRatioHintPerItem', { batch: v.batchSize || '1' });

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
    <form onSubmit={submit} className="space-y-5" aria-label={t('serviceForm.label')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('serviceForm.code')} required hint={!isEdit ? t('serviceForm.codeHint') : undefined} error={fieldError('code')}>
          {(id) => <Input id={id} dir="ltr" required disabled={isEdit} value={v.code} onChange={(e) => set('code', e.target.value)} autoFocus={!isEdit} />}
        </Field>
        <Field label={t('serviceForm.name')} required error={fieldError('name')}>{(id) => <Input id={id} required value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus={isEdit} />}</Field>
        <Field label={t('serviceForm.pricingUnit')} required hint={!isEdit ? t('serviceForm.pricingUnitHint') : undefined}>
          {(id) => (
            <Select id={id} disabled={isEdit} value={v.pricingUnit} onChange={(e) => set('pricingUnit', e.target.value as PricingUnit)}>
              {PRICING_UNITS.map((u) => <option key={u} value={u}>{label('pricingUnit', u)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('serviceForm.priceRatio')} required hint={ratioHint} error={fieldError('priceRatio')}>
          {(id) => <Input id={id} dir="ltr" inputMode="decimal" required value={v.priceRatio} onChange={(e) => set('priceRatio', e.target.value)} />}
        </Field>
        {v.pricingUnit === 'per_item' && (
          <Field label={t('serviceForm.batchSize')} required hint={t('serviceForm.batchSizeHint')} error={fieldError('batchSize')}>
            {(id) => <Input id={id} dir="ltr" inputMode="decimal" required value={v.batchSize} onChange={(e) => set('batchSize', e.target.value)} />}
          </Field>
        )}
      </div>

      {isEdit && (
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={v.isActive} onChange={(e) => set('isActive', e.target.checked)} className="size-4 accent-ink" />
          {t('serviceForm.active')}
        </label>
      )}

      {error != null && <p role="alert" className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad">{errorText(error)}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
