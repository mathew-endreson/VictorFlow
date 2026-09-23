import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type AttendanceDto, type Page, type RoleSummary, type UserSummary } from '@victorflow/types';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, cx, Empty, ErrorBox, Loading, Ltr, Modal, PageHeader, Table, Td, Th, useToast } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AttendanceForm } from './AttendanceForm';
import { blankEmployee, EmployeeForm, fromEmployee, toCreatePayload, toUpdatePayload } from './EmployeeForm';

type Tab = 'staff' | 'attendance';

export function Employees() {
  const { can } = useAuth();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('staff');

  return (
    <div>
      <PageHeader title={t('employees.title')} subtitle={t('employees.subtitle')} />
      <div className="mb-4 flex gap-1.5 border-b border-line">
        <button type="button" onClick={() => setTab('staff')} className={cx('border-b-2 px-3.5 py-2.5 text-sm font-semibold transition', tab === 'staff' ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>{t('employees.staffTab')}</button>
        {can(PERMISSIONS.WORKFORCE_ATTENDANCE_READ) && (
          <button type="button" onClick={() => setTab('attendance')} className={cx('border-b-2 px-3.5 py-2.5 text-sm font-semibold transition', tab === 'attendance' ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>{t('employees.attendanceTab')}</button>
        )}
      </div>
      {tab === 'staff' ? <StaffRoster /> : <Attendance />}
    </div>
  );
}

function StaffRoster() {
  const { can } = useAuth();
  const { t, label, fmt } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserSummary | null>(null);

  const users = useQuery({ queryKey: ['employees'], queryFn: () => api.get<UserSummary[]>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleSummary[]>('/roles') });

  const create = useMutation({
    mutationFn: (body: ReturnType<typeof toCreatePayload>) => api.post<UserSummary>('/users', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast.ok(t('employees.created')); setCreating(false); },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReturnType<typeof toUpdatePayload> }) => api.patch<UserSummary>(`/users/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast.ok(t('employees.updated')); setEditing(null); },
  });

  if (users.isPending || roles.isPending) return <Loading />;
  if (users.isError) return <ErrorBox error={users.error} onRetry={() => users.refetch()} />;
  if (roles.isError) return <ErrorBox error={roles.error} onRetry={() => roles.refetch()} />;

  return (
    <div>
      <div className="mb-4 flex justify-end">
        {can(PERMISSIONS.CORE_USER_MANAGE) && <Button variant="primary" onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" />{t('employees.new')}</Button>}
      </div>
      <Card>
        {users.data.length === 0 ? (
          <Empty>{t('employees.none')}</Empty>
        ) : (
          <Table>
            <thead><tr><Th>{t('employeeForm.fullName')}</Th><Th>{t('common.email')}</Th><Th>{t('employees.rolesCol')}</Th><Th>{t('employees.lastLogin')}</Th><Th>{t('customers.status')}</Th><Th /></tr></thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <Td className="font-semibold">{u.fullName}</Td>
                  <Td><Ltr>{u.email}</Ltr></Td>
                  <Td><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r}>{label('role', r)}</Badge>)}</div></Td>
                  <Td className="text-muted">{u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : '—'}</Td>
                  <Td>{u.isActive ? <Badge tone="green">{t('customers.active')}</Badge> : <Badge>{t('customers.inactive')}</Badge>}</Td>
                  <Td>{can(PERMISSIONS.CORE_USER_MANAGE) && <Button size="sm" onClick={() => setEditing(u)}><Pencil aria-hidden className="size-3.5" />{t('common.edit')}</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {creating && (
        <Modal title={t('employees.newTitle')} wide onClose={() => setCreating(false)}>
          <EmployeeForm initial={blankEmployee()} roles={roles.data} isEdit={false} submitLabel={t('employees.create')} onCancel={() => setCreating(false)} onSubmit={async (v) => { await create.mutateAsync(toCreatePayload(v)); }} />
        </Modal>
      )}
      {editing && (
        <Modal title={editing.fullName} wide onClose={() => setEditing(null)}>
          <EmployeeForm initial={fromEmployee(editing)} roles={roles.data} isEdit submitLabel={t('common.save')} onCancel={() => setEditing(null)} onSubmit={async (v) => { await update.mutateAsync({ id: editing.id, body: toUpdatePayload(v) }); }} />
        </Modal>
      )}
    </div>
  );
}

function Attendance() {
  const { can } = useAuth();
  const { t, fmt } = useI18n();
  const qc = useQueryClient();
  const [recording, setRecording] = useState(false);

  const users = useQuery({ queryKey: ['employees'], queryFn: () => api.get<UserSummary[]>('/users') });
  const rows = useQuery({ queryKey: ['attendance'], queryFn: () => api.get<Page<AttendanceDto>>('/workforce/attendance', { page: 1, pageSize: 50 }) });
  const byId = new Map((users.data ?? []).map((u) => [u.id, u.fullName]));

  const record = useMutation({
    mutationFn: (body: unknown) => api.post<AttendanceDto>('/workforce/attendance', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['attendance'] }); setRecording(false); },
  });

  if (rows.isPending || users.isPending) return <Loading />;
  if (rows.isError) return <ErrorBox error={rows.error} onRetry={() => rows.refetch()} />;

  return (
    <div>
      <div className="mb-4 flex justify-end">
        {can(PERMISSIONS.WORKFORCE_ATTENDANCE_RECORD) && <Button variant="primary" onClick={() => setRecording(true)}><Plus aria-hidden className="size-4" />{t('attendance.new')}</Button>}
      </div>
      <Card>
        {rows.data.items.length === 0 ? (
          <Empty>{t('attendance.none')}</Empty>
        ) : (
          <Table>
            <thead><tr><Th>{t('employeeForm.fullName')}</Th><Th>{t('attendance.date')}</Th><Th>{t('attendance.clockIn')}</Th><Th>{t('attendance.clockOut')}</Th><Th>{t('common.notes')}</Th></tr></thead>
            <tbody>
              {rows.data.items.map((a) => (
                <tr key={a.id}>
                  <Td className="font-semibold">{byId.get(a.userId) ?? '—'}</Td>
                  <Td>{fmt.day(a.date)}</Td>
                  <Td>{a.clockIn ? fmt.dateTime(a.clockIn) : '—'}</Td>
                  <Td>{a.clockOut ? fmt.dateTime(a.clockOut) : '—'}</Td>
                  <Td className="text-muted">{a.notes ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {recording && users.data && (
        <Modal title={t('attendance.newTitle')} onClose={() => setRecording(false)}>
          <AttendanceForm users={users.data} onCancel={() => setRecording(false)} onSubmit={async (body) => { await record.mutateAsync(body); }} />
        </Modal>
      )}
    </div>
  );
}
