/**
 * Money maths for VictorFlow.
 *
 * Rules:
 *  - Money NEVER touches a JS float. On the wire and in the DB it is a decimal string
 *    ("1234.5600" ↔ NUMERIC(15,4)); in arithmetic it is a bigint scaled by 10^4.
 *  - DZD is invoiced to the centime, so every *line* amount is rounded (half away from
 *    zero) to 2 decimals and then stored with 4-decimal scale.
 *  - Document totals are the exact sum of the rounded line amounts, so an invoice can
 *    never disagree with the sum of its own lines.
 */

export const MONEY_SCALE = 4;
export const DEFAULT_TVA_RATE = '19.00';

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Parse a decimal string into a bigint scaled by 10^scale. Rejects anything that would lose digits. */
export function parseScaled(input: string, scale: number = MONEY_SCALE): bigint {
  if (typeof input !== 'string') throw new TypeError(`Expected a decimal string, got ${typeof input}`);
  const m = DECIMAL_RE.exec(input.trim());
  if (!m) throw new RangeError(`Invalid decimal: "${input}"`);
  const sign = m[1] ?? '';
  const int = m[2] ?? '0';
  const frac = m[3] ?? '';
  if (frac.length > scale) throw new RangeError(`Too many decimals (max ${scale}): "${input}"`);
  const v = BigInt(int + frac.padEnd(scale, '0'));
  return sign === '-' ? -v : v;
}

/** Inverse of parseScaled. */
export function formatScaled(value: bigint, scale: number = MONEY_SCALE): string {
  const neg = value < 0n;
  const digits = (neg ? -value : value).toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  return `${neg ? '-' : ''}${int}${scale > 0 ? `.${frac}` : ''}`;
}

export const parseMoney = (s: string): bigint => parseScaled(s, MONEY_SCALE);
export const formatMoney = (v: bigint): string => formatScaled(v, MONEY_SCALE);

/** Normalise any valid decimal string to canonical 4-decimal form ("12.5" → "12.5000"). */
export const normalizeMoney = (s: string): string => formatMoney(parseMoney(s));

/** Integer division rounding half away from zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError('Division by zero');
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return negative ? -q : q;
}

export function sumMoney(values: readonly string[]): string {
  return formatMoney(values.reduce((acc, v) => acc + parseMoney(v), 0n));
}

export interface LineInput {
  /** Decimal string, up to 4 decimals. */
  quantity: string;
  /** Unit price HT, up to 4 decimals. */
  unitPrice: string;
  /** Percent 0–100, up to 2 decimals. Default "0". */
  discountPct?: string;
  /** TVA percent, up to 2 decimals. Default "19.00". */
  tvaRate?: string;
}

export interface LineAmounts {
  ht: bigint;
  tva: bigint;
  ttc: bigint;
}

/**
 * HT  = round₂(qty × unitPrice × (1 − discount%))
 * TVA = round₂(HT × rate%)
 * TTC = HT + TVA
 * Returned bigints are scaled by 10^4 and always a whole number of centimes.
 */
export function computeLine(input: LineInput): LineAmounts {
  const qty = parseScaled(input.quantity, 4);
  const price = parseScaled(input.unitPrice, 4);
  const discountBp = parseScaled(input.discountPct ?? '0', 2); // 12.50 → 1250
  const rateBp = parseScaled(input.tvaRate ?? DEFAULT_TVA_RATE, 2); // 19.00 → 1900

  if (qty < 0n || price < 0n) throw new RangeError('Quantity and unit price must be non-negative');
  if (discountBp < 0n || discountBp > 10_000n) throw new RangeError('Discount must be between 0 and 100');
  if (rateBp < 0n || rateBp > 10_000n) throw new RangeError('TVA rate must be between 0 and 100');

  // qty(4) × price(4) × (10000 − discountBp)(4, i.e. a fraction of 10000) → scale 12; centimes are scale 2.
  const htCents = divRound(qty * price * (10_000n - discountBp), 10n ** 10n);
  const tvaCents = divRound(htCents * rateBp, 10_000n);
  return { ht: htCents * 100n, tva: tvaCents * 100n, ttc: (htCents + tvaCents) * 100n };
}

export interface LineTotalsStrings {
  ht: string;
  tva: string;
  ttc: string;
}

export interface DocumentTotals<L extends LineInput = LineInput> {
  lines: Array<L & LineTotalsStrings>;
  totalHt: string;
  totalTva: string;
  totalTtc: string;
}

export function computeDocument<L extends LineInput>(lines: readonly L[]): DocumentTotals<L> {
  let ht = 0n;
  let tva = 0n;
  let ttc = 0n;
  const out = lines.map((line) => {
    const a = computeLine(line);
    ht += a.ht;
    tva += a.tva;
    ttc += a.ttc;
    return { ...line, ht: formatMoney(a.ht), tva: formatMoney(a.tva), ttc: formatMoney(a.ttc) };
  });
  return { lines: out, totalHt: formatMoney(ht), totalTva: formatMoney(tva), totalTtc: formatMoney(ttc) };
}

/** "1234567.5000" → "1 234 567,50 DA" (display only — never parse this back). */
export function formatDZD(value: string, opts: { symbol?: boolean } = {}): string {
  const scaled = parseMoney(value);
  const cents = divRound(scaled, 100n); // → 2 decimals
  const neg = cents < 0n;
  const digits = (neg ? -cents : cents).toString().padStart(3, '0');
  const int = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const frac = digits.slice(-2);
  const body = `${neg ? '-' : ''}${int},${frac}`;
  return opts.symbol === false ? body : `${body} DA`;
}
