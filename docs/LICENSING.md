# DukaanDesk Pro licensing: how it works and its limits

Offline only. No server, no internet needed, ever.

## Trial
- 14 days from first launch **or** 200 hours of active use, whichever comes first.
  Active use = a minute in which someone pressed a key or clicked (the app sends `GET /license/heartbeat`
  at most once a minute; background polling does not count).
- Pill bottom-right: `Trial · N days left`; adds `· H h of use left` only in the last 24 hours of use.
- After the trial: **read-only**. Reports, exports (Excel/PDF), backups, restore and login still work.
  Selling and every change answer `402 READ_ONLY`; the UI shows a red "Trial ended | Read-only | Activate" strip.
- The trial record (first run, last seen, minutes used, extensions) is HMAC'd and bound to the Machine Code,
  stored in 4 places: `%APPDATA%\DukaanDesk Pro\runtime.dat`, hidden `%LOCALAPPDATA%\.ddrt`,
  `HKCU\Software\DukaanDesk Pro\Runtime`, and the shop DB (`license_state`). Earliest first run and highest usage win;
  deleting some copies does not reset it; an edited copy ends the trial.

## Clock check
Read-only "Computer date looks wrong" (`clock_rollback`) when the clock is more than 2 h behind either the last
time the app ran, or the newest record in the shop data (sales, audit log, purchases, stock adjustments,
expenses, last auto-backup). Fix the date → works again.

## Keys (Ed25519, offline)
- `DD1.` (v1, old): `{machineCode, edition, features, shop, issuedAt}` — full licence, updates unlimited.
- `DD2.` (v2): adds `type` = `full` | `ext` | `transfer`, `updatesUntil`, `days`, `useBy`, `id`, `from`.
- The app holds only the public key. Keys are bound to one Machine Code (Windows MachineGuid + CPU + BIOS + disk).
- `ext`: +N days to the trial, once per key id, only on that machine, only before `useBy`; ignored once licensed.
- `transfer`: a full licence for the new PC; the issue is logged with the old code (offline: the old PC is
  not switched off remotely — see limits).
- When several keys were entered, the one with the latest `updatesUntil` is used; an older key is refused (`older_key`).

## Updates-until rule
Each installer has a build date (`packages/license/src/build-info.js`, stamped by `pnpm package:win`).
A licence covers builds made on or before `updatesUntil` (empty = unlimited).
Policy `UPDATE_POLICY = 'warn'` (in `state.js`): an uncovered build still runs read-write and asks for a
renewal key. Set `'readonly'` to make uncovered builds read-only instead.

## Tamper protection (within reason)
- Electron: `contextIsolation`, `sandbox`, no `nodeIntegration`, no remote module, DevTools off in the packaged
  app, new windows/navigation/webviews blocked, CSP on every page.
- Fuses (`apps/desktop/build/after-pack.cjs`, `@electron/fuses`): NODE_OPTIONS off, `--inspect` off,
  only load app from asar, cookie encryption on, file-protocol extra privileges off.
  `RunAsNode` stays **on** (the bundled server runs as `ELECTRON_RUN_AS_NODE`).
  ASAR integrity is **off** until tested on Windows (`DD_ASAR_INTEGRITY=1` to try it).
- Signed manifest (`dd-manifest.json`) of the server files, licence module and UI files, checked at every start.
  Changed, added or missing file → read-only with "Files changed — reinstall DukaanDesk Pro" (`integrity`).
- The packaged app refuses a stray dev server already on port 3847.
- No obfuscators.

## Honest limits
Anything offline can be cracked by a determined person with a debugger: they can patch `main.js` inside the
asar, the Electron binary, or the check itself, and the manifest only protects files the checker reads.
Machine-bound keys stop casual sharing; read-only after the trial stops casual "keep using it";
the clock and 4-store checks stop the common tricks. A transfer cannot switch off the old PC — keep the log and
only transfer after the shop tells you the old PC is gone. Real protection is the relationship: updates,
support and Care renewals only for keys in your log.

## Code signing (optional)
Buy an OV/EV code-signing certificate, then on the build PC:
```
set CSC_LINK=C:\path\cert.pfx
set CSC_KEY_PASSWORD=...
set DD_SIGN=1
pnpm package:win
```
Unsigned builds work; Windows SmartScreen shows "unknown publisher" until signed.
