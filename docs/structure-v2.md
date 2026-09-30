# VictorFlow — New Structure v2

Sep 30, 2026 · @Nasro Tamri

## Overview

VictorFlow v2 runs on a local server (NestJS API + PostgreSQL 16) that every company PC connects to; the same server self-hosts the client tracking website and the backend of the employee and admin mobile app. It follows the real Victor Pub workflow: one commercial owns the client, design is approved before production, a first payment unlocks production, and finished orders move to history.

Four rules drive every module:

- **The server is the source of truth.** Prices, TVA, statuses and permissions are computed and checked on the API; the UI only displays.
- **Least privilege by default.** Every screen, field and list is filtered by the user's permissions, not only hidden in the UI.
- **Nothing is lost.** Completed orders are archived, never deleted; posted money entries are immutable; drafts survive page changes.
- **Local first.** All data lives in PostgreSQL 16 on the shop's server. The same server hosts the tracking website and the mobile app's backend; there is no third-party cloud in the MVP.

### Your notes, mapped

| Note | Where it lands | Section |
| --- | --- | --- |
| Search bar for orders and services | Global list component with server-side search + filters | Screens and UX rules |
| Remove the unit column on order lines | Unit implied by the service pricing mode | Services and pricing |
| Keep data when switching pages | Draft store per form, restored on return | Screens and UX rules |
| Dark / light mode | Theme tokens, per-user setting | Screens and UX rules |
| Arabic, French, English | Three catalogues, French added | Screens and UX rules |
| TVA as a selection or custom value | Admin-editable TVA list + custom rate per line | Orders and TVA |
| Local client folder (Design, Production, Resources, Facturation) | Folders on the local server, reached from every company PC | Client folders |
| No production without payment | Any payment above 0 DA unlocks production | Order lifecycle |
| Completed order leaves the production board | Auto-archive to client and order history | Order lifecycle |
| Company name + client name, or "No company" | Required fields with a "No company" option | Clients |
| Wilaya as a select | 58 wilayas reference table | Clients |
| Client source | Source select + referrer link or free text | Clients |
| Service: Prix 1, Prix 2, Prix 3 typed at order time | Service price tiers | Services and pricing |
| Quotation management (leads) | Leads, quotes, versions, follow-ups, win/loss | Quotation management |
| Purchasing management | Suppliers, purchase orders, receipts | Purchasing management |
| Inventory management | Materials, lots, stock levels, counts | Inventory management |
| Scrap and offcut management | A new QR code at every update | Scrap and offcut management |
| Gestion d'évaluation | Stock value, real cost and margin per order | Gestion d'évaluation |
| Production dashboard as a list with filter + search | List view beside the Kanban | Production |
| Financial board by month or period | Charts modelled on the Excel dashboard | Financial board |
| Access by position in the company | Position presets + permission scopes | Roles and data privacy |
| TV screen for the production room | Display app, staff board | Displays |
| TV screen for clients | Company names, order numbers, stats | Displays |
| Attendance from the fingerprint machine | Punch-log import + salary run | HR and payroll |
| Bonuses, rates, CNAS and IRG set by the admin | Pay components with admin overrides | HR and payroll |
| Hover on an order; click creates the invoice | Order preview popover | Screens and UX rules |
| Company logo on documents | Company profile logo on all documents | Documents |
| Automatic client updates | Notification layer now; WhatsApp after the MVP | Notifications |
| Local PostgreSQL 16, self-hosted | Tracking website and mobile backend on the shop's server | Architecture |
| Production figures on the board | Orders completed, m² produced and printed, production time, delays | Financial board |
| Lifetime copy per print shop with an opening code | Activation code, signed licence, optional maintenance plan | Licensing and activation |

## Architecture

In the MVP the shop's local server hosts everything: the database, the API, the tracking website and the mobile app's backend. Company PCs and TVs use the LAN; only the tracking website and mobile sync are reachable from the internet.

&#91;embedded content: architecture · self-hosted on the shop's server\]

- **Local server:** one PC on the company network runs PostgreSQL 16, the API, the tracking website, mobile sync, the notification layer, the client folders and the backups. It is the only source of truth.
- **Company PCs and TVs:** use the local network, so they keep working without internet.
- **Mobile app:** works offline with VictorFlow's own sync engine (local SQLite) and syncs with the server over the company Wi-Fi, or through the secure tunnel from outside.
- **Public access:** Cloudflare Tunnel, under one BluxTech Cloudflare account with a subdomain per shop; BluxTech creates each shop's tunnel at installation. The cloudflared service runs on the local server and connects out to Cloudflare, so no router port is opened. Its rules expose only the tracking and mobile sync routes over HTTPS; the rest of the API stays on the LAN. Tracking works while the server and its internet connection are on.
- **Later:** a cloud relay (run by BluxTech, Supabase or Firebase) can be added behind the same sync interface without changing the apps, and an S3-compatible file store (for example SeaweedFS or Garage) can replace the disk behind the storage interface.

## Repository structure

One new app (`display`) and fifteen new server modules; the tracking website and the mobile app's backend run on the local server. New or changed items are marked `[new]` or `[changed]`.

```
victorflow/
|-- apps/
|   |-- server/                     NestJS API on the local server, source of truth
|   |   `-- src/modules/
|   |       |-- auth/               [changed] positions, permission scopes, field masking
|   |       |-- licensing/          [changed] activation code, signed licence, transfers,
|   |       |                             read-only fallback
|   |       |-- company/            logo + profile on every document
|   |       |-- reference/          [new] wilayas, TVA rates, stamp duty, client sources
|   |       |-- crm/                [changed] company or "No company", contact, wilaya,
|   |       |                             source, referrer, account owner
|   |       |-- quotes/             [new] leads, quotes, versions, follow-ups, win/loss
|   |       |-- sales/              [changed] orders, Prix 1/2/3, TVA per line, payment gate
|   |       |-- design/             [new] design versions, client approval, revisions
|   |       |-- production/         [changed] FSM v2, list + Kanban, auto-archive
|   |       |-- documents/          [new] devis, bon de commande, fiche de production,
|   |       |                             bon de livraison, recu, facture (PDF + QR)
|   |       |-- client-files/       [new] folder per client on the server disk
|   |       |-- purchasing/         [new] suppliers, purchase orders, receipts, balances
|   |       |-- inventory/          [changed] materials, lots, stock levels, counts
|   |       |-- offcuts/            [new] consumption, offcut split, new QR per update
|   |       |-- valuation/          [new] stock value, material cost and margin per order
|   |       |-- finance/            [changed] payments, cash register, daily close, P&L (TCR)
|   |       |-- finance-board/      [new] income, expenses, KPI, MPI, production figures
|   |       |-- workforce/          tasks, proof photos, mobile sync
|   |       |-- hr/                 [new] fingerprint import, pay components, CNAS, IRG,
|   |       |                             payroll runs, payslips
|   |       |-- notifications/      [new] notification layer: events, templates FR/AR/EN,
|   |       |                             channels (in-app now, WhatsApp later)
|   |       |-- displays/           [new] TV feeds (staff board, client board), tokens
|   |       |-- search/             [new] unified search: orders, clients, services, quotes
|   |       |-- history/            [new] archived orders, client timeline
|   |       |-- backup/             [new] scheduled pg_dump + client folders, restore
|   |       `-- tracking/  audit/  dashboard/  health/
|   |
|   |-- desktop/                    React 19 + Tauri v2, on every company PC (LAN)
|   |   `-- src/
|   |       |-- pages/              see Screens
|   |       |-- components/         [changed] DataTable (search/filter), OrderPreview,
|   |       |                             Charts, NotificationCentre, ThemeToggle,
|   |       |                             LanguageSwitch
|   |       |-- state/drafts/       [new] per-form draft store (survives page changes)
|   |       |-- theme/              [new] light + dark tokens
|   |       `-- i18n/               [changed] en, fr, ar
|   |
|   |-- display/                    [new] full-screen TV app, served by the local server
|   |   `-- src/app/                staff/[token]/   clients/[token]/
|   |
|   |-- tracker/                    [changed] client tracking website, served by the
|   |                                     local server (public through the tunnel)
|   `-- mobile/                     [changed] Expo app for employees and admin,
|                                         offline sync with the local server
|
|-- packages/
|   |-- types/                      [changed] zod DTOs, pricing + TVA maths, FSM v2 ids
|   |-- db/                         PostgreSQL 16 migrations 0001-0009 + 0010-0025
|   |-- crypto/                     licences, tokens (tracking, displays, QR labels)
|   |-- i18n/                       [changed] fr added; shared statuses in 3 languages
|   `-- documents/                  [new] shared PDF templates, company header, QR
|
|-- infrastructure/
|   |-- docker/                     PostgreSQL 16 + Redis 7 for development
|   `-- tunnel/                     [new] cloudflared config: tracking + mobile routes only
`-- scripts/  .github/
```

## Order lifecycle

Production is locked until the client approves the design and a first payment is received; a completed order leaves the production board automatically and lands in history.

&#91;embedded content: order lifecycle · 9 states, 1 gate, 2 loops\]

The states follow the Victor Pub process sheet and the statuses already used in the Excel workbook.

- **Quotes first:** a quote lives in Quotation management; accepting it creates the order in Confirmed. An order can also be created directly.
- **Configurable:** states, transitions and permissions stay as rows in the `erp.fsm_*` tables, with labels in 3 languages. Only the guards are code.
- **Payment gate:** the move to Production needs at least one payment above 0 DA on the order. There is no minimum amount or percentage, and no bypass.
- **Cancelling:** allowed from any state before Production with a reason; after that, owner or manager only.
- **Completed:** `archived_at` is set, and the order disappears from the production list, the Kanban and the staff TV. It stays searchable in History and on the client's timeline. An unpaid balance stays in receivables.
- **Notifications:** each transition raises a notification event, shown in the app and on the tracking page in the MVP, with WhatsApp possible later (see Notification layer).

## Modules

Each module below lists what it stores and the rules the server enforces.

### Clients (CRM)

- **Company:** the company name, or tick **No company** for a private person; the contact name then becomes the display name.
- **Required:** contact name, phone, wilaya. Company and contact names are copied onto every order and can be edited there (another contact at the same company).
- **Wilaya:** a select from the 58-wilaya reference table; commune is optional free text.
- **Source:** a select with Commercial, Employee, Existing client, Social media, Walk-in, Website, Other. Commercial or Employee opens a user picker, Existing client opens a client picker, Other opens a text field. This makes referral reports possible (who brings the most revenue).
- **Account owner:** the one commercial who talks to the client; shown on every document and the tracking page.
- **Also kept:** NIF, NIS, RC, AI (companies only), default price tier (Prix 1 or 2), notification language.

### Quotation management

- **Leads:** every request starts as a lead with company or "No company", contact, wilaya, source, the need, and the commercial in charge. The lead becomes a client when its first quote is accepted.
- **Pipeline:** New, Visit and measures, Quote sent, Follow-up, then Won or Lost, plus **Not feasible** (non réalisable) from the process sheet.
- **Quotes:** lines priced like order lines (Prix 1/2/3, TVA), a validity date, and versions (v1, v2, …) each time the client asks for another proposal. Every version is kept.
- **Follow-ups:** a date and a note per lead; overdue follow-ups appear on the commercial's dashboard.
- **Won or lost:** accepting a version creates the order in Confirmed with the same lines. A lost quote needs a reason from a list (price, delay, competitor, no answer, other).
- **Stats:** conversion rate, average quote value and lost reasons, by commercial, source and service. Quote PDFs are saved in the client's Facturation folder.

### Services and pricing

- **A service has:** a name in 3 languages, a category, a pricing mode (per m², per linear metre, per piece, per batch), **Prix 1** and **Prix 2**. Either price can be marked "not offered", as in the current price list.
- **Prix 3** is not stored on the service. It is typed on the order line and needs the `sales.price.custom` permission; the user who typed it is recorded.
- **Unit removed:** order lines no longer have a unit field. The unit shown (m², ml, pcs) comes from the service's pricing mode; custom lines without a service show none.
- Services have a search bar and a category filter.

### Orders and TVA

- **Header:** company name (or No company), contact name, account owner, deadline, priority (Critique, Élevé, Moyenne, Bas), notes.
- **Line:** service, tier (1, 2 or 3), width, height, quantity, discount, extra fees, TVA rate. The server computes m², line total HT, TVA and TTC.
- **TVA:** a select with the rates the admin configures (none is hard-coded) plus **Custom**, which opens an input. A company default pre-fills new lines, and each line keeps its rate so later changes never re-price an order.
- **Stamp duty (droit de timbre):** an admin setting, on or off with its rule, applied to invoices paid in cash.
- **Payment gate:** any payment above 0 DA recorded on the order unlocks production (see Order lifecycle).
- **Invoice in one click:** clicking the order name in the order preview creates the invoice directly; if one exists, it opens instead.

### Design

- Design versions (v1, v2, …) are uploaded into the client's Design folder and linked to the order.
- The client approves through the tracking link, or the commercial records the approval. Each rejection opens a revision with a comment and counts toward a revision limit.

### Production

- **Two views** of the same data: a **List** (default) with search and filters (status, priority, assignee, service, deadline, late only) and the **Kanban**.
- Only active orders appear. When an order reaches Completed it is removed from both views and kept in the order history and the client's timeline.
- Tasks are created per order and stage and assigned to designers, printers or installers.

### Purchasing management

- **Suppliers:** name, contact, wilaya, materials supplied, payment terms and balance, replacing the "Situation fournisseur" sheet.
- **Material requests:** production asks for a material from an order or from stock; the chef de stock turns requests into purchase orders.
- **Purchase orders:** lines with material, size (roll width × length, sheet size) or quantity, unit price and TVA. Statuses: Draft, Sent, Partly received, Received, Cancelled.
- **Receipts:** receiving a purchase order creates stock lots with QR labels, and the received cost updates the material's average cost.
- **Supplier payments:** partial or full, from Cash, Safe, CCP or Bank, with the balance per supplier.

### Inventory management

- **Materials:** name, category (bâche, vinyle, one way, forex, canvas, ink, hardware), unit type (m², linear metre, sheet, piece), minimum stock level and minimum usable offcut size.
- **Lots:** every roll, sheet or panel is a lot in a warehouse with its size, remaining quantity, cost and QR label.
- **Stock levels:** available per material and warehouse, the part reserved for confirmed orders, and alerts below the minimum level.
- **Moves:** receipts, consumption, transfers between warehouses and adjustments, each with who and why.
- **Counts:** periodic stock counts by warehouse, scanned by QR code; differences become adjustments after approval.

### Scrap and offcut management

- **A new QR code at every update:** a production employee scans a lot in the mobile app and enters the size used and the order. The server records the consumption, retires the old QR code and issues a new one for what remains.
- **Offcut or scrap:** a remainder at or above the material's minimum usable size becomes an offcut lot with its own QR label; a smaller one is logged as scrap with its area.
- **Traceability:** scanning an old QR code shows what replaced it and the chain back to the original roll, with every order that used it.
- **Offcut finder:** when planning a job, the app lists offcuts of that material big enough for it, so they are used before a new roll.
- **Labels:** printed from any company PC or shown on the phone.

### Gestion d'évaluation

- **Stock value:** the value of stock at weighted average cost, by material, category and warehouse, on any date.
- **Cost per order:** materials consumed (from offcut management) plus extra costs give each order's real cost and margin.
- **Scrap rate:** area scrapped per material and per month, and how many offcuts were reused.
- **Count differences:** the value of gains and losses found in stock counts.

### Finance

- **Deposits (acomptes)** recorded against an order before any invoice, then applied to the final invoice.
- **Cash register:** sessions per cashier, a daily close with counted vs expected cash, and transfers to the Safe, CCP and Bank accounts.
- **Expense categories** (materials, external costs, salaries, taxes, depreciation, donations) feed a **P&L report (TCR)**.
- Invoices, payments, the double-entry ledger and the immutability rules stay as they are.

### Financial board

The board follows the Excel dashboard. It is for the owner (and the manager, if the owner allows) and filtered by month, quarter, year or a custom range, with the same period last year beside it.

| Figure | How it is computed |
| --- | --- |
| Total income (chiffre d'affaires) | Orders invoiced in the period, HT |
| Collected (encaissements) | Payments received in the period |
| Expenses (dépenses, charges) | Money spent in the period, by expense category |
| Net profit or loss | Total income minus expenses |
| Unpaid (impayés) | Invoiced but not yet paid |
| Cash (liquidité) | Balances of Cash, Safe, CCP and Bank |
| Orders | Number and value of orders in the period |
| Clients | New clients and active clients |
| Break-even (équilibre financier) | Fixed costs ÷ variable-margin rate: the income that covers all costs |
| Financial target (objectif financier) | Break-even × a factor the admin sets (the Excel file uses 1.5) |

Monthly charts:

- **Total income** per month, with collected income beside it.
- **Expenses (dépenses)** per month, stacked by expense category.
- **Orders** per month, count and value.
- **Clients:** new clients per month.
- **Best clients:** the top 10 by income for the period.
- **KPI (Key Performance Indicators):** gross margin, value added, EBE, operating result and net result as % of income, per month. Shown as bars, because the ratios don't add up to a whole (the Excel file uses a pie).
- **MPI (Management Performance Indicators):** target achievement (income ÷ financial target), collection rate (collected ÷ invoiced), average days to get paid, expenses and salaries as % of income, quote conversion rate and on-time delivery rate, per month.

Production, a separate section of the board:

- **Orders completed** per month.
- **m² produced:** the area of finished order lines.
- **m² printed:** the area of finished lines whose service includes printing.
- **Production time:** average time from Production to Completed, by service.
- **Delayed orders:** orders completed after their deadline, and orders late right now.

Every figure opens the orders, invoices or expenses behind it. Fixed costs are the expense categories marked fixed plus a monthly amount the admin sets (the Excel formula uses salaries plus 225,000 DA).

### HR and payroll

- **Fingerprint import:** the admin uploads the fingerprint machine's export (Excel or CSV) each period. VictorFlow reads each punch (employee ID, date, time), pairs the first and last punch of each day, and flags missing punches for correction. The column mapping is saved after the first file.
- **Worked time:** days worked, hours, late minutes, overtime and absences per employee, with every correction logged.
- **Pay components:** the admin builds a catalogue of bonuses (fixed or %), rates (hourly, daily, overtime) and deductions (absence, lateness, advances), then picks which apply to each employee and sets their values.
- **CNAS and IRG:** rates and the IRG scale are admin settings, not hard-coded, so they can follow each finance law.
- **Owner control:** RH prepares each run; before validation, the owner or RH can change any line of any payslip with a note (logged), and the owner approves the run.
- **Payroll run:** per month, draft then validated then paid, with a payslip PDF. Salary data needs the payroll permission.

### Notification layer

- **Events:** every order step (confirmed, design ready for approval, production started, ready for pickup or delivery, installed, payment due) creates a notification event in PostgreSQL.
- **In the MVP:** events appear in the desktop notification centre for the right staff, and on the client's tracking page timeline.
- **Channels behind one interface:** in-app now; WhatsApp, SMS or email can be plugged in later as new channels, without touching order or production code.
- **Ready for later:** templates in French, Arabic and English with variables such as `{client}`, `{order}`, `{tracking_link}`, and each client's language, channel and opt-out, are stored from day one.
- **Outbox:** every notification goes through an outbox with status and retries, so a channel added later gets delivery logs without new work.

### Client folders

- **Where:** on the local server's disk, through the existing storage service, `clients/<code>_<company>/` with `Design`, `Production`, `Resources` and `Facturation`, and one sub-folder per order inside each. Created with the client.
- **Access from every PC:** company PCs reach the folders over the local network, through the app and a shared network folder. Nothing is stored in the cloud.
- The folder name uses the client code, so renaming the company never breaks it.
- Generated PDFs are saved automatically: invoices, receipts and quotes to Facturation; production sheets to Production.
- Access follows position: infographes see Design and Resources; commercials and the caissier see Facturation. The desktop app has an "Open folder" button.

### Displays (TV screens)

- **Production room board:** active orders and tasks by stage and by employee, deadlines, late orders highlighted, live refresh. No prices or client phone numbers.
- **Client board:** company names, order numbers and status (In design, In production, Completed), with the count of orders in each. No prices or contact details. A client can be hidden with a "Don't show on TV" option.
- **Local only:** both screens are served by the local server on the company network. Each is paired with a revocable read-only token and can see nothing else.

### Documents

- Devis, bon de commande, fiche de production (no prices), bon de livraison, reçu de paiement and facture, all in PDF.
- Every document shows the company logo uploaded by the admin (VictorFlow only as a fallback) and a tracking QR code.

## Database migrations

Sixteen new migrations (0010–0025) extend 0001–0009 on the local PostgreSQL 16 database; money stays `NUMERIC(15,4)` and every new table joins the audit trail.

| Migration | Adds | Key tables and columns |
| --- | --- | --- |
| 0010\_reference | Reference data | `ref.wilayas` (58, names in 3 languages), `ref.tva_rates`, `ref.stamp_duty`, `ref.client_sources` |
| 0011\_crm\_v2 | Client rules | `customers.is_individual` (No company), `company_name` (required unless individual), `contact_name`, `wilaya_id`, `source_id`, `referrer_user_id`, `referrer_customer_id`, `source_note`, `account_owner_id`, `price_tier`, `notify_lang`, `hide_on_tv` |
| 0012\_quotes | Quotation management | `leads`, `lead_followups`, `quotes`, `quote_versions`, `quote_lines`, `lost_reasons` |
| 0013\_pricing\_v2 | Price tiers, TVA, no unit | `services.price_1`, `price_2` (nullable = not offered); `order_lines.price_tier`, `custom_price_by`, `discount`, `extra_fees`, `tva_rate`, `tva_amount`; `unit` dropped |
| 0014\_fsm\_v2 | New lifecycle | new `erp.fsm_*` rows, the payment guard, `orders.archived_at` |
| 0015\_design | Design approval | `design_versions`, `design_reviews` |
| 0016\_documents | Generated documents | `documents` (type, order, number, file path, hash) |
| 0017\_client\_files | Local folders | `client_folders`, `client_files` |
| 0018\_purchasing | Purchasing management | `suppliers`, `material_requests`, `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `supplier_payments` |
| 0019\_inventory\_v2 | Inventory management | `materials` (minimum stock, minimum offcut size), `stock_lots`, `stock_reservations`, `stock_counts`, `stock_count_lines` |
| 0020\_offcuts | Scrap and offcuts | `lot_consumptions` (order, size used, by), `lot_splits` (parent lot, child lot, new QR token), `scrap_entries` |
| 0021\_valuation | Gestion d'évaluation | `material_cost_history`, `order_costs` view, `stock_value` view |
| 0022\_cash | Cash and payments | `cash_sessions`, `cash_transfers`, `expense_categories` (fixed or variable), `payments.kind` |
| 0023\_hr | HR and payroll | `attendance_imports` (file hash, saved column mapping), `attendance_punches`, `attendance_days`, `pay_components`, `employee_pay_components`, `cnas_settings`, `irg_brackets`, `payroll_runs`, `payslips`, `payslip_lines` (overrides with a note) |
| 0024\_board | Financial board | `board_settings` (fixed monthly amount, target factor), monthly aggregate views for income, expenses, KPI, MPI and production |
| 0025\_notify\_displays | Notifications and TVs | `notification_events`, `notification_templates`, `notification_outbox` (channel, status), `notification_preferences`, `display_screens` |

## Screens and UX rules

Six rules apply to every screen, then each screen is listed with what changes.

### Rules for every screen

1. **Search and filter:** every list (orders, clients, services, production, stock, invoices) uses one DataTable component with a search bar, filters and sorting done on the server, so it stays fast with thousands of rows.
2. **Drafts survive page changes:** a form you leave (for example an order, to create a client or a service) is kept in a draft store and restored when you return, with a "Draft restored" note and a Discard button. The new client or service is then offered in the order form directly. Drafts are per user and are cleared on save or discard.
3. **Order preview on hover:** hovering an order row or card opens a small popover listing each item with its status (design, production, done) and quantities. Clicking the order name creates its invoice directly (or opens it if it exists), for users with the invoicing permission.
4. **Light and dark mode:** one set of colour tokens with two themes, chosen per user and remembered.
5. **Three languages:** Arabic (right to left), French and English, chosen per user; the build fails if a translation key is missing in any language.
6. **Privacy in the UI:** fields a user may not see (prices, costs, phone numbers, salaries) are removed by the server, not only hidden.

### Screens

| Screen | What changes |
| --- | --- |
| Dashboard | Operational view per position: late orders, tasks due, follow-ups due, cash today |
| Financial board | Owner, and the manager if allowed: monthly figures and charts with period filters |
| Clients | Search, wilaya and source filters; company or No company; contact name required |
| Client detail | Timeline of all orders (active and archived), quotes, payments, files, Open folder button |
| Quotations | Leads pipeline, quote versions, follow-ups due, win and loss stats |
| Orders | Search, status filter, hover preview; click the name to invoice |
| Order editor | Prix 1/2/3 per line, TVA select or custom, discount and extra fees, no unit column |
| Order detail | Tabs: items, design, production, payments, invoicing, documents, messages sent |
| Services | Search, category filter, Prix 1 and Prix 2 |
| Production | List view (default) and Kanban, filters, search; completed orders disappear |
| Design | Versions, approval status, revision count |
| Purchasing | Suppliers, material requests, purchase orders, receipts, supplier balance |
| Inventory | Materials, lots, stock levels, alerts, counts |
| Offcuts | Offcut list and finder, scrap log, QR labels to print |
| Évaluation | Stock value, cost and margin per order, scrap rate |
| Cash | Open and close a session, transfers, daily report |
| Invoices | Payments applied, TVA and stamp duty, reminders |
| Reports | P&L (TCR), sales by service, by client source, by commercial |
| Employees | Roster, positions, pay components per employee |
| Attendance | Fingerprint file upload, column mapping, missing punches, corrections |
| Payroll | Monthly runs, CNAS and IRG, payslip overrides, payslips |
| Notifications | Notification centre, templates in 3 languages, event log |
| Displays | Pair or revoke a TV screen, choose staff or client board |
| Settings | Company profile and logo, positions and permissions, TVA rates, stamp duty, CNAS and IRG, board settings, public access (Cloudflare Tunnel), theme, language, backups |
| History | Archived orders with full search |

### Mobile app

One Expo app for employees and the admin. It signs in against the local server and works offline with VictorFlow's own sync engine (local SQLite), syncing over the company Wi-Fi or through the secure tunnel. Employees see their own tasks, upload proof photos and use the **offcut scanner**: scan a lot's QR code, enter the size used, get the new QR code. The owner also sees the board's headline figures, and the chef de stock handles material requests.

## Roles and data privacy

Access follows each employee's position in the company: a position is a preset of permissions with a scope, checked on the server for every request and every field.

Full = create, edit, delete · Own = only their own clients or records · Assigned = only orders and tasks given to them · Read = view only.

| Area | Owner (admin) | Manager (sub-admin) | Commercial | Infographe (designer) | Chef de stock | Production (atelier and pose) | Caissier | RH |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Financial board | Full | Read, if the owner allows | None | None | None | None | None | None |
| Dashboard | Full | Full | Own | Own tasks | Stock alerts | Own tasks | Cash only | Staff only |
| Leads and quotes | Full | Full | Own | None | None | None | None | None |
| Clients and contacts | Full | Full | Own | Name only | None | Name and site address | Name only | None |
| Orders | Full | Full | Own | Assigned | Read materials | Assigned | Read | None |
| Prices, discounts, totals | Full | Full | Own | None | None | None | Read | None |
| Prix 3 (typed price) | Yes | Yes | If granted | No | No | No | No | No |
| Design files and approvals | Full | Full | Own | Assigned | None | Read final files | None | None |
| Production board | Full | Full | Read own | Own tasks | Read | Full | None | None |
| Invoices and collections | Full | Full | Own | None | None | None | Read, record payments | None |
| Cash register | Full | Read | None | None | None | None | Own session | None |
| Purchasing and suppliers | Full | Full | Read | None | Full | Request materials | Pay suppliers | None |
| Inventory | Full | Read | Read | None | Full | Read | None | None |
| Scrap and offcuts (gestion des chutes) | Full | Read | None | None | Full | Consume and split | None | None |
| Gestion d'évaluation | Full | Read | None | None | Full, without order margins | None | None | None |
| Client folders | All | All | Own clients | Design, Resources | None | Production, Resources | Facturation | None |
| Employees and attendance (pointage) | Full | Read | Own | Own | Own | Own | Own | Full |
| Payroll, CNAS, IRG | Full, sets rates, approves runs | None | Own payslip | Own payslip | Own payslip | Own payslip | Own payslip | Prepares runs, edits pay components |
| Notification templates and log | Full | Full | Read own clients | None | None | None | None | None |
| Licence, settings, users, backups, TV screens | Full | TV screens only | None | None | None | None | None | None |

Six more rules:

- **Presets, not locks:** the owner can grant or remove single permissions per employee, and one person can hold two positions (for example Manager and Commercial in a small shop).
- **Custom positions:** the owner can create new positions in Settings: a name in fr, ar and en, a start from a copy of a preset or from nothing, and a grid of permissions with their scope. The server checks permissions, never position names, so a new position works everywhere without code. A position still assigned to someone can be retired but not deleted, and only the owner manages positions.
- **Manager limits:** the manager runs daily operations but cannot manage users, permissions, positions, the licence, settings, backups or salaries, and sees the financial board only if the owner allows it.
- **Same rules everywhere:** the mobile app and the tracking website go through the same API and permission checks, and only their routes are reachable from the internet.
- **Audited:** every read of salary data, every price override and every change to a position is written to the audit trail.
- **Tokens for screens:** TV screens and the tracking website use their own tokens and never see prices, phone numbers or salaries.

## Licensing and activation

Each copy is sold once, for life, and unlocked with an activation code tied to the shop's local server. Prices are set later.

### What the shop buys

- **Perpetual licence** for the version it buys, on one local server.
- **Seats:** the number of company PCs and mobile users, written in the licence.
- **Modules:** which modules are unlocked, also written in the licence.
- **Updates:** included for a set period, then an optional yearly maintenance plan (updates and support).

### Activation

1. BluxTech sells a copy and issues one single-use activation code, for example `VF-7K2M-9QXA-4TPL`, recorded against the shop.
2. On first launch, onboarding asks for the code, then the company profile, then the first admin.
3. The server combines the code with its hardware ID into a request code.
4. **Online:** the app sends the request code to BluxTech's licence server and receives a signed licence file. **Offline:** the shop sends the request code by WhatsApp or phone and types in the unlock code it gets back.
5. The licence file (licence ID, shop, hardware ID, seats, edition, updates-until date) is signed with BluxTech's Ed25519 private key and checked with the public key inside the app, as the licensing module already does.

### Rules

- **Never lock a shop out of its data:** if the licence check fails, VictorFlow switches to read-only, so the shop can still view and export everything.
- **Hardware change:** a new server or disk needs a transfer. The old activation is revoked and the code reactivated, with a set number of free transfers.
- **Updates after the plan ends:** an update released after the updates-until date refuses to install, and the shop keeps its current version.
- **Protection:** the private key stays on an offline BluxTech machine, never in the repo or the app. Signed licences and hardware binding stop casual copying; compiling the server code raises the bar, and a signed licence agreement with each shop covers the rest.
- **Back-office:** a small BluxTech tool to issue codes, sign licences, record transfers and track maintenance end dates.

## Build phases and decisions

Six phases, ordered so the shop can stop using the Excel workbook after phase 3; each phase ends with a working, tested install.

1. **Foundation:** licence activation and onboarding, local server install (PostgreSQL 16, API, backups), positions and permissions, reference data, clients with No company, services with Prix 1/2/3, TVA and stamp duty settings, unit column removed, unified search, drafts, light and dark mode, French.
2. **Sales and lifecycle:** quotation management, orders, FSM v2 with the payment gate, design approval, auto-archive and history, production list view, documents with the company logo, one-click invoice, client folders on the server, notification layer (in-app).
3. **Money:** cash register and daily close, payments and collections, P&L (TCR), financial board (income, expenses, KPI, MPI).
4. **Materials and production:** purchasing, inventory, scrap and offcut management (desktop scanning first), Gestion d'évaluation, production figures on the board.
5. **People:** fingerprint import, pay components, CNAS and IRG settings, payroll runs and payslips.
6. **Remote access and screens:** Cloudflare Tunnel for the tracking website and mobile sync, mobile app with the offcut scanner, production room TV, client TV.

**After the MVP:** the WhatsApp channel, imports from other machines (printers), a cloud relay, pricing.

### Decisions

| # | Question | Decision |
| --- | --- | --- |
| 1 | Unit | The unit column on order lines is removed |
| 2 | Gestion d'évaluation | Kept, alongside Quotation, Purchasing, Inventory, and Scrap and offcut management |
| 3 | Clicking the order name | Creates the invoice directly |
| 4 | Private clients | A "No company" option |
| 5 | Payment before production | Any payment above 0 DA; no minimum amount or percentage |
| 6 | TVA and stamp duty | Admin settings; no rate is hard-coded |
| 7 | Attendance file | The fingerprint machine export; the shop provides one real sample file |
| 8 | Payroll | Includes CNAS and IRG; the admin sets all rates and can change any payslip line |
| 9 | Client TV | Company names, order numbers and order stats |
| 10 | Messages | A notification layer with in-app notifications in the MVP; WhatsApp plugs in later |
| 11 | Client folders | On the local server, reached from company PCs over the LAN |
| 12 | Excel import | None; the workbook only documents the workflow |
| – | Hosting | Self-hosted on the shop's local server: database, API, tracking website and mobile backend; no third-party cloud in the MVP |
| – | Machine imports | Fingerprint machine only in the MVP; other machines later |
| – | KPI and MPI | KPI = Key Performance Indicators; MPI = Management Performance Indicators |
| – | Expenses wording | "Expenses" in English; "Dépenses", "Charges" or "Sorties" in French; never "Output" |
| – | Production figures | A separate board section: orders completed, m² produced, m² printed, production time, delayed orders |
| – | Sales model | One lifetime licence per print shop, unlocked with an activation code |
| – | Pricing | Set later |
| – | Public access | Cloudflare Tunnel: outbound only, no open router ports, tracking and mobile routes only |
| – | Tunnel account | One BluxTech Cloudflare account, with a subdomain per shop |
| – | File storage | The existing storage service on the server's disk, so client folders open from Windows; no MinIO; an S3-compatible store can come later |
| – | Positions | Owner, Manager, Commercial, Infographe, Chef de stock, Production (atelier and pose), Caissier, RH; the owner can create new positions |

Tunnel account and domain: one BluxTech Cloudflare account with a subdomain per shop, or each shop's own Cloudflare account and domain.

oes clicking the order name open its invoici
