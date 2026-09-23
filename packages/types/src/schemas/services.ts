import { z } from 'zod';
import { PRICING_UNITS } from '../pricing';
import { moneySchema, paginationSchema, percentSchema, quantitySchema, uuidSchema } from './common';

/** A physical dimension in meters, up to millimeter precision (DIMENSION_SCALE in pricing.ts). */
const dimensionSchema = z
  .string()
  .regex(/^\d{1,4}(\.\d{1,3})?$/, 'A length in meters, up to 3 decimals, e.g. "1.250"')
  .refine((v) => Number(v) > 0, 'Must be greater than zero');

// ── services catalogue (admin-managed) ────────────────────────────────────────

export const createServiceSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(200),
  pricingUnit: z.enum(PRICING_UNITS),
  priceRatio: moneySchema,
  /** Only meaningful for pricingUnit "per_item" (e.g. 1000 for "priced per 1000 cards"); defaults to 1 (plain per-unit pricing) for the other units. */
  batchSize: moneySchema.default('1'),
});
export type CreateServiceDto = z.infer<typeof createServiceSchema>;

export const updateServiceSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    priceRatio: moneySchema,
    batchSize: moneySchema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateServiceDto = z.infer<typeof updateServiceSchema>;

export const serviceListQuerySchema = paginationSchema.extend({
  activeOnly: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export type ServiceListQuery = z.infer<typeof serviceListQuerySchema>;

export interface ServiceDto {
  id: string;
  code: string;
  name: string;
  pricingUnit: (typeof PRICING_UNITS)[number];
  priceRatio: string;
  batchSize: string;
  isActive: boolean;
}

// ── order lines: either a service the server prices, or a permission-gated manual override ──────────

/**
 * What the client sends for one order line — three shapes:
 *   - serviceId, no unitPrice: auto-priced (+ quantity + whichever of width/height/length that service's
 *     pricing unit needs). The employee never types a price. The normal case.
 *   - serviceId AND unitPrice + overrideReason: the line still references a service (kept for reporting/
 *     re-use, and its dimensions if given), but an admin has manually overridden the computed price for a
 *     custom/odd job. Requires sales.order.override_price.
 *   - no serviceId, unitPrice + description + overrideReason: a fully custom line with no matching
 *     service at all. Same permission.
 * Permission is checked server-side (zod has no request context), never trust the client to have hidden
 * the field. Dimensions are validated against the SPECIFIC service's pricingUnit server-side too, not
 * here — this schema only knows the shapes are individually well-formed.
 */
export const orderLineInputSchema = z
  .object({
    serviceId: uuidSchema.optional(),
    description: z.string().trim().min(1).max(500).optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    quantity: quantitySchema,
    width: dimensionSchema.optional(),
    height: dimensionSchema.optional(),
    length: dimensionSchema.optional(),
    unitPrice: moneySchema.optional(),
    overrideReason: z.string().trim().min(3).max(500).optional(),
    discountPct: percentSchema.default('0'),
    tvaRate: percentSchema.default('19'),
  })
  .refine((v) => v.serviceId != null || v.unitPrice != null, {
    message: 'Provide a serviceId (auto-priced) or a manual unitPrice',
    path: ['serviceId'],
  })
  .refine((v) => v.unitPrice == null || v.overrideReason, {
    message: 'A manually-priced line needs an override reason',
    path: ['overrideReason'],
  })
  .refine((v) => v.serviceId != null || v.description, {
    message: 'A line with no service needs a description',
    path: ['description'],
  });
export type OrderLineInput = z.infer<typeof orderLineInputSchema>;
