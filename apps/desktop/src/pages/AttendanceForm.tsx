import { useState } from 'react';
import type { UserSummary } from '@victorflow/types';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';

const today = () => new Date().toISOString().slice(0, 10);
const nowLocal = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function AttendanceForm({ users, onCancel, onSubmit }: { users: UserSummary[]; onCancel: () => void; onSubmit: (body: unknown) => Promise<void> }) {
  const { t, error: errorText } = useI18n();
  const [userId, setUserId] = useState(users[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const [clockIn, setClockIn] = useState(nowLocal());
  const [clockOut, setClockOut] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fieldError = (name: string) => (error instanceof ApiError ? error.issues.find((i) => i.path === name)?.message : undefined);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        userId,
        date,
        clockIn: clockIn ? new Date(clockIn).toISOString() : null,
        clockOut: clockOut ? new Date(clockOut).toISOString() : null,
        notes: notes.trim() || null,
      });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label={t('attendanceForm.label')}>
      <Field label={t('employeeForm.fullName')} required>
        {(id) => (
          <Select id={id} required value={userId} onChange={(e) => setUserId(e.target.value)}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
        )}
      </Field>
      <Field label={t('attendance.date')} required error={fieldError('date')}>{(id) => <Input id={id} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('attendance.clockIn')} error={fieldError('clockIn')}>{(id) => <Input id={id} dir="ltr" type="datetime-local" value={clockIn} onChange={(e) => setClockIn(e.target.value)} />}</Field>
        <Field label={t('attendance.clockOut')} error={fieldError('clockOut')}>{(id) => <Input id={id} dir="ltr" type="datetime-local" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />}</Field>
      </div>
      <Field label={t('common.notes')}>{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>

      {error != null && <p role="alert" className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad">{errorText(error)}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={busy}>{t('attendance.record')}</Button>
      </div>
    </form>
  );
}
