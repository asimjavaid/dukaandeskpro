# DukaanDesk Pro — Windows demo (portable)

Offline retail POS demo (Electron + Nest + React + SQLite).  
**Local only** — no cloud sync, no live FBR. Tax uses `TAX_MODE=simulate` (queue / accept|reject stubs only).

Target path example: `C:\Users\asimj\dukaandesk`

---

## What this package is

| Included | Excluded |
|----------|----------|
| Full monorepo source (`apps/`, `packages/`, `scripts/`) | `node_modules` (install on Windows) |
| `pnpm-lock.yaml`, workspace config | Linux-built `dist/` / native binaries |
| `.env.example`, this guide, `scripts\win\*.cmd` | SQLite DB files (created on first run) |
| README (slices 0–16 + packaging) | A prebuilt `.exe` inside this tree (build it on Windows) |

**Dev demo** (Node + pnpm, three terminals) is the fastest way to try the app. **Production** loads the built web + Nest sidecar (`pnpm build:desktop` then `pnpm start:prod`). **Installer** (`pnpm package:win`) is electron-builder NSIS + portable and must be run **on Windows** — a Linux box cannot emit a `.exe` (no Wine; `better-sqlite3` is host-native). No auto-update and no code signing in P1.

---

## Prerequisites (once per PC)

1. **Node.js 20 LTS** (repo engines: `>=20`; do not use Node 25 — `better-sqlite3` has no prebuild and the native compile fails)  
   - https://nodejs.org/ (Windows Installer, 20.x)  
   - After install, open a **new** PowerShell or Command Prompt and check:
     ```bat
     node -v
     where node
     ```
     Expect `v20.x`.  
   - **Herd:** if Laravel Herd is installed, its Node may sit first on PATH (`node -v` shows 25 even after `nvm use 20`). Do **not** change Herd’s global Node if other local sites need it. For this window only, put Node 20’s folder first on `Path`, then check `where.exe node` does not point at Herd’s `v25` directory. Other Herd projects stay on their own Node.

2. **pnpm 10.x** (matches `packageManager` in `package.json`: `pnpm@10.33.4`)
   ```bat
   corepack enable
   corepack prepare pnpm@10.33.4 --activate
   pnpm -v
   ```
   If Corepack is unavailable:
   ```bat
   npm install -g pnpm@10.33.4
   ```

3. **Build tools for native modules** (needed by `better-sqlite3` and Electron)  
   - Install **Visual Studio Build Tools** with “Desktop development with C++”, **or**  
   - Run (as Admin, once):
     ```bat
     npm install -g windows-build-tools
     ```
     (Older helper; VS Build Tools is preferred on modern Windows.)  
   - Or install [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/) → workload **Desktop development with C++**.

---

## Get the tree onto your PC

From the agent box, the archive is:

- `/workspace/dukaandesk-windows-demo.zip`  
  (also folder `/workspace/dukaandesk-portable/` before zip)

**Copy to Windows** (pick one):

1. **CopyFromBox** (if your Grok/Cursor setup exposes it) → save under `C:\Users\asimj\`  
2. Or download/share the zip any other way → extract to:
   ```
   C:\Users\asimj\dukaandesk
   ```
   After extract, you should see `package.json`, `apps\`, `pnpm-lock.yaml`, `RUN-WINDOWS.md`.

If the zip contains a top folder `dukaandesk-portable`, rename/move it to `C:\Users\asimj\dukaandesk`.

---

## Install dependencies (first time)

Open **Command Prompt** or **PowerShell**:

```bat
cd C:\Users\asimj\dukaandesk
pnpm install
```

This downloads Electron, Nest, Vite, and compiles `better-sqlite3` for **Windows**.  
Expect several minutes. If `better-sqlite3` fails, install VS C++ Build Tools (above) and retry `pnpm install`.

Optional env file (defaults are fine for demo):

```bat
copy .env.example .env
```

Defaults:

| Variable | Default | Meaning |
|----------|---------|---------|
| `API_PORT` | `3847` | Nest sidecar |
| Vite UI | `http://localhost:5173` | React (proxies API) |
| `TAX_MODE` | `simulate` | Offline tax queue only |
| SQLite (API CLI) | `apps\api\data\dukaandesk.sqlite` | Created on first API start |
| SQLite (Electron) | `%APPDATA%\dukaandesk\...` userData | Set by Electron main |

---

## Run the demo (three terminals)

Prefer starting **API** then **web**, then optionally **desktop**.

### Terminal A — API (Nest + SQLite)

```bat
cd C:\Users\asimj\dukaandesk
pnpm dev:api
```

Or double-click / run: `scripts\win\start-api.cmd`

Wait until Nest is listening (no crash). Health: http://127.0.0.1:3847/health

### Terminal B — Web (Vite React UI)

```bat
cd C:\Users\asimj\dukaandesk
pnpm dev:web
```

Or: `scripts\win\start-web.cmd`

Open in browser: **http://localhost:5173**

### Terminal C — Electron (optional)

Only after Vite is up (dev loads `http://127.0.0.1:5173`):

```bat
cd C:\Users\asimj\dukaandesk
pnpm dev:desktop
```

Or: `scripts\win\start-desktop.cmd`

Electron may spawn/connect Nest itself; if API is already on :3847 it will reuse it.

**Browser-only demo is enough** for owner login + sell loop (API + web). Electron is the desktop shell.

---

## First-run — Owner PIN + sell loop

1. Open http://localhost:5173  
2. First launch → **Set up your store**  
3. Enter Owner display name, optional store name, **PIN (4–6 digits)** twice  
4. You land on **Catalog**  
5. **Add product** (name, piece price Rs — sell is pieces only)  
6. **Receive stock** (Owner): loose pieces + total paid, or carton pieces + carton cost  
7. Open **Sell** → add lines → **Pay** cash (or udhaar / split) → Done  
8. Optional: View receipt → Print / Share  

To **reset** the demo DB (browser/API path):

```bat
del /Q C:\Users\asimj\dukaandesk\apps\api\data\dukaandesk.sqlite*
```

Then restart `pnpm dev:api`.  
(Electron userData DB is under `%APPDATA%` — delete that sqlite if you used desktop-only.)

---

## Quick helper scripts

| Script | Does |
|--------|------|
| `scripts\win\install.cmd` | `pnpm install` from repo root |
| `scripts\win\start-api.cmd` | `pnpm dev:api` |
| `scripts\win\start-web.cmd` | `pnpm dev:web` |
| `scripts\win\start-desktop.cmd` | `pnpm dev:desktop` (Vite must already be up) |
| `scripts\win\start-prod.cmd` | `pnpm start:prod` after `pnpm build:desktop` |
| `scripts\win\package-win.cmd` | `pnpm package:win` (NSIS + portable, this PC only) |

All `cd` to the repo root (two levels above `scripts\win`).

---

## Production (built web + API, still this PC)

Not the Vite dev server. One window, local SQLite under Electron userData (`%APPDATA%`).

```bat
cd C:\Users\asimj\dukaandesk
pnpm build:desktop
pnpm start:prod
```

Or `scripts\win\start-prod.cmd` after the build.  
`start:prod` sets `DUKAANDESK_PROD=1`: Electron serves `apps\web\dist` and spawns `node apps\api\dist\main.js`. Backup export uses the Windows save dialog. Browser dev (`pnpm dev:web`) still downloads the JSON file. No cloud backup.

## Windows installer (NSIS + portable)

Configured with **electron-builder** (`apps\desktop\electron-builder.yml`): targets **nsis** and **portable**. No auto-update. No code signing.

```bat
cd C:\Users\asimj\dukaandesk
pnpm install
pnpm package:win
```

Artifacts land in `dist-desktop\` (`DukaanDesk Pro-Setup-…exe` and `DukaanDesk Pro-Portable-…exe`).  
`package:win` runs `pnpm build:desktop`, `pnpm deploy` of the API (so `better-sqlite3` is the Windows binary), then `electron-builder --win`. **Run this on Windows.** Do not expect a `.exe` from a Linux build machine.

## Smoke checks (optional)

With deps installed:

```bat
cd C:\Users\asimj\dukaandesk
pnpm test:slice1
pnpm test:slice3
pnpm test:slice10
pnpm test:slice17
```

`test:slice17` builds web+api and checks the production Electron entry, the electron-builder Windows target, and this guide. It does not launch a GUI. On Linux it also checks that `package:win` refuses instead of pretending to emit an `.exe`.

---

## Honest limits / blockers

- **Installer is configured** (`pnpm package:win`, electron-builder NSIS + portable) but **this repo does not contain a prebuilt `.exe`**. Build it on the Windows PC. A Linux machine cannot cross-compile it (no Wine; native `better-sqlite3`).  
- **No auto-update** and **no code-signing certificate** in P1.  
- **Do not copy Linux `node_modules`** — `better-sqlite3` and Electron binaries are platform-specific. Always `pnpm install` on Windows.  
- **No live FBR**, no JazzCash/EasyPaisa, no cloud sync, no multi-till — offline single PC (`TAX_MODE=simulate`).  
- Paths like `/workspace/dukaandesk` are **Linux box** paths; on your PC use `C:\Users\asimj\dukaandesk`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `pnpm` not found | Corepack/npm global install; new terminal |
| `better-sqlite3` build error | Install VS C++ Build Tools; retry `pnpm install` |
| Port in use | Change `API_PORT` in `.env` or stop other process on 3847 / 5173 |
| Blank Electron window | Start `pnpm dev:web` first |
| Setup screen again after PIN | Wrong/deleted sqlite; check `apps\api\data\` vs Electron userData |
| Electron sandbox errors | Desktop script already uses Electron; if needed set `ELECTRON_DISABLE_SANDBOX=1` (dev only) |

---

*DukaanDesk Pro P1 — dev demo, production Electron load, and Windows installer path (Slice 17).*
