# VictorFlow

Scope: @docs/structure-v2.md is the spec. Progress: docs/mvp-gap-report.md.

## Architecture
- One local server per print shop: NestJS API, PostgreSQL 16, tracking website, mobile sync, TV displays, files on disk. Company PCs run the Tauri desktop app over the LAN.
- Only the tracking and mobile sync routes are public, through Cloudflare Tunnel. Everything else is LAN-only.
- The MVP has no third-party cloud: no Firebase, no MinIO, no WhatsApp sending.

## Rules
- IMPORTANT: the server computes and checks prices, TVA, totals, statuses and permissions. The UI only displays.
- Money: NUMERIC(15,4) in SQL, decimal strings in JSON, scaled integers in code. Never floats.
- Every endpoint checks a permission (never a position name) and its scope (all, own, assigned) and removes fields the user may not see from the response.
- New tables get created_at, updated_at and audit.attach(). Posted financial entries are immutable.
- Order states and transitions are rows in erp.fsm_*; only guards are code.
- TVA rates, stamp duty, CNAS and IRG are admin settings. Never hard-code a rate.
- Every UI string exists in en, fr and ar. Arabic is right-to-left. Colours come from theme tokens (light and dark).
- Files go through the storage service: clients/<code>_<company>/{Design,Production,Resources,Facturation}/<order>/.
- Migrations: new files numbered after the last existing one, in build order. Never edit an applied migration. Keep the migrations table in docs/structure-v2.md in sync.

## Commands
- pnpm verify: typecheck, lint, unit and e2e tests (PostgreSQL must be up: pnpm infra:up)
- pnpm ui:smoke: browser walkthrough of the demo flow (needs pnpm dev:up running; writes demo data to the dev database)
- pnpm db:reset: rebuild the dev database (drops all data, re-migrates, re-seeds)

## Definition of done (every task)
1. pnpm verify passes. New behaviour has tests, including a permission test per position.
2. New strings exist in en, fr and ar.
3. docs/mvp-gap-report.md is updated; the spec too if the design changed.
4. Reply with what changed, how to try it, and what is left.
5. One commit on the branch that is checked out: <type>(<module>): <summary>. Do not create or switch branches unless asked.

## Out of scope for the MVP
WhatsApp sending, imports from machines other than the fingerprint machine, a cloud relay, licence prices (what BluxTech charges each shop). Order pricing is in scope.
