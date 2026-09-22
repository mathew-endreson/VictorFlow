import { computeLine, formatMoney, type DocumentLineInput } from '@victorflow/types';

/** One editable row of the order form. Everything is a STRING, exactly as it will be sent — money never becomes a float. */
export interface LineDraft {
  key: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  tvaRate: string;
}

let seq = 0;
export const blankLine = (over: Partial<LineDraft> = {}): LineDraft => ({
  key: `l${++seq}`,
  description: '',
  unit: 'u',
  quantity: '1',
  unitPrice: '',
  discountPct: '0',
  tvaRate: '19',
  ...over,
});

const DEC4 = /^\d{1,11}(\.\d{1,4})?$/;
const PCT = /^\d{1,3}(\.\d{1,2})?$/;

export interface LinePreview {
  ht: string;
  tva: string;
  ttc: string;
}

/** What is wrong with a row. A code, not a sentence: the screen words it in the user's language. */
export type LineProblem = 'description' | 'quantity' | 'unitPrice' | 'discount' | 'tva';

/** Problems with the NUMBERS of a row (mirrors the server's zod rules). */
function numericProblem(l: LineDraft): LineProblem | null {
  if (!DEC4.test(l.quantity) || Number(l.quantity) <= 0) return 'quantity'; // positive, max 4 decimals
  if (!DEC4.test(l.unitPrice)) return 'unitPrice'; // a number, max 4 decimals
  if (!PCT.test(l.discountPct) || Number(l.discountPct) > 100) return 'discount'; // 0–100
  if (!PCT.test(l.tvaRate) || Number(l.tvaRate) > 100) return 'tva'; // 0–100
  return null;
}

/** Is this row ready to be saved? (null = yes). */
export function lineProblem(l: LineDraft): LineProblem | null {
  if (!l.description.trim()) return 'description';
  return numericProblem(l);
}

/**
 * Live preview using the SAME bigint maths the server uses (computeLine from @victorflow/types) — so the total on
 * screen while typing is, to the centime, the total the server will store. A row shows its amounts as soon as its
 * numbers are valid; rows that are not valid yet show nothing and are left out of the totals.
 */
export function previewLines(lines: readonly LineDraft[]): { rows: Array<LinePreview | null>; totalHt: string; totalTva: string; totalTtc: string } {
  let ht = 0n;
  let tva = 0n;
  let ttc = 0n;
  const rows = lines.map((l): LinePreview | null => {
    if (numericProblem(l)) return null;
    try {
      const a = computeLine({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, tvaRate: l.tvaRate });
      ht += a.ht;
      tva += a.tva;
      ttc += a.ttc;
      return { ht: formatMoney(a.ht), tva: formatMoney(a.tva), ttc: formatMoney(a.ttc) };
    } catch {
      return null;
    }
  });
  return { rows, totalHt: formatMoney(ht), totalTva: formatMoney(tva), totalTtc: formatMoney(ttc) };
}

export const toItemsPayload = (lines: readonly LineDraft[]): DocumentLineInput[] =>
  lines.map((l) => ({ description: l.description.trim(), unit: l.unit.trim() || 'u', quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, tvaRate: l.tvaRate }));
