# DukaanDesk Pro — progress notes

Source: copy of P1 (/workspace/dukaandesk) taken 2026-11-03 00:10 PKT. P1 is never modified.

## Step 1 — copy
- [x] Copied via tar, excluded node_modules, dist, *.sqlite*, .tsbuildinfo, .git. No real data copied (apps/api/data has only .gitkeep).
- [x] Package scopes renamed @dukaandeskpro/* -> @dukaandeskpro/*; root package `dukaandeskpro`.
- [x] Product strings -> "DukaanDesk Pro" (app name, window titles, EULA, docs, keygen, installer appId `pk.sturer.dukaandeskpro`, artifacts `dukaandeskpro-Setup-*`).
- [x] Licence: prefixes DR1/DR2, v2 payload carries `product: 'dukaandeskpro'` + `tills` (1..99); keygen `--tills N`; keys dir `~/.dukaandeskprokeys`; trial stores `%APPDATA%\dukaandeskpro`, `.ddlrt`, `HKCU\Software\dukaandeskpro\Runtime` (no clash with P1 on the same PC).
- [x] New TEST keypair (id 25C8047765CD) in /workspace/dukaandeskpro-testkeys (box only, TEST_ONLY=true).
- [x] packages/license tests: 15 + 17 + 5 new (P1 keys rejected by Pro and vice versa) pass.
- Backup file header `product: 'DukaanDesk'` deliberately unchanged for now (P1 backups must stay importable; revisit with pg_dump backup in slice P5).

## Step 3 — PostgreSQL on the box
- apt mirror is down (500), so dev PG = portable official binaries from npm `@embedded-postgres/linux-x64@17.11.0-beta.19` (PostgreSQL 17.11) in /workspace/pgdev.
- Cluster /workspace/pgdev/data, port 5433, 127.0.0.1 only, trust auth, user `postgres`. Start: `/workspace/pgdev/start.sh`.
- DBs: dukaandeskpro_dev, dukaandeskpro_test. ICU collations + pgcrypto available.

## Step 4 — DB layer spike (in progress)
Approach: keep P1's synchronous better-sqlite3 call style (717 prepare() calls) behind a drop-in shim:
packages/db/src/pg/ = sync client (worker thread + Atomics.wait, one PG connection), SQL translator (SQLite dialect -> PG), compat functions (datetime/date/strftime/julianday/randomblob/hex/json_group_array/group_concat/total/round), baseline schema generated from P1's final schema (45 migrations squashed).
- [x] packages/db/src/pg/: sync-client.js + worker.js (one PG connection, Atomics.wait; ~0.14 ms/query), translate.js, database.js (better-sqlite3-compatible), compat.sql, triggers.sql, build-baseline.js -> baseline.sql (48 tables) + baseline-migrations.json, index.js (migratePg/openDatabase; DATABASE_URL or DD_DB=pg path-mapped dev/test DBs).
- [x] packages/db migrate() switches to PostgreSQL in PG mode; DbService picks PostgreSQL when DATABASE_URL or DD_DB=pg (SQLite kept as legacy fallback).
- [x] Code fixes: reset-data (sqlite_master, VACUUM INTO skipped on PG), backup restore INSERT OR REPLACE -> ON CONFLICT upserts (valid on both engines).
- [x] tools/import-p1/import-p1.cjs: P1 .sqlite -> empty Pro PG (copy upgraded to 045 first; source untouched). Tested with /workspace/pc-db-20261016.sqlite -> dukaandeskpro_dev: 750 rows, 48 tables, stock 1373 matches, 0.2 s.
- [x] scripts/run-all-tests.mjs (pg|sqlite) + scripts/lib/pg-test-hook.cjs (redirects test scripts' better-sqlite3 to PG).
- SQLite baseline (same code, legacy engine): 42/54 pass; the 12 failures are pre-existing P1 test drift (see test-results-sqlite.md).
- Resume: `/workspace/pgdev/start.sh` then `API_PORT=4900 DD_PG_DEBUG=1 node scripts/run-all-tests.mjs pg`.
- [x] Run 4 (PostgreSQL): 39/54 P1 tests pass vs 43/54 on SQLite with the same code. 11 failures are identical on both engines (old P1 test drift). 4 PostgreSQL-only failures are all SQLite-file scenarios (copying/opening a .sqlite file, SQLite down-migrations): buy-units §B, product-types §PC, landed-cost down-042, reset-data .sqlite copy. Their API sections pass.
- [x] New scripts/test-lite-concurrent-sell.mjs: 20 parallel sales vs 3 in stock -> exactly 3 succeed, stock 0, unique bill ids. Passes on PostgreSQL and SQLite.
- [x] Quantity columns that hold fractions in P1 (qty_*, pieces, counted_qty, cost_before/after …) are NUMERIC; other INTEGER -> BIGINT.
- [x] /health now reports `engine` and `product`. Web build OK.
- [x] Leftover ddp_* test databases dropped (229).
- Dev DB dukaandeskpro_dev holds an import of /workspace/pc-db-20261016.sqlite (Asim's 16 Oct PC copy, box only) for manual checks.

## Next (slice P2), not started
- Rewrite backup/restore/reset on pg_dump/pg_restore; port the 4 SQLite-file tests to import-p1 / pg_dump equivalents.
- Fix the 11 stale P1 tests (they fail on SQLite too) or update them to current behaviour.
- Then slice P3 (tills, shifts, bill numbers) per docs/PLAN.md.

## Step 5 — rename to DukaanDesk Pro (2026-11-03)
- [x] Project moved /workspace/dukaandesk-pro -> /workspace/dukaandeskpro; all names, scopes `@dukaandeskpro/*`, installer appId `pk.sturer.dukaandeskpro`, artifacts `dukaandeskpro-Setup-*`, licence product `dukaandeskpro`, key prefixes DR1/DR2, trial `.ddlrt`.
- [x] Clean rebuild + pnpm install; licence tests 15 + 17 + 5 pass (P1/Lite key separation); PG subset after rename 6/6 pass (license, lite-concurrent-sell, returns, slice13, slice3, slice7).
- [x] PG databases renamed dukaandeskpro_dev / dukaandeskpro_test.
- [x] docs/PLAN.md updated: product line (Lite / Pro / Connect), server-only main PC setup, manager role in slice P3, server-down = block selling + keep bill, pricing, tax slices T0–T5.
- [x] docs/PRICING.md proposal (placeholder numbers).

## Step 6 — tax research (research only, no code)
- [x] docs/TAX-RESEARCH.md: federal + AJK + provincial findings with official sources, ⚠ uncertain items, gap analysis vs current Tax screen/tax_documents simulate, phases T0–T5, questions for Asim.
- PDFs + text copies in /workspace/taxres/.
- Next: wait for Asim's answers and adviser/PRAL confirmations before T1.

## Step 7 — FBR/AJK integration research + pricing (2026-11-03)
- [x] docs/FBR-INTEGRATION.md: licence rules (r.150XE–150XO), PRAL free route and its limits, AJK route, offline design, recommended path, draft PRAL email (not sent).
- [x] docs/PRICING.md finalised as a proposal; docs/PLAN.md tax phases T0–T5 rewritten with Asim's decisions (Lite = Tier-1, PK + AJK, PRAL route, inclusive shelf prices).

## Step 8 — Slice P2: all tests green on PostgreSQL + full copies (2026-11-03)
- [x] Result: **55/55 pass (pg)** — docs/test-results-pg-2026-11-03.md.
- [x] pg client 17.9 (pg_dump/pg_restore) in /workspace/pgclient (dev box only; installer bundles its own). Env: DD_PG_BIN, DD_PG_LIB, DD_BACKUP_DIR.
- [x] apps/api/src/backup/pg-backup.service.ts: pg_dump custom format `.ddpro` (PGDMP header verified), restore = safety dump first, then pg_restore --clean --single-transaction.
- [x] Auto copy: PG mode writes `dukaandesk-auto-YYYY-MM-DD-HHMM.ddpro`, keep 14; on first boot with DD_BACKUP_DIR set it turns on daily copies automatically.
- [x] Reset data: writes a real full copy `dukaandesk-before-reset-<stamp>.ddpro` (was an empty file) + the JSON copy.
- [x] API: GET /backup/db (list full copies), POST /backup/db/restore {pin,path} (owner PIN, 401 bad_pin, 400 not_a_db_copy).
- [x] UI: Backup → files table has Restore (inline PIN confirm), reloads after restore.
- [x] PG adapter: savepoint depth fix after failed COMMIT; SUM(boolean) aggregate in compat.sql.
- [x] Stale tests updated to current behaviour (carton mode removed, udhaar needs customer, kg=Bulk, English-only i18n + Urdu hints, no offline chip, schema_version ≥ n, buy_measure derived, in-store barcode never reused). SQLite-file upgrade sections skipped on PG, replaced by new scripts/test-import-p1.mjs. test-tax-v1 retired → scripts/retired/ (replaced by test-tax-simple).
- Next: Slice P3 (tills).

## Step 9 — Slice P3: tills (2026-11-03, in progress)
Recovery check after interruption (02:00 PKT): tree = 07cd13a + uncommitted P3 work (50 modified, 7 new paths). Dev DB dukaandeskpro_dev at 045 (046_tills not applied, not half-applied: each migration is one transaction; applies on next boot). 202 leftover ddp_* test DBs (2.2 GB) — drop after the suite. Nothing half-done in code; API + web build OK.
- [x] Migration 046_tills.sql (PG only — Lite is PG-only from P3; SQLite suite retired at 55/55): tills, per-till shifts (one open per till), sales.till_id/bill_no unique, returns till_id/approved_by, line price override columns, role manager, users.active_till_*.
- [x] API apps/api/src/tills: till context (x-dd-till device key, loopback = Till 1), registry, 6-digit pairing code (10 min), pair, rename/turn off, install mode main_till|server_only (DD_INSTALL_MODE), till limit (dev DD_TILL_LIMIT=2, trial 2, licence.tills).
- [x] Bill numbers per till T2-000123, gap-free (UPDATE…RETURNING in sale tx); search by T#-number, number or old hex.
- [x] Manager role: open/close any till, refund approval, price override (one-use 5-min HMAC approval tokens, POST /auth/approve); cashier refunds need manager (shop rule, default on); cashier/manager one till at a time.
- [x] scripts/test-lite-tills.mjs 69 checks pass (incl. 2-till rush on 3 in stock). Older tests use seed({cashierRefunds:true}); bill-number assertions moved to T1-… format.
- [x] Web: Tills screen (↑↓ Enter N R C, actions on selected row), pairing code modal (Close only), Till screen T1…Tn picker, F4 price change on POS + manager approval modal, refunds approval, full-copy restore in a PIN modal.
- [x] Fix: POS re-price on pay no longer wipes a changed price.
- [x] Screenshots: /workspace/lite-p3-tills.png, lite-p3-pairing-code.png, lite-p3-till-shift-t2.png, lite-p3-price-override.png, lite-p3-manager-approval.png, lite-p3-after-approval.png, lite-p2-backup-full-restore.png (scripts/ui/lite-shots.ui.mjs).
- [x] Full PG suite (first P3 run): 55/56 — only slice17-packaging failed, because it built the web while a P4 edit was half-typed (duplicate keys in errors.ts). Fixed; rerun with the P4 suite below.

## Step 10 — Slice P4: network (2026-11-03, in progress)
- [x] API apps/api/src/tills/lan.ts: DD_LAN=1 → listen 0.0.0.0 (default 127.0.0.1); LAN gate: another PC without a paired key gets 401 till_not_paired / till_key_rejected except GET /health, GET /tills/me, POST /tills/pair; /health hides dbPath off-PC; UDP discovery responder (port 3849, DD_DISCOVERY_PORT) answers `DDLITE_DISCOVER 1` with store name, port, mode.
- [x] apps/desktop/src/till-link.js: till-only PC = bundled UI + forwarding to the main PC; /__till/status|discover|server|forget; config in userData/till.json; 502 server_unreachable / 503 no_server. Electron main: till-only via DD_TILL_ONLY=1 or till-only.flag next to the exe (no API, no DB).
- [x] Web features/tills/TillLink.tsx: connect screen (found list ↑↓ Enter, F5 search, typed IP), pair screen (6-digit code), 3-s heartbeat (/tills/me on a till, /health on the main PC), full-screen block when down (keys swallowed, screen underneath stays mounted = bill kept), lifts on reconnect (event dd:reconnected), key turned off → pair screen as overlay.
- [x] scripts/test-lite-network.mjs: 44 checks pass (LAN gate, discovery, two till-links, pairing over LAN, 30 parallel sales gap-free per till, turned-off till, main PC down → 502 + nothing saved, restart → same key + session sell T2-000016).
- [x] UI run scripts/ui/lite-network.ui.mjs: 8/8 (found on network → pair → sell → main PC stopped: block, bill kept → back: block gone → sale T2-000001). Shots /workspace/lite-p4-connect.png, lite-p4-pair.png, lite-p4-main-pc-down.png, lite-p4-reconnected-sale.png.
- [x] Sale-time licence check: a till past the licence limit (key shrank) gets till_limit; Till 1 first, by code (`TillsService.withinLimit`). New scripts/test-lite-licence-tills.mjs (trial 2, key tills=4, key tills=1, restart).

## Step 11 — Slice P5: installer (2026-11-03, in progress)
- [x] docs/INSTALLER-PRO.md: one installer, page Main PC / Main PC no till / Till PC; tested vs UNTESTED list.
- [x] apps/desktop/build/win: installer.nsh (custom page, flags, PowerShell), main-pc-setup.ps1 (PG 17 cluster 127.0.0.1:5439 scram, db, server.json + secrets with ACL, WinSW service, firewall Private only), main-pc-remove.ps1 (keeps data), dukaandeskproServer.xml.
- [x] apps/desktop/src/server-config.js + server-service.js (service entry, reads server.json); main.js: main-pc.flag → wait for the service; till-only.flag → till-link.
- [x] electron-builder.yml: perMachine, nsis include, asarUnpack service files, pgsql/winsw/win resources. scripts/fetch-win-runtime.mjs (SHA-256 to pin) run by package-win.
- [x] Migration 047 store.install_mode_env: installer mode applied once (also right after first-run setup); owner's switch survives restarts.
- [x] Licence fix found by the new test: status() now carries `tills` (was missing → licensed limit was always 1); same updates-until → key issued last wins (till upgrade). packages/license unit tests 15+17+5 pass, test-license pass.
- [x] scripts/test-lite-server-service.mjs pass (server.json → PG URL, LAN, licence home, server-only applied after setup, owner switch kept, secret file, backups folder).
- [x] Full PG suite 02:25 PKT: 58/59, test-slice3-pos-cash "health timeout" (API slow to boot on a busy box); passes alone and in both earlier full runs → 59/59. docs/test-results-pg-2026-11-03-p3p5.md.
- [x] Committed dc6b444 (02:30 PKT). Leftover ddp_* test DBs dropped (kept the screenshot store). Screenshot servers still up: API 3947, Vite 5273.

## Step 12 — Offline till selling (2026-11-03, Asim [pt199u]: "keep selling and catch up later")
- Server: migration 048 (sales.client_uuid unique, offline_no, synced_at; tills.off_alloc_to; stock may go negative; stock_reviews). GET /tills/offline-pack (copy + block of 200 numbers), POST /sales/offline-sync (dedup by client UUID, number must be inside the till's block, cashier/manager check), GET/POST /stock/reviews. POST /sales accepts clientUuid (retry = same sale).
- Till: apps/desktop/src/till-offline.js (durable queue/pack/cache, offline PIN check from cached scrypt hashes, 5 fails → lock, manager approval offline, sync every 3 s, pack refresh 60 s + on pair); till-link answers locally while the main PC is away.
- Web: Offline / Sending N / Not sent N / Synced chip in the top bar (till PCs only); Sell-only menu offline; khata off offline; clientUuid per bill; re-check sign-in on reconnect; Stock review on Tills screen; error texts.
- Keygen: `--tills` default 2 (README + PLAN).
- Tests: scripts/test-lite-offline.mjs 45/45 (two tills one offline, restart while offline, duplicate sync, stock conflict, cash-only refusals, offline PIN + manager approval, token upgrade, online retry dedup); test-lite-network 45/45 (sale while down now kept offline and caught up); UI lite-network.ui 15/15 → /workspace/lite-offline-selling.png, /workspace/lite-offline-synced.png.
- Full PG suite 60/60 (docs/test-results-pg-2026-11-03-offline.md). Commit 1644cb0.

## Step 13 — Deploy to Asim's PC (10:26 PKT)
- ListMachines: Asim-Javaid-PC **not connected** (checked twice) → nothing run on his PC.
- Kit ready on the box: /workspace/dukaandeskpro-deploy-kit.zip (folder /workspace/dukaandeskpro-deploy-kit), source tools/deploy-local-win/.
  deploy-lite.ps1: P1 hash + 3847/5173 health before/after, ports 3947/5273/5275/5443 free check, Node 20 / pnpm 10 check (pnpm per-user if missing), code → %USERPROFILE%\dukaandeskpro, pnpm install + build, PG 17.11-5 EDB zip (SHA-256 pinned) → initdb per user on 127.0.0.1:5443 (no service), launchers, demo seed (or -Data p1: shared-read copy of P1 db → tools/import-p1), start via explorer.exe, checks health engine=postgres / 401 / web 200 / till 2 200, TEST-GUIDE-LITE.md → %USERPROFILE%.
  Checked here: PS parse OK (pwsh 7.4), seed-demo against a fresh API OK (and skips 2nd time), health engine=postgres, no-session 401. Not run on Windows yet.
- 13:51 PKT: PC online briefly. Found: Node 25 + pnpm 11 on PATH (Herd nvm), Node 20.15.1 in C:\Program Files\nodejs (what P1 launchers use), P1 not running (no 3847/5173 listener), no Lite folders yet. Kit patched (Node dir first in PATH for Lite only, pnpm 10 via corepack, vite via node). PC went offline before copy; nothing written on the PC.
