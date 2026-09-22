import { checkCatalogPair } from '@victorflow/i18n';
import { describe, expect, it } from 'vitest';
import { mobileEn } from './messages';
import { mobileAr } from './messages.ar';

describe('mobile catalogs', () => {
  it('Arabic has exactly the messages English has, with the same placeholders and every plural form', () => {
    expect(checkCatalogPair(mobileEn, mobileAr)).toEqual([]);
  });
});
