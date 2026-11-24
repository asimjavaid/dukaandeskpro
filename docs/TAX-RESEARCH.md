# DukaanDesk Pro — Pakistan + AJK tax research (step 1, research only)

Researched 2026-11-03 (PKT). Every fact has its source. **[A]** = official text read directly (FBR/PRAL/statute PDF).
**[S]** = secondary or summary source. **⚠** = uncertain or possibly out of date; needs a tax adviser or an
FBR/AJK-IRD answer before we build on it. This is not legal advice. Local copies of the PDFs are in `/workspace/taxres/`.

## Sources

| Id | Document | URL |
|---|---|---|
| STA | Sales Tax Act 1990, updated to 2025-26 (FBR) | https://download1.fbr.gov.pk/Docs/202586148252375SalesTaxActupdatedupto2025-26.pdf |
| CH14 | Sales Tax Rules 2006, Ch. XIV (licensing, e-invoices, integration), S.R.O. 69(I)/2025, 29.01.2025 | https://download1.fbr.gov.pk/Docs/2025571554338577ChapterXIV.pdf |
| BOOK | FBR POS Booklet (legal provisions), 2025 | https://download1.fbr.gov.pk/Docs/202551615541769POSBooklet.pdf |
| LEG | FBR "POS legal provisions" page (index of SROs) | https://www.fbr.gov.pk/pos-legal-provisions/163085/163086 |
| S2071 | S.R.O. 2071(I)/2025, 03.11.2025 (rule 150Q(3)) | https://download1.fbr.gov.pk/SROs/202511413114246831SRO2071(1).pdf |
| S1006 | S.R.O. 1006(I)/2021, 09.08.2021 (standard POS invoice format) | https://download1.fbr.gov.pk/SROs/202189168291729SRO-1006.pdf |
| OP1006 | FBR letter "Operationalization of SRO 1006(I)/2021" | https://download1.fbr.gov.pk/Docs/20218161283220712OperationalizationSRO1006-2021.pdf |
| S1279 | S.R.O. 1279(I)/2021, 30.09.2021 (Re 1 per POS invoice) | https://download1.fbr.gov.pk/SROs/202110110104124427SRO1279-2021.pdf |
| S428 | S.R.O. 428(I)/2024, 22.03.2024 (Income Tax Rules Ch. VIIA, online integration + licensed integrators) | https://download1.fbr.gov.pk/SROs/2024322153582988SRO-428.pdf |
| FAQ | FBR FAQs POS Integration (Dec 2020) ⚠ old rates | https://download1.fbr.gov.pk/Docs/20201201313212651FAQs-POSIntegration.pdf |
| AJKTD | PRAL "Software fiscal component from Tier-1 retailer with AJK", v1.0, issue 07.02.2025 | https://e.fbr.gov.pk/SOP/AJK/AJK_POS_Technical_Document.pdf |
| FBRTD | FBR Knowledge Base "Technical specification … software fiscal component … with FBR" (copy on a forum) [S] | https://forum.sambapos.com/uploads/short-url/XSMFnYCsTOJs1Nib2O2MNLTbUk.pdf (original: https://help.fbr.gov.pk/?p=6148) |
| DI | FBR Digital Invoicing API tech doc v1.12 (B2B e-invoicing, not retail POS) — not read in detail | https://download1.fbr.gov.pk/Docs/20257301172130815TechnicalDocumentationforDIAPIV1.12.pdf |
| AJK | AJK Inland Revenue Dept (CBR AJ&K) site — blocks automated fetch; seen via search snippets [S] | https://ird.ajk.gov.pk/sales-tax-2/ , https://ird.ajk.gov.pk/ministry-posts/the-sales-tax-act-1990/ |
| PRA | PRA "Technical Specification … Software Fiscal Device" 1.2 | https://e.pra.punjab.gov.pk/templates/Technical_Specification_Software_Fiscal_Device_1.2_PRA.pdf |
| SRB | SRB Point of Sale page and FAQ | https://www.srb.gos.pk/srb/point-of-sale-pos/ , https://www.srb.gos.pk/srb/faq/ |
| KPRA | KPRA RIMS API guide (restaurants) | https://kpra.gov.pk/docs/rims.html |
| BR | Business Recorder articles on SRO 1006 [S] | https://www.brecorder.com/news/40112252 , https://www.brecorder.com/news/40118079 |

All accessed 2026-11-03.

## 1. Who must register and integrate (federal, goods)

1. **Tier-1 retailer** = STA s.2(43A) [A, STA]: (a) unit of a national/international chain of stores; (b) retailer in an
   air-conditioned mall/plaza/centre, excluding kiosks; (c) cumulative electricity bill over **Rs 1.2 million** in the
   last 12 months; (d) wholesaler-cum-retailer importing/supplying consumer goods in bulk; (e) omitted; (f) retailer who
   has acquired a POS for card/digital payment; (g) retailer whose 236G/236H withholding exceeds a threshold notified by
   the Board; (h) other persons prescribed by the Board. ⚠ The 2020 FAQ still lists "shop ≥ 1,000 sq ft"; the current Act
   has (e) omitted, while Income Tax Rules (S428 schedule, s.no. 12) still list 1,000 sq ft for income-tax integration.
2. **Clause (g) threshold now set**: S.R.O. 2071(I)/2025 dated 03.11.2025 adds rule 150Q(3): retailers whose deductible
   withholding under s.236G or s.236H in the preceding period exceeds **Rs 100,000 or Rs 500,000** respectively must
   integrate [A, S2071]. ⚠ "Preceding period" length (month/year) not defined in the SRO — confirm.
3. **Tier-1 obligations**: pay sales tax at the applicable rates and integrate for real-time reporting, STA s.3(9A) [A, STA];
   all Tier-1 retailers integrate from 1 Dec 2019, rule 150ZEA [A, BOOK].
4. **Other retailers (not Tier-1)**: pay sales tax with the electricity bill — **5%** of a monthly bill up to Rs 20,000,
   **7.5%** above — STA s.3(9) [A, STA]; excluded from registration, STA s.14(1)(b) [A, STA]. No POS invoice reporting.
   → Most small kiryana shops are here; for them DukaanDesk needs no FBR link, only optional simple tax.
5. **Restaurants** must integrate irrespective of Tier-1 (Rules Ch. XIV-A) [A, BOOK].
6. **Income tax integration** (separate from sales tax): Income Tax Rules Ch. VIIA, rule 33A + Schedule (S428) list
   retailers matching the same Tier-1 style tests (chain, AC mall, electricity > Rs 1.2m, wholesaler-cum-retailer,
   shop ≥ 1,000 sq ft) and must integrate "every payment counter … fixed or portable" via a licensed system, rule 33H(3) [A, S428].

## 2. FBR POS integration (federal)

| Item | Finding | Source |
|---|---|---|
| POS functions | Generate, record and store invoices; prescribed format + digital signature; transmit to FBR and receive the unique FBR invoice no.; encrypt and preserve data irrevocably; QR from the FBR no.; day/week/month closing; log every adjustment, modification, cancellation and system event; alert FBR on malpractice/error | rule 150R(4),(6) [A, CH14] |
| Only integrated sales | No supply except through registered/integrated outlets and POS; each outlet/POS registered on FBR system | 150R(2),(3) [A, CH14] |
| Annex-C | Sales annex of the monthly return auto-filled from the POS invoices | 150R(5) [A, CH14] |
| Card/QR payment | FBR may require card/QR payment at every sale point | 150R(7) [A, CH14] |
| CCTV | FBR may require CCTV at each POS, kept ≥ 1 month | 150R(8) [A, CH14] |
| Every supply | Real-time verifiable invoice for every supply incl. exempt items; debit/credit notes issued electronically | 150S [A, BOOK]; FAQ |
| Offline | Invoices issued during internet/power failure marked **"offline mode"**, uploaded within **24 h**; operational failure reported within 24 h | 150XC, 150XA [A, BOOK] ⚠ rule numbering after S.R.O. 69(I)/2025 to re-check |
| Licensed integrator | Integration only through a **licensed integrator**; licence needs e.g. Rs 10m paid-up capital, P@SHA/ICAP/PSEB cert, 3 yrs audited accounts; PRAL is a free integrator providing the fiscal component | 150XE, 150XF, 150XH [A, BOOK] ⚠ confirm current criteria in CH14 |
| Income-tax licence | Integrators need a 5-year non-transferable FBR licence (P@SHA + PSEB registration, 3 yrs returns); in-house POS may get a non-replicable licence | rules 33H–33M [A, S428] |
| Signboard | "Integrated with FBR" display at the outlet | [A, BOOK] |
| Penalties | Non-integrated period: input tax cut by 60% (s.8B(6)); failure to integrate Rs 500k/1m/2m/3m + sealing (s.33 sr.25A); suppressing reported sales Rs 500k or 200% of tax + prosecution, abetting software vendor up to 1 yr + Rs 200k (s.33 sr.24) | [A, STA] |
| Re 1 POS fee | Re 1 per invoice issued via integrated POS, collected from the customer, deposited with the monthly return (own row, separate head of account) | [A, S1279], [A, OP1006] |
| Prize scheme | FBR draw on POS invoices (Ch. XIV-AC); invoice must print the "Verify … Tax Asaan / SMS 9966" line | [A, LEG], [A, S1006] |

**Technical path (PRAL fiscal component)** [A, AJKTD]; [S, FBRTD]: Windows service installed on the POS machine, local HTTP
`http://localhost:8524/api/IMSFiscal/GetInvoiceNumberByModel`; POS posts invoice JSON, gets back the fiscal invoice no.
synchronously, the component uploads to FBR/AJK in the background (so it works through short internet gaps). Separate
sandbox and production. A cloud REST option also exists (AJK sandbox `https://gw.fbr.gov.pk/ajkposdsandbox/v1/postinvoicedata`,
production `…/ajkposd/v1/postinvoicedata`, bearer token from IRIS-AJK "POS Clients"). QR: version 2.0 (25×25),
0.7–1.0 inch [S, FBRTD]; S1006 says 7×7 mm [A]. ⚠ The federal FBR spec is only available as a forum copy; ask PRAL for
the current federal document and sandbox token.

**Invoice JSON (AJK v1.0, same shape as FBR)** [A, AJKTD]: header `InvoiceNumber` (blank on request), `POSID` (bigint,
POS registration no.), `USIN` (our own invoice no.), `RefUSIN` (original invoice for returns), `DateTime`, `BuyerName`,
`BuyerNTN`, `BuyerCNIC`, `BuyerPhoneNumber` (optional), `TotalSaleValue`, `TotalTaxCharged`, `TotalQuantity`, `Discount`,
`FurtherTax`, `TotalBillAmount`, `PaymentMode` (1 Cash, 2 Card, 3 Gift voucher, 4 Loyalty card, 5 Mixed, 6 Cheque),
`InvoiceType` (1 New, 2 Debit, 3 Credit). Items: `ItemCode`, `ItemName`, `PCTCode` (≤ 8 chars, Pakistan Customs Tariff),
`Quantity`, `TaxRate`, `SaleValue`, `Discount`, `FurtherTax`, `TaxCharged`, `TotalAmount`, `InvoiceType` (1 New, 3 Credit,
11 3rd-Schedule new, 12 3rd-Schedule credit), `RefUSIN`. Response e.g. `{"…InvoiceNumber": …, "Response": "Invoice received successfully", "Code": "100"}`.

## 3. Required invoice content

**S.R.O. 1006(I)/2021** (minimum, every integrated POS invoice) [A, S1006]:
- Business: name/brand, full address, STRN and NTN, tax office, unique POS registration no.
- Invoice: unique sequential invoice no. (our own, per rule 150ZEB(5) [A, OP1006]), date and time, payment mode;
  buyer name optional for B2C, **recorded when the customer is liable for tax/credit or invoice > Rs 100,000**.
- Lines: description, unit price **exclusive of tax**, tax rate per item (**0% if exempt**), quantity, tax amount;
  totals: sale value, tax, discounts, **POS service fee Re 1**, total payable, amount received.
- FBR: fiscal invoice no. (format `XXXXXX-DDMMYYHHMMSS-0001`, 18 digits per [A, OP1006]), FBR POS logo, 7×7 mm QR,
  "Verify this invoice through FBR Tax Asaan Mobile App or SMS at 9966 and win exciting prizes in draw".
- FBR issued two clarifications on how discount is shown (2021, 17.03.2022) [A, LEG] ⚠ not yet read (PDF did not extract).

**Rule 150R(13)** adds for general e-invoices: recipient details, tax period, HS code, unit of measure, ST withheld,
extra tax, further tax, FED, SRO/serial no.; several of these are waived for retailers selling to the general public
(except manufacturer-/importer-retailers) [A, BOOK]. **STA s.23**: serially numbered, Urdu or English, one invoice per supply [A, STA].

## 4. Rates and schedules (federal goods)

| Rule | Finding | Source |
|---|---|---|
| Standard rate | 18% of value of supply | STA s.3(1) [A] |
| Further tax | Extra 4% on supplies to unregistered/inactive persons | STA s.3(1A) [A] ⚠ whether a Tier-1 retailer selling to end consumers charges it — the POS spec has the field; FBR practice for B2C retail to confirm |
| Third Schedule | Taxed at 18% of the **printed retail price** (tax-inclusive MRP); items include juices, ice cream, aerated waters, syrups, cigarettes, toilet soap, detergents, shampoo, toothpaste, shaving cream, cosmetics, tea, powder/milky drinks, tissue paper, branded packed spices, shoe polish, retail-packed cement, bottled water, household electrical/gas appliances, mattresses, paints… | STA s.3(2)(a), Third Schedule [A] |
| Exempt (Sixth) | e.g. pulses; red chillies, ginger, turmeric not under brand names; rice, wheat, wheat and meslin flour; Holy Quran; newsprint/books | Sixth Schedule Table-1 [A] ⚠ milk, eggs, fresh vegetables etc. — check exact current entries; list changes every Finance Act |
| Reduced (Eighth) | Some goods at reduced rates | Eighth Schedule [A] — not mapped item by item yet |
| Return due date | Statute: 15th of the following month, Board may notify other dates per annex | STA s.2(9) [A] ⚠ the 18th date commonly used is by notification — confirm |
| Tax period | One month | STA s.2(43) [A] |
| Records | Keep 6 years | STA s.24 [A] |
| Old FAQ | Shows 17% and textile 14% — outdated | FAQ ⚠ |

## 5. Returns, debit and credit notes

- Output tax adjusted by debit/credit note when supply is cancelled, goods returned or price changes, STA s.9 [A].
- Integrated retailer: returns go through the POS (credit invoice linked to the original via `RefUSIN`, `InvoiceType` 3
  or 12 for Third Schedule) [A, AJKTD]; otherwise Annex-I debit/credit notes; Annex-C entries cannot be deleted [A, FAQ].
- No editing or deleting an issued invoice; cancellation = logged credit note (150R(4)(g)) [A, CH14].

## 6. Provincial sales tax on services

Retail sale of **goods** is federal (STA). Provinces tax **services** (restaurants, salons, etc.) and run their own POS
schemes using the same PRAL-style component or their own APIs:
- Punjab PRA: local fiscal device `localhost:8524/api/IMSFiscal/GetInvoiceNumberByModel`, QR encodes the PRA verify URL [A, PRA].
- Sindh SRB: POS integration for listed restaurant categories; integrated restaurants pay 15% with credit notes for returns [S, SRB].
- KP KPRA: RIMS API for restaurants (NTN, POS ID, key, invoice no., amounts, tax, timestamp; QR to kpra.gov.pk) [A, KPRA].
- Balochistan BRA: ⚠ not researched (site not found in search).
→ A kiryana/goods shop normally has no provincial POS duty. Only relevant if a customer runs a restaurant/bakery-café
or a service counter ⚠ confirm with adviser per shop.

## 7. Azad Jammu & Kashmir

- AJK applies the Sales Tax Act 1990 as adapted by AJK Act IV of 1993; administered by AJK Inland Revenue Department
  (CBR AJ&K); services under AJK Sales Tax (Tax on Services) Act 2001 [S, AJK] ⚠ site blocks fetch; get the adapted text.
- AJK Tier-1 POS integration runs through PRAL: register each POS per branch on IRIS-AJK, get a POS registration no.,
  install the AJK fiscal component (same port 8524 API) or use the cloud API; invoice JSON as in section 2 [A, AJKTD].
- AJK site lists the Tier-1 electricity test as **Rs 600,000** [S, AJK] ⚠ differs from Pakistan's Rs 1.2m; confirm which
  AJK rates, thresholds, Re 1 fee, invoice format (FBR logo vs AJK-IRD) and return dates apply.
- APP reported AJK IRD launching POS invoicing in Mirpur [S].

## 8. What the current Lite app has (gap analysis)

| Area | Today (inherited from P1) | Needed for Tier-1 / AJK |
|---|---|---|
| Store tax profile | `settings.sales_tax_enabled` + one `sales_tax_rate_bp` | Profile: *not registered* / *non-Tier-1 (electricity bill)* / *Tier-1 integrated*; jurisdiction FBR or AJK-IRD; NTN, STRN, tax office, business name/address |
| Tax screen | Owner picks period (From/To by Pakistan FY Jul–Jun) + Rate %, tax computed from sales totals | Keep for non-Tier-1 (owner estimate only). Tier-1: tax per line at sale time, period reports from issued invoices |
| Product data | No tax fields per product | PCT/HS code (8), tax class (standard 18 / Third Schedule MRP / exempt Sixth / reduced Eighth + rate), MRP for Third Schedule, unit of measure |
| Pricing | Prices tax-inclusive, tax backed out on totals | Per-line exclusive value + tax + rate; Third Schedule tax on retail price; rounding per line to paisa, invoice total rule ⚠ |
| Sale lines | `sale_lines.tax_rate_bp`, `tax_paisa` exist | Add PCT, tax class, sale value excl., further tax, line discount |
| Bill numbers | Per-till sequence planned (`T2-000123`) | Fine as USIN; add per-till `POSID` (FBR registration per POS) |
| Authority link | `tax_documents` queue + simulate adapter, statuses queued/accepted/rejected/authority_down/credit_note | Real adapter to PRAL fiscal component (localhost:8524) or cloud API; store FBR invoice no. + response; offline mark + 24 h upload alarm |
| Receipt | Shop name, lines, totals | SRO 1006 layout: STRN/NTN, tax office, POS no., per-line rate/tax, Re 1 fee, received, FBR no., logo, QR, verify text, "offline mode" mark |
| Returns | P1 returns/refunds | Credit invoice with `RefUSIN`, type 3/12, same POS rules |
| Immutability | Voids/replacements exist | No delete/edit after issue; audit log for every adjust/cancel; day/week/month closing records |
| Buyer | Customer record | Buyer name/NTN/CNIC capture; required > Rs 100,000 or B2B credit |
| Re 1 fee | none | Separate line, not part of sale value, own report row |
| Reports | Tax screen, Excel/PDF exports | Monthly sales-tax summary (Annex-C style) by rate/class, Re 1 fee total, credit notes, offline invoices; Excel/PDF |
| Retention | Backups | 6-year retention, no purge of invoices/logs |
| Multi-till | Tills slice planned | Each till = registered POS; fiscal component placement (see conflict below) |

**Conflicts to decide**
1. *Offline vs real-time.* Lite is LAN-only. Integrated Tier-1 shops need FBR reporting; the PRAL component queues and
   uploads, and offline-mode invoices must reach FBR within 24 h. So a Tier-1 shop needs internet on the main PC at least daily.
2. *Fiscal component per POS.* The component "resides on the same system where the POS is installed" [A, AJKTD]. With
   tills as thin clients, either install it on each till PC (one POSID each) or route all tills through the main PC.
   ⚠ Ask PRAL whether one component can serve several POSIDs on a LAN.
3. *Licensed integrator.* Selling an integrated POS to other shops requires Sturer (or a partner) to hold an FBR
   integrator licence, or shops use PRAL as their integrator with our software ⚠ business/legal decision.

## 9. Proposed phases (after Asim approves; each is a slice in PLAN.md)

| Phase | Scope |
|---|---|
| T0 — Confirm | Adviser + PRAL/AJK-IRD answers to the ⚠ list; obtain federal + AJK sandbox credentials; decide integrator route |
| T1 — Tax data model | Store tax profile (none / electricity-bill / Tier-1; FBR or AJK), product PCT + tax class + MRP, per-line tax engine (exclusive/inclusive, Third Schedule, exempt 0%, rounding), Settings screens; non-Tier-1 shops keep today's simple Tax screen |
| T2 — Invoice and receipt | SRO 1006 receipt layout, Re 1 fee line, buyer NTN/CNIC capture, immutable invoices + audit log, day/week/month closing, credit notes linked to original |
| T3 — FBR/AJK adapter (sandbox) | Adapter to the local fiscal component and cloud API, per-till POSID, FBR no. + QR on receipt, offline-mode mark, 24 h upload watchdog + owner alert, retries, reconciliation report |
| T4 — Reports | Monthly sales-tax summary (Annex-C style), by rate/class, Re 1 fee, credit notes, offline invoices; Excel/PDF; 6-year retention rules |
| T5 — Pilot | One Tier-1 store in production after integrator licence/PRAL route is settled |
| Later (P3 Pro) | Same engine for Pro; provincial services POS (PRA/SRB/KPRA) only if Pro targets restaurants |

## 10. Questions for Asim

1. Target shops: mostly small kiryana (electricity-bill regime, no FBR link) or also Tier-1 stores? This decides whether T3 is needed in Lite v1.
2. AJK or Pakistan first for the integrated version?
3. Integrator route: apply for an FBR integrator licence (capital, P@SHA/PSEB, audited accounts) or rely on PRAL as the free integrator?
4. Do you have a tax adviser we can send the ⚠ list to? (Draft questions are the ⚠ items above.)
5. Is a daily internet connection on the main PC acceptable for Tier-1 shops?
6. Should prices on screen stay tax-inclusive (shelf price) with tax backed out per line? (Needed for Third Schedule MRP items.)
7. Any shop selling restaurant/services items (provincial tax), or goods only?
