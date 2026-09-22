import { z } from 'zod';
import {
  ACCOUNT_TYPES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  type AccountType,
  type EntrySourceType,
  type EntryStatus,
  type InvoiceStatus,
  type JournalType,
  type PaymentMethod,
} from '../enums';
import { isoDateSchema, moneySchema, paginationSchema, uuidSchema } from './common';
import type { DocumentLineDto } from './sales';

const accountCode = z.string().regex(/^\d{1,10}$/, 'Account codes are digits only, e.g. "411"');

export const postEntryLineSchema = z.object({
  accountCode,
  debit: moneySchema.default('0'),
  credit: moneySchema.default('0'),
  partnerId: uuidSchema.nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
});
export type PostEntryLineInput = z.infer<typeof postEntryLineSchema>;

export const postEntrySchema = z.object({
  journalCode: z.string().regex(/^[A-Z0-9]{2,6}$/, 'Journal codes are 2–6 upper-case letters/digits, e.g. "OD"'),
  entryDate: isoDateSchema,
  description: z.string().trim().min(2).max(300),
  reference: z.string().trim().max(100).nullable().optional(),
  lines: z.array(postEntryLineSchema).min(2, 'A journal entry needs at least two lines').max(200),
});
export type PostEntryDto = z.infer<typeof postEntrySchema>;

export const reverseEntrySchema = z.object({
  reason: z.string().trim().min(3).max(300),
  /** Date of the reversing entry (defaults to today). Its fiscal year must be open. */
  entryDate: isoDateSchema.optional(),
});
export type ReverseEntryDto = z.infer<typeof reverseEntrySchema>;

export const entryListQuerySchema = paginationSchema.extend({
  journal: z.string().regex(/^[A-Z0-9]{2,6}$/).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  accountCode: accountCode.optional(),
});
export type EntryListQuery = z.infer<typeof entryListQuerySchema>;

export const createAccountSchema = z.object({
  code: accountCode,
  name: z.string().trim().min(2).max(200),
  accountType: z.enum(ACCOUNT_TYPES),
  parentCode: accountCode.optional(),
  isPostable: z.boolean().default(true),
});
export type CreateAccountDto = z.infer<typeof createAccountSchema>;

export const createFiscalYearSchema = z
  .object({
    code: z.string().regex(/^[0-9A-Z]{4,8}$/, 'e.g. "2027"'),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .refine((v) => v.endDate > v.startDate, { message: 'endDate must be after startDate', path: ['endDate'] });
export type CreateFiscalYearDto = z.infer<typeof createFiscalYearSchema>;

export const trialBalanceQuerySchema = z.object({ fiscalYear: z.string().regex(/^[0-9A-Z]{4,8}$/) });
export type TrialBalanceQuery = z.infer<typeof trialBalanceQuerySchema>;

export const createInvoiceSchema = z.object({
  invoiceDate: isoDateSchema.optional(),
  dueDate: isoDateSchema.nullable().optional(),
});
export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;

export const cancelInvoiceSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  entryDate: isoDateSchema.optional(),
});
export type CancelInvoiceDto = z.infer<typeof cancelInvoiceSchema>;

export const recordPaymentSchema = z.object({
  amount: moneySchema.refine((v) => Number(v) > 0, 'Amount must be greater than zero'),
  method: z.enum(PAYMENT_METHODS),
  paidAt: isoDateSchema.optional(),
  reference: z.string().trim().max(100).nullable().optional(),
});
export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;

export const invoiceListQuerySchema = paginationSchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  customerId: uuidSchema.optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const paymentListQuerySchema = paginationSchema.extend({ invoiceId: uuidSchema.optional() });
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

// ── responses ────────────────────────────────────────────────────────────────

export interface AccountDto {
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  parentCode: string | null;
  isPostable: boolean;
  isActive: boolean;
}

export interface JournalDto {
  id: string;
  code: string;
  name: string;
  journalType: JournalType;
}

export interface FiscalYearDto {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
}

export interface EntryLineDto {
  id: string;
  accountCode: string;
  accountName: string;
  partnerId: string | null;
  partnerName: string | null;
  description: string | null;
  debit: string;
  credit: string;
}

export interface EntrySummaryDto {
  id: string;
  entryNumber: string | null;
  journalCode: string;
  fiscalYear: string;
  entryDate: string;
  description: string;
  reference: string | null;
  sourceType: EntrySourceType;
  status: EntryStatus;
  totalDebit: string;
  totalCredit: string;
  reversalOf: string | null;
  /** id of the entry that reverses this one, if any. */
  reversedBy: string | null;
  postedAt: string | null;
}

export interface EntryDetailDto extends EntrySummaryDto {
  lines: EntryLineDto[];
}

export interface TrialBalanceRowDto {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debit: string;
  credit: string;
  /** debit − credit */
  balance: string;
}

export interface TrialBalanceDto {
  fiscalYear: string;
  rows: TrialBalanceRowDto[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
}

export interface PaymentDto {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  amount: string;
  method: PaymentMethod;
  paidAt: string;
  reference: string | null;
  journalEntryId: string | null;
  createdAt: string;
}

export interface InvoiceSummaryDto {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  invoiceDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  totalHt: string;
  totalTva: string;
  totalTtc: string;
  amountPaid: string;
  balanceDue: string;
}

export interface InvoiceDetailDto extends InvoiceSummaryDto {
  items: DocumentLineDto[];
  payments: PaymentDto[];
  journalEntry: { id: string; entryNumber: string | null } | null;
  cancelEntry: { id: string; entryNumber: string | null } | null;
  cancelledAt: string | null;
}
