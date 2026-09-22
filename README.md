# VictorFlow

ERP / CRM for an Algerian print & signage shop — a **local, single-tenant MVP** you can run on one machine.
Customers → quotes → orders → production (Kanban) → double-entry ledger → invoices & payments, with a
field-agent mobile app that works offline and a public order-tracking page for customers.

| Part | Path | Runs on |
|---|---|---|
| API (NestJS modular monolith, Kysely, PostgreSQL 16, Redis) | `apps/server` | http://localhost:3000/api/v1 |
| Desktop client (React 19 + Vite + Tailwind + TanStack Query, Tauri v2 shell) | `apps/desktop` | http://localhost:1420 |
| Public order tracking (Next.js, read-only) | `apps/tracker` | http://localhost:3001 |
| Field-agent app (Expo / React Native, offline-first SQLite) | `apps/mobile` | Expo Go / emulator |
| Shared zod schemas, DTOs, permission catalogue, money maths | `packages/types` | — |
| Kysely types, SQL migrations (triggers!), seed | `packages/db` | — |
| Ed25519 licence + HMAC tracking primitives | `packages/crypto` | — |
| Translation core (English + Arabic, right-to-left), locale-aware money & dates, shared vocabulary | `packages/i18n` | — |
| Postgres 16 + Redis 7 (with healthchecks) | `infrastructure/docker/docker-compose.yml` | Docker |

## Prerequisites

- **Node.js 22 LTS** (see `.nvmrc`) and **pnpm 10** (`npm i -g pnpm@10`).
  > ⚠️ Node **24.15 on Windows 11 build 26200 crashed roughly half of the long Jest runs** (`0xC0000409`) while this
  > was built — a Node/JIT fault, not the code (`--jitless` and Node 22 both had zero crashes in 12+ full runs).
  > Use Node 22 if you see a test run die with no output.
- **Docker** (Docker Desktop is fine) for PostgreSQL + Redis — **but it is optional**: if Docker is missing (or Docker
  Desktop is not running) `pnpm dev:up` automatically starts a local PostgreSQL 16 instead (downloaded once from npm,
  ~50 MB, no installer or admin rights; data in `./.local/`, stopped when you press Ctrl+C) and switches Redis off.
  Manage it by hand with `pnpm db:local start|stop|status`; delete `./.local` to start over. Prefer your own server?
  Point `DATABASE_URL` at it and run `SKIP_DOCKER=1 pnpm dev:up`.
- Optional: Rust toolchain (only for the native desktop shell), Expo Go on a phone (only for the mobile app).

## Quick start

```bash
pnpm install
pnpm dev:up            # same as ./scripts/dev-up (bash) or .\scripts\dev-up.ps1 (PowerShell)
```

`dev:up` does, in order: create `.env` from `.env.example` → `docker compose up -d` and wait for the healthchecks (or,
without Docker, start the local PostgreSQL) → build the shared packages → run the migrations → seed → `turbo dev`
(API + desktop + tracker).
Then open **http://localhost:1420** and sign in.

### Default seeded credentials (development only)

Every demo user has the password **`Admin123!`** (change it with `SEED_DEMO_PASSWORD` before seeding).

| Email | Role | Can, for example |
|---|---|---|
| `admin@victorflow.local` | SUPER_ADMIN | everything |
| `sales@victorflow.local` | SALES_MANAGER | customers, quotes, orders, confirm orders, invoices, payments |
| `production@victorflow.local` | PRODUCTION_MANAGER | confirm / start / send to QC, work orders, stock |
| `workshop@victorflow.local` | WORKSHOP_SUPERVISOR | start production, work orders, tasks, stock |
| `qa@victorflow.local` | QA_INSPECTOR | approve / reject at QUALITY_CHECK |
| `field@victorflow.local` | FIELD_AGENT | the mobile app: own tasks, sync, proof photos |

Guards check **permissions, never role names** — sign in as different users to see screens and actions appear and disappear.

### The 5-minute demo (the Definition of Done)

1. **Desktop** → sign in as `admin@…` → *Customers* → **New customer**.
2. **Orders → New order**: add a line (3 × 1 250,50); the total updates live to **4 464,29 DA TTC**. **Save & confirm**.
   The order page shows a **QR code / tracking link** and a production order was created.
3. **Production**: drag the card DRAFT → CONFIRMED → IN_PRODUCTION. Try dragging straight to QUALITY_CHECK — the
   **server refuses** and names the unfinished work orders. Complete them from the card, then finish the journey.
4. **Invoices → Generate invoice**: posts `Dr 411 / Cr 701 / Cr 44571` (balanced). **Record payment** (partial, then the rest).
   **Ledger** shows the entry and a balanced trial balance.
5. Open the tracking link (or scan the QR code) → the public page shows the sanitised timeline.
6. **Mobile** (below): go offline, update a task, come back online, sync.
7. **Language**: click **العربية** at the bottom of the sidebar — the whole app mirrors to right-to-left; the tracking
   page follows the visitor's browser language and has its own switch.

Automated: with the stack running, `pnpm ui:smoke` drives exactly this flow in a real browser (needs Chrome/Edge/Chromium),
then repeats the key screens in Arabic and checks the right-to-left layout.

## Desktop app

`pnpm dev` (and `dev:up`) serve the web UI in your browser — that is the same UI the Tauri shell wraps.
For the native window: install [Rust + the Tauri prerequisites](https://tauri.app/start/prerequisites/), then
`pnpm --filter @victorflow/desktop tauri dev` (or `tauri build`). *The Tauri shell has never been compiled where this repo was
authored (no Rust toolchain there); the web UI is what has been exercised. Everything that can be checked without Rust was:
valid config/capabilities, brand icons (ico/icns/png), the production frontend build. The `opener` plugin (opens the customer
tracking link in the system browser — a Tauri window ignores `target="_blank"`) is wired in but uncompiled.*

**Which server?** A desktop client is installed on employees' PCs and talks to the API on the customer's server, so the address is
a setting, not a build constant: on the sign-in screen, **Server → Change** (`192.168.1.10:3000`, `office-pc:3000` or a full
`https://…/api/v1` URL). It is remembered on that machine; `VITE_API_URL` only sets the default. The native window's CSP therefore
allows `connect-src http: https:` (scripts stay `'self'`); list your own host there instead if you want it pinned. The API side needs
that client's origin in `CORS_ORIGINS` (`http://tauri.localhost` for the native window).

## Mobile app

```bash
pnpm --filter @victorflow/mobile start      # then scan the QR code with Expo Go (SDK 57)
```

The phone and your computer must be on the same network; on the login screen the **Server URL** defaults to your
computer's address (`http://<your-ip>:3000/api/v1`). Sign in as `field@victorflow.local`.

- Everything is read from local SQLite — the list works with no connection.
- Change a task's status / hours / notes **offline**: it shows "not synced yet" and is queued.
- Attach a photo (camera + GPS) offline: it uploads on the next sync.
- Back online (or *Sync now*, or on app foreground / every 30 s) the queue is pushed. If somebody else edited the
  same task meanwhile you get a **conflict** screen: *Use server version* or *Keep mine and retry*. If the server *refuses*
  an edit for good (validation, permission) the task shows a **"The server refused your change"** notice until you dismiss it —
  a refused edit never just vanishes. An edit you make while a sync request is in flight is kept even when that request
  ends in a conflict or a refusal.

## Public order tracking

`GET /api/v1/orders/:id/tracking-link` (or the desktop order page) gives `http://localhost:3001/t/<orderId>/<token>`.
The token is `HMAC-SHA256(serverSecret, orderId + customerId)`, compared in constant time. The page is read-only and
shows only a timeline and item descriptions — **no prices, customer identity, staff names or internal notes**. A wrong
token and an unknown order return the identical 404.

## Languages and look

The desktop app, the public tracking page and the field-agent app speak **English** and **العربية** (Arabic, right to left).

- **Switching.** Desktop: the *English | العربية* switch at the bottom of the sidebar (top corner of the login screen).
  Tracker: the switch in the header — and on a first visit it follows the browser language (`Accept-Language`).
  Mobile: on the login and task-list screens. The choice is remembered; without one, an Arabic device/browser gets
  Arabic and anything else gets English.
- **Right to left done properly.** Navigation, tables, the Kanban board, breadcrumbs and arrows mirror. Codes, phone
  numbers, e-mails and URLs stay left-to-right inside Arabic text. Numbers use Latin digits (0-9), as on Algerian
  invoices; the dinar sign follows the amount (`4 464,29 DA` / `4 464,29 دج`); months use the Algerian names
  (جانفي، فيفري …); the clock is 24-hour.
- **Terminology** follows Algerian business usage (الزبون, الولاية, الرسم على القيمة المضافة). HT / TTC / TVA / NIF / NIS / RC / AI
  stay as printed on invoices. The ledger shows the official Arabic names of the seeded accounts and journals; in English
  it shows the names stored in the database (the legal chart is French).
- **Where the words live.** `packages/i18n` holds the engine (plurals — Arabic has six forms —, placeholders, fallbacks),
  the formatters and the vocabulary every app shares (statuses, roles, error messages). Each app adds its own wording in
  `src/i18n/`. English is the source of truth for the keys; a test in every app fails if Arabic misses a message, has a
  stray one, drops a `{placeholder}` or lacks a plural form. **Adding a language** = one catalog per app plus one entry
  in `LOCALES` (`packages/i18n/src/core.ts`).
- **What is not translated.** Data: customer names, work-order titles, order notes. Workflow labels an administrator adds in
  the database keep the label they were configured with (the six standard moves *are* translated). And the API's own
  English explanations of business rules: in Arabic the desktop shows a translated message for every known error *code*,
  and only falls back to the server's English text for a rule that has no translation yet.
- **Mobile.** React Native fixes the layout direction at start-up, so switching between English and Arabic restarts the
  app (offline data and queued edits live on disk and are kept). This path is type-checked and bundles with Metro, but has
  not been run on a device.

**Look.** The interface follows the VP · By.CREATIVE logo: near-black, one red accent (the slash), off-white paper.
Buttons are black and red is only an accent, so a red button always means *danger*. Light and dark follow the system
setting. Typefaces are Jost (Latin) and Cairo (Arabic), bundled with the app — no network needed. The monogram is drawn in
code (SVG) from the logo; the mobile app uses PNGs rendered from the same paths (`apps/mobile/assets`).

## Tests

```bash
pnpm test        # everything; the db + server suites need PostgreSQL (pnpm infra:up). They use throw-away
                 # <db>_test / <db>_dbtest databases — your dev data is never touched.
pnpm typecheck
pnpm build
```

| Suite | What it proves |
|---|---|
| `packages/types` | money maths on scaled integers (HT / TVA 19 % / TTC), rounding, no float drift |
| `packages/i18n` | plural rules (English + all six Arabic forms), locale negotiation, money / date formats in both languages, error translation by code, catalog completeness |
| `packages/crypto` | Ed25519 licence (valid / tampered / wrong key / hardware mismatch / expired), HMAC tracking |
| `packages/db` | every table has `created_at`/`updated_at`; required indexes; **DB triggers**: immutable posted entries, balanced-entry check, per-journal-per-year sequence numbers, `stock_levels`, `change_seq`, audit hash chain (tamper detection) |
| `packages/db` (seed guard) | production refuses to seed the public default password |
| `apps/server` unit | licensing (`crypto.verify(null, …)`), rate limiter (fail-open), error mapping, config, image sniffing, path safety |
| `apps/server` e2e | one file per phase against a real database: auth/RBAC (default-deny), CRM + sales, ledger + invoices + payments, config-driven FSM, inventory, **sync (concurrent conflicting push, replayed push, `change_seq` paging)**, public tracking, licensing enforcement, audit, dashboard, **user management (no privilege escalation, no lock-out)** |
| `apps/desktop`, `apps/tracker`, `apps/mobile` | API client (single-flight token refresh), live order maths, Kanban drop logic, the **sync engine** against a fake server that enforces the real rules, **English/Arabic catalog completeness** (every `t("…")` in the source has a message; Arabic has the same keys, placeholders and plural forms) |

Opt-in extras (need the stack running): `pnpm ui:smoke` (browser) and
`VF_LIVE_API=http://localhost:3000/api/v1 pnpm --filter @victorflow/mobile test` (the real sync engine against the real API).

**Not covered by any automated test** (be aware when you first run them):
- the Tauri native shell — never compiled (no Rust toolchain where this was authored);
- the mobile UI on a real device/emulator — the app *is* type-checked, bundles with Metro, and its sync engine is tested
  against both a fake and the real API. **Device checklist:** switch English ↔ Arabic (the app restarts, layout mirrors, no restart
  loop); sign in with a wrong password (message is in the chosen language); open a task, change status/hours, go offline (airplane
  mode), change it again, come back online and sync; edit the same task on the desktop first to get the conflict screen; attach a photo
  offline and sync; check the Android manifest has `android:supportsRtl="true"`;
- `docker compose` itself (the file is only reviewed: healthchecks, loopback-only ports);
- a **live Redis** — the limiter and audit paths are tested with fakes, and with Redis *disabled* and *enabled-but-unreachable*
  against a real API (limiter falls back, health reports `degraded`), but never against a running Redis server.

## Design decisions worth knowing

- **Money is never a float.** `NUMERIC(15,4)` in the DB, decimal *strings* on the wire, scaled `bigint` in code. Line amounts are rounded to the centime; totals are the exact sum of the rounded lines.
- **Ledger.** `sum(debit) = sum(credit)` is checked with scaled integers *and* again by a DB trigger. Entry numbers come from a Postgres **sequence per (journal, fiscal year)**, and the year comes from the **entry date**, not the clock. Posted entries and their lines are immutable (triggers reject UPDATE/DELETE/TRUNCATE); cancelling posts a **reversing entry**.
- **Production FSM is data.** States, the transition matrix, the permission each transition needs and its guard (with parameters) live in `erp.fsm_*` tables and are loaded on every call. Only guard *implementations* are code. Disable a transition, re-point its permission, or add one with a plain row — no deploy.
- **Audit.** Append-only `audit.trail`, filled by DB triggers, with a per-row SHA-256 hash chain (`audit.verify_chain()`, `GET /audit/verify`, hourly BullMQ job).
- **Sync.** Pull uses a monotonic `change_seq` cursor (never `updated_at`); a trigger + advisory lock makes sequence order equal commit order so a slow transaction can't be skipped. Push uses optimistic concurrency on `version`, and every mutation carries an idempotency key stored in the same transaction as the change.
- **Users can't escalate or lock themselves out.** Whoever may manage users can only hand out roles made of permissions they hold
  themselves, can't touch a user who holds more than they do, and no change may leave the installation without an active user who can
  manage users (`ROLE_ESCALATION` / `USER_OUT_OF_REACH` / `LAST_ADMIN`).
- **Rate limits work without Redis.** Login and tracking limits use Redis when it is healthy and an exact in-process counter otherwise
  (one API process per installation) — a limiter that fails open is no limiter. `RATE_LIMIT_ENABLED=false` is the only off switch.
  Behind a reverse proxy set `TRUST_PROXY=true` so limits see the real client address.
- **The tamper check survives Redis being off.** With no Redis/queue the audit chain is verified hourly by an in-process timer
  (`GET /audit/verify` always works). *If Redis is configured but unreachable the scheduled check pauses and logs a warning.*
- **Production won't ship a backdoor.** The server refuses to start with placeholder secrets or `LICENSE_MODE=dev`, and `db:seed`
  refuses to run in production without a strong `SEED_DEMO_PASSWORD` (the development default is public).
- **Licensing.** `LicenseService` interface with a dev stub and a real `CryptographicLicenseService` (Ed25519, hardware id, expiry, seats). `LICENSE_ENFORCE=false` (default) means nothing is ever blocked.

<details>
<summary>Try the real licence check</summary>

```bash
node -e "
const c = require('./packages/crypto'); const fs = require('fs');
const k = c.generateLicenseKeyPair();
fs.writeFileSync('license.demo.vfl', c.signLicense({ licenseId:'LIC-DEMO', customer:'Demo', tier:'PROFESSIONAL',
  features:['crm','sales','production','finance','inventory','workforce','audit'], maxUsers:10,
  hardwareId: c.hardwareFingerprint(), issuedAt:new Date().toISOString(), expiresAt:null }, k.privateKeyPem));
console.log('LICENSE_MODE=crypto\nLICENSE_ENFORCE=true\nLICENSE_FILE=./license.demo.vfl\nLICENSE_PUBLIC_KEY=' + k.publicKeyPem.replace(/-----[A-Z ]+-----|\s/g,''));
"
```
Put the printed lines in `.env`, restart the API, and open **License** in the desktop app.
</details>

## Configuration

Everything is in `.env` (created from `.env.example`). The ones you are most likely to touch:

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` / `REDIS_URL` | local docker | connections |
| `REDIS_ENABLED`, `QUEUE_ENABLED` | `true` | `false` = never touch Redis (rate limiting + the audit job are then off) |
| `JWT_ACCESS_SECRET`, `TRACKING_HMAC_SECRET` | dev placeholders | **change outside dev** (the API refuses placeholders in production) |
| `LICENSE_MODE` / `LICENSE_ENFORCE` | `dev` / `false` | see above |
| `STORAGE_DIR`, `UPLOAD_MAX_BYTES` | `./storage`, 10 MiB | proof photos on the local filesystem |
| `TRACKER_BASE_URL` | `http://localhost:3001` | host used in tracking links / QR codes |
| `SEED_DEMO_PASSWORD` | `Admin123!` | password of every seeded account. **Required (12+ chars, not the default) when `NODE_ENV=production`** |
| `LOGIN_MAX_ATTEMPTS`, `RATE_LIMIT_ENABLED` | `10` per 15 min, `true` | login throttling (per client address + e-mail) |
| `TRUST_PROXY` | `false` | `true` behind one reverse proxy, so limits see the real client IP |

## Deferred on purpose

No MinIO, Kubernetes, multi-tenancy or FIFO cost layers (weighted-average only; the trigger marks where FIFO layers would go).
Every production concern that was consciously postponed is marked **`// MVP-NOTE:`** — `grep -rn "MVP-NOTE" apps packages`
lists them (≈ 20): e.g. tokens in `localStorage` instead of the OS keychain, fixed account mapping for invoices,
global write lock behind the audit chain and `change_seq`, invoices cancelled by reversal rather than a credit note,
no refunds/payment cancellation, in-DB licence seats, signing out discards unsynced edits. **No backup tooling ships with the
product** — back up the PostgreSQL database (`pg_dump`) and `STORAGE_DIR` on a schedule of your own.

## Troubleshooting

- **A test run dies with no output on Windows** → use Node 22 (see Prerequisites). Never run two `pnpm test` at once: the e2e suites share one `<db>_test` database.
- **`docker` not found** → nothing to do: `dev:up` falls back to the local PostgreSQL (see Prerequisites). Force it with `LOCAL_DB=1 pnpm dev:up`, or use your own server with `SKIP_DOCKER=1`.
- **Port 5432 already in use** → if it is a Postgres that accepts the credentials in `.env` it is simply reused; otherwise stop it or change `DATABASE_URL`.
- **Something looks wrong in Arabic** → the language is chosen per browser/device (desktop: `localStorage`, tracker: a `vf_lang` cookie); switch back and forth, or clear it, to test.
- **`429 Too many login attempts`** → the login throttle (10 per 15 minutes per address + e-mail) is working; wait, or raise `LOGIN_MAX_ATTEMPTS` while testing.
- **`pnpm ui:smoke` says no browser could be started** → it tries every installed Chrome/Edge/Chromium in turn (a browser that is mid-update can exit at once); set `BROWSER_PATH` to a working one.
- **Ports 3000 / 3001 / 1420 busy** → stop the other process (the desktop dev server needs exactly 1420 for Tauri).
- **Redis warnings in the API log** → harmless when Redis is not running; set `REDIS_ENABLED=false` to silence them.
- **Phone can't reach the API** → same Wi-Fi, allow Node through the firewall on port 3000, and check the *Server URL* on the login screen.
- **Reset everything** → `pnpm db:reset` (drops all app schemas, migrates, re-seeds; refuses in production).

## Layout

```
apps/
  server/    NestJS API — modules: auth, crm, sales, production (+fsm), finance, inventory,
             workforce (sync, proofs), tracking, licensing, audit, dashboard
  desktop/   React + Vite + Tailwind (+ src-tauri/ native shell)
  tracker/   Next.js public tracking page
  mobile/    Expo app; src/sync/ is the offline sync engine (pure TS, unit-tested)
packages/
  types/     zod schemas + DTOs + permissions + money maths   (browser-safe)
  db/        migrations/*.sql · Kysely types · seed · CLI
  crypto/    Ed25519 licence + HMAC tracking                  (Node only)
  i18n/      English + Arabic engine, formatters, shared vocabulary (browser + Node + React Native)
infrastructure/docker/docker-compose.yml
scripts/     dev-up (.mjs/.ps1/sh) · ui-smoke/
```
