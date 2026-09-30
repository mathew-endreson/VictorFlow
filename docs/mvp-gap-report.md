# VictorFlow v2 spec vs. current implementation — gap report

**Sources read:** `doc/VictorFlow — New Structure v2.md` (the spec — note: the task referenced it as
`docs/structure-v2.md`; the actual file lives in `doc/`, singular, under that longer name — there is no
`docs/structure-v2.md` in the repo), `README.md`, `README.txt`. Codebase explored via two read-only research
agents (order/quote lifecycle + payment gate; i18n/UX patterns + a repo-wide term grep) plus direct reading of
`packages/types/src/permissions.ts`, every migration, all desktop pages, and every server module. No code was
changed to produce this report.

**Status key:** `done` = matches the spec · `partial` = exists but materially incomplete vs. the spec ·
`missing` = nothing in code · `conflicts` = current code actively does something the spec says should not
happen (not just an absence).

---

## 1. Modules

| Item (spec module) | Status | Files involved | Notes |
| --- | --- | --- | --- |
| `auth` (positions, scopes, field masking) | partial | `packages/types/src/permissions.ts`, `apps/server/src/modules/auth/*` | Real RBAC exists (JWT, permission-per-route, no-escalation/no-lockout rules — all solid), but it's flat permissions on 6 hardcoded roles. No "position" concept distinct from role, no per-field scope tiers (Own/Assigned/Read), no field-level masking (a field is either in the DTO or it isn't, not conditionally redacted per caller). `core.roles`/`core.permissions`/`core.role_permissions` (migration `0001_core.sql`) are already generic DB tables, so the *data model* could support admin-defined positions — there's just no service/UI to create one. |
| `licensing` (activation code, transfers, read-only fallback) | partial | `apps/server/src/modules/licensing/*`, `packages/crypto/src/license.ts` | A real `CryptographicLicenseService` (Ed25519, hardware fingerprint, expiry, seats, features) plus a `dev` stub already exist — a solid foundation. Missing entirely: the activation-code request/response exchange (online + offline WhatsApp fallback), transfer/revoke flow, a "read-only" mode when the check fails (today `LICENSE_ENFORCE=false` just means nothing is ever blocked — the opposite posture), and any back-office issuing tool. |
| `company` | done | `apps/server/src/modules/company/*`, `packages/db/migrations/0009_company_profile.sql`, `apps/desktop/src/pages/Company.tsx` | Name, address, phone, email, NIF/NIS/RC/AI, logo upload, printed on the order PDF header — matches the spec's description closely. |
| `reference` (wilayas, TVA rates, stamp duty, client sources) | missing | — | No `ref.*` schema, no wilaya/TVA-rate/stamp-duty/source tables anywhere. `wilaya` today is a free-text column on `crm.customers` (`packages/db/migrations/0002_crm_erp.sql:18`), not a 58-row reference table. |
| `crm` (company/No-company, wilaya FK, source, referrer, account owner) | partial | `packages/db/migrations/0002_crm_erp.sql`, `apps/server/src/modules/crm/*` | Customers exist with `customer_type` (`COMPANY`/`INDIVIDUAL` — a partial analog of "No company"), NIF/NIS/RC/AI, custom fields. Missing: `wilaya` as a reference-table FK, `source`/`referrer`/`account_owner`/`price_tier`/`notify_lang`/`hide_on_tv` — none of these columns exist (confirmed by grep: `is_individual`, `account_owner`, `referrer_user_id`, `source_id` [CRM sense] appear nowhere in code, only in the spec doc). |
| `quotes` (leads, versions, follow-ups, win/loss) | partial | `apps/server/src/modules/sales/quotes.service.ts`, `packages/types/src/schemas/sales.ts` | A quote exists and converts to an order (`QuoteStatus`: `DRAFT/SENT/ACCEPTED/REJECTED/CONVERTED`), but it is a **flat single record** — no `leads` stage, no version history (v1/v2…), no follow-up date/notes, no lost-reason list, no win/loss stats. Not a separate module either; it lives inside `sales`. |
| `sales` (orders, Prix 1/2/3, admin TVA, payment gate) | **conflicts** | `apps/server/src/modules/sales/{orders.service.ts,order-pricing.ts}` | See §6 below — pricing model, TVA, and the payment gate are all structurally different from the spec, and the payment gate is an active contradiction, not just a gap. |
| `design` (versions, client approval, revisions) | missing | — | No `design_versions`/`design_reviews` tables, no design module, no approval/revision flow anywhere. |
| `production` (FSM v2, list+Kanban, auto-archive) | partial | `apps/server/src/modules/production/*`, `packages/db/migrations/0002_crm_erp.sql` (`erp.fsm_*`) | The FSM is **already data-driven** — states/transitions/permissions live in `erp.fsm_machines`/`fsm_states`/`fsm_transitions` rows, loaded per call, only guards are code. This is a strong, ready-made match for the spec's "configurable, only guards are code" requirement. Missing: a List view (Kanban only today, per `apps/desktop/src/pages/Production.tsx`), and auto-archive (`orders` has no `archived_at` column — see §6). |
| `documents` (devis, bon de commande, fiche de production, bon de livraison, reçu, facture — PDF+QR, shared template, company logo) | partial | `apps/desktop/src/pages/OrderDocument.tsx` | Only the **order** has a printable PDF (browser print, company header, no QR on the document itself — the QR is for the separate tracking link). No devis/bon de commande/fiche de production/bon de livraison/reçu templates, no shared PDF-template package (`packages/documents` from the spec doesn't exist), no per-document QR code. |
| `client-files` (per-client folders on server disk) | missing | — | `StorageService` (`apps/server/src/infra/storage/storage.service.ts`) is a flat key→file store (proof photos, company logo) with no per-client folder structure, no `Design`/`Production`/`Resources`/`Facturation` layout, no "Open folder" UI. |
| `purchasing` (suppliers, POs, receipts, balances) | missing | — | Nothing — no `suppliers`, `purchase_orders`, `material_requests`, `goods_receipts`, `supplier_payments` tables or module. |
| `inventory` (materials, lots+QR, reservations, counts) | partial | `apps/server/src/modules/inventory/*`, `packages/db/migrations/0004_inventory.sql` | Warehouses/items/stock moves/stock levels exist (weighted-average costing) — real, tested inventory, but no per-lot tracking, no QR labels, no reservations against confirmed orders, no stock counts, no minimum-offcut-size concept. There is also **no desktop screen for it at all** (see §2) despite the backend module existing. |
| `offcuts` (consumption, splits, new QR per update) | missing | — | Nothing. Confirmed by grep: `offcut`, `lot_splits`, `scrap_entries` appear only in the spec doc. |
| `valuation` (stock value, cost/margin per order) | missing | — | No `material_cost_history`, no `order_costs`/`stock_value` views. |
| `finance` (deposits, cash register, daily close, P&L/TCR) | partial | `apps/server/src/modules/finance/*`, `packages/db/migrations/0003_finance.sql` | Real double-entry ledger, invoices, payments — solid and well-tested (immutable posted entries, balanced-entry trigger, per-journal/per-year sequences). But `finance.payments.invoice_id` is `NOT NULL` (migration `0003_finance.sql:117`) — **payments can only attach to an already-generated invoice; there is no pre-invoice deposit/acompte concept at all**, which the spec's payment-gate depends on. No cash-register sessions, no daily close, no P&L/TCR report. |
| `finance-board` (income/expenses/KPI/MPI/production figures, monthly charts) | missing | — | `apps/server/src/modules/dashboard` exists but is a simple current-month summary (revenue, collections, open orders, pipeline) — none of the monthly time-series, KPI/MPI ratios, break-even/target figures, or production stats (m² produced/printed, delays) the spec's board wants. |
| `workforce` (tasks, proof photos, mobile sync) | done | `apps/server/src/modules/workforce/*` | Matches the spec's (unchanged) description: tasks, photo proofs (magic-byte sniffed), and a real offline sync engine (change_seq cursor, optimistic concurrency, idempotency keys) — tested, including concurrent-conflict cases. |
| `hr` (fingerprint import, pay components, CNAS/IRG, payroll) | missing | — | `workforce.attendance` (migration `0007_employees.sql`) is plain admin-recorded clock-in/out — not a fingerprint-file importer, no pay components, no CNAS/IRG settings, no payroll runs/payslips. |
| `notifications` (events, templates FR/AR/EN, outbox, channels) | missing | — | No `notification_events`/`notification_templates`/`notification_outbox`/`notification_preferences` tables anywhere. |
| `displays` (TV feeds, tokens) | missing | — | No `display_screens` table, no TV-facing routes, no `apps/display` app. |
| `search` (unified cross-entity search) | missing | — | Confirmed by direct file reading: `Orders.tsx` and `Customers.tsx` each hand-roll their own `search`/`page` `useState` + `useQuery`, with no shared component. There is no unified search across orders/clients/services/quotes. |
| `history` (archived orders, client timeline) | missing | — | No `archived_at` column, no history view; a completed/cancelled order simply stays in the same `erp.orders` list. |
| `backup` (scheduled pg_dump + restore) | missing | — | `README.md` states this explicitly: "No backup tooling ships with the product." |
| `tracking` / `audit` / `dashboard` / `health` (unchanged in spec) | done | `apps/server/src/modules/{tracking,audit,dashboard,health}` | Present and working as documented in `README.md` (HMAC tracking links, hash-chained audit trail, dashboard summary, health check). |

---

## 2. Screens

| Item (spec screen) | Status | Files involved | Notes |
| --- | --- | --- | --- |
| Dashboard | partial | `apps/desktop/src/pages/Dashboard.tsx` | Exists, but a single executive summary — not the "operational view per position" (late orders, tasks due, follow-ups due, cash today) the spec wants. |
| Financial board | missing | — | No screen; no backing module either (see §1). |
| Clients | partial | `apps/desktop/src/pages/Customers.tsx` | Exists with its own ad hoc search, but no wilaya/source filters (those fields don't exist server-side either). |
| Client detail | partial | `apps/desktop/src/pages/CustomerDetail.tsx` | Exists; no "Open folder" button (no client-files module), no quotes/design tabs. |
| Quotations | **missing (screen)** | — | There is **no desktop screen for quotes at all**, even though the backend has a working quote→order conversion. A commercial cannot create or view a quote from the UI today. |
| Orders | partial | `apps/desktop/src/pages/Orders.tsx` | Own search/status-filter/paging; no hover/preview popover (grep for "popover"/`onMouseEnter` under `apps/desktop/src` found nothing), no "click name to invoice" shortcut. |
| Order editor | **conflicts** | `apps/desktop/src/pages/OrderEditor.tsx` | Still has a **Unit column** — spec decision #1 explicitly removes it (see §6). Pricing is service+dimension based, not Prix 1/2/3 tiers. TVA is a free-typed percentage, not a select from an admin list. |
| Order detail | partial | `apps/desktop/src/pages/OrderDetail.tsx` | Has tracking QR, order-scoped tasks, Export PDF — but not the spec's design/production/payments/invoicing/documents/messages tabs. |
| Services | partial | `apps/desktop/src/pages/Services.tsx` | List + create/edit exist; no category filter (no category concept at all — services only have code/name/pricing-unit/rate). |
| Production | partial | `apps/desktop/src/pages/Production.tsx` | Kanban board only (per `README.md`); no List view. |
| Design | missing | — | No screen. |
| Purchasing | missing | — | No screen. |
| Inventory | **missing (screen)** | — | The backend module exists (§1) but **there is no desktop page for it at all** — not in `apps/desktop/src/pages/`. |
| Offcuts | missing | — | No screen. |
| Évaluation | missing | — | No screen. |
| Cash | missing | — | No screen; no cash-register module. |
| Invoices | partial | `apps/desktop/src/pages/Invoices.tsx` | Exists; no stamp-duty handling, no reminders. |
| Reports | missing | — | `Ledger.tsx` shows journal entries and a trial balance, not P&L/sales-by-service/source/commercial reports the spec wants under "Reports". |
| Employees | partial | `apps/desktop/src/pages/Employees.tsx` | Roster + roles exist; no pay-components-per-employee (no HR module). |
| Attendance | partial | `apps/desktop/src/pages/AttendanceForm.tsx` | Manual clock-in/out entry only — no fingerprint-file upload, no column-mapping UI, no missing-punch correction flow. |
| Payroll | missing | — | No screen; no HR/payroll module. |
| Notifications | missing | — | No notification centre screen. |
| Displays | missing | — | No screen; no display module. |
| Settings | partial | `apps/desktop/src/pages/{Company,License}.tsx` | Company profile and licence status exist as **separate** pages; no unified Settings screen for positions/permissions, TVA rates, stamp duty, CNAS/IRG, board settings, public access, theme, language, or backups. |
| History | missing | — | No screen; no archive concept to show. |

**Cross-cutting screen rules from the spec** (not tied to one screen): no shared `DataTable` component (each list page reimplements search/filter/paging — confirmed by reading `Orders.tsx` and `Customers.tsx` in full), no draft-persistence store (grep for "draft" only found the `DRAFT` order status and a `LineDraft` type — nothing restores an in-progress form after navigating away), no light/dark **toggle** (Tailwind `dark:` classes exist but only follow the OS's `prefers-color-scheme`, no in-app switch), and only English/Arabic — no French (`packages/i18n/src/core.ts:4` — `LOCALES = ['en', 'ar']`; no `fr.ts` catalogue in any app). All: **missing**.

---

## 3. Migrations

Current migrations: `0001_core` … `0009_company_profile`. **Next free migration number: `0010`.**

| Item (spec migration) | Status | Files involved | Notes |
| --- | --- | --- | --- |
| `0010_reference` | missing | — | No `ref.*` schema. |
| `0011_crm_v2` | missing | `packages/db/migrations/0002_crm_erp.sql` (current CRM) | Current `crm.customers` has `customer_type`, `wilaya` (text), `nif/nis/rc/ai` — none of `is_individual`, `wilaya_id` (FK), `source_id`, `referrer_user_id`, `referrer_customer_id`, `account_owner_id`, `price_tier`, `notify_lang`, `hide_on_tv`. |
| `0012_quotes` | missing | `packages/db/migrations/0002_crm_erp.sql` (`erp.quotes`) | Current `erp.quotes` has no lead/version/follow-up/lost-reason tables. |
| `0013_pricing_v2` | **conflicts** | `packages/db/migrations/0008_services.sql`, `packages/types/src/units.ts` | The spec's own decision #1 for this migration is "`unit` dropped". Current schema has `erp.order_items.unit` (added in `0002_crm_erp.sql`, still present), and this session's own earlier work *added* `packages/types/src/units.ts` (`normalizeLineUnit`) to make that field more robust — directly the opposite of the spec's direction. No `price_1`/`price_2` on services (current model is `pricing_unit`/`price_ratio`/`batch_size`), no per-line `price_tier`/`custom_price_by`/`extra_fees`. |
| `0014_fsm_v2` | partial | `packages/db/migrations/0002_crm_erp.sql` (`erp.fsm_*`) | The FSM tables already exist and are already data-driven (see §1) — a real head start — but there is no payment guard and no `orders.archived_at`. |
| `0015_design` | missing | — | — |
| `0016_documents` | missing | — | No `documents` table (type/order/number/file path/hash). |
| `0017_client_files` | missing | — | — |
| `0018_purchasing` | missing | — | — |
| `0019_inventory_v2` | missing | `packages/db/migrations/0004_inventory.sql` (current inventory) | Current inventory has no lots/reservations/counts tables. |
| `0020_offcuts` | missing | — | — |
| `0021_valuation` | missing | — | — |
| `0022_cash` | missing | `packages/db/migrations/0003_finance.sql` (current `finance.payments`) | `finance.payments.invoice_id` is `NOT NULL` — no room for a pre-invoice deposit without a migration; no cash-session/expense-category tables. |
| `0023_hr` | missing | `packages/db/migrations/0007_employees.sql` (current attendance) | Current `workforce.attendance` is a much smaller table (clock in/out only) than the spec's fingerprint-import + payroll schema. |
| `0024_board` | missing | — | — |
| `0025_notify_displays` | missing | — | — |

---

## 4. Roles

Current roles (`packages/types/src/permissions.ts`): `SUPER_ADMIN`, `SALES_MANAGER`, `PRODUCTION_MANAGER`,
`WORKSHOP_SUPERVISOR`, `QA_INSPECTOR`, `FIELD_AGENT` — six **flat, hardcoded** roles, each a fixed list of
permissions (`ROLE_PERMISSIONS`). No scope tiers (Full/Own/Assigned/Read) are modeled — a permission is either
granted or not, with no notion of "only their own records."

| Item (spec position) | Status | Files involved | Notes |
| --- | --- | --- | --- |
| Owner (admin) | partial | `packages/types/src/permissions.ts` (`ROLES.SUPER_ADMIN`) | `SUPER_ADMIN` gets `ALL_PERMISSIONS` — functionally close, but named/structured differently and not an admin-editable "position". |
| Manager (sub-admin) | missing | — | No role runs daily operations broadly while being excluded from admin/licence/settings/payroll the way the spec's Manager is. |
| Commercial | partial | `ROLES.SALES_MANAGER` | Closest match (customers/quotes/orders/invoices/payments), but `SALES_MANAGER` also holds finance permissions (`FINANCE_INVOICE_CREATE`, `FINANCE_PAYMENT_RECORD`) beyond what the spec's plain Commercial gets, and lacks the "Own only" scope restriction. |
| Infographe (designer) | missing | — | No design permissions exist at all (no design module). |
| Chef de stock | missing | — | No purchasing/full-inventory-control role; `WORKSHOP_SUPERVISOR` has some stock permissions but not purchasing. |
| Production (atelier & pose) | partial | `ROLES.WORKSHOP_SUPERVISOR`, `ROLES.PRODUCTION_MANAGER` | Reasonable overlap for production/work-order permissions. |
| Caissier | missing | — | `FINANCE_PAYMENT_RECORD`/`FINANCE_PAYMENT_READ` exist as permissions, but no role bundles *just* a cashier's scope (no cash-register module to scope it to, either). |
| RH | missing | — | No payroll/HR permissions exist at all. |
| Owner can create custom positions | partial (data model only) | `packages/db/migrations/0001_core.sql` (`core.roles`, `core.role_permissions`) | These tables are already generic — a new role is just new rows — but there is no service/UI anywhere to create one; roles today are seeded once and are not admin-editable at runtime. |
| Per-field masking / audited access to sensitive fields | missing | — | No conditional field redaction, no audit-on-read for salary/price data (the audit trail logs writes via DB triggers, not reads). |

---

## 5. Architecture

This is the section with the largest, most structural gap.

| Item (spec requirement) | Status | Files involved | Notes |
| --- | --- | --- | --- |
| One local server (Postgres + API + tracker + mobile sync) that every company PC/TV connects to over LAN | **conflicts** | `apps/desktop/src-tauri/sidecar/launcher.mjs` | The installed desktop app is a **Tauri sidecar that embeds Node.js, PostgreSQL and the API server inside every single installed copy** (confirmed: `launcher.mjs` spawns its own Postgres + `main.js` per install, with per-install secrets in `secrets.json`). Every company PC that installs VictorFlow today runs **its own local database**, not a shared one — the direct opposite of the spec's "one server, many clients" model. This is the example the task named, and it's real. |
| Public access via Cloudflare Tunnel (tracking + mobile sync only, outbound-only, no open ports) | missing | — | No `infrastructure/tunnel/` directory, no cloudflared config, no code referencing Cloudflare beyond an incidental transitive dependency (`pg-cloudflare` inside `.local/pgtools`, unrelated). |
| Tracking website served by the shared local server | partial | `apps/tracker/` (Next.js) | The tracker exists and works (HMAC-signed links, sanitized read-only timeline — see `README.md`), but it is its own standalone Next.js process (`localhost:3001` in dev), not shown to be co-hosted by whichever machine the spec calls "the local server." How it would be exposed in the per-PC-sidecar production model is unaddressed. |
| Mobile app syncs with the one local server | conflicts (by extension) | `apps/mobile/src/config.ts` | The mobile app's "Server URL" points at whichever machine's API the admin configures — consistent with a per-PC embedded server, not a single always-on server. The offline sync ENGINE itself (change_seq, optimistic concurrency) is solid and reusable regardless of which server model wins. |
| Client folders on the local server's disk, reached from every PC over the LAN | missing | — | See §1 `client-files`. |
| Scheduled backups (pg_dump + client folders) on the local server | missing | — | `README.md`: "No backup tooling ships with the product." |
| Licence tied to the local server's hardware ID | partial | `packages/crypto/src/license.ts` (`hardwareFingerprint`) | The hardware-fingerprint primitive already exists and is unit-tested — a good building block — but it fingerprints whichever machine runs the check, which today is each individual sidecar install, not one designated server. |
| Later: pluggable cloud relay / S3-compatible store behind the same interfaces | partial (interfaces exist) | `apps/server/src/infra/storage/storage.service.ts` (`StorageService` abstract class) | The storage layer is already a swappable interface (`LocalStorageService` today) — genuinely reusable for the spec's "swap in SeaweedFS/Garage later" plan. No equivalent swappable interface exists yet for "sync" as a concept (mobile sync logic is directly in `workforce`, not behind a named relay interface), but the underlying change_seq/idempotency design would transfer. |

---

## 6. Code that actively contradicts the spec

Not just gaps — these are places current code does the specific thing the spec says should not happen, or
was reinforced *after* the spec's decision:

1. **The Tauri sidecar runs its own PostgreSQL on every PC** (`apps/desktop/src-tauri/sidecar/launcher.mjs`). The spec's whole architecture assumes one shared local server; the shipping product instead gives every installed copy its own isolated database. Reconciling this is a foundational decision, not a code tweak — see §5.
2. **The Unit field on order lines is still present, and was just reinforced.** Spec decision #1 is explicit: *"The unit column on order lines is removed."* Current code has `erp.order_items.unit` (`packages/db/migrations/0002_crm_erp.sql`), a visible Unit column in `apps/desktop/src/pages/OrderEditor.tsx`, and — from earlier in this same session — a brand-new `packages/types/src/units.ts` (`normalizeLineUnit`, `lineUnitSchema`) that adds *more* validation to keep that field, defaulting a blank/bare-number value to `"u"` rather than removing the field. This is the opposite of the spec's direction, done after the spec existed.
3. **A hard-coded TVA rate default.** The spec: *"TVA: a select with the rates the admin configures (none is hard-coded) plus Custom."* Current code hard-codes a default: `tvaRate: percentSchema.default('19')` in **both** `packages/types/src/schemas/sales.ts` (`documentLineSchema`) and `packages/types/src/schemas/services.ts` (`orderLineInputSchema`). There is no admin-managed TVA-rate table at all (see `reference` in §1) — every line's TVA is a free-typed percentage that happens to default to 19.
4. **No payment gate before production — and the code actively lets production start unpaid.** The spec: *"The move to Production needs at least one payment above 0 DA on the order."* `apps/server/src/modules/sales/orders.service.ts`'s `confirm()` method only checks the order is `DRAFT` and its total is non-zero, then **unconditionally** creates a production order in the same transaction — there is no query against `finance.payments` anywhere in that method. Combine this with finding #3 in §1 (`finance.payments.invoice_id NOT NULL` — no pre-invoice deposit can exist yet), and a payment gate isn't just unimplemented, it's structurally impossible to add without a schema change first.
5. **The pricing model is a different shape, not just missing tiers.** Spec: a service has **Prix 1** and **Prix 2** (either "not offered"), with **Prix 3** typed per line by a permitted user. Current: a service has one `price_ratio` plus a `pricing_unit` (`m2` / `per_linear_m` / `per_item` + `batch_size`) — an area/length/batch-rate model, not a flat per-piece tiered-price model. This isn't a small gap to fill in; it's a different pricing concept that the whole `OrderEditor.tsx` dimension-input UI is built around.

---

## 7. Test commands that exist today, and whether they pass

Re-run on 2026-09-30 (later the same day), Node 22.23.2, against an **isolated** PostgreSQL 16 on port 5434
(database `victorflow_ui`; the tests create their own throw-away `victorflow_ui_test` / `victorflow_ui_dbtest`)
— not the dev stack on 5433 and not the protected `victorflow` DB. `REDIS_ENABLED=false`, `QUEUE_ENABLED=false`.

| Command | Result | Detail |
| --- | --- | --- |
| `pnpm verify` (new: typecheck → lint → test, stops at first failure) | ✅ **passes** | Exit 0. Also checked that a deliberate type error makes it stop at typecheck (exit 2) with lint and tests never started. |
| `pnpm typecheck` (root, via turbo, 12 packages) | ✅ **passes** | `Tasks: 12 successful, 12 total`. |
| `pnpm lint` (new: ESLint, root flat config) | ✅ **passes** | 0 errors, 1 warning (a stale `eslint-disable no-console` in `packages/db/src/cli.ts`, left as-is). `apps/tracker` and `apps/mobile` are excluded this phase. |
| `pnpm test` (root, via turbo, all packages) | ✅ **passes** | `Tasks: 12 successful, 12 total` — **420 passed, 1 intentionally skipped**. |
| ↳ `packages/types` / `i18n` / `crypto` | ✅ | 32 / 14 / 16 tests. |
| ↳ `packages/db` | ✅ | 30/30 (both files, incl. `db.test.ts`, which previously crashed on load). |
| ↳ `apps/server` unit | ✅ | 11/11 suites, 74/74 tests (the 3 suites that failed before now pass). |
| ↳ `apps/server` e2e | ✅ | 10/10 suites, 185/185 tests (not runnable before). |
| ↳ `apps/desktop` / `tracker` / `mobile` | ✅ | 36 / 5 / 28 + 1 intentionally skipped (opt-in live-API test). |
| `pnpm db:migrate` / `pnpm db:seed` (standalone) | ✅ **pass** | Migrate: up to date. Seed: 56 permissions, 6 roles, 6 users, 24 accounts, fiscal year 2026. |
| `pnpm build` (root, via turbo) | ⏸ **not re-run in this pass** | Last confirmed passing earlier on 2026-09-30. Not re-run here because `apps/tracker`'s `next build` writes into `.next`, the same directory the dev stack's tracker uses. |

**What changed since the earlier run:** the earlier failures were all `BLOCKED BY ENVIRONMENT`. Windows Smart
App Control (event ID 3077, policy `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`) was blocking `argon2`'s native addon
(`node_modules/.pnpm/argon2@0.45.1/.../argon2.glibc.node`), so anything that imported the seed module crashed at
`require()` time. That block no longer occurs: `argon2` loads and hashes normally (checked directly, then through
the full test run above). No repo code was changed to get past it, and no Windows security setting was changed by
Claude. The only code changes in this pass were small lint fixes and do not affect test behaviour. `turbo.exe`
can still be blocked intermittently by the same policy; a bare retry has cleared it every time so far.

The same `pnpm verify` now runs in CI on every push (`.github/workflows/verify.yml`, windows-latest, Postgres
from `pnpm db:local`). As of this writing it has **not yet run on GitHub**. Its first run is the real proof.
