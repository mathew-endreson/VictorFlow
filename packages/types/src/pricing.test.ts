import { describe, expect, it } from 'vitest';
import { computeServiceUnitPrice } from './pricing';

describe('computeServiceUnitPrice', () => {
  it('m2: unit price = ratio × width × height', () => {
    // 800 DA/m² × (2.5m × 1.2m = 3.00m²) = 2400.0000
    expect(computeServiceUnitPrice({ pricingUnit: 'm2', priceRatio: '800', batchSize: '1' }, { width: '2.5', height: '1.2' })).toBe('2400.0000');
  });

  it('m2: rounds to money scale, half away from zero', () => {
    // 3 DA/m² × (1.111 × 1.111 = 1.234321 m²) = 3.702963 → rounds to 4 decimals: 3.7030
    expect(computeServiceUnitPrice({ pricingUnit: 'm2', priceRatio: '3', batchSize: '1' }, { width: '1.111', height: '1.111' })).toBe('3.7030');
  });

  it('m2: requires both width and height', () => {
    expect(() => computeServiceUnitPrice({ pricingUnit: 'm2', priceRatio: '800', batchSize: '1' }, { width: '2.5' })).toThrow(RangeError);
    expect(() => computeServiceUnitPrice({ pricingUnit: 'm2', priceRatio: '800', batchSize: '1' }, {})).toThrow(RangeError);
  });

  it('per_linear_m: unit price = ratio × length', () => {
    // 450 DA/m × 3.5m = 1575.0000
    expect(computeServiceUnitPrice({ pricingUnit: 'per_linear_m', priceRatio: '450', batchSize: '1' }, { length: '3.5' })).toBe('1575.0000');
  });

  it('per_linear_m: requires length', () => {
    expect(() => computeServiceUnitPrice({ pricingUnit: 'per_linear_m', priceRatio: '450', batchSize: '1' }, {})).toThrow(RangeError);
  });

  it('per_item: unit price = ratio / batchSize (business cards priced per 1000)', () => {
    // 1500 DA per 1000 cards → 1.5000 DA/card; × 3000 cards (via the normal quantity path) = 4500
    const unitPrice = computeServiceUnitPrice({ pricingUnit: 'per_item', priceRatio: '1500', batchSize: '1000' }, {});
    expect(unitPrice).toBe('1.5000');
  });

  it('per_item: batchSize of 1 is plain per-unit pricing', () => {
    expect(computeServiceUnitPrice({ pricingUnit: 'per_item', priceRatio: '25', batchSize: '1' }, {})).toBe('25.0000');
  });

  it('per_item: rejects a zero or negative batchSize', () => {
    expect(() => computeServiceUnitPrice({ pricingUnit: 'per_item', priceRatio: '25', batchSize: '0' }, {})).toThrow(RangeError);
  });

  it('rejects a zero or negative dimension', () => {
    expect(() => computeServiceUnitPrice({ pricingUnit: 'm2', priceRatio: '800', batchSize: '1' }, { width: '0', height: '1' })).toThrow(RangeError);
    expect(() => computeServiceUnitPrice({ pricingUnit: 'per_linear_m', priceRatio: '450', batchSize: '1' }, { length: '-1' })).toThrow(RangeError);
  });
});
