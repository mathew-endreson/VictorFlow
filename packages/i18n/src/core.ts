// Translation core: pure TypeScript, no React, no DOM — the same code runs in the desktop app, the Next.js tracker and
// the React Native app.

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export type Dir = 'ltr' | 'rtl';

export const DEFAULT_LOCALE: Locale = 'en';

interface LocaleMeta {
  /** Name in its own language — what the language switcher shows. */
  nativeName: string;
  dir: Dir;
  /**
   * BCP-47 tag handed to Intl. Arabic is pinned to Latin digits (-nu-latn): that is how Algerian invoices, price
   * lists and phone numbers are written, and it keeps every number in the UI in one script.
   */
  intl: string;
}

export const LOCALE_META: Readonly<Record<Locale, LocaleMeta>> = {
  en: { nativeName: 'English', dir: 'ltr', intl: 'en-GB' },
  ar: { nativeName: 'العربية', dir: 'rtl', intl: 'ar-DZ-u-nu-latn' },
};

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
export const dirOf = (locale: Locale): Dir => LOCALE_META[locale].dir;

/**
 * Pick the best supported locale from a browser's `navigator.languages` or an `Accept-Language` header
 * ("ar-DZ,ar;q=0.9,en;q=0.8"). The first supported language wins, weighted by q; anything else falls back to English.
 */
export function negotiateLocale(input: readonly string[] | string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  const ranked = (Array.isArray(input) ? (input as readonly string[]).map((tag) => ({ tag, q: 1 })) : parseAcceptLanguage(input as string))
    .map((entry, order) => ({ ...entry, order }))
    .sort((a, b) => b.q - a.q || a.order - b.order);
  for (const { tag } of ranked) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

function parseAcceptLanguage(header: string): Array<{ tag: string; q: number }> {
  return header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(p)?.[1]).find(Boolean);
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q) };
    })
    .filter((e) => e.tag && e.tag !== '*' && Number.isFinite(e.q) && e.q > 0);
}

// ── catalogs & translator ────────────────────────────────────────────────────

/** A flat message catalog: "area.name" → text, with `{placeholders}`. */
export type Catalog = Readonly<Record<string, string>>;
export type MessageParams = Readonly<Record<string, string | number>>;

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export const PLURAL_CATEGORIES: readonly PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

type StripPlural<K extends string> = K extends `${infer Base}_${PluralCategory}` ? Base : K;
/** Every key callable through `t()`: the plural variants of one message (`x_one`, `x_other`) collapse into `x`. */
export type MessageKey<C extends Catalog> = StripPlural<Extract<keyof C, string>>;

export interface Translator<K extends string = string> {
  readonly locale: Locale;
  readonly dir: Dir;
  /**
   * Look a message up. A numeric `count` param selects the plural form for the language
   * (`items_one` / `items_other` in English; zero/one/two/few/many/other in Arabic).
   * Falls back to English, then to the key itself, so a missing translation is visible but never crashes a screen.
   */
  t(key: K, params?: MessageParams): string;
  /** Like `t`, but returns `fallback` (not the key) when the catalog has no such message — for data-driven codes. */
  tOr(key: string, fallback: string, params?: MessageParams): string;
  has(key: string): boolean;
}

export function createTranslator<C extends Catalog>(locale: Locale, catalogs: { readonly en: C } & Partial<Record<Locale, Catalog>>): Translator<MessageKey<C>> {
  const chain: Catalog[] = locale === 'en' ? [catalogs.en] : [catalogs[locale] ?? {}, catalogs.en];
  const plural = new Intl.PluralRules(LOCALE_META[locale].intl);

  const find = (key: string, count: number | undefined): string | undefined => {
    for (const catalog of chain) {
      if (count !== undefined) {
        const form = catalog[`${key}_${plural.select(count)}`] ?? catalog[`${key}_other`];
        if (form !== undefined) return form;
      }
      const plain = catalog[key];
      if (plain !== undefined) return plain;
    }
    return undefined;
  };

  const render = (template: string, params?: MessageParams) => (params ? template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : template);
  const countOf = (params?: MessageParams) => (typeof params?.count === 'number' ? params.count : undefined);

  return {
    locale,
    dir: dirOf(locale),
    t: (key, params) => render(find(key, countOf(params)) ?? key, params),
    tOr: (key, fallback, params) => {
      const found = find(key, countOf(params));
      return found === undefined ? fallback : render(found, params);
    },
    has: (key) => find(key, undefined) !== undefined || PLURAL_CATEGORIES.some((c) => chain.some((cat) => cat[`${key}_${c}`] !== undefined)),
  };
}
