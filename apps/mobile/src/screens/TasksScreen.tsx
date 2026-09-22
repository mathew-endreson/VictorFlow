import { FlatList, RefreshControl, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TaskStatus } from '@victorflow/types';
import { useI18n } from '../i18n';
import type { Session } from '../session';
import type { SyncState } from '../sync/useTaskSync';
import type { TaskView } from '../sync/types';
import { Button, Card, LanguageSwitch, Monogram, Pill, usePalette } from '../ui';

export const statusTone = (s: TaskStatus) => (s === 'DONE' ? 'ok' : s === 'IN_PROGRESS' ? 'info' : s === 'BLOCKED' ? 'bad' : 'muted') as 'ok' | 'info' | 'bad' | 'muted';

function TaskCard({ task, onOpen }: { task: TaskView; onOpen: () => void }) {
  const c = usePalette();
  const { t, fmt, status } = useI18n();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('tasks.openTask', { title: task.title })} onPress={onOpen}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ color: c.ink, fontSize: 16, fontWeight: '700', flex: 1 }}>{task.title}</Text>
          <Pill text={status(task.status)} tone={statusTone(task.status)} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {task.dueDate && <Text style={{ color: c.muted, fontSize: 13 }}>{t('common.dueOn', { date: fmt.day(task.dueDate) })}</Text>}
          {Number(task.hoursLogged) > 0 && <Text style={{ color: c.muted, fontSize: 13 }}>{t('tasks.hours', { hours: Number(task.hoursLogged) })}</Text>}
          {task.pending && <Pill text={`⟳ ${t('tasks.pending')}`} tone="warn" />}
          {task.conflict && <Pill text={`⚠ ${t('tasks.conflict')}`} tone="bad" />}
          {task.rejected && <Pill text={`⚠ ${t('tasks.rejected')}`} tone="warn" />}
        </View>
      </Card>
    </Pressable>
  );
}

export function TasksScreen({ session, sync, onOpen, onSignOut }: { session: Session; sync: SyncState & { syncNow: () => Promise<void> }; onOpen: (id: string) => void; onSignOut: () => void }) {
  const c = usePalette();
  const { t, fmt, error: errorText } = useI18n();
  const message = sync.error ? (sync.error.kind === 'offline' ? t('sync.offline') : errorText(sync.error.cause) || t('sync.failed')) : sync.lastSyncAt ? t('tasks.lastSynced', { time: fmt.time(sync.lastSyncAt) }) : t('tasks.notSynced');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
            <Monogram width={40} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.ink, fontSize: 22, fontWeight: '800' }}>{t('tasks.title')}</Text>
              <Text style={{ color: c.muted }} numberOfLines={1}>{session.user.fullName}</Text>
            </View>
          </View>
          <Button label={t('common.signOut')} variant="secondary" onPress={onSignOut} />
        </View>
        <LanguageSwitch />

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ gap: 4, flex: 1 }}>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Pill text={sync.online ? `● ${t('tasks.online')}` : `○ ${t('tasks.offline')}`} tone={sync.online ? 'ok' : 'warn'} />
                {sync.pending > 0 && <Pill text={t('tasks.waiting', { count: sync.pending })} tone="warn" />}
                {sync.conflicts > 0 && <Pill text={t('tasks.conflicts', { count: sync.conflicts })} tone="bad" />}
              </View>
              <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={2}>{message}</Text>
            </View>
            <Button label={t('tasks.syncNow')} variant="secondary" onPress={() => void sync.syncNow()} busy={sync.syncing} />
          </View>
        </Card>
      </View>

      <FlatList
        data={sync.tasks}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}
        refreshControl={<RefreshControl refreshing={sync.syncing} onRefresh={() => void sync.syncNow()} tintColor={c.brand} />}
        renderItem={({ item }) => <TaskCard task={item} onOpen={() => onOpen(item.id)} />}
        ListEmptyComponent={<Text style={{ color: c.muted, textAlign: 'center', marginTop: 40 }}>{sync.syncing ? t('tasks.loading') : t('tasks.none')}</Text>}
      />
    </SafeAreaView>
  );
}
