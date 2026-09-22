import { z } from 'zod';

/** Lenient 8-4-4-4-12 hex UUID (accepts any version/variant, incl. client-generated ids). */
export const uuidSchema = z.guid();

/** Non-negative decimal string, ≤ 4 decimals. Numbers are rejected on purpose: money is never a float. */
export const moneySchema = z
  .string()
  .regex(/^\d{1,11}(\.\d{1,4})?$/, 'Expected a non-negative decimal string with at most 4 decimals, e.g. "1250.50"');

export const quantitySchema = z
  .string()
  .regex(/^\d{1,11}(\.\d{1,4})?$/, 'Expected a decimal string with at most 4 decimals')
  .refine((v) => Number(v) > 0, 'Must be greater than zero');

/** Signed decimal (stock adjustments). */
export const signedQuantitySchema = z
  .string()
  .regex(/^-?\d{1,11}(\.\d{1,4})?$/, 'Expected a decimal string with at most 4 decimals')
  .refine((v) => Number(v) !== 0, 'Must not be zero');

/** 0–100 with up to 2 decimals. */
export const percentSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Expected a percentage string like "19" or "12.5"')
  .refine((v) => Number(v) <= 100, 'Must be between 0 and 100');

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Calendar date 'YYYY-MM-DD' (no time, no timezone — accounting days are not instants). */
export const isoDateSchema = z.string().refine(isValidIsoDate, 'Expected a valid date as YYYY-MM-DD');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(200));

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
