import { describe, expect, it } from 'vitest';
import { DISPLAY_LANGS, displayMessages } from './messages';

describe('display catalogs', () => {
  it('French, Arabic and English have exactly the same messages, none empty', () => {
    const en = Object.keys(displayMessages.en).sort();
    for (const lang of DISPLAY_LANGS) {
      expect(Object.keys(displayMessages[lang]).sort(), lang).toEqual(en);
      for (const [key, text] of Object.entries(displayMessages[lang])) expect(text.trim(), `${lang} ${key}`).not.toBe('');
    }
  });
});
