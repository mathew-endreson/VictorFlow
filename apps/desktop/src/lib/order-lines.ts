import { computeLine, computeServiceUnitPrice, formatMoney, type OrderLineInput, type ServiceDto } from '@victorflow/types';

/**
 * One editable row of the order form. Everything is a STRING, exactly as it will be sent — money never
 * becomes a float. A row is either service-priced (serviceId set, unitPrice computed from the service +
 * whichever dimension it needs — the employee never types a price) or manual (serviceId empty, unitPrice
 * typed directly). A manual row, or overriding a service-priced row's computed price, both require
 * sales.order.override_price and a reason — gating that lives in the UI (hide/disable) AND, always, on
 * the server (never trust the client to have hidden a field).
 */
export interface LineDraft {
  key: string;
  serviceId: string; // '' = no service (a fully manual/custom line)
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  tvaRate: string;
  width: string;
  height: string;
  length: string;
  /** True once the operator has chosen to override a service line's computed price. Meaningless (and
   * ignored) when serviceId is empty — a line with no service is inherently a manual price already. */
  override: boolean;
  overrideReason: string;
}

let seq = 0;
export const blankLine = (over: Partial<LineDraft> = {}): LineDraft => ({
  key: `l${++seq}`,
  serviceId: '',
  description: '',
  unit: 'u',
  quantity: '1',
  unitPrice: '',
  discountPct: '0',
  tvaRate: '19',
  width: '',
  height: '',
  length: '',
  override: false,
  overrideReason: '',
  ...over,
});

const DEC4 = /^\d{1,11}(\.\d{1,4})?$/;
const PCT = /^\d{1,3}(\.\d{1,2})?$/;
const DIM = /^\d{1,4}(\.\d{1,3})?$/;

export interface LinePreview {
  ht: string;
  tva: string;
  ttc: string;
  /** The computed unit price for a service line (before rounding into ht/tva/ttc) — shown read-only next
   * to the (disabled) price field so the operator sees where the number came from. */
  computedUnitPrice: string | null;
}

/** What is wrong with a row. A code, not a sentence: the screen words it in the user's language. */
export type LineProblem = 'description' | 'quantity' | 'unitPrice' | 'discount' | 'tva' | 'dimensions' | 'overrideReason';

const isManualPrice = (l: LineDraft) => l.serviceId === '' || l.override;

/** Computes a service line's unit price from its dimensions, or null if the service/dimensions aren't
 * resolvable yet (still being typed) — callers treat null as "not ready to preview", not as an error. */
function serviceUnitPrice(l: LineDraft, service: ServiceDto | undefined): string | null {
  if (!service) return null;
  try {
    return computeServiceUnitPrice(
      { pricingUnit: service.pricingUnit, priceRatio: service.priceRatio, batchSize: service.batchSize },
      { width: l.width || undefined, height: l.height || undefined, length: l.length || undefined },
    );
  } catch {
    return null;
  }
}

/** Problems with the NUMBERS of a row (mirrors the server's zod rules). services is only needed to
 * validate a service line's dimensions — pass an empty map to skip that check (e.g. before it has loaded). */
function numericProblem(l: LineDraft, services: ReadonlyMap<string, ServiceDto>): LineProblem | null {
  if (!DEC4.test(l.quantity) || Number(l.quantity) <= 0) return 'quantity';
  if (l.serviceId && !l.override) {
    const service = services.get(l.serviceId);
    if (service) {
      if (service.pricingUnit === 'm2' && (!DIM.test(l.width) || Number(l.width) <= 0 || !DIM.test(l.height) || Number(l.height) <= 0)) return 'dimensions';
      if (service.pricingUnit === 'per_linear_m' && (!DIM.test(l.length) || Number(l.length) <= 0)) return 'dimensions';
    }
  } else {
    if (!DEC4.test(l.unitPrice)) return 'unitPrice';
    if (!l.overrideReason.trim()) return 'overrideReason';
  }
  if (!PCT.test(l.discountPct) || Number(l.discountPct) > 100) return 'discount';
  if (!PCT.test(l.tvaRate) || Number(l.tvaRate) > 100) return 'tva';
  return null;
}

/** Is this row ready to be saved? (null = yes). */
export function lineProblem(l: LineDraft, services: ReadonlyMap<string, ServiceDto> = new Map()): LineProblem | null {
  if (!l.serviceId && !l.description.trim()) return 'description';
  return numericProblem(l, services);
}

/**
 * Live preview using the SAME bigint maths the server uses (computeLine / computeServiceUnitPrice from
 * @victorflow/types) — so the total on screen while typing is, to the centime, the total the server will
 * store. A row shows its amounts as soon as its numbers (and, for a service line, its dimensions) are
 * valid; rows that are not ready yet show nothing and are left out of the totals.
 */
export function previewLines(lines: readonly LineDraft[], services: ReadonlyMap<string, ServiceDto> = new Map()): { rows: Array<LinePreview | null>; totalHt: string; totalTva: string; totalTtc: string } {
  let ht = 0n;
  let tva = 0n;
  let ttc = 0n;
  const rows = lines.map((l): LinePreview | null => {
    if (numericProblem(l, services)) return null;
    const manual = isManualPrice(l);
    const computed = manual ? null : serviceUnitPrice(l, services.get(l.serviceId));
    const unitPrice = manual ? l.unitPrice : computed;
    if (unitPrice == null) return null;
    try {
      const a = computeLine({ quantity: l.quantity, unitPrice, discountPct: l.discountPct, tvaRate: l.tvaRate });
      ht += a.ht;
      tva += a.tva;
      ttc += a.ttc;
      return { ht: formatMoney(a.ht), tva: formatMoney(a.tva), ttc: formatMoney(a.ttc), computedUnitPrice: computed };
    } catch {
      return null;
    }
  });
  return { rows, totalHt: formatMoney(ht), totalTva: formatMoney(tva), totalTtc: formatMoney(ttc) };
}

export const toItemsPayload = (lines: readonly LineDraft[], services: ReadonlyMap<string, ServiceDto>): OrderLineInput[] =>
  lines.map((l) => {
    const manual = isManualPrice(l);
    const service = services.get(l.serviceId);
    return {
      ...(l.serviceId && { serviceId: l.serviceId }),
      description: l.description.trim() || undefined,
      unit: l.unit.trim() || 'u',
      quantity: l.quantity,
      discountPct: l.discountPct,
      tvaRate: l.tvaRate,
      ...(manual ? { unitPrice: l.unitPrice, overrideReason: l.overrideReason.trim() } : {}),
      ...(!manual && service?.pricingUnit === 'm2' && { width: l.width, height: l.height }),
      ...(!manual && service?.pricingUnit === 'per_linear_m' && { length: l.length }),
    };
  });
