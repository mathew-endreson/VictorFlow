// Enumerations shared by DB CHECK constraints, API schemas and the UIs.
// Keep in sync with packages/db/migrations (CHECK constraints) — the db package has a test for it.

export const CUSTOMER_TYPES = ['COMPANY', 'INDIVIDUAL'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CONVERTED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Default production lifecycle. The *authoritative* state machine lives in the DB
 * (erp.fsm_states / erp.fsm_transitions); these constants only name the seeded states.
 */
export const PRODUCTION_STATUSES = ['DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'QUALITY_CHECK', 'COMPLETED', 'REJECTED'] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const WORK_ORDER_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const JOURNAL_TYPES = ['SALES', 'PURCHASES', 'BANK', 'CASH', 'GENERAL'] as const;
export type JournalType = (typeof JOURNAL_TYPES)[number];

export const ENTRY_STATUSES = ['DRAFT', 'POSTED'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const ENTRY_SOURCE_TYPES = ['MANUAL', 'INVOICE', 'PAYMENT', 'REVERSAL'] as const;
export type EntrySourceType = (typeof ENTRY_SOURCE_TYPES)[number];

export const STOCK_MOVE_TYPES = ['RECEIPT', 'ISSUE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT'] as const;
export type StockMoveType = (typeof STOCK_MOVE_TYPES)[number];

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The modules a licence can unlock (the `modules` list of a licence). Routes name theirs with @RequiresFeature. */
export const LICENSE_FEATURES = ['crm', 'sales', 'production', 'finance', 'inventory', 'workforce', 'audit'] as const;
export type LicenseFeature = (typeof LICENSE_FEATURES)[number];

/** Which app a session was opened from: licence seats are counted per kind (core.refresh_tokens.client). */
export const SESSION_CLIENTS = ['desktop', 'mobile'] as const;
export type SessionClient = (typeof SESSION_CLIENTS)[number];
