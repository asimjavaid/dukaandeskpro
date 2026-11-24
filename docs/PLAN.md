# DukaanDesk Pro (P2) — plan

**DukaanDesk Pro** (P2): multi-till, offline (shop LAN only), no mobile app, for **Tier-1 retail stores** (goods only) in Pakistan (FBR) and AJK (AJK-IRD). P1 stays for small kiryana stores (no FBR link).
Forked from DukaanDesk P1 on 2026-11-03 (P1 stays single-till, SQLite, unchanged).

Product line: P1 **DukaanDesk** (single till) · P2 **DukaanDesk Pro** (multi-till, offline) · P3 **DukaanDesk Pro**
(multi-till + owner mobile app, cloud link) and **DukaanDesk Connect** (customer mobile ordering app). P3 is out of scope here.

Standing rules carried over: clean UI, no explanatory copy, keyboard-first, `Rs 1,170`, English UI with Urdu only in
nav and headings, Excel and PDF exports only, square corners, "customer", palette B default with A/B/C switcher,
no AGPL/GPL dependencies, closed-source installer with trial.

## Shape of a Lite install

```
          shop LAN (cable / wifi, no internet)
 ┌──────────── Main PC ────────────┐      ┌── Till 2 ──┐  ┌── Till 3 ──┐
 │ PostgreSQL 17 (127.0.0.1 only)  │      │ Electron   │  │ Electron   │
 │ DukaanDesk Pro server (Nest)    │◄────►│ till app   │  │ till app   │
 │   HTTP :3847 on LAN + web UI    │ HTTP │ (UI only)  │  │ (UI only)  │
 │ Till 1 (Electron, same PC)      │      └────────────┘  └────────────┘
 └─────────────────────────────────┘
```

Two supported setups, chosen in the installer:
- **Main PC with till**: server + Till 1 on the same PC (picture above).
- **Server-only main PC**: back-office PC with server, PostgreSQL and the owner/web UI but no till; all selling on
  till PCs. It does not count against the licence till limit.

Only the server talks to PostgreSQL. Tills talk HTTP to the server, so the database never listens on the network.

## (a) PostgreSQL move

**What P1 uses today.** No ORM. Raw SQL through better-sqlite3, synchronous: ~21.5k lines in `apps/api/src`,
717 `prepare()` calls, 51 `transaction()` blocks, 45 SQLite migrations (1,340 lines, 6 triggers, 4 table rebuilds).

**Approach, in two steps.**
1. *Compatibility adapter (done as spike, slice P1).* `packages/db/src/pg/` gives the same call style
   (`prepare().get/all/run`, `transaction`, `exec`, `pragma`) on PostgreSQL:
   - one dedicated connection in a worker thread; the API thread waits with `Atomics.wait` (about 0.14 ms per query);
   - SQL translator for the SQLite dialect: `?`/`@name` params bound as escaped literals, `INSERT OR IGNORE`,
     `LIKE`→`ILIKE`, 2-arg `MAX/MIN`→`GREATEST/LEAST`, `datetime/date/strftime/julianday`, `COLLATE NOCASE`,
     `IS x`→`IS NOT DISTINCT FROM`, `CAST AS INTEGER` truncation, `json_each`, `LIMIT -1`, `IN ()`,
     camelCase aliases, ambiguous columns in `ON CONFLICT DO UPDATE`;
   - `compat.sql`: SQLite date functions, `randomblob/hex`, `json_group_array`, `group_concat`, `total`, `round(float,n)`;
   - SQLite error codes mapped (`SQLITE_CONSTRAINT_UNIQUE` …) so P1 error handling keeps working;
   - each statement inside a transaction runs under a savepoint (SQLite keeps a transaction alive after a failed
     statement; PostgreSQL would abort it).
   All requests run one at a time through that connection, exactly like P1's single SQLite handle, so two tills
   selling the last packet cannot both succeed. Fine for a medium store (a sale is ~20–60 queries ≈ 10 ms).
2. *Native async (slice P6, later).* Move hot paths (sell, receive, stock count) to `pg` pool + async/await with
   row locks; then the rest. Needed only if one store outgrows the serial adapter (roughly 10+ busy tills).

**Migrations.** P1's 45 migrations are squashed into a generated `baseline.sql` (48 tables, indexes, seed rows,
6 triggers rewritten in PL/pgSQL, every FK `DEFERRABLE`, hidden `rowid` identity column for P1 queries that use it).
Generator: `node packages/db/src/pg/build-baseline.js`. New Lite changes go in `packages/db/migrations-pg/046_*.sql`.

**SQLite-only code still to rewrite by hand** (found so far): `sqlite_master` in reset-data, `INSERT OR REPLACE`
(2), lax `GROUP BY`, integer-as-boolean `WHERE x`, text-vs-number comparisons, backup/restore and reset that copy
the `.sqlite` file, `PRAGMA wal_checkpoint`. Each is listed in PROGRESS.md as tests find it.

**Data import from P1.** `tools/import-p1`: reads a P1 `.sqlite` (or P1 `.json` backup) read-only, checks schema is at
045, copies all 48 tables in FK order in one transaction, resets identity sequences, verifies row counts and stock
totals, writes a report. Lets an existing P1 shop upgrade to Lite.

**Bundling PostgreSQL (Windows installer, "Main PC" option).**
- Ship the official PostgreSQL 17 Windows x64 binaries zip (postgres, initdb, pg_ctl, pg_dump, pg_restore; PostgreSQL
  Licence, permissive, fine in a closed-source installer). About 30 MB compressed after trimming docs/pgAdmin.
- Installer: `initdb` into `%ProgramData%\dukaandeskpro\pgdata` (UTF8, scram-sha-256, random password kept in a
  DPAPI-protected file), `listen_addresses=127.0.0.1`, port 5442 (avoid clashing with any other PostgreSQL), register
  Windows service `dukaandeskproDB` (`pg_ctl register`), start it, run migrations.
- Till-only install skips PostgreSQL entirely.
- Uninstall keeps the data folder unless the owner ticks "remove shop data".

**Backup and restore.** `pg_dump -Fc` to `.ddpro` files (daily 9 PM + on close, keep 14, Google Drive folder option
like P1), restore with `pg_restore --clean --single-transaction` into a fresh database then swap. Excel/PDF exports
unchanged. The P1 JSON backup stays readable for import.

## (b) Multi-till design

| Area | Design |
|---|---|
| Till registry | `tills` table: id, name ("Till 2"), code (2), device key hash, last seen, active. Main PC is Till 1 unless installed server-only. Owner adds a till in Settings → shows a 6-digit pairing code (10 min); new till enters it once and gets a device key. Licence caps active tills. |
| Login and roles | Staff log in per till with PIN as now. Session row records `till_id`. Roles: owner, cashier, data entry, and new **`manager`** (built in slice P3): open/close any till's shift, approve refunds/returns, override price on a line, all logged with manager id. A cashier can be logged in on one till at a time. |
| Shifts and cash | `till_shifts` gains `till_id`; one open shift per till (partial unique index). Opening float, cash in/out, close with counted cash and over/short, per till. Owner's day close shows all tills and the store total. Cash drawer kick stays local to each till. |
| Stock-safe selling | Sale = one transaction: lock `stock_balances` rows in product-id order (`SELECT … FOR UPDATE`, avoids deadlocks), check, decrement, insert lines. Oversell stays blocked with the clear message. With the slice-P1 adapter this is already serial; row locks matter from slice P6. |
| Bill numbers | Per-till sequence: `till_sequences(till_id, next_no)`, `UPDATE … RETURNING` inside the sale transaction. Printed number `T2-000123`, unique `(till_id, bill_no)`. No collisions, no gaps from failed sales. PO / opening-stock numbers switch from `MAX()+1` to sequences. |
| Connect screen | Till app first run: finds the server by UDP broadcast on the LAN (server answers with name, address, version), or type the main PC's IP. Then pairing code. Remembers the server; re-discovers if the main PC's IP changes. |
| Server lost | **Till keeps selling** (Asim, 2026-11-03). The till PC keeps an offline copy (items + prices, cashier/manager PIN hashes, shop rules) and a block of 200 bill numbers reserved from the main PC (refilled below 50). While the main PC is away: small **Offline** chip + queue count in the top bar, only Sell open; cash sales of cached items only (no khata, customer, refunds, stock receiving, digital pay, discounts); price change only with a manager PIN checked against the cached hash. Bills are numbered **T2-OFF-000045**, saved to a durable queue on the till disk before "Sale complete" (survives app restart). On reconnect the queue is sent in batches (client UUID per bill, server ignores duplicates); a sale that takes stock below zero is **kept** and flagged in **Stock review** (Tills screen) for a manager. A till that never got a copy still shows the block. The main PC itself (server_plus_till) still blocks when its own service stops. |
| Live updates | Server-sent events for stock and price changes so all tills see them without refresh. |
| Customer display | Unchanged, per till. |

## (c) Licensing per store

- Separate key family from P1: `DR2.` keys, payload `product: "dukaandeskpro"` + `tills: N` (done; P1 keys cannot
  unlock Lite and Lite keys cannot unlock P1, covered by tests). Separate test key pair, keys folder
  `~/.dukaandeskprokeys`, trial stores `%APPDATA%\dukaandeskpro`, `HKCU\Software\dukaandeskpro`.
- Key is bound to the **main PC** machine code. Tills need no key; the server refuses to pair more than `tills`
  active tills. Upgrade = new key with a higher count (keygen `--tills N`; default 2).
- 14-day trial: 2 tills, then read-only exactly like P1 (reports, export, backup still work).
- Pricing proposal: base Rs 59,900 (2 tills), extra till Rs 14,900, Tier-1 tax module Rs 24,900, Care Rs 11,900/yr,
  server-only PC free, trial 14 days / 2 tills. See `docs/PRICING.md`.

## (d) Slices

| Slice | Scope | Size | Risk |
|---|---|---|---|
| **P1 — PostgreSQL foundation** (this build) | Fork, rename, Lite licence, dev PostgreSQL, adapter + translator + baseline, API boots on PostgreSQL, P1 test suite run on both engines | M | Hidden SQLite-isms in rarely used paths |
| P2 — Make every P1 test green on PostgreSQL | Fix remaining failures, rewrite backup/restore/reset on pg_dump, `tools/import-p1` | M | Backup/restore format change |
| P3 — Tills, shifts, manager | `tills`, pairing, session `till_id`, per-till shifts and cash, per-till bill numbers, Settings → Tills screen, `manager` role (any till open/close, refunds, price override) | M | Migration of P1 shift data |
| P4 — LAN mode | Server binds LAN, firewall rule, UDP discovery, connect screen, server-lost screen, SSE updates, till Electron build | L | Windows firewall/AV, wifi drops |
| P5 — Installer | Main PC (with till) / Server-only main PC / Till install, bundled PostgreSQL service, upgrade from P1 data, Lite keys with till count | L | Windows service permissions, code signing |
| P6 — Scale-up (if needed) | Async `pg` pool and row locks on sell/receive; load test 8 tills | M | Large refactor |
| T0 — Confirm | Email PRAL + AJK-IRD (questions in FBR-INTEGRATION.md), pilot Tier-1 store, sandbox credentials. Route: retailer uses **PRAL as licensed integrator**; Sturer not licensed for now | S | PRAL answers on multi-POSID / offline numbering |
| T1 — Tax engine | Store tax profile (FBR or AJK, NTN/STRN, POSIDs per till), product PCT + tax class (standard / 3rd Schedule MRP / exempt / reduced), shelf prices tax-inclusive with tax backed out per line, rounding | M | Rate/schedule data upkeep |
| T2 — Invoice | SRO 1006 receipt, Re 1 fee, buyer NTN/CNIC (> Rs 100,000), immutable invoices + hash chain + audit log, day/week/month closing, credit notes with RefUSIN | M | — |
| T3 — PRAL link + offline | Server-side fiscalization via fiscal component on main PC (fallback: per-till component), store-and-forward queue, "OFFLINE MODE" receipts, Sync now (4G dongle/hotspot), alerts at 12 h / 20 h, optional block-after-N-hours policy, failure report | L | Main PC without internet is non-compliant long-term |
| T4 — Reports | Monthly sales tax summary (Annex-C style), Re 1 fee, credit notes, offline periods; Excel/PDF; 6-year retention | M | — |
| T5 — Pilot | One Tier-1 store live (PK or AJK) | M | — |
| Later | Multi-store (P3 groundwork) | — | — |

**Status 2026-11-03 (PKT):** P1 ✅ · P2 ✅ 55/55 PG · P3 ✅ · P4 ✅ (no SSE yet: Tills list and tills poll; till Electron build = same app + `till-only.flag`) · P5 scripts + docs ✅, offline till selling ✅ (test-lite-offline 45/45), **untested on Windows** (docs/INSTALLER-PRO.md). Not done: P1 data upgrade inside the installer (tool exists: `tools/import-p1`), code signing. Lite runs on PostgreSQL only from P3 (migration 046+ are PG-only).

**First build scope (slice P1):** as above, no UI changes. Done when the API starts on PostgreSQL, migrations apply,
and the P1 API tests are run on both engines with a pass/fail table.
