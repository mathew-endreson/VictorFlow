import { createFormatters, createTranslator, isLocale, negotiateLocale, sharedAr, sharedEn, type Locale } from '@victorflow/i18n';
import { cookies, headers } from 'next/headers';
import { trackerEn } from './messages';
import { trackerAr } from './messages.ar';

export const LOCALE_COOKIE = 'vf_lang';

export const messages = { en: { ...sharedEn, ...trackerEn }, ar: { ...sharedAr, ...trackerAr } } as const;

/** The visitor's language: their explicit choice (cookie), else what their browser asks for, else English. */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return negotiateLocale((await headers()).get('accept-language'));
}

export async function getI18n() {
  const locale = await getLocale();
  const tr = createTranslator(locale, messages);
  return { locale, dir: tr.dir, t: tr.t, tOr: tr.tOr, fmt: createFormatters(locale) };
}
