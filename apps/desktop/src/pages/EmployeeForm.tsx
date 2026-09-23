import { useState } from 'react';
import type { RoleSummary, UserSummary } from '@victorflow/types';
import { Button, Field, Input } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';

export interface EmployeeFormValues {
  email: string;
  fullName: string;
  password: string;
  roles: string[];
  isActive: boolean;
}

export const blankEmployee = (): EmployeeFormValues => ({ email: '', fullName: '', password: '', roles: [], isActive: true });

export const fromEmployee = (u: UserSummary): EmployeeFormValues => ({ email: u.email, fullName: u.fullName, password: '', roles: [...u.roles], isActive: u.isActive });

/** Create sends every field; edit only ever sends what a supervisor would plausibly change, and drops an
 * empty password rather than resetting it. */
export function toCreatePayload(v: EmployeeFormValues) {
  return { email: v.email.trim(), fullName: v.fullName.trim(), password: v.password, roles: v.roles };
}
export function toUpdatePayload(v: EmployeeFormValues) {
  return { fullName: v.fullName.trim(), roles: v.roles, isActive: v.isActive, ...(v.password ? { password: v.password } : {}) };
}

export function EmployeeForm({
  initial,
  roles,
  isEdit,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: EmployeeFormValues;
  roles: RoleSummary[];
  isEdit: boolean;
  submitLabel: string;
  onSubmit: (v: EmployeeFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, label, error: errorText } = useI18n();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EmployeeFormValues>(k: K, val: EmployeeFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const fieldError = (name: string) => (error instanceof ApiError ? error.issues.find((i) => i.path === name)?.message : undefined);
  const toggleRole = (code: string) => set('roles', v.roles.includes(code) ? v.roles.filter((r) => r !== code) : [...v.roles, code]);

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
    <form onSubmit={submit} className="space-y-5" aria-label={t('employeeForm.label')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t('employeeForm.fullName')} required error={fieldError('fullName')}>{(id) => <Input id={id} required value={v.fullName} onChange={(e) => set('fullName', e.target.value)} autoFocus />}</Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t('common.email')} required error={fieldError('email')}>{(id) => <Input id={id} dir="ltr" type="email" required disabled={isEdit} value={v.email} onChange={(e) => set('email', e.target.value)} />}</Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={isEdit ? t('employeeForm.newPassword') : t('employeeForm.password')} required={!isEdit} hint={isEdit ? t('employeeForm.passwordHint') : undefined} error={fieldError('password')}>
            {(id) => <Input id={id} dir="ltr" type="password" required={!isEdit} minLength={8} value={v.password} onChange={(e) => set('password', e.target.value)} />}
          </Field>
        </div>
      </div>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1.5 text-xs font-bold text-muted">{t('employeeForm.roles')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {roles.map((r) => (
            <label key={r.code} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition hover:bg-surface2">
              <input type="checkbox" checked={v.roles.includes(r.code)} onChange={() => toggleRole(r.code)} className="size-4 accent-ink" />
              {label('role', r.code)}
            </label>
          ))}
        </div>
        {fieldError('roles') && <p className="mt-1.5 text-xs text-bad">{fieldError('roles')}</p>}
      </fieldset>

      {isEdit && (
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={v.isActive} onChange={(e) => set('isActive', e.target.checked)} className="size-4 accent-ink" />
          {t('employeeForm.active')}
        </label>
      )}

      {error != null && <p role="alert" className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad">{errorText(error)}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={v.roles.length === 0}>{submitLabel}</Button>
      </div>
    </form>
  );
}
