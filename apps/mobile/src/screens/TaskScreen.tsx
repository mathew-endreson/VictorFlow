import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TASK_STATUSES, type TaskChanges, type TaskStatus } from '@victorflow/types';
import { useI18n } from '../i18n';
import type { Session } from '../session';
import { dismissRejected } from '../sync/engine';
import { newProofId, queueEdit, resolve } from '../sync/runtime';
import type { LocalProof, TaskView } from '../sync/types';
import { Button, Card, Field, Pill, usePalette } from '../ui';
import { statusTone } from './TasksScreen';

const HOURS = /^\d{1,4}(\.\d{1,2})?$/;

function ConflictPanel({ task, onResolve }: { task: TaskView; onResolve: (choice: 'server' | 'mine') => void }) {
  const c = usePalette();
  const { t, status } = useI18n();
  const item = task.conflict!;
  const server = item.conflict!;
  const hours = (v: string) => t('tasks.hours', { hours: Number(v) });
  const rows: Array<[string, string, string]> = [];
  if (item.changes.status !== undefined) rows.push([t('task.status'), status(item.changes.status), status(server.status)]);
  if (item.changes.hoursLogged !== undefined) rows.push([t('task.hoursTitle'), hours(item.changes.hoursLogged), hours(server.hoursLogged)]);
  if (item.changes.notes !== undefined) rows.push([t('common.notes'), item.changes.notes ?? '—', server.notes ?? '—']);
  return (
    <View style={{ borderWidth: 1, borderColor: c.bad, borderRadius: 12, padding: 14, gap: 10, backgroundColor: `${c.bad}14` }} accessibilityRole="alert">
      <Text style={{ color: c.bad, fontWeight: '800', fontSize: 16 }}>⚠ {t('conflict.title')}</Text>
      <Text style={{ color: c.ink }}>{t('conflict.body', { server: server.version, mine: item.baseVersion })}</Text>
      {rows.map(([label, mine, theirs]) => (
        <View key={label} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={{ color: c.muted, minWidth: 64 }}>{label}</Text>
          <View style={{ flex: 1 }}><Text style={{ color: c.muted, fontSize: 11 }}>{t('conflict.mine')}</Text><Text style={{ color: c.ink }}>{mine}</Text></View>
          <View style={{ flex: 1 }}><Text style={{ color: c.muted, fontSize: 11 }}>{t('conflict.server')}</Text><Text style={{ color: c.ink }}>{theirs}</Text></View>
        </View>
      ))}
      <View style={{ gap: 8 }}>
        <Button label={t('conflict.useServer')} variant="secondary" onPress={() => onResolve('server')} />
        <Button label={t('conflict.keepMine')} onPress={() => onResolve('mine')} />
      </View>
    </View>
  );
}

function RejectedPanel({ item, onDismiss }: { item: NonNullable<TaskView['rejected']>; onDismiss: () => void }) {
  const c = usePalette();
  const { t, locale } = useI18n();
  return (
    <View style={{ borderWidth: 1, borderColor: c.warn, borderRadius: 12, padding: 14, gap: 8, backgroundColor: `${c.warn}14` }} accessibilityRole="alert">
      <Text style={{ color: c.warn, fontWeight: '800', fontSize: 16 }}>⚠ {t('rejected.title')}</Text>
      <Text style={{ color: c.ink }}>{t('rejected.body')}</Text>
      {/* the server's own explanation is English text: shown only in English */}
      {locale === 'en' && item.error && <Text style={{ color: c.muted, fontSize: 12 }}>{item.error}</Text>}
      <Button label={t('rejected.dismiss')} variant="secondary" onPress={onDismiss} />
    </View>
  );
}

export function TaskScreen({ session, task, proofs, onBack, reload, syncNow }: { session: Session; task: TaskView; proofs: LocalProof[]; onBack: () => void; reload: () => Promise<void>; syncNow: () => Promise<void> }) {
  const c = usePalette();
  const { t, fmt, status: statusLabel, isRtl, locale, error: errorText } = useI18n();
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [hours, setHours] = useState(String(Number(task.hoursLogged)));
  const [notes, setNotes] = useState(task.notes ?? '');
  const [busy, setBusy] = useState(false);
  const blocked = Boolean(task.conflict);

  // When a conflict is resolved (or the server copy changes under us), re-seed the form from the task's current view.
  useEffect(() => {
    setStatus(task.status);
    setHours(String(Number(task.hoursLogged)));
    setNotes(task.notes ?? '');
  }, [task.status, task.hoursLogged, task.notes, task.version, task.conflict?.id]);

  const dirty = status !== task.status || hours !== String(Number(task.hoursLogged)) || notes !== (task.notes ?? '');
  const hoursOk = HOURS.test(hours);

  async function save() {
    if (!hoursOk) return Alert.alert(t('task.hoursTitle'), t('task.hoursInvalid'));
    const changes: TaskChanges = {};
    if (status !== task.status) changes.status = status;
    if (hours !== String(Number(task.hoursLogged))) changes.hoursLogged = hours;
    if (notes !== (task.notes ?? '')) changes.notes = notes.trim() === '' ? null : notes;
    setBusy(true);
    try {
      await queueEdit(session.store, task.id, changes); // instant, works offline
      await reload();
      void syncNow(); // best effort: if there is no network it simply stays queued
    } catch (e) {
      Alert.alert(t('task.saveFailed'), errorText(e) || t('task.unknownError'));
    } finally {
      setBusy(false);
    }
  }

  async function attachPhoto() {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) return Alert.alert(t('task.cameraTitle'), t('task.cameraNeeded'));
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (shot.canceled || !shot.assets[0]) return;
    const asset = shot.assets[0];

    // GPS is best-effort: a photo without coordinates is still a valid proof.
    let latitude: number | null = null;
    let longitude: number | null = null;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        latitude = pos.coords.latitude;
        longitude = pos.coords.longitude;
      }
    } catch {
      /* no GPS fix — carry on */
    }

    // The camera's file lives in a cache that can be purged; keep our own copy until it has been uploaded.
    const id = newProofId();
    const mime = asset.mimeType ?? 'image/jpeg';
    const dest = new File(Paths.document, `proof-${id}.${mime === 'image/png' ? 'png' : 'jpg'}`);
    new File(asset.uri).copy(dest);
    await session.store.putProof({ id, taskId: task.id, fileUri: dest.uri, mimeType: mime, latitude, longitude, capturedAt: new Date().toISOString(), status: 'PENDING', error: null, remote: null });
    await reload();
    void syncNow();
  }

  const proofLabel = (p: LocalProof) => t(p.status === 'UPLOADED' ? 'task.proof.UPLOADED' : p.status === 'FAILED' ? 'task.proof.FAILED' : 'task.proof.PENDING');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Button label={`${isRtl ? '→' : '←'} ${t('task.back')}`} variant="secondary" onPress={onBack} />
        <View style={{ gap: 6 }}>
          <Text style={{ color: c.ink, fontSize: 22, fontWeight: '800' }}>{task.title}</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pill text={statusLabel(task.status)} tone={statusTone(task.status)} />
            {task.dueDate && <Pill text={t('common.dueOn', { date: fmt.day(task.dueDate) })} tone="muted" />}
            {task.pending && <Pill text={`⟳ ${t('tasks.pending')}`} tone="warn" />}
          </View>
          {task.description && <Text style={{ color: c.muted }}>{task.description}</Text>}
        </View>

        {task.rejected && (
          <RejectedPanel
            item={task.rejected}
            onDismiss={async () => {
              await dismissRejected(session.store, task.rejected!.id);
              await reload();
            }}
          />
        )}

        {task.conflict && (
          <ConflictPanel
            task={task}
            onResolve={async (choice) => {
              await resolve(session.store, task.conflict!.id, choice);
              await reload();
              if (choice === 'mine') void syncNow();
            }}
          />
        )}

        <Card>
          <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>{t('task.status')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TASK_STATUSES.map((s) => (
              <Button key={s} label={statusLabel(s)} variant={status === s ? 'primary' : 'secondary'} disabled={blocked} onPress={() => setStatus(s)} />
            ))}
          </View>
          <Field label={t('task.hoursWorked')} ltr value={hours} onChangeText={setHours} keyboardType="decimal-pad" editable={!blocked} />
          <Field label={t('common.notes')} value={notes} onChangeText={setNotes} multiline editable={!blocked} />
          <Button label={dirty ? t('task.save') : t('task.saved')} onPress={save} disabled={!dirty || blocked || !hoursOk} busy={busy} />
        </Card>

        <Card>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{t('task.photos')}</Text>
          {proofs.length === 0 && <Text style={{ color: c.muted }}>{t('task.noPhotos')}</Text>}
          {proofs.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              {p.fileUri ? <Image source={{ uri: p.fileUri }} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: c.line }} /> : <View style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: c.line }} />}
              <View style={{ flex: 1, gap: 3 }}>
                <Pill text={proofLabel(p)} tone={p.status === 'UPLOADED' ? 'ok' : p.status === 'FAILED' ? 'bad' : 'warn'} />
                <Text style={{ color: c.muted, fontSize: 12, writingDirection: 'ltr', textAlign: isRtl ? 'right' : 'left' }}>{p.latitude !== null && p.longitude !== null ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` : t('task.noGps')}</Text>
                {p.status === 'FAILED' && <Text style={{ color: c.bad, fontSize: 12 }}>{t('task.proof.refused')}{locale === 'en' && p.error ? ` ${p.error}` : ''}</Text>}
              </View>
            </View>
          ))}
          <Button label={`📷 ${t('task.attach')}`} variant="secondary" onPress={attachPhoto} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
