================================================================================
VICTORFLOW
ERP / CRM for a print & signage shop (Algeria) — local, single-tenant, offline-capable
================================================================================

Customers -> quotes -> orders (with area/length/item-based pricing) -> production
(Kanban) -> double-entry ledger -> invoices & payments, with a field-agent mobile
app that works offline, a public order-tracking page for customers, printable
order PDFs, and a company profile that brands them.

Full narrative documentation lives in README.md at the repo root (quick start,
demo script, test matrix, configuration reference, troubleshooting). This file
is a structural map of the codebase and a plain list of what is implemented.


================================================================================
1. PROJECT STRUCTURE
================================================================================

victorflow/
|
|-- apps/
|   |
|   |-- server/                  NestJS API (the source of truth for all data)
|   |   `-- src/
|   |       |-- modules/
|   |       |   |-- auth/            login, refresh, users, roles, permissions
|   |       |   |-- company/         company profile (name, contact, tax ids, logo)
|   |       |   |-- crm/             customers, contacts
|   |       |   |-- sales/           quotes, orders, order pricing, services catalogue
|   |       |   |-- production/      production orders, work orders, the FSM engine
|   |       |   |   `-- fsm/         configurable state machine (states/transitions in DB)
|   |       |   |-- finance/         chart of accounts, ledger, journal entries, invoices, payments
|   |       |   |-- inventory/       warehouses, items, stock moves, stock levels
|   |       |   |-- workforce/       tasks, attendance, proof photos, mobile sync
|   |       |   |-- tracking/        public order-tracking link (HMAC token)
|   |       |   |-- licensing/       licence check (dev stub or Ed25519 cryptographic)
|   |       |   |-- audit/           append-only audit trail + hash-chain verification
|   |       |   |-- dashboard/       executive dashboard summary
|   |       |   `-- health/          health check endpoint
|   |       |-- infra/               db, redis, storage (local filesystem) services
|   |       `-- common/              decorators, guards, zod request pipes, error filter
|   |
|   |-- desktop/                 React 19 + Vite + Tailwind + TanStack Query
|   |   `-- src/
|   |       |-- pages/               one file per screen (see section 2)
|   |       |-- components/          Layout (sidebar/nav), Brand, ui.tsx (design system), ServerGate
|   |       |                         (server check + "cannot reach the server" screen), ServerAddress
|   |       |-- lib/                 api client, auth, order-lines maths, company helpers, formatting
|   |       |-- i18n/                English + Arabic UI strings for this app
|   |       `-- src-tauri/           native shell (Tauri v2): a window + the opener plugin, no backend inside
|   |
|   |-- tracker/                 Next.js public order-tracking page (read-only)
|   |   `-- src/app/t/[orderId]/     the tracking page itself
|   |
|   |-- display/                 Next.js TV screens -- a "not paired yet" placeholder for now
|   |
|   |-- server-host/             VictorFlow Server for Windows: vf-server CLI (setup, services,
|   |                            run, status), stage.mjs (installer payload), installer/ (Inno Setup)
|   |
|   `-- mobile/                  Expo / React Native field-agent app
|       `-- src/
|           |-- screens/             LoginScreen, TasksScreen, TaskScreen
|           |-- sync/                offline-first sync engine (pure TypeScript, unit-tested)
|           |-- db/                  local SQLite
|           `-- api/                 API client used by the sync engine
|
|-- packages/
|   |-- types/                   zod schemas, DTOs, the permission catalogue, money maths,
|   |                            pricing maths (m2 / per_linear_m / per_item), unit-of-measure
|   |                            normalization -- shared by every app, browser-safe
|   |-- db/                      SQL migrations (0001..0009), Kysely table types, seed script, CLI
|   |-- crypto/                  Ed25519 licence signing/verification, HMAC tracking tokens
|   `-- i18n/                    translation engine (plurals, formatters), shared vocabulary
|                                 (statuses, roles, error messages) reused by every app
|
|-- infrastructure/
|   `-- docker/docker-compose.yml    PostgreSQL 16 + Redis 7, for local development
|
|-- scripts/
|   |-- dev-up.mjs / .ps1 / dev-up/  one-command dev bootstrap (infra -> migrate -> seed -> run)
|   |-- local-postgres.mjs           Docker-free embedded PostgreSQL fallback
|   `-- ui-smoke/                    automated browser walkthrough of the demo flow
|
|-- .github/workflows/           CI (verify.yml) + the server and desktop installer builds
|                                (server-build.yml, desktop-build.yml; workflow_dispatch only)
|-- README.md                    full narrative documentation (quick start, demo, tests, config)
`-- README.txt                   this file


--------------------------------------------------------------------------------
1.1 Database (packages/db/migrations)
--------------------------------------------------------------------------------
  0001_core.sql              users, roles, permissions, refresh tokens, doc counters
  0002_crm_erp.sql           customers, contacts, quotes, orders, production + FSM tables
  0003_finance.sql           chart of accounts, fiscal years, journals, entries, invoices, payments
  0004_inventory.sql         warehouses, items, stock moves, stock levels
  0005_workforce.sql         tasks, task proofs, mobile sync mutations
  0006_audit.sql             append-only audit trail with a SHA-256 hash chain (DB triggers)
  0007_employees.sql         staff attendance (clock in/out); tasks gain an optional order_id
  0008_services.sql          services catalogue (area/length/item pricing) + order-line pricing
                             provenance (snapshotted service, rate, dimensions, price overrides)
  0009_company_profile.sql   company profile singleton (name, contact, tax ids, logo pointer)

Every table has created_at/updated_at; most are wired into the audit trail via
audit.attach(schema, table). Money is NUMERIC(15,4) end to end -- never a float.


================================================================================
2. DESKTOP APP SCREENS (apps/desktop/src/pages)
================================================================================
  Login                 sign in; remembers/edits which server to talk to
  Dashboard             executive summary: revenue, collections, open orders, pipeline
  Customers             list + search; CustomerForm (create/edit, Algerian fiscal ids)
  CustomerDetail        one customer's history
  Orders                list, filter by status
  OrderEditor           create/edit a DRAFT order: service-priced lines (auto width/height/
                        length -> computed price) or manual lines with a permission-gated
                        override + required reason; live totals via the server's own maths
  OrderDetail           full order view: lines, totals, confirm/cancel, generate invoice,
                        customer tracking QR code + link, order-scoped Tasks, Export PDF
  Services              pricing catalogue CRUD (per m2 / per linear metre / per item+batch)
  Production            Kanban board (drag between stages; illegal moves are server-refused
                        with the reason named)
  Employees             staff roster, roles, attendance (clock in/out)
  Tasks                 cross-order task list: filter by status/assignee, inline status change
  Ledger                journal entries, trial balance
  Invoices              list, statuses, payments
  License               licence status (seats, expiry, features)
  Company               company profile: name, address, phone, email, NIF/NIS/RC/AI, logo
                        upload -- printed at the top of the order PDF
  (OrderDocument)        not a screen: the hidden print-only order sheet Export PDF renders


================================================================================
3. FUNCTIONALITY BY DOMAIN
================================================================================

3.1 Authentication & access control
--------------------------------------------------------------------------------
  - JWT access + refresh tokens; single-flight refresh on 401.
  - Permission-based authorization (never role names) -- every permission checked
    server-side, UI only hides what a user cannot use.
  - Role management: users can't escalate privileges they don't hold, can't touch
    a user who holds more than they do, and the last user able to manage users
    can never be removed (ROLE_ESCALATION / USER_OUT_OF_REACH / LAST_ADMIN).
  - Login throttling (per client address + e-mail), Redis-backed with an exact
    in-process fallback when Redis is off/unreachable.

3.2 Customers (CRM)
--------------------------------------------------------------------------------
  - Customers + contacts, Algerian fiscal identifiers (NIF, NIS, RC, AI), custom
    fields (free-form key/value), search, active/inactive.

3.3 Sales: quotes, orders, pricing
--------------------------------------------------------------------------------
  - Quotes -> convert to order.
  - Orders: DRAFT -> CONFIRMED -> (production) -> COMPLETED / CANCELLED.
  - Services catalogue: each service is priced per square metre, per linear
    metre, or per item (with a batch size, e.g. "1500 DA per 1000 cards").
  - Order lines are one of three shapes:
      1. service + dimensions  -> price computed by the server, never typed
      2. service + manual price + required reason (permission-gated override)
      3. no service, fully custom line + description + required reason
  - Every line snapshots the service/rate/dimensions used at creation time, so
    editing a service's price later never re-prices an existing order/invoice.
  - Unit of measure on every line is normalized: a blank or bare-number value
    (e.g. "0") is rejected and replaced with "u"; a real unit is kept as typed.
  - Money: decimal strings end to end, scaled integers internally -- never a
    float. Per-line rounding; document totals are the exact sum of the lines.
  - Export PDF: prints a clean, brand-neutral A4 order sheet (company header,
    customer, dates, lines, totals, notes) via the browser's own print engine
    -- works in English and Arabic (right-to-left), paginates long orders with
    the header row repeated, and suggests the order number as the file name.

3.4 Production
--------------------------------------------------------------------------------
  - Kanban board: DRAFT -> CONFIRMED -> IN_PRODUCTION -> QUALITY_CHECK ->
    COMPLETED, with REJECTED -> rework.
  - The state machine (states, transitions, the permission and guard each
    transition needs) is DATA in erp.fsm_* tables, loaded on every call --
    reconfigurable without a deploy. Only guard implementations are code.
  - Work orders per production order; illegal Kanban moves are refused server
    side with the specific unfinished work named.

3.5 Finance
--------------------------------------------------------------------------------
  - Double-entry ledger: chart of accounts, fiscal years, journals, entries.
  - Balanced-entry check enforced twice (application maths + a DB trigger).
  - Entry numbers: a Postgres sequence per (journal, fiscal year); the year is
    taken from the entry date, not the clock.
  - Posted entries and their lines are immutable (DB triggers reject UPDATE /
    DELETE / TRUNCATE); cancelling an invoice posts a reversing entry.
  - Invoices generated from confirmed orders; partial and full payments.

3.6 Inventory
--------------------------------------------------------------------------------
  - Warehouses, items, stock moves (receipt / issue / adjustment / transfer),
    computed stock levels. Weighted-average costing (no FIFO layers yet).

3.7 Workforce
--------------------------------------------------------------------------------
  - Employees ARE users (core.users) -- no separate "employee" table.
  - Attendance: clock in/out per user per day, admin-recorded, audited.
  - Tasks: assignable, optional link to a work order AND/OR an order; four
    statuses; usable stand-alone (Tasks page) or from an order (OrderDetail).
  - Proof photos: uploaded from the field, identified by magic bytes (never
    trusting the file name or declared content type), stored on the local
    filesystem via a pluggable storage service.
  - Mobile sync: pull by a monotonic change_seq cursor (never updated_at, so a
    slow transaction can't be skipped); push with optimistic concurrency
    (version) and an idempotency key per mutation, so retries are safe and a
    conflicting concurrent edit is reported, not silently overwritten.

3.8 Company profile
--------------------------------------------------------------------------------
  - One profile per install (name, address, phone, e-mail, NIF/NIS/RC/AI, logo).
  - Logo: PNG/JPEG/WebP up to 512 KB, identified by magic bytes, stored via the
    same storage service as proof photos, served back as an inline data URL.
  - Printed at the top of the order PDF; falls back to the VictorFlow mark
    when no logo (or no profile at all) has been configured.
  - Readable by any signed-in user (it's just the document header); editable
    only with the core.company.manage permission.

3.9 Public order tracking
--------------------------------------------------------------------------------
  - A signed link + QR code per order (HMAC-SHA256 token, constant-time
    compare). The public page is read-only and shows only a timeline and item
    descriptions -- no prices, customer identity, staff names or notes.

3.10 Audit trail
--------------------------------------------------------------------------------
  - Append-only audit.trail, filled by DB triggers on every audited table, with
    a per-row SHA-256 hash chain. Verifiable on demand (GET /audit/verify) and
    hourly via an in-process timer (works even with no Redis/queue).

3.11 Licensing
--------------------------------------------------------------------------------
  - Pluggable LicenseService: a "dev" stub (always allowed) or a real Ed25519-
    signed licence file (hardware id, expiry, seats, feature flags).
    Enforcement is off by default (LICENSE_ENFORCE=false).

3.12 Dashboard
--------------------------------------------------------------------------------
  - Revenue and collections this month, unpaid invoices, open orders, the
    production pipeline by stage, orders by status.

3.13 Internationalization
--------------------------------------------------------------------------------
  - Full English + Arabic (right-to-left) in the desktop app, the tracking
    page, and (screens built, not device-tested) the mobile app.
  - Proper RTL: mirrored navigation/tables/Kanban/breadcrumbs; codes, phone
    numbers, e-mails and URLs stay left-to-right inside Arabic text; Latin
    digits; dinar sign follows the amount; Algerian month names; 24-hour clock.
  - A build-time test fails if any app's Arabic catalogue is missing a key, has
    a stray one, drops a {placeholder}, or lacks a required plural form.

3.14 Server install and desktop shell
--------------------------------------------------------------------------------
  - One computer per shop runs VictorFlow Server (apps/server-host, Inno Setup
    installer): PostgreSQL 16, the API, the tracker and the TV displays as four
    Windows services (account NetworkService, automatic start, restart on
    failure), with config, secrets, the database, files and logs in ONE data
    folder (default C:\ProgramData\VictorFlow, kept on uninstall). Ports
    3000-3002 are opened to private/domain networks; PostgreSQL listens on
    127.0.0.1 only. "vf-server status|start|stop|setup|remove" manages it.
  - Setup and every API start migrate and seed (idempotent, marked temporary
    until real onboarding -- licence -> company -> admin -- is built); secrets
    (DB password, JWT secret, a random admin password) are generated once into
    the data folder's secrets.json.
  - The React UI is wrapped in a thin native Windows shell (Tauri v2) installed
    on every company PC. It holds no data: it checks the configured server and,
    when it cannot be reached, says why and lets the address be changed.


================================================================================
4. WHERE THINGS RUN (development)
================================================================================
  API (NestJS)                    http://localhost:3000/api/v1
  Desktop client (browser or      http://localhost:1420
    Tauri window)
  Public order tracking           http://localhost:3001
  TV displays (placeholder)       http://localhost:3002
  Field-agent app                 Expo Go / emulator
  PostgreSQL 16 / Redis 7         infrastructure/docker/docker-compose.yml
                                   (or an auto-started local PostgreSQL if
                                   Docker is unavailable -- see README.md)


================================================================================
5. COMMON COMMANDS (run from the repo root unless noted)
================================================================================
  pnpm install              install all workspace dependencies
  pnpm dev:up                bootstrap: infra -> build packages -> migrate -> seed -> run
  pnpm dev                   run API + desktop + tracker + displays (infra must already be up)
  pnpm build                 production build of every package/app
  pnpm typecheck             typecheck every package/app (run after any shared-type change)
  pnpm test                  run every test suite (needs PostgreSQL for db/server)
  pnpm db:migrate            apply pending SQL migrations
  pnpm db:seed               seed demo data (idempotent)
  pnpm db:reset              drop all app schemas, migrate, reseed (refuses in production)
  pnpm infra:up / infra:down docker compose for Postgres + Redis
  pnpm ui:smoke              automated browser walkthrough of the demo flow
  pnpm server:stage          assemble the server installer's payload (CI; --skip-web locally)

  apps/desktop:  pnpm --filter @victorflow/desktop dev | build | test | typecheck
                 pnpm --filter @victorflow/desktop tauri dev|build   (needs Rust)
  apps/server:   pnpm --filter @victorflow/server dev | test:unit | test:e2e
  apps/mobile:   pnpm --filter @victorflow/mobile start


================================================================================
6. NOT IMPLEMENTED / DEFERRED ON PURPOSE
================================================================================
  - Onboarding UI (licence -> create company -> create admin) for a fresh
    install -- a new server currently reaches a login screen via a temporary
    seeding shim (first-login.txt in the data folder), clearly marked to be
    removed once this ships.
  - Scheduled backups of the server's data folder.
  - No MinIO / object storage (local filesystem only), no Kubernetes, no
    multi-tenancy, no FIFO inventory costing (weighted-average only).
  - No credit notes (invoices are cancelled by a reversing entry), no partial
    refunds, no OS-keychain token storage (tokens live in localStorage).
  - The Tauri native shell and the server installer are only built on CI (the
    server installer with an install/uninstall smoke test there); the mobile
    app's UI is not exercised on a real device -- see README.md's "Not covered
    by pnpm verify" section for the exact list.

For anything not covered above -- setup, the demo script, the full test
matrix, configuration variables, and troubleshooting -- see README.md.
================================================================================
