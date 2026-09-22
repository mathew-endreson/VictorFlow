import { z } from 'zod';
import type { LicenseFeature, LicenseTier } from '../enums';
import { paginationSchema, uuidSchema } from './common';

// ── licensing ────────────────────────────────────────────────────────────────

export interface EntitlementDto {
  licenseId: string;
  customer: string;
  tier: LicenseTier;
  features: LicenseFeature[];
  maxUsers: number;
  /** true when the licence only works on one machine. */
  hardwareBound: boolean;
  issuedAt: string;
  /** null = perpetual */
  expiresAt: string | null;
}

export interface LicenseStatusDto {
  mode: 'dev' | 'crypto';
  /** LICENSE_ENFORCE — when false nothing is ever blocked, whatever the licence says. */
  enforced: boolean;
  valid: boolean;
  entitlement: EntitlementDto | null;
  problem: { code: string; message: string } | null;
  /** This machine's fingerprint — quote it when requesting a hardware-bound licence. */
  hardwareId: string;
}

// ── audit ────────────────────────────────────────────────────────────────────

export const auditListQuerySchema = paginationSchema.extend({
  table: z.string().regex(/^[a-z_]+\.[a-z_]+$/, 'schema.table, e.g. "finance.invoices"').optional(),
  rowId: z.string().max(64).optional(),
  actorId: uuidSchema.optional(),
  operation: z.enum(['INSERT', 'UPDATE', 'DELETE']).optional(),
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export interface AuditEntryDto {
  id: string;
  createdAt: string;
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  rowId: string | null;
  actorId: string | null;
  actorName: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  rowHash: string;
}

export interface AuditVerifyDto {
  ok: boolean;
  checked: number;
  firstBrokenId: string | null;
  reason: string | null;
  verifiedAt: string;
}

// ── dashboard ────────────────────────────────────────────────────────────────

export interface DashboardSummaryDto {
  generatedAt: string;
  customers: { total: number; active: number };
  orders: { open: number; byStatus: Record<string, number> };
  production: { byStatus: Record<string, number> };
  invoices: { unpaidCount: number; overdueCount: number; balanceDue: string };
  revenue: {
    /** 'YYYY-MM' of the month reported */
    month: string;
    invoiceCount: number;
    ht: string;
    tva: string;
    ttc: string;
    collected: string;
  };
  lowStockItems: number;
}
