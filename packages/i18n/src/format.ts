import { formatDZD } from '@victorflow/types';
import { LOCALE_META, type Dir, type Locale } from './core';

/** Left-to-right isolate / pop directional isolate: keep an amount's digits (and its minus sign) in one piece inside right-to-left text. */
const LRI = '\u2066';
const PDI = '\u2069';
const NBSP = '\u00a0';

/** Currency label written after the amount. */
const CURRENCY: Record<Locale, string> = { en: 'DA', ar: 'دج' };

export interface Formatters {
  readonly locale: Locale;
  readonly dir: Dir;
  /** "1234.5000" → "1 234,50 DA" / "1 234,50 دج". Display only — money is never parsed back from this. */
  dzd(v: string | null | undefined): string;
  /** 'YYYY-MM-DD' (an accounting day, not an instant) → "19 Sept 2026" / "19 سبتمبر 2026". Parsed as a LOCAL date so it never shifts a day. */
  day(v: string | null | undefined): string;
  /** An instant (ISO timestamp) → date + 24-hour time. */
  dateTime(v: string | null | undefined): string;
  /** An instant → 24-hour time only. */
  time(v: string | number | Date | null | undefined): string;
  /** 'YYYY-MM' → "September 2026" / "سبتمبر 2026". */
  month(v: string | null | undefined): string;
  /** A date given as a JS Date (or timestamp) → long form, e.g. "19 September 2026". */
  longDate(v: string | Date | null | undefined): string;
  /** Quantities come as "3.0000"; show "3" or "2.75". */
  qty(v: string): string;
  /** A plain integer/decimal count, in Latin digits. */
  number(n: number): string;
  /** ["a", "b", "c"] → "a, b, c" / "a، b، c". */
  list(items: readonly string[]): string;
}

const DASH = '—';

export function createFormatters(locale: Locale): Formatters {
  const { intl, dir } = LOCALE_META[locale];
  const dayFmt = new Intl.DateTimeFormat(intl, { day: '2-digit', month: 'short', year: 'numeric' });
  const dateTimeFmt = new Intl.DateTimeFormat(intl, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const timeFmt = new Intl.DateTimeFormat(intl, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const monthFmt = new Intl.DateTimeFormat(intl, { month: 'long', year: 'numeric' });
  const longFmt = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'long', year: 'numeric' });
  const numFmt = new Intl.NumberFormat(intl, { useGrouping: true, maximumFractionDigits: 4 });
  const listFmt = new Intl.ListFormat(intl, { style: 'narrow', type: 'unit' });

  return {
    locale,
    dir,
    dzd(v) {
      if (v == null) return DASH;
      if (locale === 'en') return formatDZD(v); // "4 464,29 DA" — the historical format, unchanged
      // logical order "number, then currency" — in a right-to-left line the number sits on the right and the dinar sign to its left
      return `${LRI}${formatDZD(v, { symbol: false })}${PDI}${NBSP}${CURRENCY[locale]}`;
    },
    day(v) {
      if (!v) return DASH;
      const [y, m, d] = v.slice(0, 10).split('-').map(Number);
      return dayFmt.format(new Date(y!, m! - 1, d!));
    },
    dateTime: (v) => (v ? dateTimeFmt.format(new Date(v)) : DASH),
    time: (v) => (v == null ? DASH : timeFmt.format(new Date(v))),
    month(v) {
      if (!v) return DASH;
      const [y, m] = v.split('-').map(Number);
      return monthFmt.format(new Date(y!, m! - 1, 1));
    },
    longDate(v) {
      if (!v) return DASH;
      return longFmt.format(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v));
    },
    qty: (v) => (v.includes('.') ? v.replace(/\.?0+$/, '') : v),
    number: (n) => numFmt.format(n),
    list: (items) => listFmt.format(items),
  };
}
