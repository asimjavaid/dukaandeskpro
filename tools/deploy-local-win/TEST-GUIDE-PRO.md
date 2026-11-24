# DukaanDesk Pro — test copy on this PC

Separate from DukaanDesk P1: own folder, own database, own ports. P1 (`C:\Users\asimj\dukaandesk`, ports 3847/5173) is not touched.

| What | Where |
|---|---|
| Lite screen (main PC, Till 1) | http://127.0.0.1:5373 |
| Second till on this PC (Till 2) | http://127.0.0.1:5375 |
| API | http://127.0.0.1:4047/health |
| Code | `C:\Users\asimj\dukaandeskpro` |
| Data (PostgreSQL 17, port 5453, backups, logs) | `C:\Users\asimj\dukaandeskprodata` |

Demo PINs: owner **Asim 2468** · manager **Mona 1357** · cashiers **Bilal 5678**, **Sara 4321**.
(If you imported your P1 data instead, use your P1 PINs.)

This is a dev copy: no licence check, no Windows service, no firewall rule, other PCs cannot reach it.

## 1. Start / stop
- Start: double-click `C:\Users\asimj\dukaandeskpro\startpro.cmd`. Three black windows open (API, Web, Till 2) and the browser opens the Lite screen. Keep the windows open.
- Stop: `stoppro.cmd` (closes only Lite ports 4047/5373/5375 and Lite's own PostgreSQL).

## 2. Pair a second till (same PC)
1. Main screen (5373): sign in as Asim → **Tills** → **Add till** → name "Counter 2" → a 6-digit pair code shows.
2. Open http://127.0.0.1:5375 in another tab. Type the main PC address **`127.0.0.1:4047`** (with `:4047`) → Enter.
3. Type the pair code and a PC name → Enter. Sign in as Sara (4321).
4. Sell on both tabs: Till 1 bills are `T1-000001…`, Till 2 bills `T2-000001…`.
5. **Tills** (as Asim) shows both tills, who is signed in, today's total.

## 3. Manager approval
- As a cashier, change a price on the bill (or try a refund) → a manager PIN box opens. Mona 1357 → approved; a cashier PIN is refused.
- Cashier refunds always need a manager (shop rule, default on).

## 4. Offline (main PC down)
1. Till 2 signed in, with a bill ready.
2. Close the **DD Lite API 4047** window (this is "main PC down").
3. Till 2 top bar shows **Offline**; only Sell is open. Cash sale → `T2-OFF-000001`. The number after Offline = bills waiting.
   Not possible offline: khata/customer credit, refunds, stock receiving, digital pay, discounts. Price change needs Mona's PIN.
4. Close and reopen the Till 2 window (`ddprotill2.cmd`) while offline: the waiting bills are still there.
5. Start the API again (`ddproapi.cmd`). Top bar: **Sending N** → **Synced**. Bills appear in **Sales** on the main screen with their `T2-OFF` numbers.
6. Sell more of an item offline than the stock you have → after sync, **Tills → Stock review** shows it; Resolve after counting.

The main screen (Till 1 = main PC) does not sell offline: when its own API is down it shows the "not reachable" block.

## 5. Backups
- **Backup** screen: **Make full copy** → a `.ddpro` file (PostgreSQL copy). **Restore full copy** puts it back (asks first).
- Daily automatic copies go to `C:\Users\asimj\dukaandeskprodata\backups` (keep 14).
- Excel/PDF exports work as in P1.

## 6. If something is wrong
- Logs: `dukaandeskprodata\deploy-log.txt`, `pg17.log`, and the black windows.
- Start over: `stoppro.cmd`, then delete `C:\Users\asimj\dukaandeskpro` and `C:\Users\asimj\dukaandeskprodata` (Lite only), run `deploypro.ps1` again.

## Not set up on purpose (ask before doing)
- Windows service for the Lite server (installer would add "DukaanDesk Pro Server").
- Firewall rule for API port 4047 + UDP 3849 (needed only for a real second PC on the LAN).
- PostgreSQL as a service on port 5439 (installer) instead of this per-user copy on 5453.
