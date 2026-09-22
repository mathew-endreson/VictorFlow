import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { defaultApiUrl } from '../config';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { ByCreative, Button, Card, Field, LanguageSwitch, Monogram, usePalette } from '../ui';

export function LoginScreen() {
  const c = usePalette();
  const { t, error: errorText } = useI18n();
  const { signIn, lastApiUrl } = useSession();
  const [apiUrl, setApiUrl] = useState(lastApiUrl ?? defaultApiUrl());
  const [email, setEmail] = useState('field@victorflow.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn(apiUrl.trim(), email.trim(), password);
    } catch (e) {
      setError(e instanceof Error && e.name === 'NetworkError' ? t('login.unreachable', { url: apiUrl }) : errorText(e, { login: true }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ alignSelf: 'flex-end' }}>
            <LanguageSwitch />
          </View>
          <View style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Monogram width={84} />
            <Text style={{ color: c.ink, fontSize: 26, fontWeight: '800' }}>VictorFlow</Text>
            <ByCreative size={11} />
            <Text style={{ color: c.muted, marginTop: 2 }}>{t('login.subtitle')}</Text>
          </View>
          <Card>
            <Field label={t('login.serverUrl')} ltr value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Field label={t('common.email')} ltr value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
            <Field label={t('common.password')} ltr value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" onSubmitEditing={submit} />
            {error && <Text accessibilityRole="alert" style={{ color: c.bad }}>{error}</Text>}
            <Button label={t('common.signIn')} onPress={submit} busy={busy} disabled={!email || !password} />
          </Card>
          <Text style={{ color: c.muted, textAlign: 'center', fontSize: 12 }}>
            {t('login.devSeed')} <Text style={{ writingDirection: 'ltr' }}>field@victorflow.local / Admin123!</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
