# DukaanDesk Pro licence keys (owner only)

This folder is never packed into the installer (electron-builder ships only `apps/desktop/src`, `web`, `staged/api`).
Full step-by-step for the owner: `docs/OWNER-GUIDE.md`. Technical design and limits: `docs/LICENSING.md`.

## ⚠ The key in the repo now is a TEST KEY
`packages/license/src/public-key.js` has `TEST_ONLY: true`. It was made on the dev box and must never ship.
`pnpm package:win` refuses to build while it is there.

**Create the production key once, on your own Windows PC (not a shop PC, not the dev box):**
```powershell
cd C:\Users\asimj\products\dukaandeskpro
node tools\keygen\keygen.mjs init --force
```
- Writes `%USERPROFILE%\.dukaandeskprokeys\private.pem` (SECRET) + `public.pem`, and puts the public key into
  `packages\license\src\public-key.js` (without `TEST_ONLY`).
- Back up `%USERPROFILE%\.dukaandeskprokeys` to 2 USB sticks + an encrypted cloud copy. Lose it = no more keys for
  installers already sold. Leak it = anyone can make keys.
- After `init --force`, every key made with the test key stops working. Rebuild the installer (`pnpm package:win`).
- `init` without `--force` keeps an existing key. `init --test` makes a throw-away key marked TEST_ONLY.

## Commands
| Command | What it makes |
|---|---|
| `sign --machine CODE --shop "Name" [--tills 2] [--updates-months 12 \| --updates-until 2027-11-30] [--edition standard] [--features a,b]` | Full licence (DR2). Perpetual; free updates until the date. `--tills` = active tills allowed (default 2). |
| `renew --machine CODE --shop "Name" [--updates-months 12]` | Care renewal: same licence with a later updates-until. Paste over the old one. |
| `extend --machine CODE [--days 7] [--use-within 14]` | One-time trial extension for that PC. Must be entered within 14 days. Not a licence. |
| `transfer --from OLD-CODE --machine NEW-CODE --shop "Name"` | Licence for the shop's new PC. Logged with the old code; warns if that shop moved before. |
| `verify --machine CODE --key DR2...` | Checks a key (DR1 or DR2). |
| `list` / `log [--machine CODE]` | Everything issued (`%USERPROFILE%\.dukaandeskprokeys\issued.csv`). |
| `manifest --dir DIR --kind api\|web --build-date YYYY-MM-DD` | Signs a build manifest (run by `package:win`; you don't need it by hand). |

Old `DR1.` keys (made before Nov 2026) keep working: they are full licences with updates unlimited.

## Updates rule
Every installer carries its build date. A licence covers builds made on or before its **updates-until** date.
Installing a newer build on an uncovered licence: DukaanDesk Pro keeps working normally (read-write) and shows
"Updates ended · this version needs renewal". Send a `renew` key after payment. (Switchable to read-only by
setting `UPDATE_POLICY = 'readonly'` in `packages/license/src/state.js`.)

Override the keys folder with `DD_KEYS_DIR` (tests do this).
