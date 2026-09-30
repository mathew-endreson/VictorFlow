import { describe, expect, it } from 'vitest';
import { documentLineSchema } from './schemas/sales';
import { orderLineInputSchema } from './schemas/services';
import { normalizeLineUnit } from './units';

describe('normalizeLineUnit', () => {
  it('keeps a real unit as typed (trimmed)', () => {
    for (const unit of ['u', 'pcs', ' kg ', 'm²', 'm2', 'ml', 'متر', 'roll of 50']) expect(normalizeLineUnit(unit)).toBe(unit.trim());
  });

  it('falls back to "u" when empty, blank or missing', () => {
    for (const unit of ['', '   ', undefined, null]) expect(normalizeLineUnit(unit)).toBe('u');
  });

  it('falls back to "u" for a bare number or punctuation — no letter, no unit', () => {
    for (const unit of ['0', '12', '1.5', '٣', '-', '%', '0 0']) expect(normalizeLineUnit(unit)).toBe('u');
  });

  it('falls back to "u" for something longer than a unit can be', () => {
    expect(normalizeLineUnit('x'.repeat(21))).toBe('u');
  });
});

describe('line schemas apply the unit rule', () => {
  const base = { description: 'Banner', quantity: '2', unitPrice: '100', overrideReason: 'custom' };

  it('order lines: "0" / empty / missing all become "u"; a real unit survives', () => {
    expect(orderLineInputSchema.parse({ ...base, unit: '0' }).unit).toBe('u');
    expect(orderLineInputSchema.parse({ ...base, unit: '  ' }).unit).toBe('u');
    expect(orderLineInputSchema.parse({ ...base }).unit).toBe('u');
    expect(orderLineInputSchema.parse({ ...base, unit: 'm' }).unit).toBe('m');
  });

  it('quote lines follow the same rule', () => {
    expect(documentLineSchema.parse({ ...base, unit: '0' }).unit).toBe('u');
    expect(documentLineSchema.parse({ ...base }).unit).toBe('u');
    expect(documentLineSchema.parse({ ...base, unit: 'kg' }).unit).toBe('kg');
  });

  it('still rejects an over-long unit as a validation error rather than silently replacing it', () => {
    expect(orderLineInputSchema.safeParse({ ...base, unit: 'x'.repeat(21) }).success).toBe(false);
  });
});
