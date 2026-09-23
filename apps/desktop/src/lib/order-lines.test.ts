import { describe, expect, it } from 'vitest';
import { blankLine, lineProblem, previewLines, toItemsPayload } from './order-lines';

// A manual (no-service) line now needs an override reason, matching the server's orderLineInputSchema —
// this fixture bakes it in so the existing money-math assertions below don't have to repeat it everywhere.
const line = (o: Parameters<typeof blankLine>[0]) => blankLine({ description: 'Enseigne', overrideReason: 'test', ...o });

describe('order line editor maths', () => {
  it('matches the server: 3 × 1 250,50 → HT 3751.50 / TVA 712.79 / TTC 4464.29', () => {
    const p = previewLines([line({ quantity: '3', unitPrice: '1250.50' })]);
    expect(p.rows[0]).toMatchObject({ ht: '3751.5000', tva: '712.7900', ttc: '4464.2900' });
    expect([p.totalHt, p.totalTva, p.totalTtc]).toEqual(['3751.5000', '712.7900', '4464.2900']);
  });

  it('totals are the exact sum of the rounded lines (ten 0.10 lines → HT 1.00, TVA 0.20)', () => {
    const p = previewLines(Array.from({ length: 10 }, () => line({ quantity: '1', unitPrice: '0.10' })));
    expect([p.totalHt, p.totalTva, p.totalTtc]).toEqual(['1.0000', '0.2000', '1.2000']);
  });

  it('applies discounts and mixed TVA rates', () => {
    const p = previewLines([
      line({ quantity: '10', unitPrice: '200', discountPct: '12.5' }),
      line({ quantity: '1', unitPrice: '100', tvaRate: '9' }),
    ]);
    expect([p.totalHt, p.totalTva, p.totalTtc]).toEqual(['1850.0000', '341.5000', '2191.5000']);
  });

  it('shows amounts as soon as the numbers (and, for a manual line, the override reason) are valid, ignores incomplete rows, never throws', () => {
    const p = previewLines([line({ unitPrice: '10' }), line({ unitPrice: '' }), line({ unitPrice: 'abc' }), line({ quantity: '0', unitPrice: '5' })]);
    expect(p.rows[0]).toMatchObject({ ht: '10.0000' });
    expect(p.rows.slice(1)).toEqual([null, null, null]);
    expect(p.totalHt).toBe('10.0000');
  });

  it('a manual line with no override reason is incomplete, not an error', () => {
    const p = previewLines([blankLine({ description: 'x', unitPrice: '10' })]); // no overrideReason
    expect(p.rows[0]).toBeNull();
  });

  it('flags rows that the server would reject, naming the problem', () => {
    expect(lineProblem(line({ description: '', unitPrice: '5' }))).toBe('description');
    expect(lineProblem(line({ description: 'x', unitPrice: '5', quantity: '-1' }))).toBe('quantity');
    expect(lineProblem(line({ description: 'x', unitPrice: '5.12345' }))).toBe('unitPrice');
    expect(lineProblem(line({ description: 'x', unitPrice: '5', discountPct: '101' }))).toBe('discount');
    expect(lineProblem(line({ description: 'x', unitPrice: '5', tvaRate: '150' }))).toBe('tva');
    expect(lineProblem(blankLine({ description: 'x', unitPrice: '5' }))).toBe('overrideReason');
    expect(lineProblem(line({ description: 'x', unitPrice: '5' }))).toBeNull();
  });

  it('sends money as trimmed strings, never numbers, and carries the override reason', () => {
    const [item] = toItemsPayload([line({ description: '  Bâche ', quantity: '2.5', unitPrice: '1800' })], new Map());
    expect(item).toEqual({ description: 'Bâche', unit: 'u', quantity: '2.5', unitPrice: '1800', discountPct: '0', tvaRate: '19', overrideReason: 'test' });
    expect(typeof item!.quantity).toBe('string');
    expect(typeof item!.unitPrice).toBe('string');
  });
});
