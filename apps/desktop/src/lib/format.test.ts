import { describe, expect, it } from 'vitest';
import { createFormatters } from '@victorflow/i18n';
import { humanize } from '@/i18n';
import { today } from './format';

// The formatters themselves (money, dates, quantities in both languages) are tested in @victorflow/i18n;
// this checks the desktop's use of them.
describe('desktop formatting', () => {
  it('formats DZD amounts from decimal strings (no floats)', () => {
    const { dzd } = createFormatters('en');
    expect(dzd('4464.2900')).toBe('4 464,29 DA');
    expect(dzd('0.0000')).toBe('0,00 DA');
    expect(dzd(null)).toBe('—');
  });

  it('today() is a valid YYYY-MM-DD and humanize prettifies enum codes', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(humanize('IN_PRODUCTION')).toBe('In production');
  });
});
