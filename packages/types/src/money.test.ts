import { describe, expect, it } from 'vitest';
import {
  computeDocument,
  computeLine,
  divRound,
  formatDZD,
  formatMoney,
  normalizeMoney,
  parseMoney,
  parseScaled,
  sumMoney,
} from './money';

describe('parse / format', () => {
  it('round-trips without floats', () => {
    expect(formatMoney(parseMoney('1234.5'))).toBe('1234.5000');
    expect(formatMoney(parseMoney('0.0001'))).toBe('0.0001');
    expect(formatMoney(parseMoney('-7.25'))).toBe('-7.2500');
    expect(normalizeMoney('19')).toBe('19.0000');
  });

  it('is exact where floats are not (0.1 + 0.2)', () => {
    expect(sumMoney(['0.1', '0.2'])).toBe('0.3000');
    expect(0.1 + 0.2).not.toBe(0.3); // the trap we are avoiding
  });

  it('is exact at the top of NUMERIC(15,4)', () => {
    expect(formatMoney(parseMoney('99999999999.9999'))).toBe('99999999999.9999');
  });

  it('rejects malformed or lossy input', () => {
    expect(() => parseMoney('1.23456')).toThrow(RangeError);
    expect(() => parseMoney('abc')).toThrow(RangeError);
    expect(() => parseMoney('1,5')).toThrow(RangeError);
    expect(() => parseMoney('')).toThrow(RangeError);
    expect(() => parseScaled(12 as unknown as string)).toThrow(TypeError);
  });
});

describe('divRound (half away from zero)', () => {
  it('rounds .5 up in magnitude', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divRound(7n, 3n)).toBe(2n);
    expect(divRound(-7n, 3n)).toBe(-2n);
  });
});

describe('computeLine — HT / TVA(19%) / TTC in DZD', () => {
  it('3 × 1 250,50 → HT 3 751,50 / TVA 712,79 (712,785 rounded half-up) / TTC 4 464,29', () => {
    const a = computeLine({ quantity: '3', unitPrice: '1250.50' });
    expect(formatMoney(a.ht)).toBe('3751.5000');
    expect(formatMoney(a.tva)).toBe('712.7900');
    expect(formatMoney(a.ttc)).toBe('4464.2900');
  });

  it('applies a percentage discount before tax', () => {
    // 10 × 200 = 2000, −12.5% → 1750; TVA 19% = 332.50; TTC 2082.50
    const a = computeLine({ quantity: '10', unitPrice: '200', discountPct: '12.5' });
    expect(formatMoney(a.ht)).toBe('1750.0000');
    expect(formatMoney(a.tva)).toBe('332.5000');
    expect(formatMoney(a.ttc)).toBe('2082.5000');
  });

  it('handles fractional quantities (m² of vinyl)', () => {
    // 2.75 m² × 1 800 = 4 950 ; TVA 940.50
    const a = computeLine({ quantity: '2.75', unitPrice: '1800' });
    expect(formatMoney(a.ht)).toBe('4950.0000');
    expect(formatMoney(a.tva)).toBe('940.5000');
  });

  it('rounds the line to whole centimes (HT 0.005 → 0.01)', () => {
    const a = computeLine({ quantity: '1', unitPrice: '0.005' });
    expect(formatMoney(a.ht)).toBe('0.0100');
  });

  it('supports a non-standard TVA rate (9%) and a 0% line', () => {
    expect(formatMoney(computeLine({ quantity: '1', unitPrice: '100', tvaRate: '9' }).tva)).toBe('9.0000');
    const zero = computeLine({ quantity: '1', unitPrice: '100', tvaRate: '0' });
    expect(formatMoney(zero.tva)).toBe('0.0000');
    expect(formatMoney(zero.ttc)).toBe('100.0000');
  });

  it('a 100% discount yields zero everywhere', () => {
    const a = computeLine({ quantity: '5', unitPrice: '99.99', discountPct: '100' });
    expect([a.ht, a.tva, a.ttc]).toEqual([0n, 0n, 0n]);
  });

  it('rejects out-of-range inputs', () => {
    expect(() => computeLine({ quantity: '-1', unitPrice: '10' })).toThrow(RangeError);
    expect(() => computeLine({ quantity: '1', unitPrice: '10', discountPct: '100.01' })).toThrow(RangeError);
    expect(() => computeLine({ quantity: '1', unitPrice: '10', tvaRate: '101' })).toThrow(RangeError);
  });

  it('TTC always equals HT + TVA (no drift) across many awkward values', () => {
    for (const qty of ['0.333', '1', '7.1234', '1000']) {
      for (const price of ['0.01', '3.3333', '19.99', '12345.6789']) {
        const a = computeLine({ quantity: qty, unitPrice: price, discountPct: '7.33' });
        expect(a.ttc).toBe(a.ht + a.tva);
        expect(a.ht % 100n).toBe(0n); // whole centimes
        expect(a.tva % 100n).toBe(0n);
      }
    }
  });
});

describe('computeDocument', () => {
  it('totals are the exact sum of the rounded lines', () => {
    const doc = computeDocument([
      { quantity: '3', unitPrice: '1250.50' }, // 3751.50 / 712.79
      { quantity: '2', unitPrice: '99.99' }, //   199.98 /  38.00 (37.9962)
      { quantity: '1', unitPrice: '0.01' }, //      0.01 /   0.00 (0.0019)
    ]);
    expect(doc.lines.map((l) => l.ht)).toEqual(['3751.5000', '199.9800', '0.0100']);
    expect(doc.lines.map((l) => l.tva)).toEqual(['712.7900', '38.0000', '0.0000']);
    expect(doc.totalHt).toBe('3951.4900');
    expect(doc.totalTva).toBe('750.7900');
    expect(doc.totalTtc).toBe('4702.2800');
    expect(parseMoney(doc.totalHt) + parseMoney(doc.totalTva)).toBe(parseMoney(doc.totalTtc));
  });

  it('empty document totals zero', () => {
    const doc = computeDocument([]);
    expect([doc.totalHt, doc.totalTva, doc.totalTtc]).toEqual(['0.0000', '0.0000', '0.0000']);
  });
});

describe('formatDZD', () => {
  it('groups thousands and shows centimes', () => {
    expect(formatDZD('1234567.5000')).toBe('1 234 567,50 DA');
    expect(formatDZD('0.0500', { symbol: false })).toBe('0,05');
    expect(formatDZD('-12.3400', { symbol: false })).toBe('-12,34');
  });
});
