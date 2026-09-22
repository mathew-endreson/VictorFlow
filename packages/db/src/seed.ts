import argon2 from 'argon2';
import type { Kysely, Transaction } from 'kysely';
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_NAMES,
  ROLE_PERMISSIONS,
  ROLES,
  type Permission,
  type RoleCode,
} from '@victorflow/types';
import type { Database } from './schema';

type Trx = Transaction<Database>;

export interface SeedOptions {
  /** Password for every demo user. DEV ONLY. */
  demoPassword: string;
  /** Fiscal year to open. Defaults to the current calendar year. */
  fiscalYear?: number;
  log?: (message: string) => void;
}

export interface SeedSummary {
  permissions: number;
  roles: number;
  users: number;
  accounts: number;
  fiscalYear: string;
}

// ── static seed data ─────────────────────────────────────────────────────────

export const DEMO_USERS: ReadonlyArray<{ email: string; fullName: string; role: RoleCode }> = [
  { email: 'admin@victorflow.local', fullName: 'Administrateur', role: ROLES.SUPER_ADMIN },
  { email: 'sales@victorflow.local', fullName: 'Samir Benali (Ventes)', role: ROLES.SALES_MANAGER },
  { email: 'production@victorflow.local', fullName: 'Karim Haddad (Production)', role: ROLES.PRODUCTION_MANAGER },
  { email: 'workshop@victorflow.local', fullName: 'Yacine Mebarki (Atelier)', role: ROLES.WORKSHOP_SUPERVISOR },
  { email: 'qa@victorflow.local', fullName: 'Nadia Cherif (Qualité)', role: ROLES.QA_INSPECTOR },
  { email: 'field@victorflow.local', fullName: 'Rachid Toumi (Terrain)', role: ROLES.FIELD_AGENT },
];

const FSM_MACHINE = 'production_order';

const FSM_STATES = [
  { code: 'DRAFT', label: 'Draft', position: 1, is_initial: true, is_terminal: false, color: '#64748b' },
  { code: 'CONFIRMED', label: 'Confirmed', position: 2, is_initial: false, is_terminal: false, color: '#2563eb' },
  { code: 'IN_PRODUCTION', label: 'In production', position: 3, is_initial: false, is_terminal: false, color: '#d97706' },
  { code: 'QUALITY_CHECK', label: 'Quality check', position: 4, is_initial: false, is_terminal: false, color: '#7c3aed' },
  { code: 'COMPLETED', label: 'Completed', position: 5, is_initial: false, is_terminal: true, color: '#16a34a' },
  { code: 'REJECTED', label: 'Rejected', position: 6, is_initial: false, is_terminal: false, color: '#dc2626' },
] as const;

const FSM_TRANSITIONS: ReadonlyArray<{
  from: string;
  to: string;
  permission: Permission;
  label: string;
  guard?: string;
  requiresNote?: boolean;
}> = [
  { from: 'DRAFT', to: 'CONFIRMED', permission: 'production.order.confirm', label: 'Confirm' },
  { from: 'CONFIRMED', to: 'IN_PRODUCTION', permission: 'production.order.start', label: 'Start production' },
  {
    from: 'IN_PRODUCTION',
    to: 'QUALITY_CHECK',
    permission: 'production.order.submit_qc',
    label: 'Send to quality check',
    guard: 'ALL_WORK_ORDERS_COMPLETED',
  },
  { from: 'QUALITY_CHECK', to: 'COMPLETED', permission: 'production.order.approve', label: 'Approve' },
  { from: 'QUALITY_CHECK', to: 'REJECTED', permission: 'production.order.reject', label: 'Reject', requiresNote: true },
  { from: 'REJECTED', to: 'IN_PRODUCTION', permission: 'production.order.rework', label: 'Send back to production' },
];

const PRODUCTION_STAGES = [
  { code: 'PREPRESS', name: 'Prépresse', position: 1, auto_create: true, default_hours: '2' },
  { code: 'PRINTING', name: 'Impression', position: 2, auto_create: true, default_hours: '4' },
  { code: 'FINISHING', name: 'Finition', position: 3, auto_create: true, default_hours: '3' },
  { code: 'INSTALLATION', name: 'Pose / installation', position: 4, auto_create: false, default_hours: '4' },
] as const;

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
// Skeleton of the Algerian SCF chart. `parent` groups accounts; group accounts are not postable.
const CHART: ReadonlyArray<{ code: string; name: string; type: AccountType; parent?: string; postable?: boolean }> = [
  { code: '101', name: 'Capital social', type: 'EQUITY' },
  { code: '213', name: 'Matériel et outillage industriel', type: 'ASSET' },
  { code: '218', name: 'Autres immobilisations corporelles', type: 'ASSET' },
  { code: '300', name: 'Stocks de marchandises', type: 'ASSET' },
  { code: '310', name: 'Matières premières', type: 'ASSET' },
  { code: '320', name: 'Autres approvisionnements et consommables', type: 'ASSET' },
  { code: '401', name: 'Fournisseurs de stocks et services', type: 'LIABILITY' },
  { code: '411', name: 'Clients', type: 'ASSET' },
  { code: '421', name: 'Personnel — rémunérations dues', type: 'LIABILITY' },
  { code: '431', name: 'Sécurité sociale', type: 'LIABILITY' },
  { code: '4456', name: 'TVA déductible', type: 'ASSET', postable: false },
  { code: '44566', name: 'TVA déductible sur autres biens et services', type: 'ASSET', parent: '4456' },
  { code: '4457', name: 'TVA collectée', type: 'LIABILITY', postable: false },
  { code: '44571', name: 'TVA collectée 19 %', type: 'LIABILITY', parent: '4457' },
  { code: '512', name: 'Banque', type: 'ASSET' },
  { code: '530', name: 'Caisse', type: 'ASSET' },
  { code: '600', name: 'Achats de marchandises vendues', type: 'EXPENSE' },
  { code: '601', name: 'Achats de matières premières', type: 'EXPENSE' },
  { code: '602', name: 'Achats d’approvisionnements consommables', type: 'EXPENSE' },
  { code: '613', name: 'Locations', type: 'EXPENSE' },
  { code: '631', name: 'Rémunérations du personnel', type: 'EXPENSE' },
  { code: '700', name: 'Ventes de marchandises', type: 'REVENUE' },
  { code: '701', name: 'Ventes de produits finis', type: 'REVENUE' },
  { code: '706', name: 'Prestations de services', type: 'REVENUE' },
];

const JOURNALS = [
  { code: 'VTE', name: 'Journal des ventes', journal_type: 'SALES' },
  { code: 'ACH', name: 'Journal des achats', journal_type: 'PURCHASES' },
  { code: 'BNQ', name: 'Journal de banque', journal_type: 'BANK' },
  { code: 'CAI', name: 'Journal de caisse', journal_type: 'CASH' },
  { code: 'OD', name: 'Opérations diverses', journal_type: 'GENERAL' },
] as const;

const DEMO_ITEMS = [
  { sku: 'VIN-ADH-BL', name: 'Vinyle adhésif blanc', unit: 'm²', min_stock: '20', receive: '120', cost: '450' },
  { sku: 'BACHE-440', name: 'Bâche PVC 440 g', unit: 'm²', min_stock: '30', receive: '200', cost: '380' },
  { sku: 'ENC-UV-CMJN', name: 'Encre UV CMJN', unit: 'L', min_stock: '5', receive: '25', cost: '3200' },
  { sku: 'DIBOND-3', name: 'Panneau Dibond 3 mm', unit: 'unit', min_stock: '10', receive: '40', cost: '5200' },
] as const;

// ── seeding ──────────────────────────────────────────────────────────────────

export async function seed(db: Kysely<Database>, opts: SeedOptions): Promise<SeedSummary> {
  const log = opts.log ?? (() => {});
  const year = opts.fiscalYear ?? new Date().getFullYear();

  // Hash outside the transaction: argon2 is CPU-bound and we don't want to hold locks while it runs.
  const passwordHashes = new Map<string, string>();
  for (const u of DEMO_USERS) {
    passwordHashes.set(
      u.email,
      await argon2.hash(opts.demoPassword, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
    );
  }

  return db.transaction().execute(async (trx) => {
    await seedPermissionsAndRoles(trx, log);
    await seedFsm(trx, log);
    await seedProductionStages(trx, log);
    const accounts = await seedChartOfAccounts(trx, log);
    await seedFinanceCalendar(trx, year, log);
    const userIds = await seedUsers(trx, passwordHashes, log);
    const warehouseId = await seedWarehouse(trx, log);
    await seedDemoBusinessData(trx, userIds, warehouseId, log);

    return {
      permissions: ALL_PERMISSIONS.length,
      roles: Object.keys(ROLES).length,
      users: DEMO_USERS.length,
      accounts,
      fiscalYear: String(year),
    };
  });
}

async function seedPermissionsAndRoles(trx: Trx, log: (m: string) => void) {
  // Create-only (ON CONFLICT DO NOTHING): re-seeding must never undo what an admin re-bundled.
  await trx
    .insertInto('core.permissions')
    .values(ALL_PERMISSIONS.map((code) => ({ code, module: code.split('.')[0]!, description: PERMISSION_DESCRIPTIONS[code] })))
    .onConflict((oc) => oc.column('code').doNothing())
    .execute();

  await trx
    .insertInto('core.roles')
    .values((Object.keys(ROLES) as RoleCode[]).map((code) => ({ code, name: ROLE_NAMES[code], is_system: true })))
    .onConflict((oc) => oc.column('code').doNothing())
    .execute();

  const perms = await trx.selectFrom('core.permissions').select(['id', 'code']).execute();
  const roles = await trx.selectFrom('core.roles').select(['id', 'code']).execute();
  const permId = new Map(perms.map((p) => [p.code, p.id]));

  for (const role of roles) {
    const wanted = ROLE_PERMISSIONS[role.code as RoleCode];
    if (!wanted) continue; // a custom role created by an admin
    const rows = wanted.map((code) => ({ role_id: role.id, permission_id: permId.get(code)! }));
    if (rows.length === 0) continue;
    await trx
      .insertInto('core.role_permissions')
      .values(rows)
      .onConflict((oc) => oc.columns(['role_id', 'permission_id']).doNothing())
      .execute();
  }
  log(`permissions: ${perms.length}, roles: ${roles.length}`);
}

async function seedFsm(trx: Trx, log: (m: string) => void) {
  await trx
    .insertInto('erp.fsm_machines')
    .values({ code: FSM_MACHINE, name: 'Production order lifecycle' })
    .onConflict((oc) => oc.column('code').doNothing())
    .execute();

  await trx
    .insertInto('erp.fsm_states')
    .values(FSM_STATES.map((s) => ({ machine_code: FSM_MACHINE, ...s })))
    .onConflict((oc) => oc.columns(['machine_code', 'code']).doNothing())
    .execute();

  await trx
    .insertInto('erp.fsm_transitions')
    .values(
      FSM_TRANSITIONS.map((t) => ({
        machine_code: FSM_MACHINE,
        from_state: t.from,
        to_state: t.to,
        permission_code: t.permission,
        guard_code: t.guard ?? null,
        requires_note: t.requiresNote ?? false,
        label: t.label,
      })),
    )
    .onConflict((oc) => oc.columns(['machine_code', 'from_state', 'to_state']).doNothing())
    .execute();
  log(`fsm '${FSM_MACHINE}': ${FSM_STATES.length} states, ${FSM_TRANSITIONS.length} transitions`);
}

async function seedProductionStages(trx: Trx, log: (m: string) => void) {
  await trx
    .insertInto('erp.production_stages')
    .values(PRODUCTION_STAGES.map((s) => ({ ...s })))
    .onConflict((oc) => oc.column('code').doNothing())
    .execute();
  log(`production stages: ${PRODUCTION_STAGES.length}`);
}

async function seedChartOfAccounts(trx: Trx, log: (m: string) => void): Promise<number> {
  const idByCode = new Map<string, string>();
  // parents first, then children (CHART is already ordered that way)
  for (const a of CHART) {
    const existing = await trx.selectFrom('finance.chart_of_accounts').select('id').where('code', '=', a.code).executeTakeFirst();
    if (existing) {
      idByCode.set(a.code, existing.id);
      continue;
    }
    const inserted = await trx
      .insertInto('finance.chart_of_accounts')
      .values({
        code: a.code,
        name: a.name,
        account_type: a.type,
        parent_id: a.parent ? (idByCode.get(a.parent) ?? null) : null,
        is_postable: a.postable ?? true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    idByCode.set(a.code, inserted.id);
  }
  log(`chart of accounts: ${CHART.length}`);
  return CHART.length;
}

async function seedFinanceCalendar(trx: Trx, year: number, log: (m: string) => void) {
  await trx
    .insertInto('finance.fiscal_years')
    .values({ code: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31` })
    // overlapping ranges are rejected by an EXCLUDE constraint; a re-seed hits the unique code first
    .onConflict((oc) => oc.column('code').doNothing())
    .execute();

  await trx
    .insertInto('finance.journals')
    .values(JOURNALS.map((j) => ({ ...j })))
    .onConflict((oc) => oc.column('code').doNothing())
    .execute();
  log(`fiscal year ${year}, journals: ${JOURNALS.map((j) => j.code).join(', ')}`);
}

async function seedUsers(trx: Trx, hashes: Map<string, string>, log: (m: string) => void): Promise<Map<string, string>> {
  const roles = await trx.selectFrom('core.roles').select(['id', 'code']).execute();
  const roleId = new Map(roles.map((r) => [r.code, r.id]));
  const ids = new Map<string, string>();

  for (const u of DEMO_USERS) {
    let row = await trx
      .selectFrom('core.users')
      .select('id')
      .where((eb) => eb(eb.fn('lower', ['email']), '=', u.email.toLowerCase()))
      .executeTakeFirst();
    if (!row) {
      row = await trx
        .insertInto('core.users')
        .values({ email: u.email, password_hash: hashes.get(u.email)!, full_name: u.fullName })
        .returning('id')
        .executeTakeFirstOrThrow();
    }
    ids.set(u.email, row.id);
    await trx
      .insertInto('core.user_roles')
      .values({ user_id: row.id, role_id: roleId.get(u.role)! })
      .onConflict((oc) => oc.columns(['user_id', 'role_id']).doNothing())
      .execute();
  }
  log(`demo users: ${DEMO_USERS.map((u) => u.email).join(', ')}`);
  return ids;
}

async function seedWarehouse(trx: Trx, log: (m: string) => void): Promise<string> {
  await trx
    .insertInto('inventory.warehouses')
    .values({ code: 'MAIN', name: 'Entrepôt principal', address: 'Zone industrielle, Alger' })
    .onConflict((oc) => oc.column('code').doNothing())
    .execute();
  const wh = await trx.selectFrom('inventory.warehouses').select('id').where('code', '=', 'MAIN').executeTakeFirstOrThrow();
  log('warehouse: MAIN');
  return wh.id;
}

/** Sample customers, stock and mobile tasks so every screen has something to show on a fresh install. */
async function seedDemoBusinessData(trx: Trx, userIds: Map<string, string>, warehouseId: string, log: (m: string) => void) {
  const customers = [
    { name: 'Café El Yasmine', wilaya: 'Alger', city: 'Bab El Oued', phone: '0555 12 34 56', contact: 'Amine Kaci' },
    { name: 'Boulangerie Ben Salah', wilaya: 'Oran', city: 'Es Senia', phone: '0661 98 76 54', contact: 'Fatima Ben Salah' },
  ];
  for (const c of customers) {
    const exists = await trx.selectFrom('crm.customers').select('id').where('name', '=', c.name).executeTakeFirst();
    if (exists) continue;
    const created = await trx
      .insertInto('crm.customers')
      .values({
        name: c.name,
        wilaya: c.wilaya,
        city: c.city,
        phone: c.phone,
        created_by: userIds.get('admin@victorflow.local') ?? null,
        custom_fields: JSON.stringify({ source: 'demo seed' }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx.insertInto('crm.contacts').values({ customer_id: created.id, full_name: c.contact, phone: c.phone, is_primary: true }).execute();
  }

  for (const it of DEMO_ITEMS) {
    let item = await trx.selectFrom('inventory.items').select('id').where('sku', '=', it.sku).executeTakeFirst();
    if (!item) {
      item = await trx
        .insertInto('inventory.items')
        .values({ sku: it.sku, name: it.name, unit: it.unit, min_stock: it.min_stock })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('inventory.stock_moves')
        .values({
          item_id: item.id,
          warehouse_id: warehouseId,
          move_type: 'RECEIPT',
          quantity: it.receive,
          unit_cost: it.cost,
          note: 'Initial stock (demo seed)',
        })
        .execute();
    }
  }

  const field = userIds.get('field@victorflow.local');
  const tasks = [
    { title: 'Pose enseigne lumineuse — Café El Yasmine', description: 'Enseigne caisson 3 m, façade rue principale. Prévoir nacelle.', due: 2 },
    { title: 'Relevé de mesures — Boulangerie Ben Salah', description: 'Mesurer la vitrine (2 faces) pour le lettrage vinyle.', due: 1 },
    { title: 'Dépose ancienne bâche — Place des Martyrs', description: 'Déposer la bâche 4×3 m et la rapporter à l’atelier.', due: 4 },
  ];
  for (const t of tasks) {
    const exists = await trx.selectFrom('workforce.tasks').select('id').where('title', '=', t.title).executeTakeFirst();
    if (exists) continue;
    const due = new Date();
    due.setDate(due.getDate() + t.due);
    await trx
      .insertInto('workforce.tasks')
      .values({
        title: t.title,
        description: t.description,
        assigned_to: field ?? null,
        due_date: due.toISOString().slice(0, 10),
        created_by: userIds.get('workshop@victorflow.local') ?? null,
      })
      .execute();
  }
  log('demo customers, stock and field tasks');
}
