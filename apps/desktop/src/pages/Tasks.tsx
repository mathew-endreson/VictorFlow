import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, TASK_STATUSES, type Page, type TaskDto, type UserSummary } from '@victorflow/types';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, Pager, Select, StatusBadge, Table, Td, Th, useToast } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { TaskForm, toTaskPayload } from './TaskForm';

const PAGE_SIZE = 20;

export function Tasks() {
  const { can } = useAuth();
  const { t, status } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const canSeeAll = can(PERMISSIONS.WORKFORCE_TASK_READ_ALL);

  const users = useQuery({ queryKey: ['employees'], queryFn: () => api.get<UserSummary[]>('/users'), enabled: canSeeAll });
  const q = useQuery({
    queryKey: ['tasks', { page, statusFilter, assigneeFilter }],
    queryFn: () => api.get<Page<TaskDto>>('/workforce/tasks', { page, pageSize: PAGE_SIZE, ...(statusFilter ? { status: statusFilter } : {}), ...(assigneeFilter ? { assignedTo: assigneeFilter } : {}) }),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: (body: ReturnType<typeof toTaskPayload>) => api.post<TaskDto>('/workforce/tasks', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); toast.ok(t('tasks.created')); setCreating(false); },
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, taskStatus }: { id: string; taskStatus: string }) => api.patch<TaskDto>(`/workforce/tasks/${id}`, { status: taskStatus }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: toast.error,
  });

  const byId = new Map((users.data ?? []).map((u) => [u.id, u.fullName]));

  return (
    <div>
      <PageHeader
        title={t('tasks.title')}
        subtitle={t('tasks.subtitle')}
        actions={can(PERMISSIONS.WORKFORCE_TASK_CREATE) && <Button variant="primary" onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" />{t('tasks.new')}</Button>}
      />
      <Card>
        <div className="flex flex-wrap gap-2.5 border-b border-line p-3.5">
          <Select aria-label={t('tasks.filterStatus')} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="max-w-[12rem]">
            <option value="">{t('tasks.allStatuses')}</option>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{status(s)}</option>)}
          </Select>
          {canSeeAll && users.data && (
            <Select aria-label={t('tasks.filterAssignee')} value={assigneeFilter} onChange={(e) => { setAssigneeFilter(e.target.value); setPage(1); }} className="max-w-[14rem]">
              <option value="">{t('tasks.allAssignees')}</option>
              {users.data.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </Select>
          )}
        </div>
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <div className="p-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>
        ) : q.data.items.length === 0 ? (
          <Empty>{t('tasks.none')}</Empty>
        ) : (
          <>
            <Table>
              <thead><tr><Th>{t('tasks.title')}</Th><Th>{t('tasks.order')}</Th><Th>{t('tasks.assignedTo')}</Th><Th>{t('tasks.dueDate')}</Th><Th>{t('customers.status')}</Th></tr></thead>
              <tbody>
                {q.data.items.map((task) => (
                  <tr key={task.id}>
                    <Td className="font-semibold">{task.title}</Td>
                    <Td>{task.orderId ? <Link className="font-semibold text-brandfg hover:underline" to={`/orders/${task.orderId}`}>{t('tasks.viewOrder')}</Link> : '—'}</Td>
                    <Td>{task.assignedTo ? (byId.get(task.assignedTo) ?? '—') : t('tasks.unassigned')}</Td>
                    <Td className="text-muted">{task.dueDate ?? '—'}</Td>
                    <Td>
                      {can(PERMISSIONS.WORKFORCE_TASK_CREATE) ? (
                        <Select aria-label={t('customers.status')} value={task.status} onChange={(e) => updateStatus.mutate({ id: task.id, taskStatus: e.target.value })} className="h-8 py-1 text-xs">
                          {TASK_STATUSES.map((s) => <option key={s} value={s}>{status(s)}</option>)}
                        </Select>
                      ) : (
                        <StatusBadge status={task.status} />
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      {creating && (
        <Modal title={t('tasks.newTitle')} onClose={() => setCreating(false)}>
          <TaskForm users={users.data ?? []} submitLabel={t('tasks.create')} onCancel={() => setCreating(false)} onSubmit={async (v) => { await create.mutateAsync(toTaskPayload(v)); }} />
        </Modal>
      )}
    </div>
  );
}
