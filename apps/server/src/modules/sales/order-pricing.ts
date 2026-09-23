import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { Database, Kysely, Row } from '@victorflow/db';
import { computeServiceUnitPrice, type DocumentLineDto, type DocumentLineInput, type OrderLineInput, type PricingUnit } from '@victorflow/types';
import { LINE_COLUMNS, toLineDto } from './documents';

/** LINE_COLUMNS plus the pricing-provenance columns only order_items has (quote_items does not, and
 * documents.ts's shared LINE_COLUMNS/toLineDto stay untouched so quotes are unaffected). */
export const ORDER_LINE_COLUMNS = [
  ...LINE_COLUMNS,
  'service_id', 'pricing_unit_snapshot', 'price_ratio_snapshot', 'batch_size_snapshot',
  'piece_width', 'piece_height', 'piece_length', 'is_price_override', 'override_reason',
] as const;

type OrderLineRow = Pick<Row<'erp.order_items'>, (typeof ORDER_LINE_COLUMNS)[number]>;

export const toOrderLineDto = (r: OrderLineRow): DocumentLineDto => ({
  ...toLineDto(r),
  serviceId: r.service_id,
  pricingUnitSnapshot: r.pricing_unit_snapshot,
  priceRatioSnapshot: r.price_ratio_snapshot,
  batchSizeSnapshot: r.batch_size_snapshot,
  pieceWidth: r.piece_width,
  pieceHeight: r.piece_height,
  pieceLength: r.piece_length,
  isPriceOverride: r.is_price_override,
  overrideReason: r.override_reason,
});

/** The extra (non-computeDocument) columns an order line carries once priced — zipped back onto
 * priceDocument's output by array position before the insert. */
export interface LineProvenance {
  service_id: string | null;
  pricing_unit_snapshot: PricingUnit | null;
  price_ratio_snapshot: string | null;
  batch_size_snapshot: string | null;
  piece_width: string | null;
  piece_height: string | null;
  piece_length: string | null;
  is_price_override: boolean;
  override_reason: string | null;
}

/**
 * Resolves what the client sent (either a service + dimensions, or — permission-gated — a fully manual
 * price) into a plain DocumentLineInput (for the existing, unchanged priceDocument/computeDocument path)
 * plus its provenance. The employee never types a price for a service-based line: unitPrice always comes
 * from computeServiceUnitPrice here, never from the request body.
 */
export async function resolveOrderLines(
  db: Kysely<Database>,
  items: readonly OrderLineInput[],
  canOverridePrice: boolean,
): Promise<{ lines: DocumentLineInput[]; provenance: LineProvenance[] }> {
  const lines: DocumentLineInput[] = [];
  const provenance: LineProvenance[] = [];

  for (const item of items) {
    const service = item.serviceId
      ? await db
          .selectFrom('erp.services')
          .select(['id', 'name', 'pricing_unit', 'price_ratio', 'batch_size', 'is_active'])
          .where('id', '=', item.serviceId)
          .executeTakeFirst()
      : null;
    if (item.serviceId && !service) throw new UnprocessableEntityException({ message: 'Service does not exist', code: 'UNKNOWN_SERVICE' });
    if (service && !service.is_active) throw new UnprocessableEntityException({ message: `Service "${service.name}" is no longer active`, code: 'SERVICE_INACTIVE' });

    let unitPrice: string;
    if (item.unitPrice != null) {
      // Override: an admin-typed price, either alongside a service (kept for reporting/re-use of its
      // dimensions) or with none at all (a fully custom line). orderLineInputSchema already guarantees
      // overrideReason (and, with no service, description) are present. Checked here, not only at the
      // controller, because one request can mix auto-priced and overridden lines — a blanket route guard
      // can't tell them apart.
      if (!canOverridePrice) {
        throw new ForbiddenException({ message: 'Missing permission: sales.order.override_price', code: 'PRICE_OVERRIDE_NOT_ALLOWED' });
      }
      unitPrice = item.unitPrice;
    } else {
      // service is guaranteed non-null here: the schema requires serviceId when unitPrice is absent.
      try {
        unitPrice = computeServiceUnitPrice(
          { pricingUnit: service!.pricing_unit, priceRatio: service!.price_ratio, batchSize: service!.batch_size },
          { width: item.width, height: item.height, length: item.length },
        );
      } catch (err) {
        if (err instanceof RangeError) throw new UnprocessableEntityException({ message: err.message, code: 'INVALID_DIMENSIONS' });
        throw err;
      }
    }

    lines.push({
      description: item.description ?? service!.name,
      unit: item.unit ?? 'u',
      quantity: item.quantity,
      unitPrice,
      discountPct: item.discountPct,
      tvaRate: item.tvaRate,
    });
    provenance.push({
      service_id: service?.id ?? null,
      pricing_unit_snapshot: service?.pricing_unit ?? null,
      price_ratio_snapshot: service?.price_ratio ?? null,
      batch_size_snapshot: service?.batch_size ?? null,
      piece_width: item.width ?? null,
      piece_height: item.height ?? null,
      piece_length: item.length ?? null,
      is_price_override: item.unitPrice != null,
      override_reason: item.overrideReason ?? null,
    });
  }

  return { lines, provenance };
}
