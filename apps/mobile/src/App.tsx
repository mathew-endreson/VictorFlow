import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoginScreen } from './screens/LoginScreen';
import { TaskScreen } from './screens/TaskScreen';
import { TasksScreen } from './screens/TasksScreen';
import { I18nProvider } from './i18n';
import { SessionProvider, useSession, type Session } from './session';
import type { LocalProof } from './sync/types';
import { useTaskSync } from './sync/useTaskSync';
import { usePalette } from './ui';

function Splash() {
  const c = usePalette();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
      <ActivityIndicator color={c.brand} size="large" />
    </View>
  );
}

function SignedIn({ session }: { session: Session }) {
  const { signOut } = useSession();
  const [openId, setOpenId] = useState<string | null>(null);
  const [proofs, setProofs] = useState<LocalProof[]>([]);
  const sync = useTaskSync(session, () => void signOut());

  // proofs of the open task, re-read whenever the list reloads (a photo is added or an upload finishes)
  useEffect(() => {
    if (!openId) return setProofs([]);
    void session.store.listProofs(openId).then(setProofs);
  }, [openId, session.store, sync.tasks, sync.syncing]);

  // Android hardware back: detail → list
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (openId) {
        setOpenId(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [openId]);

  const task = openId ? sync.tasks.find((t) => t.id === openId) : undefined;
  // a task that vanished (deleted / reassigned on the server) closes the detail view
  useEffect(() => {
    if (openId && !task && !sync.syncing && sync.tasks.length >= 0) setOpenId(null);
  }, [openId, task, sync.syncing, sync.tasks.length]);

  const reload = useCallback(async () => {
    await sync.reload();
    if (openId) setProofs(await session.store.listProofs(openId));
  }, [sync, openId, session.store]);

  if (task) return <TaskScreen key={task.id} session={session} task={task} proofs={proofs} onBack={() => setOpenId(null)} reload={reload} syncNow={sync.syncNow} />;
  return <TasksScreen session={session} sync={sync} onOpen={setOpenId} onSignOut={() => void signOut()} />;
}

function Root() {
  const { status, session } = useSession();
  if (status === 'loading') return <Splash />;
  return status === 'signed-in' && session ? <SignedIn session={session} /> : <LoginScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nProvider fallback={<Splash />}>
        <SessionProvider>
          <Root />
          <StatusBar style="auto" />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
