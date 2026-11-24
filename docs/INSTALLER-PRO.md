# DukaanDesk Pro — installer plan (slice P5)

One Windows installer (`dukaandeskpro-Setup-<ver>.exe`, NSIS, per-machine, closed source, 14-day trial).
A page after the folder page asks how this PC is used:

| Choice | What it installs / runs | Data |
|---|---|---|
| **Main PC** (default) | App + bundled PostgreSQL 17 service `dukaandeskproPG` + API service `dukaandeskproServer` (LAN on). This PC is Till 1. | `%ProgramData%\dukaandeskpro` |
| **Main PC, no till** | Same, `installMode=server-only`: Till 1 off, the screen is for the owner (tills, reports, backup). | same |
| **Till PC** | App only + `till-only.flag`. No database, no API. Connect screen → pairing code → sell. | none (only `%APPDATA%\DukaanDesk Pro\till.json` = main PC address) |

## Main PC — what setup does (`apps/desktop/build/win/main-pc-setup.ps1`, elevated)
1. `initdb` in `%ProgramData%\dukaandeskpro\pgdata` (user `dukaandesk`, scram-sha-256, generated password in `pg.secret`), `listen_addresses='127.0.0.1'`, port **5439** (does not clash with a PostgreSQL the shop may already have on 5432). Service `dukaandeskproPG` (auto, NetworkService).
2. Database `dukaandesk`; the API runs the migrations on first start.
3. `server.json` (database URL, pg_dump folder, LAN on, install mode, backups `%ProgramData%\dukaandeskpro\backups`, licence home, session secret file). Folder ACL: SYSTEM + Administrators only (NetworkService read on the folder, full on pgdata/logs).
4. API service `dukaandeskproServer` (WinSW, MIT) = the app's own Electron binary as Node running `server-service.js` → `resources\api\dist\main.js`. Restarts on failure. Tills keep selling while the main PC's window is closed.
5. Firewall: TCP 3847 (API) and UDP 3849 (till discovery), **Private profile only**.
6. Re-running setup (upgrade/repair) keeps data, password and secret.

The app window on the main PC (`main-pc.flag` in the install folder) does not start its own API; it waits up to 60 s for the service.

Uninstall (`main-pc-remove.ps1`): stops/removes both services and firewall rules, **keeps** `%ProgramData%\dukaandeskpro` (data, backups, licence). Reinstall finds everything.

## Till PC
- `till-only.flag` → Electron starts `till-link.js` instead of the API: serves the bundled UI on 127.0.0.1:4173 and forwards API calls to the main PC.
- First start: connect screen (UDP discovery list + typed IP), then the 6-digit pairing code from the main PC's Tills screen. Device key kept in the till's browser storage; turning the till off on the main PC sends it back to the pairing screen.
- Main PC unreachable: full-screen block, selling stops, open bill kept; lifts on its own when the main PC answers (3-s heartbeat).
- No licence check on a till PC: the main PC's licence carries the till count (trial = 2 tills incl. Till 1).

## Build steps (build PC, Windows)
1. `node scripts/fetch-win-runtime.mjs` (also run by `pnpm package:win`): PostgreSQL 17 Windows x64 binaries (EDB zip, bin/lib/share only) → `apps/desktop/staged/pgsql`; WinSW-x64 → `apps/desktop/staged/winsw/dukaandeskproServer.exe` + xml. **SHA-256 not pinned yet**: first run `DD_PIN_HASHES=1`, compare with the publishers, paste into the script.
2. `pnpm package:win` (needs the owner private key; refuses the TEST key).
3. Licences: PostgreSQL = PostgreSQL Licence (permissive), WinSW = MIT. No GPL/AGPL added.

## Tested vs untested
Tested on the Linux dev box (PostgreSQL 17, Node):
- API LAN mode, LAN gate, UDP discovery, till-link forwarding, pairing over the LAN, two simulated tills selling in parallel, main PC down / back (`scripts/test-lite-network.mjs`, `scripts/ui/lite-network.ui.mjs`).
- `server-service.js` + `server-config.js` with a `server.json` (`scripts/test-lite-server-service.mjs`).
- Licence till count + 2-till trial (`scripts/test-lite-licence-tills.mjs`).

**UNTESTED on Windows (nothing here has run on Windows yet):**
- `installer.nsh` (custom page, flags, calling PowerShell), `perMachine: true` install/upgrade/uninstall.
- `main-pc-setup.ps1` / `main-pc-remove.ps1`: initdb as an elevated admin, NetworkService ACLs, `pg_ctl register`, WinSW install/restart, netsh rules, icacls.
- WinSW running Electron with `ELECTRON_RUN_AS_NODE=1` on `app.asar.unpacked\src\server-service.js`; `process.resourcesPath` under that mode (the xml sets `DD_API_MAIN` to avoid relying on it).
- pg_dump/pg_restore backups with the bundled Windows binaries.
- UDP broadcast through Windows Firewall / common shop routers; Electron till-only start (`till-only.flag`).
- `fetch-win-runtime.mjs` (Windows tar.exe on zip; EDB URL/version).
- Licence machine code when the API runs as SYSTEM (service) vs the old user-run sidecar: activation must be done after the switch; check that a P1-style user licence store is not needed.

## Open items
- Code-signing certificate (SmartScreen warnings otherwise).
- Main PC IP changes (DHCP): discovery finds it again from the connect screen; recommend a router reservation in the owner guide. Auto re-discovery on a till is a later step.
- Optional: owner screen to switch Main PC ↔ Main PC no till already exists (Tills → mode toggle); switching install kind Main ↔ Till needs a reinstall.

## Till PC offline (main PC down)
- The till keeps an offline copy in `%APPDATA%\DukaanDesk Pro\offline\` (next to `till.json`): `pack.json` (items, prices, cashier/manager PIN hashes — never the owner's), `queue.json` (unsent bills, written with fsync before "Sale complete"), `cache.json` (recent sign-ins).
- Offline: top bar shows **Offline** + the number of unsent bills; only Sell; cash only; bills `T2-OFF-000001…` from a block of 200 reserved on the main PC.
- Back online: bills are sent every 3 s (duplicates ignored by client UUID). Top bar: **Sending N** → **Synced**. A bill the main PC refuses shows **Not sent N** (kept in `queue.json`, nothing deleted).
- Stock that went below zero from offline bills: **Tills → Stock review** (owner/manager), Resolve after a count.
- Limits: offline bills get the main PC time when they arrive (`recorded_at`), sale time kept in `client_device_at`; carton sales and discounts are not offered offline; an offline sign-in is lost if the till app restarts (sign in again); PIN hashes on the till disk are 4–6 digits, so a stolen till PC could guess them — the owner PIN is never stored there.
- Delete a till's offline copy: close the app, delete the `offline` folder only if `queue.json` has `"sales": []`.
