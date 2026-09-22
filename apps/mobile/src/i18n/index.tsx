import { reloadAppAsync } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import { LOCALE_META, createFormatters, createTranslator, isLocale, localizeError, negotiateLocale, sharedAr, sharedEn, type Formatters, type Locale, type MessageKey, type MessageParams } from '@victorflow/i18n';
import { AuthError, HttpError } from '../api/client';
import { ConflictBlockedError, TaskNotFoundError } from '../sync/engine';
import { NetworkError, PermanentError } from '../sync/types';
import { mobileEn } from './messages';
import { mobileAr } from './messages.ar';

export const enMessages = { ...sharedEn, ...mobileEn } as const;
export const arMessages = { ...sharedAr, ...mobileAr };
export type Key = MessageKey<typeof enMessages>;

const LOCALE_KEY = 'vf.locale';
const ATTEMPT_KEY = 'vf.rtlAttempt';

I18nManager.allowRTL(true);

/** The device's own language, until the person picks one. */
const deviceLocale = (): Locale => negotiateLocale([Intl.DateTimeFormat().resolvedOptions().locale]);

/**
 * React Native fixes the layout direction when the app starts, so switching between English (left-to-right) and Arabic
 * (right-to-left) means telling the OS the new direction and restarting the JS bundle. Returns true when a restart was
 * triggered. The attempt is remembered so a platform that refuses to flip cannot put the app in a restart loop.
 */
async function ensureDirection(locale: Locale): Promise<boolean> {
  const wantRtl = LOCALE_META[locale].dir === 'rtl';
  if (I18nManager.isRTL === wantRtl) {
    await SecureStore.deleteItemAsync(ATTEMPT_KEY).catch(() => undefined);
    return false;
  }
  if ((await SecureStore.getItemAsync(ATTEMPT_KEY).catch(() => null)) === locale) return false;
  I18nManager.forceRTL(wantRtl);
  await SecureStore.setItemAsync(ATTEMPT_KEY, locale).catch(() => undefined);
  await reloadAppAsync();
  return true;
}

export interface I18n {
  locale: Locale;
  isRtl: boolean;
  setLocale: (l: Locale) => Promise<void>;
  t: (key: Key, params?: MessageParams) => string;
  fmt: Formatters;
  status: (code: string) => string;
  /** Text for anything that went wrong. `login`: a 401 means "wrong e-mail or password", not "session expired". */
  error: (e: unknown, opts?: { login?: boolean }) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale | null>(null);

  useEffect(() => {
    (async () => {
      const saved = await SecureStore.getItemAsync(LOCALE_KEY).catch(() => null);
      const chosen = isLocale(saved) ? saved : deviceLocale();
      if (!(await ensureDirection(chosen))) setLocaleState(chosen);
    })().catch(() => setLocaleState(deviceLocale()));
  }, []);

  const setLocale = useCallback(async (l: Locale) => {
    await SecureStore.setItemAsync(LOCALE_KEY, l).catch(() => undefined);
    setLocaleState(l);
    await ensureDirection(l);
  }, []);

  const value = useMemo<I18n | null>(() => {
    if (!locale) return null;
    const tr = createTranslator(locale, { en: enMessages, ar: arMessages });
    const error: I18n['error'] = (e, opts) => {
      if (e instanceof NetworkError) return tr.t('error.network');
      if (e instanceof AuthError) return tr.t(opts?.login ? 'error.invalidCredentials' : 'error.unauthorized');
      if (e instanceof ConflictBlockedError) return tr.t('task.conflictBlocked');
      if (e instanceof TaskNotFoundError) return tr.t('task.notFound');
      if (e instanceof HttpError || e instanceof PermanentError) {
        if (opts?.login && e.status === 401) return tr.t('error.invalidCredentials');
        return localizeError(tr, { status: e.status, message: e.message });
      }
      return e instanceof Error && e.message ? e.message : tr.t('error.unknown');
    };
    return { locale, isRtl: LOCALE_META[locale].dir === 'rtl', setLocale, t: tr.t, fmt: createFormatters(locale), status: (code) => tr.tOr(`status.${code}`, code), error };
  }, [locale, setLocale]);

  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>');
  return v;
}
