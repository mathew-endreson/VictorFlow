# VictorFlow

ERP / CRM for an Algerian print & signage shop — **one local server per shop**, with every company PC connecting to it
over the LAN. Customers → quotes → orders → production (Kanban) → double-entry ledger → invoices & payments, with a
field-agent mobile app that works offline and a public order-tracking page for customers.

| Part | Path | Runs on (development) |
|---|---|---|
| API (NestJS modular monolith, Kysely, PostgreSQL 16, Redis) | `apps/server` | http://localhost:3000/api/v1 |
| Desktop client (React 19 + Vite + Tailwind + TanStack Query, Tauri v2 shell) | `apps/desktop` | http://localhost:1420 |
| Public order tracking (Next.js, read-only) | `apps/tracker` | http://localhost:3001 |
| TV displays (Next.js; a "not paired yet" placeholder until the boards ship) | `apps/display` | http://localhost:3002 |
| Server install for Windows: services, data folder, `vf-server` CLI, installer | `apps/server-host` | — |
| Field-agent app (Expo / React Native, offline-first SQLite) | `apps/mobile` | Expo Go / emulator |
| Shared zod schemas, DTOs, permission catalogue, money maths | `packages/types` | — |
| Kysely types, SQL migrations (triggers!), seed | `packages/db` | — |
| Ed25519 licence (+ BluxTech's public key) and HMAC tracking primitives | `packages/crypto` | — |
| Licence issuer — **BluxTech only, never shipped**: activation codes, signed licences, transfers | `tools/licence-issuer` | BluxTech's offline machine |
| Translation core (English + Arabic, right-to-left), locale-aware money & dates, shared vocabulary | `packages/i18n` | — |
| Postgres 16 + Redis 7 (with healthchecks) | `infrastructure/docker/docker-compose.yml` | Docker |

## Install at a shop

A shop gets **two installers**, both built on GitHub Actions (see [Build the installers](#build-the-installers)):

| Installer | Goes on | What it installs |
|---|---|---|
| `VictorFlow-Server-Setup-<version>.exe` | **one** computer, the shop's server (on all the time, wired to the network) | PostgreSQL 16, the API, the tracking website and the TV displays, as four Windows services that start with Windows |
| `VictorFlow_<version>_x64-setup.exe` | **every** company PC (including the server, if someone works on it) | the desktop app only. It holds no data: it connects to the server over the LAN |

```
 company PCs ──LAN──▶ server PC :3000  VictorFlowApi      ──▶ VictorFlowPostgres (127.0.0.1:55432 only)
 TVs         ──LAN──▶ server PC :3002  VictorFlowDisplay
 browsers    ──LAN──▶ server PC :3001  VictorFlowTracker  (public through Cloudflare Tunnel later; not in this release)
```

### 1. Install the server

On the server computer, signed in as an administrator, run `VictorFlow-Server-Setup-<version>.exe` (English, French or
Arabic). It asks two things:

- **Program folder** — default `C:\Program Files\VictorFlow Server`. Replaced on every upgrade; holds no data.
- **Data folder** — default `C:\ProgramData\VictorFlow`. Everything that changes lives here, and it is **kept when VictorFlow
  is uninstalled**. Pick a local disk with room to grow; the path must use plain letters (no accents — PostgreSQL limitation).

Then it installs the Microsoft Visual C++ runtime (PostgreSQL needs it), creates the database, starts the four services, opens
ports 3000-3002 in Windows Firewall for **private and domain** networks, and shows the address to give to the PCs, for example
`192.168.1.10:3000`. The data folder then holds:

| In the data folder | What it is |
|---|---|
| `config.json` | ports (`apiPort` 3000, `trackerPort` 3001, `displayPort` 3002, `pgPort` 55432), the tracking-link address (`trackerPublicUrl`, empty = `http://<computer name>:3001`), extra allowed origins, `licenceServerUrl` (empty = offline activation only) |
| `secrets.json` | database password, JWT and tracking secrets — generated once, never edited. The folder is readable only by Administrators, SYSTEM and the services' account (NetworkService) |
| `postgres\` | the PostgreSQL 16 database (its own logs in `postgres\log\`) |
| `storage\` | uploaded files (company logo, proof photos; client folders later) |
| `logs\` | `setup.log` and each service's log (`VictorFlowApi.out.log`, `.err.log`, …) |
| `addresses.ini` | the addresses to give out (desktop PCs, tracker, TVs) |
| `license.vfl` | the licence BluxTech signed for this server, written by the onboarding (or the **Licence** screen) |

The server starts **with no account at all** and runs in production mode with the signed-licence check always on. The first
company PC that connects shows **Set up VictorFlow** instead of the sign-in screen (see step 2).

**Before the PCs can connect**, on the server: set its network to **Private** (Settings → Network & internet → your network —
on *Public* Windows blocks every other PC; setup warns you), give it a fixed address (a DHCP reservation in the router, or use
its computer name), and set it to never sleep.

### 2. Install the desktop app on each PC

Run `VictorFlow_<version>_x64-setup.exe`. On first start the app connects to `localhost:3000` — right on the server itself;
on any other PC it shows **Cannot reach the VictorFlow server**, with the reason and the address it tried. Click **Change**,
enter the server address from `addresses.ini` (`192.168.1.10:3000`, or `SHOP-SERVER:3000`), **Save**: the sign-in screen
appears — or, on a new server, **Set up VictorFlow**, once, on one PC:

1. **Licence** — type the activation code (`VF-XXXX-XXXX-XXXX`, sold with the copy) → **Get the request code** → send that
   code to BluxTech (WhatsApp is fine). Paste the licence text that comes back, or open the `.vfl` file → **Activate**.
   (If the server has a `licenceServerUrl`, **Activate online** does the exchange directly.)
2. **Company** — the details printed on documents (the logo comes later, on the Company page).
3. **Owner** — the first account, with every right; it is signed in at once and creates the team's accounts.

If the licence check later fails (another server, a changed file, a version newer than the licence's updates), VictorFlow turns
**read-only**: everything can still be viewed and exported, nothing can be changed, and the owner installs a valid licence on
the **Licence** screen. The address is remembered on that PC (sign-in screen → **Server → Change** to edit it later). If the server stops
answering while someone is working, a banner says so and the app keeps retrying; nothing typed is lost.

*Upgrading a PC that ran an earlier build:* those builds kept their own database in `%APPDATA%\dz.victorflow.desktop\`. It is
left there untouched and is **not** moved to the server.

### Run and manage the server

From the program folder (the Start menu's **VictorFlow Server status** runs the first one); `stop`, `start` and `setup`
need a terminal opened as administrator:

```bat
cd "C:\Program Files\VictorFlow Server"
vf-server status     :: each service, whether it answers, the addresses to give out, where the logs are
vf-server stop       :: stop all four services (dependants first)
vf-server start      :: start them again
vf-server setup      :: re-apply everything after editing config.json (ports, tracking address) — safe to run any time
```

The services are also in **services.msc** (`VictorFlowPostgres`, `VictorFlowApi`, `VictorFlowTracker`, `VictorFlowDisplay`):
automatic start, restart on failure, account *Network Service*. The API applies new database migrations each time it starts.

- **Upgrade:** run the newer server installer. It stops the services, replaces the program folder, migrates, starts again;
  the data folder and its secrets are untouched. Installing an older version over a newer one is refused.
- **Uninstall:** Settings → Apps → *VictorFlow Server*. The services and firewall rules go; **the data folder stays** (delete
  it yourself only if you really mean to lose the shop's data).
- **Back up** (no scheduled backup yet): stop the services (`vf-server stop`), copy the whole data folder, start them again.
- **Something wrong?** `vf-server status` first; then `logs\setup.log` (installation), `logs\VictorFlowApi.err.log` (the API),
  `postgres\log\` (the database). If setup failed, the installer shows the reason's file; fix it and run the installer again.

### Build the installers

Both are built on GitHub Actions, **manually**: Actions tab → the workflow → **Run workflow** (a push builds nothing).

| Workflow | Produces | Steps |
|---|---|---|
| `.github/workflows/server-build.yml` | artifact `victorflow-server-windows-installer` | `pnpm install` → build the API, `server-host` and the tracker's packages (`.github/actions/server-deps`) → `pnpm server:stage` (Node 22.23.2 with its checksum, PostgreSQL 16 from `embedded-postgres`, WinSW 2.12 with a pinned SHA-256, the VC++ runtime with its Microsoft signature checked, the deployed API, the tracker and displays each built as a Next.js standalone server inside its own `pnpm deploy` copy — checked for a single React, then started once —, migrations, `vf-server`) → a **copy** of the stage with a throwaway licence key → Inno Setup 6.7.1 → **smoke test on the runner** with that test installer: silent install, all services running as NetworkService, health, no demo account, **onboarding through the API** (code → request code → licence signed by `tools/licence-issuer` → company → owner), LAN address, restart, reinstall keeps the data and the licence, uninstall keeps the data → **release key check** (fails while the committed key is the placeholder) → the release installer from the untouched stage |
| `.github/workflows/desktop-build.yml` | artifact `victorflow-desktop-windows-installer` | `pnpm install` → build the desktop app and its packages → `tauri build --bundles nsis` |

Neither installer is code-signed yet: SmartScreen and Smart App Control may warn on a customer PC.

**Trying them on real PCs:** `pnpm trial:kit` downloads the latest successful installers of `phase-1` (with `gh`) into
`trial-kit/` (gitignored) together with `check-server.ps1`, `check-client.ps1` and a step-by-step README
(`scripts/trial-install/README.md`). The two scripts write `report-server.txt` and `report-client.txt`, which never contain
a secret.

`pnpm server:stage` assembles the same payload locally (≈ 1 GB of temporary space; `--skip-web` leaves out the tracker and
displays, `--web-only` does only them — that is what `verify.yml`'s `server-web` job runs on every push). To run the server
parts **without installing services** — from the repository, after `pnpm build`:

```bash
node apps/server-host/dist/vf-server.mjs setup --no-services --data-dir C:\vf-test   # data folder + database cluster
node apps/server-host/dist/vf-server.mjs run postgres --data-dir C:\vf-test          # one terminal each
node apps/server-host/dist/vf-server.mjs run api --data-dir C:\vf-test
node apps/server-host/dist/vf-server.mjs run tracker --data-dir C:\vf-test           # needs a `next build` of the app
node apps/server-host/dist/vf-server.mjs run display --data-dir C:\vf-test
```

Edit `C:\vf-test\config.json` first if `pnpm dev:up` is running (it uses 3000-3002 too).

## Prerequisites (development)

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
(API + desktop + tracker + displays).
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
`pnpm --filter @victorflow/desktop tauri dev` (or `tauri build`). The shell is deliberately thin: one window plus the `opener`
plugin (opens the customer tracking link in the system browser — a Tauri window ignores `target="_blank"`). It runs no database
and no API; it is only ever compiled on CI (`desktop-build.yml`), because Smart App Control blocks Rust builds on the machine
this repo is developed on.

**Which server?** The address is a setting, not a build constant: the first screen checks the server
(`GET /api/v1/health`, which names itself `victorflow-api`) and, if it can't be reached, says why — nothing answers, it timed out,
something that isn't VictorFlow answered, or the server is up but its database is not — and offers **Change** right there. The same
editor is on the sign-in screen (**Server → Change**: `192.168.1.10:3000`, `office-pc:3000` or a full `https://…/api/v1` URL).
Changing server signs that PC out and clears cached data. `VITE_API_URL` only sets the default (`http://localhost:3000/api/v1`).
The native window's CSP allows `connect-src http: https:` (scripts stay `'self'`). The API must list the client's origin in
`CORS_ORIGINS`; the server install allows `http://tauri.localhost` and `tauri://localhost` itself.

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
pnpm verify      # typecheck → lint → test, stops at the first failure (what CI runs on every push)
pnpm lint        # ESLint (apps/tracker and apps/mobile are excluded for now)
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
| `apps/desktop` (server connection) | every outcome of the server check (ok / unreachable / timeout / not VictorFlow / database down), "connection lost" raised once and cleared by the next answer, changing server signs out; the new French strings match English |
| `apps/server-host` | the whole `setup` sequence against a fake Windows (data folder locked by SID before anything else, initdb between a temporary grant and its removal, PostgreSQL registered before the database is prepared, the database ready before the API starts, accounts, firewall private/domain only), a second run (no re-init, no re-registration, secrets kept, new ports applied), refusals (port in use names its owner, not admin, network path), `remove` keeps the data; WinSW files carry no secret; config/secrets merging; the services' environment |
| `apps/display` | French, Arabic and English messages match |

Opt-in extras (need the stack running): `pnpm ui:smoke` (browser) and
`VF_LIVE_API=http://localhost:3000/api/v1 pnpm --filter @victorflow/mobile test` (the real sync engine against the real API).

**Not covered by `pnpm verify`** (be aware when you first run them):
- the Tauri native shell and the server installer — only built on CI; the server installer's real install / services /
  firewall / uninstall are covered by the smoke test in `server-build.yml`, never on a development machine;
- two real PCs on a real LAN (firewall profile, IP changes) — test this at the first shop install;
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
- **Production won't ship a backdoor.** The server refuses to start with placeholder secrets, `LICENSE_MODE=dev`,
  `LICENSE_ENFORCE=false` or the placeholder licence key, and `db:seed` refuses to run in production without a strong
  `SEED_DEMO_PASSWORD` (the development default is public). A shop's server never seeds an account: the first one is the
  owner, created by the onboarding.
- **Licensing.** A licence is perpetual, Ed25519-signed by BluxTech and bound to the server's hardware ID (Windows MachineGuid +
  SMBIOS UUID — not network cards, so a VPN never breaks it). It lists the modules, the seats (desktop sessions at the same
  time; mobile users) and `updatesUntil`: versions released after that date run read-only on it. A failed check never locks
  a shop out: **read-only** (every write → `403 LICENCE_READ_ONLY`, every read and export works). A module outside a valid
  licence is hidden and refused (`LICENSE_FEATURE`); a sign-in over the seats is refused (`LICENSE_SEATS`). A desktop session
  holds its seat until it signs out or stops renewing for 30 minutes. In development, `LICENSE_MODE=dev` unlocks everything
  and `LICENSE_ENFORCE=false` blocks nothing.

<details>
<summary>Licences: the issuer, a development trial, and the real key</summary>

`tools/licence-issuer` runs on BluxTech's **offline** machine only (`pnpm --filter @victorflow/licence-issuer build`, then copy
`tools/licence-issuer/dist/licence-issuer.mjs` there and run it with Node 22). It refuses to put a private key or its ledger
inside any repository.

```bash
I=tools/licence-issuer/dist/licence-issuer.mjs
node $I keygen   --out D:/bluxtech/keys                       # once: the key pair; prints the public key line
node $I codes    --ledger D:/bluxtech/ledger.json --shop "Imprimerie X"            # VF-XXXX-XXXX-XXXX, single use
node $I issue    --key D:/bluxtech/keys/licence-private-key.pem --ledger D:/bluxtech/ledger.json \
                 --request VFR1-… --modules crm,sales,production,finance,inventory,workforce,audit \
                 --desktop-seats 3 --mobile-users 5 --updates-until 2027-10-05                # → <id>.vfl + <id>.txt
node $I issue    … --reissue                                  # the same server again (lost file, new terms)
node $I transfer --key … --ledger … --request VFR1-…          # a new server: 2 free transfers per code, then --force
node $I inspect  licences/LIC-….vfl --public-key D:/bluxtech/keys/licence-public-key.pem
```

**The real key.** `packages/crypto/src/licence-public-key.ts` holds a **placeholder** until BluxTech runs `keygen` and commits
the printed line. Until then the API refuses to start in production and `server-build.yml` builds no release installer (its
smoke test still runs, on a copy with a throwaway key).

**Trying it in development:** `keygen` and `codes` into a folder outside the repo, then in `.env`: `LICENSE_MODE=crypto`,
`LICENSE_ENFORCE=true`, `LICENSE_PUBLIC_KEY=<the printed line>` (development and tests only — production ignores it),
`LICENSE_FILE=./license.demo.vfl`. Restart the API, open **Licence** in the desktop app, get the request code, `issue` it, and
paste the licence. To see the onboarding, point `DATABASE_URL` at an empty database with only the reference data.
</details>

## Configuration

Everything is in `.env` (created from `.env.example`). The ones you are most likely to touch:

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` / `REDIS_URL` | local docker | connections |
| `REDIS_ENABLED`, `QUEUE_ENABLED` | `true` | `false` = never touch Redis (rate limiting + the audit job are then off) |
| `JWT_ACCESS_SECRET`, `TRACKING_HMAC_SECRET` | dev placeholders | **change outside dev** (the API refuses placeholders in production) |
| `LICENSE_MODE` / `LICENSE_ENFORCE` | `dev` / `false` | see above; production requires `crypto` / `true` |
| `LICENSE_FILE` | `./license.vfl` | the installed licence (the data folder's `license.vfl` on a shop server) |
| `LICENSE_SERVER_URL` | empty | online activation: BluxTech's licence server (empty = offline activation only) |
| `LICENSE_PUBLIC_KEY` | built-in key | development and tests only: trust another key (production always uses the built-in one) |
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
product yet** — on a shop server, stop the services and copy the data folder (see [Run and manage the server](#run-and-manage-the-server)).

## Troubleshooting

### Windows

- **Docker Desktop won't start, or `pnpm infra:up` hangs waiting for it** → Docker Desktop needs virtualization enabled in the BIOS/UEFI and the **WSL2** feature turned on (`wsl --install`, then reboot; Docker Desktop's own settings confirm which backend it's using). Without that, Docker Desktop refuses to start its engine — `pnpm dev:up` then automatically falls back to a local, Docker-free PostgreSQL instead (see Prerequisites), which works fine for a single machine.
- **A command fails with "An Application Control policy has blocked this file"** → this is Windows **Smart App Control**, not a bug in this repo. It can block an unsigned native binary the first time it runs; `turbo.exe` (used by `pnpm build` / `pnpm typecheck` / `pnpm dev`) is a known target, and the same file can flip between allowed and blocked across separate runs. **We never change Smart App Control for you.** If it blocks `turbo.exe`: retry the command (it sometimes passes the next time), or bypass turbo for that one package, e.g. `pnpm --filter @victorflow/server typecheck` instead of `pnpm typecheck`. A block that never clears needs a policy change on your end (Windows Security → App & browser control → Smart App Control).
- **Port 5432 already in use** → VictorFlow's own Postgres defaults to **5433**, not Postgres's usual 5432, for exactly this reason: a standalone PostgreSQL install (the EnterpriseDB Windows installer, often bundled with pgAdmin) commonly registers itself as an auto-starting Windows service and already owns 5432 — check with `Get-Service postgresql*` in PowerShell. `pnpm infra:up` / `pnpm dev:up` check the configured port before starting anything and name whatever already owns it (service or process), instead of failing with Docker's generic "bind: permission denied"; follow the printed fix — stop that service, or set `POSTGRES_PORT` (and `DATABASE_URL`) in `.env` to another free port.

### Everything else

- **A test run dies with no output on Windows** → use Node 22 (see Prerequisites). Never run two `pnpm test` at once: the e2e suites share one `<db>_test` database.
- **`docker` not found** → nothing to do: `dev:up` falls back to the local PostgreSQL (see Prerequisites). Force it with `LOCAL_DB=1 pnpm dev:up`, or use your own server with `SKIP_DOCKER=1`.
- **A configured port is already in use** → see **Port 5432 already in use** above; the same named-owner check covers Redis's port too.
- **Something looks wrong in Arabic** → the language is chosen per browser/device (desktop: `localStorage`, tracker: a `vf_lang` cookie); switch back and forth, or clear it, to test.
- **`429 Too many login attempts`** → the login throttle (10 per 15 minutes per address + e-mail) is working; wait, or raise `LOGIN_MAX_ATTEMPTS` while testing.
- **`pnpm ui:smoke` says no browser could be started** → it tries every installed Chrome/Edge/Chromium in turn (a browser that is mid-update can exit at once); set `BROWSER_PATH` to a working one.
- **Ports 3000 / 3001 / 3002 / 1420 busy** → stop the other process (the desktop dev server needs exactly 1420 for Tauri). An
  installed VictorFlow Server uses 3000-3002 too: `vf-server stop` while you develop on the same machine.
- **Redis warnings in the API log** → harmless when Redis is not running; set `REDIS_ENABLED=false` to silence them.
- **Phone can't reach the API** → same Wi-Fi, allow Node through the firewall on port 3000, and check the *Server URL* on the login screen.
- **Reset everything** → `pnpm db:reset` (drops all app schemas, migrates, re-seeds; refuses in production).

## Layout

```
apps/
  server/    NestJS API — modules: auth, crm, sales, production (+fsm), finance, inventory,
             workforce (sync, proofs), tracking, licensing, audit, dashboard
  desktop/   React + Vite + Tailwind (+ src-tauri/ native shell: a LAN client, no backend inside)
  tracker/   Next.js public tracking page
  display/   Next.js TV screens (placeholder until the boards ship)
  server-host/  vf-server CLI (setup, services, run), stage.mjs, installer/ (Inno Setup)
  mobile/    Expo app; src/sync/ is the offline sync engine (pure TS, unit-tested)
packages/
  types/     zod schemas + DTOs + permissions + money maths   (browser-safe)
  db/        migrations/*.sql · Kysely types · seed · CLI
  crypto/    Ed25519 licence + HMAC tracking                  (Node only)
  i18n/      English + Arabic engine, formatters, shared vocabulary (browser + Node + React Native)
infrastructure/docker/docker-compose.yml
scripts/     dev-up (.mjs/.ps1/sh) · ui-smoke/
.github/workflows/  verify.yml (every push) · server-build.yml · desktop-build.yml (installers, manual)
```
