import { checkCatalogPair } from '@victorflow/i18n';
import { describe, expect, it } from 'vitest';
import { trackerAr } from './messages.ar';
import { trackerEn } from './messages';

describe('tracker catalogs', () => {
  it('Arabic has exactly the messages English has', () => {
    expect(checkCatalogPair(trackerEn, trackerAr)).toEqual([]);
  });
});
