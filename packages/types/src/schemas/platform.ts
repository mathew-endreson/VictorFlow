import { z } from 'zod';
import type { LicenseFeature } from '../enums';
import { createUserSchema } from './auth';
import { paginationSchema, uuidSchema } from './common';

// ── licensing ────────────────────────────────────────────────────────────────

export interface LicenceSeats {
  /** Desktop sessions open at the same time (company PCs). */
  desktop: number;
  /** Users signed in on the mobile app. */
  mobile: number;
}

/** What a signed licence grants. A licence is perpetual: `updatesUntil` limits which versions it covers, not time. */
export interface EntitlementDto {
  licenceId: string;
  shop: string;
  /** Display only (e.g. "Standard"); what is unlocked is `modules`. */
  edition: string;
  activationCode: string;
  hardwareId: string;
  seats: LicenceSeats;
  modules: LicenseFeature[];
  issuedAt: string;
  /** YYYY-MM-DD: versions released after this date run read-only on this licence. */
  updatesUntil: string;
}

/** active = everything the licence includes works; read_only = the licence check failed, only reads and exports work. */
export type LicenceState = 'active' | 'read_only';

export interface LicenceProblem {
  code: string;
  message: string;
}

export interface LicenseStatusDto {
  mode: 'dev' | 'crypto';
  /** LICENSE_ENFORCE — when false nothing is ever blocked, whatever the licence says (development only). */
  enforced: boolean;
  valid: boolean;
  state: LicenceState;
  entitlement: EntitlementDto | null;
  problem: LicenceProblem | null;
  /** This server's hardware id — the licence is bound to it. */
  hardwareId: string;
  /** The activation code of the installed licence when it can be read, even if it fails here (a transfer reuses it). */
  activationCode: string | null;
  /** The release date of this version (compared with the licence's updatesUntil). */
  releaseDate: string;
  /** Whether online activation is configured (a licence server address is set). */
  online: boolean;
}

/** What every signed-in user may know: which modules to show, and whether the install is read-only. */
export interface LicenceSummaryDto {
  mode: 'dev' | 'crypto';
  state: LicenceState;
  modules: LicenseFeature[];
  /** The problem code when read-only (BAD_SIGNATURE, HARDWARE_MISMATCH, UPDATES_EXPIRED …). */
  problem: string | null;
}

export interface LicenceRequestDto {
  activationCode: string;
  hardwareId: string;
  /** What the shop sends to BluxTech. */
  requestCode: string;
}

export const activationRequestSchema = z.object({ code: z.string().trim().min(12).max(40) });
export type ActivationRequestDto = z.infer<typeof activationRequestSchema>;

/** The licence text as pasted, or the content of the .vfl file. */
export const installLicenceSchema = z.object({ licence: z.string().min(10).max(16_384) });
export type InstallLicenceDto = z.infer<typeof installLicenceSchema>;

// ── onboarding ───────────────────────────────────────────────────────────────

/** First run: licence, then the company profile, then the owner's account. */
export const ONBOARDING_STEPS = ['licence', 'company', 'owner', 'done'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingStatusDto {
  step: OnboardingStep;
  /** The fields below are only sent while onboarding is not done. */
  mode?: 'dev' | 'crypto';
  hardwareId?: string;
  online?: boolean;
  /** The licence installed so far, once it is valid. */
  licence?: EntitlementDto | null;
  /** Why the licence step is not passed yet (NO_LICENSE_FILE before anything was installed). */
  problem?: LicenceProblem | null;
}

export const onboardingOwnerSchema = createUserSchema.omit({ roles: true });
export type OnboardingOwnerDto = z.infer<typeof onboardingOwnerSchema>;

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
