import { describe, expect, it } from 'vitest';
import { checkCatalogPair, createFormatters, createTranslator, dirOf, localizeError, negotiateLocale, sharedAr, sharedEn, type Catalog } from './index';

describe('shared catalogs', () => {
  it('Arabic has exactly the keys English has, with the same placeholders', () => {
    expect(checkCatalogPair(sharedEn, sharedAr)).toEqual([]);
  });
});

describe('locale negotiation', () => {
  it('honours the header order and q-weights, and falls back to English', () => {
    expect(negotiateLocale('ar-DZ,ar;q=0.9,en;q=0.8')).toBe('ar');
    expect(negotiateLocale('en-GB,en;q=0.9,ar;q=0.8')).toBe('en');
    expect(negotiateLocale('fr-FR,fr;q=0.9,ar;q=0.5')).toBe('ar'); // French is unsupported → the next supported one
    expect(negotiateLocale('fr-FR')).toBe('en');
    expect(negotiateLocale('en;q=0.4, ar;q=0.9')).toBe('ar');
    expect(negotiateLocale(['fr', 'ar-DZ', 'en'])).toBe('ar');
    expect(negotiateLocale(undefined)).toBe('en');
    expect(negotiateLocale('')).toBe('en');
    expect(negotiateLocale('*')).toBe('en');
  });

  it('knows which language runs right to left', () => {
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });
});

describe('translator', () => {
  const en = { 'a.hello': 'Hello {name}', 'a.items_one': '{count} item', 'a.items_other': '{count} items', 'a.only': 'English only' } as const;
  const ar: Catalog = { 'a.hello': 'مرحباً {name}', 'a.items_zero': 'لا عناصر', 'a.items_one': 'عنصر واحد', 'a.items_two': 'عنصران', 'a.items_few': '{count} عناصر', 'a.items_many': '{count} عنصراً', 'a.items_other': '{count} عنصر' };

  it('interpolates and picks English plural forms', () => {
    const { t } = createTranslator('en', { en });
    expect(t('a.hello', { name: 'Sara' })).toBe('Hello Sara');
    expect(t('a.items', { count: 1 })).toBe('1 item');
    expect(t('a.items', { count: 0 })).toBe('0 items');
    expect(t('a.items', { count: 5 })).toBe('5 items');
  });

  it('uses all six Arabic plural forms', () => {
    const { t } = createTranslator('ar', { en, ar });
    expect(t('a.items', { count: 0 })).toBe('لا عناصر');
    expect(t('a.items', { count: 1 })).toBe('عنصر واحد');
    expect(t('a.items', { count: 2 })).toBe('عنصران');
    expect(t('a.items', { count: 7 })).toBe('7 عناصر');
    expect(t('a.items', { count: 11 })).toBe('11 عنصراً');
    expect(t('a.items', { count: 100 })).toBe('100 عنصر');
  });

  it('falls back to English, then to the key, and leaves unknown placeholders visible', () => {
    const tr = createTranslator('ar', { en, ar });
    expect(tr.t('a.only')).toBe('English only');
    expect(tr.t('nope.missing' as never)).toBe('nope.missing');
    expect(tr.tOr('nope.missing', 'fallback')).toBe('fallback');
    expect(createTranslator('en', { en }).t('a.hello')).toBe('Hello {name}');
    expect(tr.has('a.items')).toBe(true);
    expect(tr.has('a.only')).toBe(true);
    expect(tr.has('zzz')).toBe(false);
  });
});

describe('formatters', () => {
  it('keeps the English money format and puts the dinar sign after the amount in Arabic', () => {
    // amounts group thousands with U+202F and put a no-break space before the currency
    expect(createFormatters('en').dzd('4464.2900')).toBe('4\u202f464,29\u00a0DA');
    expect(createFormatters('en').dzd(null)).toBe('—');
    const ar = createFormatters('ar').dzd('4464.2900');
    // the digits are isolated, so right-to-left text can neither reorder them nor strand a minus sign; the dinar sign follows
    expect(ar).toBe('\u20664\u202f464,29\u2069\u00a0دج');
    expect(createFormatters('ar').dzd('-12.5').replace(/[\u2066\u2069]/g, '')).toBe('-12,50\u00a0دج');
  });

  it('writes dates in each language, with Latin digits and Algerian month names in Arabic', () => {
    const en = createFormatters('en');
    const ar = createFormatters('ar');
    expect(en.day('2026-12-31')).toMatch(/^31 Dec\w* 2026$/);
    expect(ar.day('2026-01-05')).toBe('05 جانفي 2026');
    expect(ar.day('2026-09-19')).toContain('سبتمبر');
    expect(ar.month('2026-04')).toBe('أفريل 2026');
    expect(en.month('2026-09')).toBe('September 2026');
    expect(en.day(null)).toBe('—');
  });

  it('shows an accounting day as the same calendar day whatever the time zone', () => {
    for (const day of ['2026-01-01', '2026-12-31']) {
      const d = Number(day.slice(8));
      expect(createFormatters('en').day(day)).toContain(String(d).padStart(2, '0'));
    }
  });

  it('uses a 24-hour clock in both languages', () => {
    const at = '2026-09-19T14:05:00';
    expect(createFormatters('en').dateTime(at)).toContain('14:05');
    expect(createFormatters('ar').dateTime(at)).toContain('14:05');
    expect(createFormatters('ar').time(new Date(2026, 8, 19, 9, 3))).toBe('09:03');
  });

  it('trims quantity zeros', () => {
    const f = createFormatters('en');
    expect([f.qty('3.0000'), f.qty('2.7500'), f.qty('100'), f.qty('0.1000')]).toEqual(['3', '2.75', '100', '0.1']);
  });
});

describe('localizeError', () => {
  const en = createTranslator('en', { en: sharedEn });
  const ar = createTranslator('ar', { en: sharedEn, ar: sharedAr });

  it('shows the specific server text in English', () => {
    expect(localizeError(en, { status: 409, code: 'ORDER_INVOICED', message: 'Order is invoiced (INV-2026-000001); cancel the invoice first' })).toBe('Order is invoiced (INV-2026-000001); cancel the invoice first');
  });

  it('translates by code, then by status, in Arabic; the server text is the last resort', () => {
    expect(localizeError(ar, { status: 409, code: 'ORDER_INVOICED', message: 'English text' })).toBe(sharedAr['error.code.ORDER_INVOICED']);
    expect(localizeError(ar, { status: 404, message: 'Customer not found' })).toBe(sharedAr['error.notFound']);
    expect(localizeError(ar, { status: 403, message: 'Missing permission: x' })).toBe(sharedAr['error.forbidden']);
    expect(localizeError(ar, { status: 503, message: 'x' })).toBe(sharedAr['error.server']);
    expect(localizeError(ar, { status: 409, code: 'SOME_NEW_RULE', message: 'Some new English rule' })).toBe('Some new English rule');
  });

  it('always translates the client-side network failure', () => {
    expect(localizeError(en, { status: 0, code: 'NETWORK', message: 'x' })).toBe(sharedEn['error.network']);
    expect(localizeError(ar, { status: 0, code: 'NETWORK', message: 'x' })).toBe(sharedAr['error.network']);
  });
});
