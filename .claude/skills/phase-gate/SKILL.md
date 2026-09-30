---
name: phase-gate
description: Gate one build phase of docs/structure-v2.md. Runs pnpm verify and pnpm ui:smoke, checks every item of the phase against the code and docs/mvp-gap-report.md, sweeps permissions for every position in the Roles table, reports the gaps that matter, and updates the gap report.
argument-hint: <phase number, 1-6>
disable-model-invocation: true
---

# Phase gate: phase $ARGUMENTS

Decide whether phase **$ARGUMENTS** of `docs/structure-v2.md` ("Build phases and decisions") is really done.
The spec is the reference, not the gap report: the report can be stale, so check the code yourself.

Label every result you report: **TESTED** (you ran it this session and saw it pass), **FAILED** (you ran it and
it failed), **BLOCKED BY ENVIRONMENT** (it could not run; say why), or **NOT RUN**. Never report a command as
passing unless you ran it in this session.

## 0. Pick the phase

- `$ARGUMENTS` must be one whole number from 1 to 6. If it is empty or anything else, list the six phases
  with their one-line titles from the spec and stop.
- Read the numbered item for that phase under "Build phases and decisions", then expand each item into its
  concrete requirements from the rest of the spec: the module section, the screens table, the migrations
  table, the Roles table, the Decisions table, and the rules in `CLAUDE.md`. Example: "services with
  Prix 1/2/3" expands to `price_1`/`price_2` nullable (not offered), Prix 3 typed on the line behind
  `sales.price.custom` with the typing user recorded, search bar and category filter on the Services screen,
  and migration `0013_pricing_v2`.
- Write this checklist down before checking anything. It is the list you will report against.

## 1. Run the checks

Run both, show the summary and every failure in full (not only the last lines), and keep going to step 2
whatever the result: a failing command is a gap, not a reason to stop.

1. `pnpm verify` (typecheck, lint, unit and e2e tests). It needs PostgreSQL. If Postgres is not reachable,
   report BLOCKED BY ENVIRONMENT and name `pnpm infra:up`; do not start or reset databases yourself.
2. `pnpm ui:smoke`. It needs the desktop UI already running (`pnpm dev:up`, or set `UI_URL` to another
   running UI) and it **writes demo data** to that stack's database.
   - First check the UI URL answers (`UI_URL`, default `http://localhost:1420/`). If it does not, report
     BLOCKED BY ENVIRONMENT. Do not start, stop or restart `pnpm dev:up` yourself.
   - Never run it against a database that holds a shop's real data. If you cannot tell, ask the user first.
   - Show every `PASS` / `FAIL` line. Screenshots land in `scripts/ui-smoke/shots/`.
   - The smoke flow covers the demo path only. It proves nothing about a phase item it does not exercise, so
     do not count it as evidence for those.

## 2. Check every item against the code

For each checklist item, find the evidence and give it one status, using the gap report's key:
`done` · `partial` · `missing` · `conflicts` (the code does something the spec says must not happen).

Look in every layer the item touches: migrations in `packages/db/migrations/`, zod DTOs and maths in
`packages/types/`, the server module and its `@RequirePermissions(...)` routes in `apps/server/src/modules/`,
the desktop page in `apps/desktop/src/pages/`, the catalogues in `packages/i18n/` and the app i18n folders,
and the tests (`*.test.ts`, `apps/server/test/*.e2e-spec.ts`). An item with a server route but no screen, or a
screen but no server check, is `partial`.

Check the `CLAUDE.md` rules on the code the phase touches:

- Prices, TVA, totals, statuses and permissions computed and checked on the server, not in the UI.
- Money: `NUMERIC(15,4)` in SQL, decimal strings in JSON, scaled integers in code. Any `number`/`parseFloat`/
  `toFixed` on money is a violation.
- No hard-coded TVA, stamp duty, CNAS or IRG rate: search for literals such as `19`, `9`, `0.19`, `DEFAULT 19`
  near rate fields, in SQL, types, server and desktop.
- Routes check a permission, never a position or role name, plus the scope (all, own, assigned).
- New tables have `created_at`, `updated_at` and `audit.attach()`. Posted financial entries stay immutable.
- Order states and transitions are rows in `erp.fsm_*`; only guards are code.
- Every new UI string exists in en, fr and ar. Colours come from theme tokens.
- Files go through the storage service, under `clients/<code>_<company>/{Design,Production,Resources,Facturation}/<order>/`.
- Migrations numbered after the last one, never an applied one edited, and the spec's migrations table in sync.
- New behaviour has tests, including a permission test per position.

Then compare each result with the item's current row in `docs/mvp-gap-report.md` and note every row that is
now wrong.

## 3. Permission sweep

Call the phase's endpoints as every position in the spec's Roles table and confirm what is allowed, what is
denied and which fields are removed.

1. **Endpoints.** List every route of the phase's modules: grep the controllers for the HTTP decorators and
   `@RequirePermissions(...)`. Include read, write and state-change routes.
2. **Expected result per position.** Take it from the Roles table rows for the phase's areas and the six rules
   under it: `Full` and `Read` (reads allowed, writes denied), `Own` and `Assigned` (only their records;
   someone else's record is 403 or 404 and absent from lists), `None` (403), plus the named field limits
   ("Name only", "without order margins", "no prices or phone numbers"). Fields a position may not see
   (prices, costs, phone numbers, salaries) must be **absent** from the JSON, not `null` or an empty string.
3. **Positions.** The eight positions are Owner, Manager, Commercial, Infographe, Chef de stock, Production,
   Caissier and RH. Find the matching rows in `core.roles` (the seed is in `packages/db/src/seed.ts`,
   permissions in `packages/types/src/permissions.ts`). A position that does not exist is one gap, "position
   missing", and its column in the matrix is `n/a`. Never stand in a legacy role for a spec position.
4. **Run it against the throw-away test database only.** Write a temporary spec at
   `apps/server/test/phase-gate.tmp.e2e-spec.ts` using the helpers in `apps/server/test/helpers/app.ts`
   (`createTestApp`, `login`, `http`, `bearer`, `USERS`, `TEST_PASSWORD`). The e2e global setup rebuilds a
   separate `<db>_test` database, so the dev data is never touched. When a position has no seeded user,
   create one inside the spec through the admin users API. For `Own` and `Assigned` checks, create a record
   owned by another user first. Run it with:

   ```
   pnpm --filter @victorflow/server exec jest --config jest.e2e.config.js --runInBand test/phase-gate.tmp.e2e-spec.ts
   ```

   Then delete the temporary spec whatever the outcome, and confirm `git status` shows no leftover file.
5. **Matrix.** One row per endpoint, one column per position, each cell `allow` / `deny` / `own` / `masked:
   <fields>` / `n/a`, with every cell that differs from the expected result marked as a gap. Also list the
   (endpoint, position) pairs that have no permanent test in `apps/server/test/`: the definition of done
   requires one per position.

## 4. Report

Report only gaps that affect correctness or the spec:

- a failing or blocked command from step 1,
- a phase item that is not `done`,
- a permission, scope or masking result that differs from the Roles table,
- a `CLAUDE.md` rule violation,
- missing tests the definition of done requires,
- a gap report row that is wrong.

Leave out style, naming, refactors and nice-to-haves. For each gap give the item, its status, the evidence
(`file:line` or the failing output), what the spec says, and what closing it needs. End with a verdict:
**phase $ARGUMENTS passes** only if both commands passed, every item is `done` and the sweep has no
mismatch; otherwise **phase $ARGUMENTS does not pass**, with the count of gaps.

## 5. Update docs/mvp-gap-report.md

- Fix the status and notes of every row in sections 1 to 6 that your check showed to be wrong, with the new
  evidence. Keep the report's status key and table layout.
- Add or replace a section `## 8. Phase gates` with one sub-section per phase,
  `### Phase <n> — <YYYY-MM-DD>, commit <short sha>`. Replace the sub-section for this phase if it exists and
  keep the others. Put in it: the two command results with their labels, the checklist with statuses, the
  permission matrix, and the gap list.
- Update the date and commit in the report's header line.
- Do not commit. Show the diff of the report and leave the commit to the user, since a gate often runs in the
  middle of other work.
