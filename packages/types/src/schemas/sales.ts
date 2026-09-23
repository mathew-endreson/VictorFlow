import { z } from 'zod';
import { ORDER_STATUSES, QUOTE_STATUSES, type InvoiceStatus, type OrderStatus, type QuoteStatus } from '../enums';
import type { PricingUnit } from '../pricing';
import { isoDateSchema, moneySchema, paginationSchema, percentSchema, quantitySchema, uuidSchema } from './common';
import { orderLineInputSchema } from './services';

export const documentLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  unit: z.string().trim().min(1).max(20).default('u'),
  quantity: quantitySchema,
  unitPrice: moneySchema,
  discountPct: percentSchema.default('0'),
  tvaRate: percentSchema.default('19'),
});
export type DocumentLineInput = z.infer<typeof documentLineSchema>;

const notes = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();
const optionalDate = isoDateSchema.nullable().optional();

export const createQuoteSchema = z.object({
  customerId: uuidSchema,
  validUntil: optionalDate,
  notes,
  items: z.array(documentLineSchema).min(1, 'A quote needs at least one line').max(200),
});
export type CreateQuoteDto = z.infer<typeof createQuoteSchema>;

export const updateQuoteSchema = z
  .object({
    customerId: uuidSchema,
    validUntil: optionalDate,
    notes,
    items: z.array(documentLineSchema).min(1).max(200),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateQuoteDto = z.infer<typeof updateQuoteSchema>;

export const createOrderSchema = z.object({
  customerId: uuidSchema,
  dueDate: optionalDate,
  notes,
  items: z.array(orderLineInputSchema).min(1, 'An order needs at least one line').max(200),
});
export type CreateOrderDto = z.infer<typeof createOrderSchema>;

export const updateOrderSchema = z
  .object({
    customerId: uuidSchema,
    dueDate: optionalDate,
    notes,
    items: z.array(orderLineInputSchema).min(1).max(200),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateOrderDto = z.infer<typeof updateOrderSchema>;

export const quoteListQuerySchema = paginationSchema.extend({
  status: z.enum(QUOTE_STATUSES).optional(),
  customerId: uuidSchema.optional(),
});
export type QuoteListQuery = z.infer<typeof quoteListQuerySchema>;

export const orderListQuerySchema = paginationSchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  customerId: uuidSchema.optional(),
  /** true → only orders that can be invoiced right now: CONFIRMED / IN_PRODUCTION / COMPLETED with no live invoice. */
  uninvoiced: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

// ── responses ────────────────────────────────────────────────────────────────

export interface DocumentLineDto {
  id: string;
  position: number;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  tvaRate: string;
  lineHt: string;
  lineTva: string;
  lineTtc: string;
  // Order lines only (undefined for quote lines) — pricing provenance, snapshotted at creation so a later
  // change to the service's rate can never retroactively re-price this line.
  serviceId?: string | null;
  pricingUnitSnapshot?: PricingUnit | null;
  priceRatioSnapshot?: string | null;
  batchSizeSnapshot?: string | null;
  pieceWidth?: string | null;
  pieceHeight?: string | null;
  pieceLength?: string | null;
  isPriceOverride?: boolean;
  overrideReason?: string | null;
}

export interface DocumentTotalsDto {
  totalHt: string;
  totalTva: string;
  totalTtc: string;
}

export interface QuoteSummaryDto extends DocumentTotalsDto {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  status: QuoteStatus;
  quoteDate: string;
  validUntil: string | null;
  convertedOrderId: string | null;
  createdAt: string;
}

export interface QuoteDetailDto extends QuoteSummaryDto {
  notes: string | null;
  items: DocumentLineDto[];
}

export interface OrderSummaryDto extends DocumentTotalsDto {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  status: OrderStatus;
  orderDate: string;
  dueDate: string | null;
  createdAt: string;
}

export interface OrderDetailDto extends OrderSummaryDto {
  notes: string | null;
  quoteId: string | null;
  confirmedAt: string | null;
  items: DocumentLineDto[];
  productionOrder: { id: string; number: string; status: string } | null;
  invoice: { id: string; number: string; status: InvoiceStatus } | null;
}
