import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LOCALES, LOCALE_META, createFormatters, createTranslator, isLocale, localizeError, negotiateLocale, sharedAr, sharedEn, type Dir, type Formatters, type Locale, type MessageKey, type MessageParams } from '@victorflow/i18n';
import { ApiError } from '@/lib/api';
import { desktopAr } from './ar';
import { desktopEn } from './en';

/** English is the source of truth for the keys `t()` accepts. */
export const enMessages = { ...sharedEn, ...desktopEn } as const;
export const arMessages = { ...sharedAr, ...desktopAr };
export type Key = MessageKey<typeof enMessages>;

const STORAGE_KEY = 'vf.locale';

function initialLocale(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* storage blocked — fall through to the browser language */
  }
  return negotiateLocale(globalThis.navigator?.languages ?? globalThis.navigator?.language);
}

type EnumGroup = 'customerType' | 'paymentMethod' | 'accountType' | 'role' | 'tier' | 'feature';

export interface I18n {
  locale: Locale;
  dir: Dir;
  setLocale: (l: Locale) => void;
  t: (key: Key, params?: MessageParams) => string;
  /** Money, dates, quantities in this language. */
  fmt: Formatters;
  /** A data-driven message key ("move.CONFIRMED.IN_PRODUCTION"): the translation if there is one, else `fallback`. */
  lookup: (key: string, fallback: string | null | undefined) => string;
  /** Label for a status code ("IN_PRODUCTION"); `serverLabel` is used for codes an administrator added that we have no text for. */
  status: (code: string, serverLabel?: string) => string;
  /** Label for a code of a fixed vocabulary (customer type, payment method, role …). */
  label: (group: EnumGroup, code: string) => string;
  /** Text for any thrown value: server errors are translated by code/status, everything else falls back to its message. */
  error: (e: unknown) => string;
}

const Ctx = createContext<I18n | null>(null);

/** "IN_PRODUCTION" → "In production": last resort for a code with no translation. */
export const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    const el = document.documentElement;
    el.lang = locale;
    el.dir = LOCALE_META[locale].dir;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, l);
    } catch {
      /* the choice just won't survive a restart */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const tr = createTranslator(locale, { en: enMessages, ar: arMessages });
    return {
      locale,
      dir: tr.dir,
      setLocale,
      t: tr.t,
      fmt: createFormatters(locale),
      lookup: (key, fallback) => tr.tOr(key, fallback ?? ''),
      status: (code, serverLabel) => tr.tOr(`status.${code}`, serverLabel ?? humanize(code)),
      label: (group, code) => tr.tOr(`${group}.${code}`, humanize(code)),
      error: (e) => (e instanceof ApiError ? localizeError(tr, e) : e instanceof Error ? e.message : tr.t('error.unknown')),
    };
  }, [locale, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>');
  return v;
}

export { LOCALES, LOCALE_META };
