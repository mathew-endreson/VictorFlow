import { z } from 'zod';
import { STOCK_MOVE_TYPES, type StockMoveType } from '../enums';
import { customFieldsSchema } from './crm';
import { moneySchema, paginationSchema, quantitySchema, signedQuantitySchema, uuidSchema } from './common';

export const createWarehouseSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, 'e.g. "MAIN"'),
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(300).nullable().optional(),
});
export type CreateWarehouseDto = z.infer<typeof createWarehouseSchema>;

export const updateWarehouseSchema = z
  .object({ name: z.string().trim().min(2).max(120), address: z.string().trim().max(300).nullable(), isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateWarehouseDto = z.infer<typeof updateWarehouseSchema>;

const itemFields = {
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{1,39}$/, 'e.g. "VIN-ADH-BL"'),
  name: z.string().trim().min(2).max(200),
  unit: z.string().trim().min(1).max(20),
  category: z.string().trim().max(60).nullable(),
  minStock: moneySchema, // 0.0000 precision like every quantity
  customFields: customFieldsSchema,
  isActive: z.boolean(),
};

export const createItemSchema = z.object({
  sku: itemFields.sku,
  name: itemFields.name,
  unit: itemFields.unit.default('unit'),
  category: itemFields.category.optional(),
  minStock: itemFields.minStock.default('0'),
  customFields: itemFields.customFields.default({}),
});
export type CreateItemDto = z.infer<typeof createItemSchema>;

export const updateItemSchema = z
  .object({ name: itemFields.name, unit: itemFields.unit, category: itemFields.category, minStock: itemFields.minStock, customFields: itemFields.customFields, isActive: itemFields.isActive })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateItemDto = z.infer<typeof updateItemSchema>;

/**
 * RECEIPT / ISSUE take a positive `quantity` (the direction comes from the type).
 * ADJUSTMENT takes a SIGNED quantity (+ found stock, − shrinkage).
 */
export const stockMoveSchema = z
  .object({
    itemId: uuidSchema,
    warehouseId: uuidSchema,
    type: z.enum(['RECEIPT', 'ISSUE', 'ADJUSTMENT']),
    quantity: z.string(),
    /** Purchase cost per unit — required for a RECEIPT; optional for a positive ADJUSTMENT (defaults to the average). */
    unitCost: moneySchema.optional(),
    refType: z.string().trim().max(40).optional(),
    refId: uuidSchema.optional(),
    note: z.string().trim().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    const positive = quantitySchema.safeParse(v.quantity);
    const signed = signedQuantitySchema.safeParse(v.quantity);
    if (v.type === 'ADJUSTMENT' ? !signed.success : !positive.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: v.type === 'ADJUSTMENT' ? 'Adjustments take a non-zero signed decimal string, e.g. "-2.5"' : 'Quantity must be a positive decimal string (max 4 decimals)',
      });
    }
    if (v.type === 'RECEIPT' && v.unitCost === undefined) {
      ctx.addIssue({ code: 'custom', path: ['unitCost'], message: 'A receipt needs the unit cost' });
    }
    if (v.type === 'ISSUE' && v.unitCost !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['unitCost'], message: 'Issues are valued at the weighted-average cost; do not send a unit cost' });
    }
  });
export type StockMoveDto_In = z.infer<typeof stockMoveSchema>;

export const transferSchema = z
  .object({
    itemId: uuidSchema,
    fromWarehouseId: uuidSchema,
    toWarehouseId: uuidSchema,
    quantity: quantitySchema,
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.fromWarehouseId !== v.toWarehouseId, { message: 'Source and destination must differ', path: ['toWarehouseId'] });
export type TransferDto = z.infer<typeof transferSchema>;

export const itemListQuerySchema = paginationSchema.extend({
  category: z.string().trim().max(60).optional(),
  belowMin: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export type ItemListQuery = z.infer<typeof itemListQuerySchema>;

export const stockLevelQuerySchema = paginationSchema.extend({
  itemId: uuidSchema.optional(),
  warehouseId: uuidSchema.optional(),
  belowMin: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export type StockLevelQuery = z.infer<typeof stockLevelQuerySchema>;

export const stockMoveListQuerySchema = paginationSchema.extend({
  itemId: uuidSchema.optional(),
  warehouseId: uuidSchema.optional(),
  type: z.enum(STOCK_MOVE_TYPES).optional(),
});
export type StockMoveListQuery = z.infer<typeof stockMoveListQuerySchema>;

// ── responses ────────────────────────────────────────────────────────────────

export interface WarehouseDto {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
}

export interface ItemDto {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string | null;
  minStock: string;
  isActive: boolean;
  customFields: Record<string, unknown>;
  /** Total on hand across every warehouse (sum of stock_levels — O(warehouses), no scan of the move history). */
  onHand: string;
  belowMin: boolean;
}

export interface StockLevelDto {
  itemId: string;
  sku: string;
  itemName: string;
  unit: string;
  warehouseId: string;
  warehouseCode: string;
  quantity: string;
  /** Weighted-average unit cost. */
  avgCost: string;
  /** quantity × avgCost, rounded to 4 decimals. */
  value: string;
  minStock: string;
  belowMin: boolean;
}

export interface StockMoveDto {
  id: string;
  itemId: string;
  sku: string;
  itemName: string;
  warehouseId: string;
  warehouseCode: string;
  type: StockMoveType;
  /** Signed: + in, − out. */
  quantity: string;
  unitCost: string | null;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdAt: string;
}

export interface StockMoveResultDto {
  move: StockMoveDto;
  /** The (item, warehouse) stock level right after the move. */
  level: { quantity: string; avgCost: string };
}

export interface TransferResultDto {
  out: StockMoveResultDto;
  in: StockMoveResultDto;
}
