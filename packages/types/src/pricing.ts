/**
 * Area/length/batch pricing for the services catalogue (erp.services / erp.order_items).
 *
 * Same rule as money.ts: never a JS float. Dimensions are decimal strings (meters, up to 3 decimals —
 * millimeter precision), parsed into scaled bigints exactly like money, multiplied as bigints, and
 * rescaled to MONEY_SCALE before being handed to computeDocument as an ordinary unitPrice. computeDocument
 * itself needs no changes: quantity × unitPrice × (1 − discount) already does the right thing once
 * unitPrice is "the price of one piece of this exact size."
 */
import { divRound, formatScaled, MONEY_SCALE, parseScaled } from './money';

export const PRICING_UNITS = ['m2', 'per_item', 'per_linear_m'] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

/** Meters, up to millimeter precision. Independent of MONEY_SCALE on purpose — a dimension is a length, not money. */
export const DIMENSION_SCALE = 3;

function rescale(value: bigint, fromScale: number, toScale: number): bigint {
  if (toScale === fromScale) return value;
  if (toScale > fromScale) return value * 10n ** BigInt(toScale - fromScale);
  return divRound(value, 10n ** BigInt(fromScale - toScale));
}

export interface ServiceForPricing {
  pricingUnit: PricingUnit;
  /** Decimal string, up to MONEY_SCALE decimals. Meaning depends on pricingUnit: DA per m², per single
   * piece of any length for per_linear_m, or per whole batch (see batchSize) for per_item. */
  priceRatio: string;
  /** Only meaningful for per_item (e.g. 1000 for "priced per 1000 cards"); 1 for the other units. */
  batchSize: string;
}

export interface ServiceDimensions {
  /** Required, and only meaningful, for pricingUnit 'm2'. Meters, e.g. "1.250". */
  width?: string;
  height?: string;
  /** Required, and only meaningful, for pricingUnit 'per_linear_m'. Meters. */
  length?: string;
}

/**
 * The price of ONE piece as described by `dims` — the caller still multiplies by quantity (how many such
 * pieces) via the normal computeDocument path. Throws RangeError on a missing/invalid dimension for the
 * service's pricing unit — the caller is expected to have already validated this shape with zod; this is
 * the last-line defense, not the primary validation surface.
 */
export function computeServiceUnitPrice(service: ServiceForPricing, dims: ServiceDimensions): string {
  const ratio = parseScaled(service.priceRatio, MONEY_SCALE);

  if (service.pricingUnit === 'm2') {
    if (!dims.width || !dims.height) throw new RangeError('Width and height are required for an area-priced service');
    const w = parseScaled(dims.width, DIMENSION_SCALE);
    const h = parseScaled(dims.height, DIMENSION_SCALE);
    if (w <= 0n || h <= 0n) throw new RangeError('Width and height must be greater than zero');
    // Round exactly once, at the very end — rescaling the area to MONEY_SCALE as an intermediate step
    // first would round twice and compound error (e.g. 1.111×1.111 m² × 3 DA: rounding the area to 4
    // decimals first gives a different, less accurate answer than rounding the final product once).
    const combinedScale = DIMENSION_SCALE * 2 + MONEY_SCALE;
    return formatScaled(rescale(ratio * w * h, combinedScale, MONEY_SCALE), MONEY_SCALE);
  }

  if (service.pricingUnit === 'per_linear_m') {
    if (!dims.length) throw new RangeError('Length is required for a linear-metre-priced service');
    const len = parseScaled(dims.length, DIMENSION_SCALE);
    if (len <= 0n) throw new RangeError('Length must be greater than zero');
    const lenAtMoneyScale = rescale(len, DIMENSION_SCALE, MONEY_SCALE);
    return formatScaled(rescale(ratio * lenAtMoneyScale, MONEY_SCALE * 2, MONEY_SCALE), MONEY_SCALE);
  }

  // per_item: ratio is the price of a whole batch (batchSize physical items) — dividing it down to a
  // per-single-item price up front means quantity (the real physical count) plugs straight into the
  // existing qty × unitPrice math with no further special-casing.
  // ratio and batch are both scale MONEY_SCALE (real × 10^4). (ratio × 10^4) / batch = (ratio/batch) × 10^4
  // — already the correct output scale, not 2×MONEY_SCALE like the other two branches.
  const batch = parseScaled(service.batchSize, MONEY_SCALE);
  if (batch <= 0n) throw new RangeError('batchSize must be greater than zero');
  return formatScaled(divRound(ratio * 10n ** BigInt(MONEY_SCALE), batch), MONEY_SCALE);
}
