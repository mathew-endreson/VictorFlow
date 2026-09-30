import { z } from 'zod';

export const DEFAULT_LINE_UNIT = 'u';
export const MAX_LINE_UNIT_LENGTH = 20;

/**
 * A line's unit of measure ("u", "m", "kg", "pcs", "m²", "متر"). It must contain at least one letter: a bare number
 * such as "0" or "12" is a typo (usually a quantity typed into the wrong box), not a unit — so an empty or
 * number-only value falls back to "u" instead of being saved.
 */
export function normalizeLineUnit(input: string | null | undefined): string {
  const unit = (input ?? '').trim();
  return unit.length > 0 && unit.length <= MAX_LINE_UNIT_LENGTH && /\p{L}/u.test(unit) ? unit : DEFAULT_LINE_UNIT;
}

/** A document line's `unit`: optional on input, always a real unit on output (see normalizeLineUnit). */
export const lineUnitSchema = z
  .string()
  .trim()
  .max(MAX_LINE_UNIT_LENGTH)
  .optional()
  .transform((v) => normalizeLineUnit(v));
