# DukaanDesk Pro — recommended price list (PROPOSAL, 2026-11-03)

Proposed by Grok Bot for Asim to approve; not market-tested. All prices one store, PKR, one-time unless marked yearly.
Same prices for Pakistan (FBR) and AJK (AJK-IRD).

| Item | Price | Notes |
|---|---|---|
| **Lite base licence** (main PC + 2 tills) | **Rs 59,900** | Includes 1st year Care |
| Extra till (3rd, 4th, …) | **Rs 14,900 each** | Key re-issued with higher till count |
| Server-only main PC (back office, no till) | **Free** | Not counted as a till |
| **Tier-1 Tax Compliance module** (FBR or AJK: tax engine, SRO 1006 invoice, PRAL link, offline queue, monthly tax reports) | **Rs 24,900** | Needed by every Tier-1 store; covers both PK and AJK |
| Care (updates + support), from year 2 | **Rs 11,900 / year** (+ Rs 2,900 per extra till) | Required to keep tax module current; without Care the app keeps working on its last version |
| Tax module rule updates (included in Care) | — | FBR/AJK spec changes shipped as updates |
| Setup and POS registration help | **Rs 7,500 remote / Rs 12,500 on-site** (+ travel outside city) | Install, PostgreSQL, tills, PRAL/IRIS registration with owner, sandbox test |
| Data import from P1 | Free | |
| Upgrade from P1 | P1 price paid (e.g. Rs 27,900) credited against base | Within 12 months of P1 purchase |
| Trial | 14 days, 2 tills, tax module in sandbox only | Then read-only |

**Typical Tier-1 store (3 tills):** 59,900 + 14,900 + 24,900 + 7,500 setup = **Rs 107,200** first year, then Rs 14,800/year Care.

**Reasoning**
- Rival offline POS: Rs 24k–40k, usually single till, no FBR link. Lite base with 2 tills at Rs 59,900 ≈ Rs 30k per till — in line.
- Cloud POS ~Rs 2,500/month per outlet = Rs 30k/year; over 3 years a 3-till cloud setup costs ~Rs 90k–270k (often per till) vs Lite
  ~Rs 107k + Rs 30k Care, and Lite works on the LAN with no internet for selling.
- P1 Standard Rs 27,900 (single till, small kiryana) — Lite ≈ 2× P1 for multi-till + PostgreSQL + manager role.
- Tier-1 module priced separately because it carries the compliance work and ongoing PRAL/FBR changes; PRAL integration itself is
  free (rule 150XF), so we charge for software and setup, not for "integration" (we are not a licensed integrator — see FBR-INTEGRATION.md).
- Care is effectively mandatory for Tier-1 stores since FBR/AJK rules change (e.g. S.R.O. 2071(I)/2025).
