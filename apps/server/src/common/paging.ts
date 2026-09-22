import type { Page } from '@victorflow/types';

/** Escape LIKE wildcards so a user typing "50%" searches for "50%", not "50<anything>". */
export const likePattern = (search: string): string => `%${search.replace(/[\\%_]/g, '\\$&')}%`;

export const offsetOf = (page: number, pageSize: number): number => (page - 1) * pageSize;

export function toPage<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, total, page, pageSize };
}

/** count(*) comes back from pg as a string. */
export const toCount = (n: string | number | bigint): number => Number(n);

export const iso = (d: Date): string => d.toISOString();
export const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);
