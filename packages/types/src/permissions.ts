/**
 * Permission catalogue + default role → permission mapping.
 *
 * Route guards check PERMISSIONS, never role names. Roles are just named bundles of
 * permissions that the seed writes into core.role_permissions; an admin can re-bundle
 * them at runtime without touching code.
 */

export const PERMISSIONS = {
  // core
  CORE_USER_READ: 'core.user.read',
  CORE_USER_MANAGE: 'core.user.manage',
  CORE_ROLE_READ: 'core.role.read',
  CORE_LICENSE_READ: 'core.license.read',
  CORE_DASHBOARD_READ: 'core.dashboard.read',
  // crm
  CRM_CUSTOMER_READ: 'crm.customer.read',
  CRM_CUSTOMER_WRITE: 'crm.customer.write',
  CRM_CUSTOMER_DELETE: 'crm.customer.delete',
  // sales
  SALES_QUOTE_READ: 'sales.quote.read',
  SALES_QUOTE_WRITE: 'sales.quote.write',
  SALES_QUOTE_CONVERT: 'sales.quote.convert',
  SALES_ORDER_READ: 'sales.order.read',
  SALES_ORDER_WRITE: 'sales.order.write',
  SALES_ORDER_CONFIRM: 'sales.order.confirm',
  SALES_ORDER_CANCEL: 'sales.order.cancel',
  // production
  PRODUCTION_ORDER_READ: 'production.order.read',
  PRODUCTION_ORDER_CONFIRM: 'production.order.confirm',
  PRODUCTION_ORDER_START: 'production.order.start',
  PRODUCTION_ORDER_SUBMIT_QC: 'production.order.submit_qc',
  PRODUCTION_ORDER_APPROVE: 'production.order.approve',
  PRODUCTION_ORDER_REJECT: 'production.order.reject',
  PRODUCTION_ORDER_REWORK: 'production.order.rework',
  PRODUCTION_WORKORDER_READ: 'production.workorder.read',
  PRODUCTION_WORKORDER_WRITE: 'production.workorder.write',
  PRODUCTION_FSM_READ: 'production.fsm.read',
  PRODUCTION_FSM_MANAGE: 'production.fsm.manage',
  // finance
  FINANCE_ACCOUNT_READ: 'finance.account.read',
  FINANCE_ACCOUNT_WRITE: 'finance.account.write',
  FINANCE_FISCALYEAR_MANAGE: 'finance.fiscalyear.manage',
  FINANCE_ENTRY_READ: 'finance.entry.read',
  FINANCE_ENTRY_POST: 'finance.entry.post',
  FINANCE_ENTRY_REVERSE: 'finance.entry.reverse',
  FINANCE_INVOICE_READ: 'finance.invoice.read',
  FINANCE_INVOICE_CREATE: 'finance.invoice.create',
  FINANCE_INVOICE_CANCEL: 'finance.invoice.cancel',
  FINANCE_PAYMENT_READ: 'finance.payment.read',
  FINANCE_PAYMENT_RECORD: 'finance.payment.record',
  // inventory
  INVENTORY_ITEM_READ: 'inventory.item.read',
  INVENTORY_ITEM_WRITE: 'inventory.item.write',
  INVENTORY_WAREHOUSE_READ: 'inventory.warehouse.read',
  INVENTORY_WAREHOUSE_WRITE: 'inventory.warehouse.write',
  INVENTORY_STOCK_READ: 'inventory.stock.read',
  INVENTORY_STOCK_MOVE: 'inventory.stock.move',
  // workforce / mobile sync
  WORKFORCE_TASK_READ: 'workforce.task.read',
  WORKFORCE_TASK_READ_ALL: 'workforce.task.read_all',
  WORKFORCE_TASK_CREATE: 'workforce.task.create',
  WORKFORCE_TASK_UPDATE: 'workforce.task.update',
  WORKFORCE_PROOF_CREATE: 'workforce.proof.create',
  WORKFORCE_ATTENDANCE_READ: 'workforce.attendance.read',
  WORKFORCE_ATTENDANCE_RECORD: 'workforce.attendance.record',
  // audit
  AUDIT_TRAIL_READ: 'audit.trail.read',
  AUDIT_TRAIL_VERIFY: 'audit.trail.verify',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/** Human description shown in admin UIs and stored in core.permissions.description. */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'core.user.read': 'View users',
  'core.user.manage': 'Create and edit users and their roles',
  'core.role.read': 'View roles and permissions',
  'core.license.read': 'View licence status',
  'core.dashboard.read': 'View the executive dashboard',
  'crm.customer.read': 'View customers and contacts',
  'crm.customer.write': 'Create and edit customers and contacts',
  'crm.customer.delete': 'Delete customers',
  'sales.quote.read': 'View quotes',
  'sales.quote.write': 'Create and edit quotes',
  'sales.quote.convert': 'Convert a quote into an order',
  'sales.order.read': 'View orders and tracking links',
  'sales.order.write': 'Create and edit draft orders',
  'sales.order.confirm': 'Confirm an order (releases it to production)',
  'sales.order.cancel': 'Cancel a draft order',
  'production.order.read': 'View production orders and the Kanban board',
  'production.order.confirm': 'Move a production order DRAFT → CONFIRMED',
  'production.order.start': 'Move a production order CONFIRMED → IN_PRODUCTION',
  'production.order.submit_qc': 'Send a production order to QUALITY_CHECK',
  'production.order.approve': 'Approve a production order at QUALITY_CHECK',
  'production.order.reject': 'Reject a production order at QUALITY_CHECK',
  'production.order.rework': 'Send a rejected production order back into production',
  'production.workorder.read': 'View work orders',
  'production.workorder.write': 'Update work orders (status, hours, assignee)',
  'production.fsm.read': 'View the production state-machine configuration',
  'production.fsm.manage': 'Edit the production state-machine configuration',
  'finance.account.read': 'View the chart of accounts',
  'finance.account.write': 'Create and edit accounts',
  'finance.fiscalyear.manage': 'Create and close fiscal years',
  'finance.entry.read': 'View journal entries and the trial balance',
  'finance.entry.post': 'Post manual journal entries',
  'finance.entry.reverse': 'Reverse a posted journal entry',
  'finance.invoice.read': 'View invoices',
  'finance.invoice.create': 'Generate invoices from orders',
  'finance.invoice.cancel': 'Cancel invoices (posts a reversing entry)',
  'finance.payment.read': 'View payments',
  'finance.payment.record': 'Record customer payments',
  'inventory.item.read': 'View inventory items',
  'inventory.item.write': 'Create and edit inventory items',
  'inventory.warehouse.read': 'View warehouses',
  'inventory.warehouse.write': 'Create and edit warehouses',
  'inventory.stock.read': 'View stock levels and movements',
  'inventory.stock.move': 'Record stock receipts, issues, adjustments and transfers',
  'workforce.task.read': 'View own tasks / pull sync',
  'workforce.task.read_all': 'View every worker\'s tasks',
  'workforce.task.create': 'Create and assign tasks',
  'workforce.task.update': 'Update own tasks / push sync',
  'workforce.proof.create': 'Upload task proof photos',
  'workforce.attendance.read': 'View staff attendance records',
  'workforce.attendance.record': 'Record staff clock-in / clock-out',
  'audit.trail.read': 'Read the audit trail',
  'audit.trail.verify': 'Verify the audit hash chain',
};

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  SALES_MANAGER: 'SALES_MANAGER',
  PRODUCTION_MANAGER: 'PRODUCTION_MANAGER',
  WORKSHOP_SUPERVISOR: 'WORKSHOP_SUPERVISOR',
  QA_INSPECTOR: 'QA_INSPECTOR',
  FIELD_AGENT: 'FIELD_AGENT',
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_NAMES: Record<RoleCode, string> = {
  SUPER_ADMIN: 'Super administrator',
  SALES_MANAGER: 'Sales manager',
  PRODUCTION_MANAGER: 'Production manager',
  WORKSHOP_SUPERVISOR: 'Workshop supervisor',
  QA_INSPECTOR: 'QA inspector',
  FIELD_AGENT: 'Field agent',
};

const P = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,

  SALES_MANAGER: [
    P.CORE_DASHBOARD_READ,
    P.CRM_CUSTOMER_READ, P.CRM_CUSTOMER_WRITE, P.CRM_CUSTOMER_DELETE,
    P.SALES_QUOTE_READ, P.SALES_QUOTE_WRITE, P.SALES_QUOTE_CONVERT,
    P.SALES_ORDER_READ, P.SALES_ORDER_WRITE, P.SALES_ORDER_CONFIRM, P.SALES_ORDER_CANCEL,
    P.PRODUCTION_ORDER_READ,
    P.FINANCE_INVOICE_READ, P.FINANCE_INVOICE_CREATE, P.FINANCE_PAYMENT_READ, P.FINANCE_PAYMENT_RECORD,
  ],

  PRODUCTION_MANAGER: [
    P.CORE_DASHBOARD_READ,
    P.CRM_CUSTOMER_READ,
    P.SALES_ORDER_READ,
    P.PRODUCTION_ORDER_READ, P.PRODUCTION_ORDER_CONFIRM, P.PRODUCTION_ORDER_START,
    P.PRODUCTION_ORDER_SUBMIT_QC, P.PRODUCTION_ORDER_REWORK,
    P.PRODUCTION_WORKORDER_READ, P.PRODUCTION_WORKORDER_WRITE,
    P.PRODUCTION_FSM_READ,
    P.INVENTORY_ITEM_READ, P.INVENTORY_WAREHOUSE_READ, P.INVENTORY_STOCK_READ, P.INVENTORY_STOCK_MOVE,
    P.WORKFORCE_TASK_READ_ALL, P.WORKFORCE_TASK_CREATE,
  ],

  WORKSHOP_SUPERVISOR: [
    P.PRODUCTION_ORDER_READ, P.PRODUCTION_ORDER_START, P.PRODUCTION_ORDER_SUBMIT_QC,
    P.PRODUCTION_WORKORDER_READ, P.PRODUCTION_WORKORDER_WRITE,
    P.INVENTORY_ITEM_READ, P.INVENTORY_STOCK_READ, P.INVENTORY_STOCK_MOVE,
    P.WORKFORCE_TASK_READ_ALL, P.WORKFORCE_TASK_CREATE, P.WORKFORCE_TASK_READ, P.WORKFORCE_TASK_UPDATE,
  ],

  QA_INSPECTOR: [
    P.PRODUCTION_ORDER_READ, P.PRODUCTION_ORDER_APPROVE, P.PRODUCTION_ORDER_REJECT,
    P.PRODUCTION_WORKORDER_READ,
  ],

  FIELD_AGENT: [
    P.WORKFORCE_TASK_READ, P.WORKFORCE_TASK_UPDATE, P.WORKFORCE_PROOF_CREATE,
  ],
};
