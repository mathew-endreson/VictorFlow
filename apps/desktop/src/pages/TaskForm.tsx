import { useState } from 'react';
import type { UserSummary } from '@victorflow/types';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';

export interface TaskFormValues {
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
}

export const blankTask = (): TaskFormValues => ({ title: '', description: '', assignedTo: '', dueDate: '' });

export function toTaskPayload(v: TaskFormValues, orderId?: string) {
  return {
    title: v.title.trim(),
    description: v.description.trim() || null,
    assignedTo: v.assignedTo || null,
    dueDate: v.dueDate || null,
    ...(orderId ? { orderId } : {}),
  };
}

/** Shared by the standalone Tasks page (no order context) and Order Detail's Tasks tab (orderId implied by the page, not re-picked here). */
export function TaskForm({ users, submitLabel, onSubmit, onCancel }: { users: UserSummary[]; submitLabel: string; onSubmit: (v: TaskFormValues) => Promise<void>; onCancel: () => void }) {
  const { t, error: errorText } = useI18n();
  const [v, setV] = useState(blankTask());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TaskFormValues>(k: K, val: TaskFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
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
    <form onSubmit={submit} className="space-y-4" aria-label={t('taskForm.label')}>
      <Field label={t('tasks.title')} required error={fieldError('title')}>{(id) => <Input id={id} required value={v.title} onChange={(e) => set('title', e.target.value)} autoFocus />}</Field>
      <Field label={t('common.notes')}>{(id) => <Textarea id={id} value={v.description} onChange={(e) => set('description', e.target.value)} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('tasks.assignedTo')}>
          {(id) => (
            <Select id={id} value={v.assignedTo} onChange={(e) => set('assignedTo', e.target.value)}>
              <option value="">{t('tasks.unassigned')}</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('tasks.dueDate')} error={fieldError('dueDate')}>{(id) => <Input id={id} type="date" value={v.dueDate} onChange={(e) => set('dueDate', e.target.value)} />}</Field>
      </div>

      {error != null && <p role="alert" className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad">{errorText(error)}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
