import { UnprocessableEntityException } from '@nestjs/common';
import type { Database, Kysely, Row } from '@victorflow/db';
import { computeDocument, type DocumentLineDto, type DocumentLineInput } from '@victorflow/types';

/** Rows ready for order_items / quote_items (minus the parent id), plus header totals. */
export interface PricedDocument {
  rows: Array<{
    position: number;
    description: string;
    unit: string;
    quantity: string;
    unit_price: string;
    discount_pct: string;
    tva_rate: string;
    line_ht: string;
    line_tva: string;
    line_ttc: string;
  }>;
  totals: { total_ht: string; total_tva: string; total_ttc: string };
}

/**
 * The single place where quote/order lines are priced. Uses the exact bigint money maths from
 * @victorflow/types — the same code the desktop uses for its live preview — so client and server
 * can never disagree on a total.
 */
export function priceDocument(items: readonly DocumentLineInput[]): PricedDocument {
  let doc;
  try {
    doc = computeDocument(items);
  } catch (err) {
    if (err instanceof RangeError || err instanceof TypeError) {
      throw new UnprocessableEntityException({ message: err.message, code: 'INVALID_LINE' });
    }
    throw err;
  }
  return {
    rows: doc.lines.map((l, i) => ({
      position: i + 1,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      discount_pct: l.discountPct,
      tva_rate: l.tvaRate,
      line_ht: l.ht,
      line_tva: l.tva,
      line_ttc: l.ttc,
    })),
    totals: { total_ht: doc.totalHt, total_tva: doc.totalTva, total_ttc: doc.totalTtc },
  };
}

type LineRow = Pick<
  Row<'erp.order_items'>,
  'id' | 'position' | 'description' | 'unit' | 'quantity' | 'unit_price' | 'discount_pct' | 'tva_rate' | 'line_ht' | 'line_tva' | 'line_ttc'
>;

export const LINE_COLUMNS = [
  'id', 'position', 'description', 'unit', 'quantity', 'unit_price', 'discount_pct', 'tva_rate', 'line_ht', 'line_tva', 'line_ttc',
] as const;

export const toLineDto = (r: LineRow): DocumentLineDto => ({
  id: r.id,
  position: r.position,
  description: r.description,
  unit: r.unit,
  quantity: r.quantity,
  unitPrice: r.unit_price,
  discountPct: r.discount_pct,
  tvaRate: r.tva_rate,
  lineHt: r.line_ht,
  lineTva: r.line_tva,
  lineTtc: r.line_ttc,
});

/** Quotes and orders may only be raised for a customer that exists and is active. */
export async function assertCustomerActive(db: Kysely<Database>, customerId: string): Promise<void> {
  const c = await db.selectFrom('crm.customers').select(['id', 'is_active']).where('id', '=', customerId).executeTakeFirst();
  if (!c) throw new UnprocessableEntityException({ message: 'Customer does not exist', code: 'UNKNOWN_CUSTOMER' });
  if (!c.is_active) throw new UnprocessableEntityException({ message: 'Customer is inactive', code: 'CUSTOMER_INACTIVE' });
}
