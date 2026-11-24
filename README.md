> **DukaanDesk Pro (P2)** — multi-till offline POS for medium stores, forked from P1 on 2026-11-03. Plan: `docs/PLAN.md`. Status: `PROGRESS.md`. PostgreSQL dev: `docs/DEV-POSTGRES.md`.

# DukaanDesk Pro

**Offline retail-store POS** for Pakistani kiryana / retail — desktop on store hardware, fully local, EN + Urdu.

Umbrella: **Sturer Ecommerce** · Product 1 (D22) · standalone repo (D21).

## Locks (D22–D26)

| ID | Decision |
|----|----------|
| **D22** | Product = **DukaanDesk Pro** (offline retail desktop POS) |
| **D23** | Tax / FBR e-invoicing **Must** — simulate / queue offline; live adapter later. **No invented FBR fields or accept codes.** |
| **D24** | Payments: **cash + udhaar only** (no JazzCash / EasyPaisa) |
| **D25** | Theme: warm **chai browns + teal** accents (CSS var stubs; Pixel hi-fi later) |
| **D26** | Stack: **Electron + Nest sidecar + React + SQLite** · pure local · no cloud sync |

Also: roles **Owner / Cashier** minimum · EN + Urdu (+ RTL).

## Monorepo layout (pnpm)

```
dukaandesk/
  apps/desktop/   # Electron main/preload — spawns Nest, loads React
  apps/api/       # NestJS local sidecar + SQLite SoR
  apps/web/       # React (Vite) UI
  packages/db/    # SQLite schema + migrations
  scripts/        # smoke helpers
```

Tree matches Archie stamp. No Hybrid / Wholesale modes. No PWA-as-product.

## How to run

Prerequisites: **Node ≥ 20**, **pnpm** (workspace uses `packageManager: pnpm@10.33.4`).

```bash
cd /workspace/dukaandesk
pnpm install

# Terminal A — Nest sidecar (SQLite → apps/api/data/dukaandesk.sqlite by default)
pnpm dev:api

# Terminal B — React UI (Vite http://localhost:5173, proxies API :3847)
pnpm dev:web

# Terminal C — Electron (spawns/connects Nest; SQLITE_PATH under Electron userData)
# Prefer starting Vite first so the window has a UI to load in DEV.
pnpm dev:desktop
```

### Useful scripts

| Script | What |
|--------|------|
| `pnpm db:migrate` | Apply SQLite migrations |
| `pnpm test:slice1` | **Slice 1 smoke** — migrate → setup Owner → login → create product → list |
| `pnpm test:slice2` | **Slice 2 smoke** — create product → receive 10 → list 10 → receive +2 → 12 |
| `pnpm test:slice3` | **Slice 3 smoke** — receive → sell cash OK → stock −; oversell → 409, stock unchanged |
| `pnpm test:slice4` | **Slice 4 smoke** — party create → udhaar sale → stock − + ledger debit; cash unchanged; oversell 409 |
| `pnpm test:slice5` / `pnpm test:tax-v1` | **Tax V1 smoke (D30, superseded by D31)** — legacy inclusive Sales Tax checks |
| `pnpm test:tax-simple` | **D31 / D31.1 Simple Tax** — period × rate from sales; All|Selected product scope; cashier 403; voided excluded; new sales tax snapshot off |
| `pnpm test:slice6` | **Slice 6 smoke** — seed sale+product → export includes them; pin_hash absent; cashier 403 |
| `pnpm test:slice7` | **Slice 7 smoke** — seed cash+udhaar → analytics totals match; low-stock when qty≤5 |
| `pnpm test:slice8` | **Slice 8 smoke** — create cashier → sell OK; owner 403; deactivate → login fails; list no pin_hash |
| `pnpm test:slice9` | **Slice 9 smoke** — receipt payload cash+udhaar; print CSS + share hooks present |
| `pnpm test:slice10` | **Slice 10 smoke** — full cash, full udhaar, split, void split |
| `pnpm test:slice11` | **Slice 11 smoke** — party → udhaar → collect partial/remainder → 0; over-collect refused |
| `pnpm test:slice12` | **Slice 12 smoke** — export → mutate → restore entities match; bad header 400; bad PIN 401; cashier 403 |
| `pnpm test:slice13` | **Slice 13 smoke** — Owner patches store; PIN change; cashier 403; tax mode; about version |
| `pnpm test:slice14` | **Slice 14 smoke** — cashier today non-voided only; voided excluded; cashier 403 `/analytics`; Owner hub no Enqueue/Drain |
| `pnpm test:slice15` | **Slice 15 smoke** — setup locale ur\|en; sample → 1 product+stock; skip → 0; EmptyState + offline chip |
| `pnpm test:slice16` | **Slice 16 smoke** — EN/UR key parity, western Rs digits, RTL hook, no hard-coded UI English |
| `pnpm test:slice17` | **Slice 17 smoke** — production web+api build, Electron points at `dist`, Windows electron-builder target |
| `pnpm test:slice18` | **Slice 18 smoke** — piece/carton receive unit cost, sale cost snapshot, cashier 403, expenses |
| `pnpm build:desktop` | Production build of web + Nest (`apps/web/dist`, `apps/api/dist`) |
| `pnpm start:prod` | Electron loads built web and spawns built Nest (local SQLite) |
| `pnpm package:win` | Windows-only NSIS + portable (`electron-builder`). Refuses on Linux |
| `pnpm smoke` | Slice 0 health + empty catalog (legacy) |
| `pnpm build:api` / `pnpm build:web` | Production builds |

### Env

See `.env.example`. Notable:

- `API_PORT` (default **3847**)
- `SQLITE_PATH` — absolute path; Electron defaults to `userData/dukaandesk.sqlite`
- `SESSION_SECRET` — HMAC for `dd_session` cookie (dev default is fine for local)
- `TAX_MODE=simulate` — queue/simulate only

---

## Slice 1 — first-run auth + Owner catalog stub

**Shipped**

1. **First-run setup** — create Owner (display name + PIN 4–6 digits) and a single local store. PIN stored as **scrypt** `pin_hash` (`scrypt$<salt>$<hash>`) in SQLite. Never plaintext.
2. **Login** — select user + PIN → Nest session. Preferred: **httpOnly cookie** `dd_session`. Also returns `sessionToken` (Bearer / `x-dd-session`) for smoke & non-cookie clients. EN/UR stub via language toggle.
3. **Owner catalog stub** — list products; **Add product** with `name`, `priceRs` (stored as `price_paisa`), `unit` ∈ `piece` \| `carton`.
4. **Cashier role** seeded in `roles` table — **no staff UI** yet (cashiers cannot be invited in Slice 1).
5. **Chai + teal** tokens on login / setup / catalog shell. Offline-local only (header chip = “Offline · local only”; no online/sync chip).

**Out of Slice 1:** Sales/POS cart, udhaar, tax queue UI polish, staff invite, analytics, backup, Electron auto-update.

### Slice 1 how-to (manual)

1. Start API + web (`pnpm dev:api` + `pnpm dev:web`).
2. Open http://localhost:5173 — first launch shows **Set up your store**.
3. Enter Owner name, optional store name, PIN (4–6 digits) twice → lands on **Catalog**.
4. Add a product (piece or carton). Sign out → PIN login again with the same PIN.
5. To reset: delete the SQLite file (`apps/api/data/dukaandesk.sqlite` or your `SQLITE_PATH`) and restart API.

### Slice 1 API (Nest)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/auth/status` | — | `{ needsSetup, users, store }` |
| `POST` | `/auth/setup` | — | `{ displayName, pin, storeName? }` → session |
| `POST` | `/auth/login` | — | `{ userId?, pin }` → session |
| `GET` | `/auth/me` | session | Current session |
| `POST` | `/auth/logout` | — | Clears cookie |
| `GET` | `/catalog/products` | session | List active products |
| `POST` | `/catalog/products` | **owner** | `{ name, priceRs\|pricePaisa, unit }` |

### Smoke

```bash
pnpm test:slice1
# or
node scripts/test-slice1-auth-catalog.mjs
```

Uses a temp SQLite file; builds API; asserts scrypt hash, cookie, login, create+list products.

---

---

## Slice 2 — stock balances + receive

**Shipped**

1. **SQLite** — `stock_balances` (`product_id`, `qty_on_hand` in **base unit = piece**); `stock_receives` ledger; `products.pieces_per_carton` (default **1**).
2. **Owner UI** — Catalog row shows **On hand**; **Receive stock** (product, qty, unit `piece`|`carton` → carton × `pieces_per_carton`); optional pieces-per-carton on add product.
3. **API** — `POST /stock/receive` (owner-gated), `GET /stock`; catalog list embeds `qty_on_hand`.
4. Oversell refuse is in **Slice 3** — this slice is receive + balances only.

**Out of Slice 2:** POS cart/sale, udhaar, tax UI, supplier costs, multi-store.

### Slice 2 API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/stock` | session | Balances (piece on-hand) |
| `POST` | `/stock/receive` | **owner** | `{ productId, qty, unit: piece\|carton, note? }` → updates balance |
| `GET` | `/catalog/products` | session | Includes `qty_on_hand`, `pieces_per_carton` |
| `POST` | `/catalog/products` | **owner** | Also accepts `piecesPerCarton` (default 1) |

### Smoke

```bash
pnpm test:slice2
# or
node scripts/test-slice2-stock.mjs
```

Asserts: create product → receive 10 pieces → list shows 10 → receive 2 more → 12; carton conversion; owner gate.



## Slice 3 — cash POS (sell + stock decrement)

**Shipped**

1. **Sell screen** — Owner and Cashier: pick products, qty `piece`|`carton`, cart total. Owner reaches Sell from Catalog (no cashier user required).
2. **Pay cash only** → `POST /sales` writes `sales` + `sale_lines` and decrements `stock_balances` in **one SQLite transaction**.
3. **Oversell refuse** — if any line would make on-hand < 0 → **409** `insufficient_stock`; stock unchanged.
4. **Done screen** — total (Rs) + short sale id.
5. **Dual timestamps** — `client_device_at` from client body; `recorded_at` = server apply time (ISO).

**Out of Slice 3:** udhaar / parties, split tender, tax enqueue UI polish, receipt print, analytics, staff invite UI.

### Slice 3 API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `POST` | `/sales` | session (owner \| cashier) | `{ lines: [{ productId, qty, unit }], paymentMethod: "cash", clientDeviceAt }` → 201 + sale; 409 on insufficient stock |

### Smoke

```bash
pnpm test:slice3
# or
node scripts/test-slice3-pos-cash.mjs
```

Asserts: receive stock → sell OK → stock −; sell over qty → refused; stock unchanged; dual timestamps present.

---


## Slice 4 — udhaar + parties

**Shipped**

1. **SQLite** — `parties` (name, phone optional); `party_ledger` (debit/credit, `sale_id` nullable, note). `sales.payment_method` ∈ `cash`\|`udhaar`; `sales.party_id` required for udhaar.
2. **Pay sheet** — **Cash | Udhaar**. Udhaar requires pick/create party → sale `payment_method: 'udhaar'` + `party_id`; stock − same as cash; ledger **debit = sale total**.
3. **Owner** — simple Parties list + balance (`SUM(debits) − SUM(credits)`).
4. Still refuse oversell (**409**); **no split** cash+udhaar this slice.
5. Smoke `scripts/test-slice4-udhaar.mjs`.

**Out of Slice 4:** split tender, collections/payments on udhaar, tax enqueue, receipt print, analytics.

### Slice 4 API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/parties` | session | List parties + `balance_paisa` |
| `POST` | `/parties` | session | `{ name, phone? }` → party |
| `POST` | `/sales` | session (owner \| cashier) | `paymentMethod: "cash" \| "udhaar"`; udhaar needs `partyId`; 409 on insufficient stock |

### Smoke

```bash
pnpm test:slice4
# or
node scripts/test-slice4-udhaar.mjs
```

Asserts: party create → udhaar sale → stock − + ledger debit; cash sale unchanged; oversell still 409.

---


## Tax — Simple Tax Management (D31 + D31.1 LOCK)

Owner **Tax** screen (not checkout): pick Month / Custom / Year, **All** or **Selected** products, enter Rate %, see Sales base + Tax = base × rate (half-up paisa). Recomputes live from non-voided sales (PKT day windows, same as Analytics). Selected uses `SUM(sale_lines.line_total_paisa)` for picked SKUs. No tax on prices or receipts. FBR still out. D30 Settings Sales Tax / receipt tax line / Analytics tax cols stripped; migration 028 columns unused.

Smoke: `pnpm test:tax-simple`.

## Tax V1 — simple Sales Tax, no FBR (D30 — **superseded by D31**)

**Rules (Asim, 2026-10-06)**

1. **R1 — OFF by default.** Fresh and upgraded installs have Sales Tax OFF. Subtotal = Grand Total. Sell / checkout / receipts show no tax fields.
2. **R2 — inclusive when ON.** One global store rate (basis points, 17% = 1700). Per line: `base = round_half_up(line_total / (1 + rate))`, `tax = line_total − base`. The customer total never changes.
3. **R3 — clean receipts.** OFF sales print items, qty, prices, total only. ON sales add one line under Total: **Incl. Sales Tax 17% Rs 14.53** (from the sale snapshot, never the live setting).
4. **No FBR.** `POST /sales` never creates `tax_documents`. The simulate queue is dormant (no background drain; `process-next` / `drain` / `enqueue` are no-ops). Every `/tax/*` route is Owner-only. Tax queue nav, bell alert and Settings "Tax mode" are removed. Historic `tax_documents` rows are untouched.
5. **Void is decoupled.** No void path depends on tax docs; a commercial Void-sale slice is separate and later.

**Schema** — migration `028_slice34_tax_v1.sql`: `store.sales_tax_enabled` (0), `store.sales_tax_rate_bp` (0); `sales.tax_enabled / tax_rate_bp / tax_paisa / tax_base_paisa`; `sale_lines.tax_rate_bp / tax_paisa`.

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/settings/store` | **owner** | `sales_tax_enabled`, `sales_tax_rate_bp`, `sales_tax_rate_percent` |
| `PATCH` | `/settings/store` | **owner** | `sales_tax_enabled`, `sales_tax_rate_percent` (or `sales_tax_rate_bp`). ON needs rate > 0 (`tax_rate_required`); bad rate → `invalid_tax_rate`. Writes `audit_log` `tax_setting_changed` |
| `POST` | `/sales` | session | Sale carries `taxEnabled`, `taxRateBp`, `taxPaisa`, `taxBasePaisa` (+ per-line `taxRateBp`, `taxPaisa`). No `tax` queue key |
| `GET` | `/analytics` | **owner** | Period `taxed_sale_count`, `tax_paisa`, `tax_base_paisa`; top-level `sales_tax_enabled` |

```bash
pnpm test:tax-v1   # alias: pnpm test:slice5
```

---


## Slice 6 — Owner local backup export

**Shipped**

1. **Owner Backup** — PIN confirm → download JSON of store, products, stock balances, parties, party ledger, sales + sale lines, tax document **statuses**.
2. **Omits secrets** — no `pin_hash`, session secrets, or raw tax provider fields (`payload_json` / `raw_detail`).
3. **Header** — `product=DukaanDesk Pro`, `exported_at`, `data_region_disclosed` stub (`local_device`), `schema_version`.
4. **Audit** — `audit_log` row with action `backup.export`.
5. **Cashier 403**; restore-from-file was **out** of Slice 6 (→ Slice 12).
6. Smoke `scripts/test-slice6-backup.mjs`.

**Out of Slice 6:** cloud backup, restore UI, analytics (→ Slice 7), staff invite, receipt print, split tender.

### Slice 6 API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/backup` | **owner** | `{ last_export_at, data_region_disclosed: "local_device", product, schema_version }` |
| `POST` | `/backup/export` | **owner** + PIN body | `{ pin }` → JSON attachment; writes `backup.export` audit |

### Smoke

```bash
pnpm test:slice6
# or
node scripts/test-slice6-backup.mjs
```

Asserts: seed sale+product → export includes them; `pin_hash` absent; cashier denied (403).

---

## Harvest note vs legacy `sturer-commerce`

| | |
|--|--|
| **Ship target** | **This repo only.** Do **not** extend `/workspace/sturer-commerce`. |
| **Harvested (copy-adapt ideas)** | Nest module layout; scrypt PIN format; signed httpOnly session cookie; EN/UR i18n + RTL; tax adapter port + simulate; chai/teal token shape. |
| **Not carried** | Postgres / Docker; cloud sync / outbox; JazzCash/EP; Hybrid/Wholesale modes; PWA shell; multi-tenant org/phone signup; invented FBR fields. |
| **Disposition (O4)** | Legacy remains reference / archaeology. |

## Docs

- P1 brief: `/workspace/sturer-ecommerce-product1-offline-retail-pos.md`
- Portfolio arch v0.2: `/workspace/sturer-ecommerce-portfolio-architecture.md`

---

## Slice 7 — Owner Analytics home

**Shipped**

1. **Owner Analytics** — today + last 7 days (Asia/Karachi): sales total (cash vs udhaar), sale count, top products by revenue/qty.
2. **Low stock list** — products with `qty_on_hand ≤ threshold` (default **5**).
3. **Udhaar outstanding** — sum of party balances where balance > 0 (debits − credits).
4. **SQLite aggregates only** — no cloud; excludes voided sales.
5. **EN/UR** section titles; chai + teal cards / simple bar widths (no chart libs).
6. Smoke `scripts/test-slice7-analytics.mjs`.

**Out of Slice 7:** heavy chart libs, staff UI, receipt print, split tender, Pixel hi-fi, profit/cost, ML forecasting.

### Slice 7 API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/analytics` | **owner** | `{ timezone, low_stock_threshold, today, last_7_days, low_stock, udhaar_outstanding_paisa }` |
| | | | Query: `lowStockThreshold` (default 5), `topLimit` (default 5). Cashier → 403 |

### Smoke

```bash
pnpm test:slice7
# or
node scripts/test-slice7-analytics.mjs
```

Asserts: seed cash + udhaar sales → analytics totals match; low-stock flag when qty≤5; cashier denied (403).

---

## Slice 8 — Owner Staff (cashiers)

**Shipped**

1. **Owner Staff** — list users; **Add cashier** (display name + PIN 4–6 digits).
2. **`pin_once`** — plaintext PIN returned **once** on create; staff list never returns PIN / `pin_hash`.
3. **Soft-disable** — `POST …/deactivate` sets `disabled_at`; PIN login fails for disabled cashiers.
4. **ACL** — Cashier may Sell (`POST /sales`); owner routes (catalog create, stock receive, analytics, backup, tax queue, staff) → **403**.
5. **EN/UR** Staff page; chai + teal; local SQLite only.
6. Smoke `scripts/test-slice8-staff.mjs`.

**Out of Slice 8:** receipt print (→ Slice 9), split tender, Pixel hi-fi, live FBR, cloud sync.

### Slice 8 API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/owner/staff` | **owner** | `{ ok, users[] }` — `id`, `display_name`, `role`, `disabled_at`, `created_at` (never PIN) |
| `POST` | `/owner/staff/cashiers` | **owner** | `{ displayName\|display_name, pin }` → `{ ok, user, pin_once }` |
| `POST` | `/owner/staff/:userId/deactivate` | **owner** | Soft-disable cashier; cannot disable owner |

### Smoke

```bash
pnpm test:slice8
# or
node scripts/test-slice8-staff.mjs
```

Asserts: create cashier → `pin_once`; list has no `pin_hash`; cashier login → sell OK; owner routes 403; deactivate → login fails.

---

*Slice 8 — Owner Staff (cashiers) — ready for Archie ping.*

---

## Slice 9 — Receipt (print / share)

**Shipped**

1. **View receipt** after Done (cash or udhaar) — store name, short sale id, lines (qty×unit), total, payment (cash / udhaar + party), dual timestamps (`client_device_at` + `recorded_at`). EN/UR.
2. **Print** — `window.print()` + `@media print` ~80mm thermal-friendly; hide nav/chrome.
3. **Share** — `navigator.share` when available; else clipboard + toast fallback.
4. No PDF server / SMS / Bluetooth ESC/POS. No split tender.
5. Smoke `scripts/test-slice9-receipt.mjs`.

**Out of Slice 9:** split tender, Pixel hi-fi tokens, live FBR, Bluetooth ESC/POS, PDF server, SMS.

### Slice 9 pieces

| Piece | Detail |
|-------|--------|
| Builder | `buildReceiptPayload` (`apps/web/src/features/pos/receipt.ts`) — paisa amounts; cash + udhaar |
| UI | Done → **View receipt** → Print / Share; `ReceiptView` |
| Print CSS | `receipt.css` — hide chrome, ~80mm width |
| Share | `navigator.share` → clipboard + toast |

### Smoke

```bash
pnpm test:slice9
# or
node scripts/test-slice9-receipt.mjs
```

Asserts: receipt payload builder for cash + udhaar; print CSS (`@media print`, ~80mm); share/print hooks in source; Done → View receipt wiring; EN/UR keys.

### Browser

```bash
pnpm dev:api && pnpm dev:web
# Sell → Pay → Cash or Udhaar → Done → View receipt → Print / Share
```

---

*Slice 9 — Receipt (print / share) — ready for Archie ping.*

---

## Slice 10 — Split tender (cash + udhaar)

**Shipped**

1. **Pay** — cash tendered → remainder; if remainder > 0 require party → `payment_method: 'split'` with `cash_amount` + `udhaar_amount` + `party_id`.
2. **Stock − full**; ledger debit = **udhaar_amount only** (not cash portion).
3. **Receipt** + **analytics** count split into cash + udhaar buckets (`cash_paisa` / `udhaar_paisa`).
4. **Tax void** on split: reverse stock + reverse udhaar debit only (no invented cash refund).
5. Smoke `scripts/test-slice10-split.mjs` — full cash, full udhaar, split, void split.

**Out of Slice 10:** Pixel hi-fi, live FBR, Bluetooth printer, udhaar collections (→ Slice 11).

### Slice 10 API

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/sales` | `paymentMethod`: `cash` \| `udhaar` \| `split`. Split requires `partyId`, `cashAmountPaisa`, `udhaarAmountPaisa` (sum = line total). Stock − full; ledger debit = udhaar portion only. |

### Smoke

```bash
pnpm test:slice10
# or
node scripts/test-slice10-split.mjs
```

Asserts: full cash; full udhaar; split stock− + ledger debit = udhaar only; analytics buckets; tax void split restores stock + reverses udhaar only.

### Browser

```bash
pnpm dev:api && pnpm dev:web
# Sell → Pay → enter cash tendered → remainder → party if needed → Complete
```

---

*Slice 10 — Split tender (cash + udhaar) — ready for Archie ping.*

---

## Slice 11 — Udhaar collections + party ledger detail

**Shipped**

1. **Party detail** — `GET /parties/:id` returns `balance_paisa` + ledger history (debits from udhaar/split sales, credits from collections), newest first.
2. **Record collection** — `POST /parties/:id/collections` with `{ amount_paisa, note? }` → append-only `party_ledger` **credit** (`sale_id` null). Balance = debits − credits drops. Refuse amount ≤ 0 (400); refuse amount > balance (409) — no over-collect.
3. **Roles** — Owner + Cashier can collect (same as list parties).
4. **UI** — PartiesShell → open party → ledger list + collect form (cash pay-in). Empty states: no parties / zero balance / empty ledger.
5. **i18n** — EN + UR keys for new strings.
6. Smoke `scripts/test-slice11-collections.mjs`.

**Out of Slice 11:** interest, write-offs, backup restore (→ Slice 12), settings, installer, Pixel redesign.

### Slice 11 API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/parties/:id` | Owner + Cashier | `{ ok, party, ledger[] }` — balance + newest-first history |
| `POST` | `/parties/:id/collections` | Owner + Cashier | `{ amount_paisa, note? }` → `{ ok, entry, party }`; 400 invalid; 409 over-balance |

Schema: existing `party_ledger` credit with optional `sale_id` (migration 005) — no new migration.

### Smoke

```bash
pnpm test:slice11
# or
node scripts/test-slice11-collections.mjs
```

Asserts: create party → udhaar sale → balance → collect partial → balance → collect remainder → 0; ledger debit+credit newest-first; over-collect refused.

### Browser

```bash
pnpm dev:api && pnpm dev:web
# Parties → open party → Record collection (cash pay-in) → see ledger
```

---

## Slice 12 — Backup restore

**Shipped**

1. **`POST /backup/restore`** (Owner only) — body `{ pin, bundle }`. Confirm Owner PIN; replace local shop domain data from a prior Slice 6 export.
2. **Header validation before mutate** — `product === DukaanDesk Pro`, `format === dukaandesk-store-export`, `schema_version === 1`. Wrong → **400** with clear `code` (`invalid_backup_product` / `invalid_backup_format` / `invalid_backup_schema_version`); DB untouched.
3. **Replace semantics** — wipe/replace store profile fields, products, stock_balances, parties, party_ledger, sales, sale_lines, tax_documents (as exported). Also clears `stock_receives` (FK to products; not in export). **Keeps local users/roles** so Owner PIN still works after restore. Local `store.id` preserved (imported `store_id` remapped).
4. **Audit** — `audit_log` action `backup.restore`.
5. **UI (BackupShell)** — import JSON (file picker or paste), strong warning that restore replaces local shop data, confirm checkbox, Owner PIN, success/error. Cashier never sees Backup (Owner-only nav + OwnerGuard 403).
6. **i18n** — EN + UR keys for restore strings.
7. Smoke `scripts/test-slice12-backup-restore.mjs`.

**Out of Slice 12:** cloud backup, incremental sync, auto-update, multi-till. No invented FBR.

### Slice 12 API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `POST` | `/backup/restore` | **owner** + PIN | `{ pin, bundle }` → `{ ok, restored_at, counts, auditId }`; bad header 400; bad PIN 401; cashier 403 |

Export unchanged (Slice 6): `BACKUP_FORMAT=dukaandesk-store-export`, `schema_version=1`, `product=DukaanDesk Pro`.

### Smoke

```bash
pnpm test:slice12
# or
node scripts/test-slice12-backup-restore.mjs
```

Asserts: seed → export → mutate DB → restore → key entities match; bad product/format/version → 400 (DB untouched); bad PIN → 401; cashier → 403; users/PIN kept.

### Browser

```bash
pnpm dev:api && pnpm dev:web
# Owner → Backup → Download backup / Restore from backup (PIN + confirm)
```

---

*Slice 12 — Backup restore — ready for Archie ping.*


## Slice 13 — Settings shell

**Shipped**

1. **Settings view** — Owner rail `view: 'settings'` → `SettingsShell` (store profile, PIN, tax mode, about).
2. **Store profile** — `GET/PATCH /settings/store` (Owner): `name`, `phone`, `address`, `receipt_footer`, `locale_default` (`en`|`ur`). Migration `011` adds `phone` + `receipt_footer` on `store`. Backup export/restore includes them; restore tolerates missing keys (keep `schema_version=1`).
3. **PIN change** — `POST /settings/pin` `{ current_pin, new_pin }` (4–6 digits). Bad current → **401**.
4. **Tax mode** — read-only `TAX_MODE` (default `simulate`) in Settings + About. No FBR editors. Link to Tax queue.
5. **About** — DukaanDesk Pro, version from package, “local SQLite · single till”; `GET /settings/about` with sqlite path redacted (`…/dukaandesk.sqlite`).
6. **Language** — saving `locale_default` updates Owner UI locale.
7. **Receipt** — `receipt_footer` shown in ReceiptView / share text when set (`auth/status` exposes it for POS).
8. **i18n** — EN + UR for Settings strings.
9. Smoke `scripts/test-slice13-settings.mjs`.

**Out of Slice 13:** Multi-store, cloud, live FBR, Pixel thrash (frozen tokens).

### Slice 13 API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/settings/store` | **owner** | Store profile |
| `PATCH` | `/settings/store` | **owner** | Partial update; `locale_default` ∈ `en`\|`ur` |
| `POST` | `/settings/pin` | **owner** | `{ current_pin, new_pin }` — bad current 401 |
| `GET` | `/settings/about` | **owner** | product, version, tax_mode, redacted sqlite path |

### Smoke

```bash
pnpm test:slice13
# or
node scripts/test-slice13-settings.mjs
```

Asserts: Owner patches store; PIN change (bad current 401); cashier 403 on mutate; tax mode simulate; about version.

### Browser

```bash
pnpm dev:api && pnpm dev:web
# Owner → Settings → edit store / change PIN / see tax mode + About
```

---

*Slice 13 — Settings shell — ready for Archie ping.*


## Slice 14 — Cashier Today + Owner hub cleanup

**Shipped**

1. **Cashier Today** — after Cashier login, landing view is **Today** (`CashierTodayShell`): today’s sale count + total Rs (Asia/Karachi calendar day), primary CTA → Sell/POS. No cost / margin / profit.
2. **API** — `GET /cashier/today` (alias `GET /sales/today`): **SessionGuard**; Cashier **and** Owner OK. Aggregates non-voided only (`voided_at IS NULL`). Reuses analytics day helpers (`todayWindow` / `periodSales`). Does **not** expose full Owner `GET /analytics` to Cashier (still **403** via OwnerGuard).
3. **Optional list** — response includes a short list of today’s sales (`id` / `short_id` / `total_paisa` / `payment_method`); voided hidden.
4. **Owner hub cleanup** — removed unused `OwnerShell` scaffold (Enqueue stub / Drain simulate). Tax enqueue/process stays in `TaxQueueShell` only. Dropped `scaffoldNote` / “Slice N” copy from Owner primary surfaces. Settings remains secondary rail. Phase 1 Owner rail unchanged; Owner default stays **catalog**.
5. Smoke `scripts/test-slice14-cashier-today.mjs`.

**Out of Slice 14:** Pixel thrash; S15 empty states (→ Slice 15); S16 i18n polish; S17 packaging.

### Slice 14 API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/cashier/today` | session (Cashier or Owner) | `{ timezone, from, to, sale_count, total_paisa, sales[] }` — Karachi day, non-voided |
| `GET` | `/sales/today` | session (Cashier or Owner) | Same payload (alias) |
| `GET` | `/analytics` | **owner** | Unchanged — Cashier → **403** |

### Smoke

```bash
pnpm test:slice14
# or
node scripts/test-slice14-cashier-today.mjs
```

Asserts: cashier today counts non-voided only; voided excluded after tax void; cashier still 403 on `/analytics`; Owner hub grep — no Enqueue/Drain on primary.

### Browser

```bash
pnpm dev:api && pnpm dev:web
# Cashier login → Today → Sell
# Owner → Tax queue for enqueue/process (not on home)
```

---

*Slice 14 — Cashier Today + Owner hub cleanup — ready for Archie ping.*


## Slice 15 — Empty states + first-run polish

**Shipped**

1. **Shared empty states** — `EmptyState` (title + one sentence + primary CTA) on Catalog (Owner add product / Cashier ask owner), Parties (add party), Cashier Today (Sell when count=0), Tax queue (calm empty + link back; no Enqueue stub), Analytics (empty-day + Sell/Catalog), Staff (no cashiers → add cashier), Backup (short help when never exported). EN+UR keys.
2. **First-run language** — setup picks `en`|`ur` → UI locale + persist `store.locale_default` via `POST /auth/setup` (`locale` / `locale_default`).
3. **Optional sample product** — after setup: Add sample / Skip. `POST /catalog/sample` (Owner) creates one kiryana piece SKU (`Lifebuoy Soap`, Rs 120, stock 24); skip leaves blank catalog. Idempotent on sku `DD-SAMPLE`.
4. **Offline chip** kept; no sync copy on setup/home.
5. Smoke `scripts/test-slice15-empty-firstrun.mjs`.

**Out of Slice 15:** S16 i18n audit; S17 packaging; catalog edit/`name_ur`; Pixel thrash.

### Slice 15 API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `POST` | `/auth/setup` | — | Accepts `locale` / `locale_default` ∈ `en`\|`ur`; returns `store.locale_default` |
| `POST` | `/catalog/sample` | **owner** | One sample product + stock; idempotent on `DD-SAMPLE` |

### Smoke

```bash
pnpm test:slice15
# or
node scripts/test-slice15-empty-firstrun.mjs
```

Asserts: setup locale ur and en; skip → 0 products; sample → 1 product with stock>0; invalid locale rejected; EmptyState + dictionary keys present.

### Browser

```bash
pnpm dev:api && pnpm dev:web
# First-run → pick UR/EN → Create Owner → Add sample or Skip
# Empty hubs show title + sentence + CTA; offline chip in header
```

---

*Slice 15 — Empty states + first-run polish — ready for Archie ping.*

## Slice 16 — EN/UR completeness

**Shipped**

1. **Dictionary parity** — every `MessageKey` has a non-empty EN and UR string (including S11–S15 collections, restore, settings, Cashier Today, empty/first-run, plus error copy).
2. **Errors** — Owner/Cashier surfaces map API/UI codes through `translateError` → `t()`. Unknown codes show a generic localized line, not raw English.
3. **Money** — `Rs` + western digits (`paisa / 100`, `toFixed(2)`) in both locales. Dictionary copy uses 0–9, not Eastern digits. Ledger/backup times use `numberingSystem: 'latn'`.
4. **RTL** — `locale=ur` still sets `dir=rtl` on `<html>` via `applyDocumentLocale`.
5. Smoke `scripts/test-slice16-i18n.mjs` (`pnpm test:slice16`).

**Out of Slice 16:** S17 packaging; catalog `name_ur` write; live FBR strings.

### Smoke

```bash
pnpm test:slice16
# or
node scripts/test-slice16-i18n.mjs
```

Asserts: EN and UR key sets equal; sample keys resolve in both locales; RTL assignment present; money helpers use `Rs` and `/100`; no suspicious hard-coded UI literals under `apps/web/src` (comments, test ids, and console allowed).

---

*Slice 16 — EN/UR completeness sweep — ready for Archie ping.*


## Slice 17 — Install / packaging

**Shipped**

1. **Production Electron** — `DUKAANDESK_PROD=1` (`pnpm start:prod`) serves `apps/web/dist` and spawns `apps/api/dist/main.js` with local SQLite. Dev `pnpm dev:desktop` still loads Vite.
2. **Windows installer** — `apps/desktop/electron-builder.yml` targets **nsis** and **portable**. `pnpm package:win` on Windows builds them into `dist-desktop/`. No auto-update. No code signing. A Linux box cannot emit the `.exe` (no Wine; host-native `better-sqlite3`) — the script exits 1 there and says so.
3. **Backup export** — Electron save dialog when the shell is running; browser download remains for `pnpm dev:web`. Restore is unchanged.
4. **`RUN-WINDOWS.md`** — Node 20 (Herd PATH caveat), dev demo, `build:desktop` / `start:prod`, and `package:win`.

**Out of Slice 17:** auto-update, code signing, multi-till, Mac store, live FBR, catalog edit / `name_ur` write.

### Smoke

```bash
pnpm test:slice17
```

Asserts production artifacts exist, Electron layout points at them, builder has a Windows target, and `RUN-WINDOWS.md` documents `package:win` without claiming electron-builder is unconfigured.

---

*Slice 17 — Install / packaging — ready for Archie ping.*


## Slice 18 — Piece cost, profit, expenses

**Shipped**

1. **Sell is pieces only.** Add-product has no unit dropdown, no pieces-per-carton, and no carton price. The till and receipt lines are pieces. A carton unit on `POST /sales` is refused.
2. **Receive is where cartons live.** Loose pieces: pieces + total Rs paid. Carton: pieces inside + carton cost Rs. Stock goes up by pieces. Unit cost paisa = `Math.round(amountPaisa / pieces)` (halves toward +∞). That becomes `products.last_unit_cost_paisa`. A later receive does not rewrite `sale_lines.unit_cost_paisa`.
3. **Owner profit** on Analytics: today sales, cost of goods, and gross profit from the snapshotted line cost. Unknown cost (never received with an amount) is not treated as free. Explicit 0 is a real cost. Markup percent only when cost > 0. Cashier Today stays count and total. Cashier gets 403 on `/analytics` and `/expenses`, and catalog omits last cost.
4. **Expenses** (Owner): one list of bill, salary, or commission, amount, date (default today, Asia/Karachi), optional note. Delete a mistake. Today’s expenses and what’s left (gross profit − today’s expenses) sit on the analytics screen.

### Smoke

```bash
pnpm test:slice18
```

---

*Slice 18 — Piece cost, profit, and simple expenses.*
