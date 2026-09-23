/**
 * Kysely table types, hand-written to mirror packages/db/migrations/*.sql.
 *
 * Runtime conventions (see client.ts):
 *   numeric  → string   (never a JS float)
 *   bigint   → string
 *   date     → 'YYYY-MM-DD' string (pg's Date parsing is disabled for OID 1082)
 *   timestamptz → Date
 *   jsonb    → parsed value on read; insert/update with JSON.stringify(...)
 */
import type { ColumnType, Generated, Selectable } from 'kysely';

type Ts = ColumnType<Date, Date | string, Date | string>;
type TsGen = ColumnType<Date, Date | string | undefined, Date | string>;
type TsNull = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type Json<T = unknown> = ColumnType<T, string, string>;
type JsonGen<T = unknown> = ColumnType<T, string | undefined, string>;
type Int8 = ColumnType<string, string | number | bigint, string | number | bigint>;

interface Stamps {
  created_at: TsGen;
  updated_at: TsGen;
}

// ── core ─────────────────────────────────────────────────────────────────────

export interface UsersTable extends Stamps {
  id: Generated<string>;
  email: string;
  password_hash: string;
  full_name: string;
  is_active: Generated<boolean>;
  last_login_at: TsNull;
}

export interface RolesTable extends Stamps {
  id: Generated<string>;
  code: string;
  name: string;
  description: string | null;
  is_system: Generated<boolean>;
}

export interface PermissionsTable extends Stamps {
  id: Generated<string>;
  code: string;
  module: string;
  description: string | null;
}

export interface RolePermissionsTable extends Stamps {
  role_id: string;
  permission_id: string;
}

export interface UserRolesTable extends Stamps {
  user_id: string;
  role_id: string;
}

export interface RefreshTokensTable extends Stamps {
  id: Generated<string>;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Ts;
  revoked_at: TsNull;
  replaced_by: string | null;
  user_agent: string | null;
}

export interface DocCountersTable extends Stamps {
  prefix: string;
  period: string;
  last_value: Generated<string>;
}

// ── crm ──────────────────────────────────────────────────────────────────────

export interface CustomersTable extends Stamps {
  id: Generated<string>;
  code: Generated<string>;
  name: string;
  customer_type: Generated<'COMPANY' | 'INDIVIDUAL'>;
  nif: string | null;
  nis: string | null;
  rc: string | null;
  ai: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  wilaya: string | null;
  city: string | null;
  custom_fields: JsonGen<Record<string, unknown>>;
  is_active: Generated<boolean>;
  created_by: string | null;
}

export interface ContactsTable extends Stamps {
  id: Generated<string>;
  customer_id: string;
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: Generated<boolean>;
}

// ── erp: sales ───────────────────────────────────────────────────────────────

interface DocumentLine extends Stamps {
  id: Generated<string>;
  position: number;
  description: string;
  unit: Generated<string>;
  quantity: string;
  unit_price: string;
  discount_pct: Generated<string>;
  tva_rate: Generated<string>;
  line_ht: string;
  line_tva: string;
  line_ttc: string;
}

export interface QuotesTable extends Stamps {
  id: Generated<string>;
  number: Generated<string>;
  customer_id: string;
  status: Generated<'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'CONVERTED'>;
  quote_date: Generated<string>;
  valid_until: string | null;
  notes: string | null;
  total_ht: Generated<string>;
  total_tva: Generated<string>;
  total_ttc: Generated<string>;
  converted_order_id: string | null;
  created_by: string | null;
}

export interface QuoteItemsTable extends DocumentLine {
  quote_id: string;
}

export interface OrdersTable extends Stamps {
  id: Generated<string>;
  number: Generated<string>;
  customer_id: string;
  quote_id: string | null;
  status: Generated<'DRAFT' | 'CONFIRMED' | 'IN_PRODUCTION' | 'COMPLETED' | 'CANCELLED'>;
  order_date: Generated<string>;
  due_date: string | null;
  notes: string | null;
  total_ht: Generated<string>;
  total_tva: Generated<string>;
  total_ttc: Generated<string>;
  confirmed_at: TsNull;
  confirmed_by: string | null;
  completed_at: TsNull;
  created_by: string | null;
}

export interface OrderItemsTable extends DocumentLine {
  order_id: string;
}

// ── erp: production ──────────────────────────────────────────────────────────

export interface ProductionStagesTable extends Stamps {
  id: Generated<string>;
  code: string;
  name: string;
  position: number;
  auto_create: Generated<boolean>;
  default_hours: Generated<string>;
}

export interface ProductionOrdersTable extends Stamps {
  id: Generated<string>;
  number: Generated<string>;
  order_id: string;
  status: Generated<string>;
  priority: Generated<number>;
  due_date: string | null;
  notes: string | null;
  rejection_reason: string | null;
  created_by: string | null;
}

export interface ProductionOrderEventsTable extends Stamps {
  id: Generated<string>;
  production_order_id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  note: string | null;
}

export interface WorkOrdersTable extends Stamps {
  id: Generated<string>;
  production_order_id: string;
  stage_id: string;
  title: string;
  status: Generated<'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'>;
  assigned_to: string | null;
  planned_hours: Generated<string>;
  actual_hours: Generated<string>;
  started_at: TsNull;
  completed_at: TsNull;
}

export interface FsmMachinesTable extends Stamps {
  code: string;
  name: string;
}

export interface FsmStatesTable extends Stamps {
  machine_code: string;
  code: string;
  label: string;
  position: number;
  is_initial: Generated<boolean>;
  is_terminal: Generated<boolean>;
  color: string | null;
}

export interface FsmTransitionsTable extends Stamps {
  id: Generated<string>;
  machine_code: string;
  from_state: string;
  to_state: string;
  permission_code: string;
  guard_code: string | null;
  guard_params: JsonGen<Record<string, unknown>>;
  requires_note: Generated<boolean>;
  label: string | null;
  is_active: Generated<boolean>;
}

// ── finance ──────────────────────────────────────────────────────────────────

export interface ChartOfAccountsTable extends Stamps {
  id: Generated<string>;
  code: string;
  name: string;
  account_type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  parent_id: string | null;
  is_postable: Generated<boolean>;
  is_active: Generated<boolean>;
}

export interface FiscalYearsTable extends Stamps {
  id: Generated<string>;
  code: string;
  start_date: string;
  end_date: string;
  status: Generated<'OPEN' | 'CLOSED'>;
}

export interface JournalsTable extends Stamps {
  id: Generated<string>;
  code: string;
  name: string;
  journal_type: 'SALES' | 'PURCHASES' | 'BANK' | 'CASH' | 'GENERAL';
  is_active: Generated<boolean>;
}

export interface JournalEntriesTable extends Stamps {
  id: Generated<string>;
  journal_id: string;
  fiscal_year_id: string;
  entry_number: string | null;
  entry_date: string;
  description: string;
  reference: string | null;
  source_type: Generated<'MANUAL' | 'INVOICE' | 'PAYMENT' | 'REVERSAL'>;
  source_id: string | null;
  status: Generated<'DRAFT' | 'POSTED'>;
  reversal_of: string | null;
  posted_at: TsNull;
  posted_by: string | null;
  created_by: string | null;
}

export interface JournalEntryLinesTable extends Stamps {
  id: Generated<string>;
  entry_id: string;
  account_id: string;
  partner_id: string | null;
  description: string | null;
  debit: Generated<string>;
  credit: Generated<string>;
}

export interface InvoicesTable extends Stamps {
  id: Generated<string>;
  number: string;
  order_id: string;
  customer_id: string;
  invoice_date: string;
  due_date: string | null;
  status: Generated<'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED'>;
  total_ht: string;
  total_tva: string;
  total_ttc: string;
  amount_paid: Generated<string>;
  journal_entry_id: string | null;
  cancel_entry_id: string | null;
  cancelled_at: TsNull;
  created_by: string | null;
}

export interface PaymentsTable extends Stamps {
  id: Generated<string>;
  invoice_id: string;
  customer_id: string;
  amount: string;
  method: 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'CARD';
  paid_at: string;
  reference: string | null;
  journal_entry_id: string | null;
  created_by: string | null;
}

// ── inventory ────────────────────────────────────────────────────────────────

export interface WarehousesTable extends Stamps {
  id: Generated<string>;
  code: string;
  name: string;
  address: string | null;
  is_active: Generated<boolean>;
}

export interface ItemsTable extends Stamps {
  id: Generated<string>;
  sku: string;
  name: string;
  unit: Generated<string>;
  category: string | null;
  min_stock: Generated<string>;
  is_active: Generated<boolean>;
  custom_fields: JsonGen<Record<string, unknown>>;
}

export interface StockMovesTable extends Stamps {
  id: Generated<string>;
  item_id: string;
  warehouse_id: string;
  move_type: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  quantity: string;
  unit_cost: string | null;
  ref_type: string | null;
  ref_id: string | null;
  note: string | null;
  created_by: string | null;
}

export interface StockLevelsTable extends Stamps {
  item_id: string;
  warehouse_id: string;
  quantity: Generated<string>;
  avg_cost: Generated<string>;
}

// ── workforce ────────────────────────────────────────────────────────────────

export interface TasksTable extends Stamps {
  id: Generated<string>;
  title: string;
  description: string | null;
  status: Generated<'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE'>;
  assigned_to: string | null;
  work_order_id: string | null;
  order_id: string | null;
  due_date: string | null;
  hours_logged: Generated<string>;
  notes: string | null;
  version: Generated<number>;
  change_seq: Generated<string>;
  deleted_at: TsNull;
  created_by: string | null;
}

export interface AttendanceTable extends Stamps {
  id: Generated<string>;
  user_id: string;
  date: string;
  clock_in: TsNull;
  clock_out: TsNull;
  notes: string | null;
  created_by: string | null;
}

export interface TaskProofsTable extends Stamps {
  id: string;
  task_id: string;
  uploaded_by: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  latitude: string | null;
  longitude: string | null;
  captured_at: TsNull;
  change_seq: Generated<string>;
}

export interface SyncMutationsTable extends Stamps {
  user_id: string;
  idempotency_key: string;
  device_id: string | null;
  entity: string;
  entity_id: string | null;
  outcome: Generated<'PENDING' | 'APPLIED' | 'CONFLICT' | 'REJECTED'>;
  response: JsonGen<Record<string, unknown>>;
}

// ── audit ────────────────────────────────────────────────────────────────────

export interface AuditTrailTable {
  id: Generated<string>;
  created_at: Ts;
  table_schema: string;
  table_name: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  row_id: string | null;
  actor_id: string | null;
  old_data: ColumnType<Record<string, unknown> | null, string | null, never>;
  new_data: ColumnType<Record<string, unknown> | null, string | null, never>;
  prev_hash: string;
  row_hash: string;
  updated_at: TsGen;
}

// ── database ─────────────────────────────────────────────────────────────────

export interface Database {
  'core.users': UsersTable;
  'core.roles': RolesTable;
  'core.permissions': PermissionsTable;
  'core.role_permissions': RolePermissionsTable;
  'core.user_roles': UserRolesTable;
  'core.refresh_tokens': RefreshTokensTable;
  'core.doc_counters': DocCountersTable;

  'crm.customers': CustomersTable;
  'crm.contacts': ContactsTable;

  'erp.quotes': QuotesTable;
  'erp.quote_items': QuoteItemsTable;
  'erp.orders': OrdersTable;
  'erp.order_items': OrderItemsTable;
  'erp.production_stages': ProductionStagesTable;
  'erp.production_orders': ProductionOrdersTable;
  'erp.production_order_events': ProductionOrderEventsTable;
  'erp.work_orders': WorkOrdersTable;
  'erp.fsm_machines': FsmMachinesTable;
  'erp.fsm_states': FsmStatesTable;
  'erp.fsm_transitions': FsmTransitionsTable;

  'finance.chart_of_accounts': ChartOfAccountsTable;
  'finance.fiscal_years': FiscalYearsTable;
  'finance.journals': JournalsTable;
  'finance.journal_entries': JournalEntriesTable;
  'finance.journal_entry_lines': JournalEntryLinesTable;
  'finance.invoices': InvoicesTable;
  'finance.payments': PaymentsTable;

  'inventory.warehouses': WarehousesTable;
  'inventory.items': ItemsTable;
  'inventory.stock_moves': StockMovesTable;
  'inventory.stock_levels': StockLevelsTable;

  'workforce.tasks': TasksTable;
  'workforce.task_proofs': TaskProofsTable;
  'workforce.sync_mutations': SyncMutationsTable;
  'workforce.attendance': AttendanceTable;

  'audit.trail': AuditTrailTable;
}

/** Selected row type for a table key, e.g. Row<'crm.customers'>. */
export type Row<T extends keyof Database> = Selectable<Database[T]>;

/** Schemas that make up the application (used by reset and by tests). */
export const APP_SCHEMAS = ['core', 'crm', 'erp', 'inventory', 'finance', 'workforce', 'audit'] as const;
