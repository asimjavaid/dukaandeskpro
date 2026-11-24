# DukaanDesk Pro — FBR / AJK POS integration: licence, PRAL route, offline design

Researched 2026-11-03 (PKT). Companion to `TAX-RESEARCH.md`. **No tax adviser reviewed this** (Asim confirmed none is
available). Confidence: **High** = read in the official rule/notification text; **Med** = official FAQ/portal manual or
consistent reputable source; **Low/⚠** = inference or unverified, confirm with FBR/PRAL/AJK-IRD in writing before relying on it.

Decisions from Asim (2026-11-03): P1 = small kiryana (no FBR link). **P2 Lite = Tier-1 retail stores**, goods only, both
**Pakistan (FBR)** and **AJK (AJK-IRD)**. Main PC may have **no internet**. Shelf prices stay tax-inclusive, tax shown on invoice.

## Sources (all accessed 2026-11-03)

| Id | Source | URL |
|---|---|---|
| CH14 | Sales Tax Rules Ch. XIV, substituted by S.R.O. 69(I)/2025 (29.01.2025) | https://download1.fbr.gov.pk/SROs/2025129141598258SRO69%28I%292025.pdf , text copy https://download1.fbr.gov.pk/Docs/2025571554338577ChapterXIV.pdf |
| BOOK | FBR POS Booklet (legal provisions) 2025 | https://download1.fbr.gov.pk/Docs/202551615541769POSBooklet.pdf |
| LIST | FBR "List of License Integrators" | https://fbr.gov.pk/list-of-license-interprator/173967/173971 |
| LCOM | FBR Licensing Committee page (notifications up to 23.02.2026); committee notification 06.10.2025 | https://www.fbr.gov.pk/fbr-licensing-committee/173967/173977 , https://download1.fbr.gov.pk/Docs/202510715104943894NotificationforcommitteetoevaluateapllicationsforLicenseIntegrators.pdf |
| DIFAQ | FBR Digital Invoicing FAQs | https://www.fbr.gov.pk/faqs/173967/173969 |
| DIMAN | FBR Digital Invoicing User Manual v1.5 | https://download1.fbr.gov.pk/Docs/20257301171649798DIUserManualV1.5.pdf |
| DISPEC | FBR DI technical spec 1.2.3 (POS client registration on e.fbr.gov.pk, cloud API, IP whitelisting) | https://download1.fbr.gov.pk/Docs/202441821416329TechnicalSpecificationDigitalInvoicing1.2.3.pdf |
| S428 | S.R.O. 428(I)/2024 Income Tax Rules Ch. VIIA (integration, licensing) | https://download1.fbr.gov.pk/SROs/2024322153582988SRO-428.pdf |
| KPMG | KPMG Tax Alert Mar 2026: draft S.R.O. 288(I)/2026 (18.02.2026) re-writing Income Tax Rules Ch. VIIA — draft, not in force | https://assets.kpmg.com/content/dam/kpmgsites/pk/pdf/2026/03/Tax-Alert.pdf.coredownload.inline.pdf |
| S1279 / OP1006 | Re 1 POS fee; SRO 1006 operationalization | see TAX-RESEARCH.md |
| S2071 | S.R.O. 2071(I)/2025 (03.11.2025) | https://download1.fbr.gov.pk/SROs/202511413114246831SRO2071(1).pdf |
| AJKTD | PRAL AJK POS technical document v1.0 (07.02.2025) | https://e.fbr.gov.pk/SOP/AJK/AJK_POS_Technical_Document.pdf |
| AJK | CBR AJ&K sales tax page (search snippet; site blocks fetch) | https://ird.ajk.gov.pk/sales-tax-2/ |
| FBRTD | FBR knowledge-base fiscal component spec (forum copy) [secondary] | https://forum.sambapos.com/uploads/short-url/XSMFnYCsTOJs1Nib2O2MNLTbUk.pdf |

## 1. Does Sturer need an FBR integrator licence?

**Short answer: not to start.** Sturer can sell DukaanDesk Pro as the *POS software* while the retailer uses **PRAL as
its licensed integrator** (free). A licence is needed only if Sturer itself wants to perform/charge for integration.

| Finding | Confidence | Source |
|---|---|---|
| Notified registered persons (incl. Tier-1 retailers) must integrate every POS/payment counter "through the licensed integrator" | High | CH14 r.150XE(3) |
| "Save as provided in rule 150XF, no person shall carry out integration … through software unless he has obtained a license" | High | CH14 r.150XE(1) |
| **PRAL is a licensed integrator by rule** and "shall provide free of cost integration services to the registered persons on demand" | High | CH14 r.150XF(1),(2) |
| Taxpayer may install **any** e-invoicing/POS software and integrate it through a licensed integrator; PRAL is free, others charge | Med | DIFAQ Q6, Q11; DIMAN §4.1 |
| On the IRIS/DI portal the taxpayer picks "Proceed with PRAL as Licensed Integrator" and enters **ERP/System Provider**, software type (cloud/on-premises), version, technical contact | Med | DIMAN §4.1.1 |
| AJK POS registration asks for **Software Vendor Information** for the software integrated with POS | Med | AJKTD §6 |
| "Only a licensed integrator … can configure a registered person's e-invoicing software" | Med | DIFAQ Q12 |
| ⚠ How Q12 applies when PRAL is the integrator and the vendor (Sturer) installs the software: our reading is that PRAL issues the POS registration/token to the retailer and Sturer only installs software built to PRAL's spec. **Confirm in writing with PRAL** (contacts on LIST: mehboob.rehman@pral.com.pk, adeel.abbasi@pral.com.pk) | Low ⚠ | inference |

**Licence process (if Sturer applies later)** — CH14 r.150XH–150XO (High):
- Apply in duplicate to the Board (FBR, Member Digital Initiatives / licensing committee, notified 06.10.2025, latest 23.02.2026 — LCOM).
- Documents: company profile; managerial/technical staff with qualifications; employee count; proof of ERP and payment-system
  integration capability; **P@SHA or ICAP registration certificate**; **audited accounts for last 3 financial years**; major
  clients; **incorporation certificate (Companies Act)**; NTN; **paid-up capital ≥ Rs 10 million** (latest year); sales tax
  registration if required; directors' CNICs; no-blacklisting/no-fraud undertaking; projects of last 3 years; anything else FBR asks.
- Timeline in the rules: eligibility check within 7 days, recommend/reject within 15 days; licence granted with Board approval;
  valid **5 years**, non-transferable, no sub-contracting; renewal applied 3 months before expiry. ⚠ Real timelines unknown;
  the Oct 2025 committee ToR also mentions preparing an "RFP as per new rules" (LCOM), so the intake format may change.
- Income-tax side: S428 r.33H–33M needs PSEB + P@SHA registration, 3 years' returns; a sales-tax licensee is treated as
  licensed for income tax (r.33H(5)). A full re-write is in draft (S.R.O. 288(I)/2026, KPMG) — not yet in force ⚠.
- Fees: **no fee payable to FBR** by retailer or integrator (DIFAQ Q8, Med). Licensee may charge the retailer for
  configuration/integration **up to a cap set by a Sales Tax General Order** (r.150XO) — ⚠ no such STGO found; cap unknown.
- Obligations: post-deployment maintenance, bug fixes, immediate troubleshooting, secure real-time capture to FBR at all
  times (r.150XL); suspension/cancellation for poor service or contraventions (r.150XN); s.33 penalties apply to
  integrators (DIFAQ Q14). Existing list: PRAL, Haball, WebDNAworks, EY Ford Rhodes, OpenPort, TMR, Naturetech, Dynamic Resources (LIST).
- ⚠ Security/audit certification: rules require digital signature, encryption, irrevocable storage, logs (r.150R(4)), technical
  audit "as instructed by the Board" (r.150U(2)) and possible committee site visits (r.150XI(2)); no published certification standard found.

**Who pays what** (High unless noted): retailer bears all hardware/software/integration costs (draft IT rules say so explicitly —
KPMG, Med); PRAL integration free; customer pays the **Re 1 POS fee** per invoice, retailer deposits it with the monthly return
(S1279, OP1006); retailer pays nothing to FBR for integration (DIFAQ Q8). Sturer pays nothing unless it seeks a licence.

**Sturer's current eligibility:** a licence needs a company with Rs 10m paid-up capital and 3 years of audited accounts —
⚠ Asim to check whether Sturer meets this today; if not, the PRAL route is the only option for now.

## 2. Licensed integrator vs not

| Being licensed (own licence) | Not licensed (retailer uses PRAL) |
|---|---|
| Sturer can configure/integrate on its own, appear on FBR's list (marketing signal) | Zero licence cost, start now |
| May charge an integration fee (capped by STGO) | Sturer cannot charge for "integration" as such; sells software, setup and support |
| Direct relationship/escalation with FBR | Retailer owns the PRAL registration; Sturer helps |
| Cost: Rs 10m paid-up capital, audits, P@SHA, renewals, legal exposure under s.33, service obligations, possible suspension | Dependent on PRAL support and its component/API |

## 3. PRAL free route — cons and limits

| Topic | Finding | Confidence |
|---|---|---|
| Where it runs | Local fiscal component "will reside on the same system where the POS is installed"; Windows service at `localhost:8524` | High (AJKTD; FBRTD) |
| Internet | Needed to **install** the component (AJKTD §3) and to upload; invoice number is returned locally in real time and data is uploaded "periodically … through an independent process" | High for wording; ⚠ Med that numbering works fully offline |
| Cloud option | Cloud API instead of component; needs internet per invoice and **IP whitelisting** of the server (static IP) | Med (DISPEC, DIMAN) |
| Multi-till | Each POS is registered and gets its own POSID; `POSID` is a per-invoice field, so one component may serve several POSIDs | ⚠ Low — confirm with PRAL; else install a component on each till PC |
| Branding/UX | Receipt must carry the FBR (or AJK-IRD) POS logo, QR and verify text; we control the rest of the UI | High (S1006) |
| Support/SLA | PRAL is free; no SLA published for retailers; support via CRM/complaints | Med (DIMAN); ⚠ no SLA found |
| Speed | AJK doc claims "99.9% uptime, millisecond responses" (marketing text) | Low |
| Platform | Windows-only component (`services.msc`) — fine for our Windows installer | Med (FBRTD) |
| Data control | Component keeps its own store and uploads on its own schedule; we see only its response, not upload status ⚠ | Low |
| Dependence | Spec/endpoint changes come from PRAL; we must follow updates; closed component inside our install | Med |
| Licence of component | We cannot bundle/redistribute it unless PRAL allows; retailer downloads from FBR/AJK site ⚠ | Low |

## 4. AJK route

- AJK-IRD runs Tier-1 POS integration through **PRAL** (document authored by PRAL): register each POS per branch on
  **IRIS-AJK** (`https://iris.ajkird.gov.pk/public/txplogin.xhtml`), get POS registration no., then fiscal component
  (same `localhost:8524` API) or cloud API (sandbox `https://gw.fbr.gov.pk/ajkposdsandbox/v1/postinvoicedata`, production
  `https://gw.fbr.gov.pk/ajkposd/v1/postinvoicedata`), token from IRIS-AJK "API MGT". High (AJKTD).
- AJK Tier-1 definition on the CBR AJ&K site: chain store unit, AC mall/plaza, **electricity bill > Rs 600,000** (12 months),
  wholesaler-cum-retailer (AJK snippet, Med). No card-POS or 236G/H clauses shown ⚠.
- ⚠ Unverified for AJK: a licensed-integrator rule equivalent to r.150XE, any integration fee, the Re 1 fee, offline 24 h rule,
  invoice logo/format, return dates. Email AJK-IRD and PRAL to confirm.

## 5. Offline design (main PC may have no internet)

**What the rules allow** (High, CH14): POS must transmit invoice data and receive the FBR number (r.150R(4)(c)); invoices made
"during any period of failure … including disruption caused by internet or power failure" must be marked **offline mode** and
uploaded **within 24 hours of restoration** (r.150XC); operational failure/inoperative system reported within 24 h (r.150XA);
no supply except through integrated POS (r.150R(3)).
**Implication:** offline mode covers *interruptions*. A Tier-1 shop with **no internet at all, permanently, is not compliant**
(⚠ our reading). The design must assume internet is *available at least intermittently* (4G dongle/phone hotspot is enough).
**USB/manual upload:** no official manual or file-upload route for POS invoices was found ⚠ — do not rely on it.

**Recommended design**
1. **Fiscalize on the main PC** (server side). The Lite server owns the only link to PRAL: one fiscal component on the main PC
   (or the cloud API), each till's own POSID in the payload. Fallback if PRAL says one component = one POSID: component on each
   till PC, called by the till app, server keeps the queue. ⚠ confirm with PRAL.
2. **Store-and-forward queue** in PostgreSQL (`tax_documents`): every sale gets our USIN at once; server requests the fiscal
   number; if the component/API is unreachable the receipt prints **"OFFLINE MODE"** with our number and the invoice stays queued;
   when the link returns the queue is sent oldest first, the FBR number stored, and a reprint/QR available on demand.
3. **Uplink options** for a shop without fixed internet: plug a 4G USB dongle or share a phone hotspot to the **main PC** for a few
   minutes; "Sync now" button shows progress. (Any-PC relay or USB carry is **not** recommended until FBR confirms a route.)
4. **Alerts:** banner on all tills + owner screen when the oldest unsent invoice is > 12 h; red alert and manager/owner
   notification at **> 20 h**; log of offline periods for the r.150XA 24 h failure report (one-click Excel/PDF of the period).
5. **Block selling?** Default: **do not hard-block** (rules do not require it, and a blocked shop loses sales); configurable
   policy for the owner: block new sales when oldest unsent > N hours (default off, manager override logged). ⚠ revisit after FBR answer.
6. Day close refuses to finish while invoices are unsent unless a manager confirms (logged).
7. Immutable invoices, signed hash chain per till, 6-year retention (r.150R(4)(d),(g), 150S).

**Confirm with FBR/PRAL/AJK-IRD:** does the fiscal component issue a valid FBR number offline; can one component serve several
POSIDs; is a permanently offline shop allowed (e.g., remote AJK areas); any manual upload route; whether intermittent upload
(e.g., daily) is acceptable when the internet is not "failed" but absent.

## 6. Recommended path and steps for Asim

**Recommendation: start on the PRAL route (no licence), build to PRAL spec, reassess a licence after ~25 integrated stores
or if PRAL support blocks us.** Cost/benefit: PRAL = Rs 0 and weeks; licence = Rs 10m paid-up capital + audits + P@SHA +
5-year obligations and s.33 exposure, for the main benefit of charging an integration fee and being on FBR's list.

Steps:
1. **Email PRAL** (addresses on FBR list; draft below) asking the ⚠ questions in §1 and §5, and for current federal POS fiscal
   component spec + sandbox token for a software vendor.
2. **Email AJK-IRD** (via ird.ajk.gov.pk contact) with the AJK ⚠ questions in §4.
3. Find **one pilot Tier-1 store** (PK or AJK) willing to register its POS on IRIS (it must be sales-tax registered with an
   IRIS login); Sturer sets up DukaanDesk Pro, the retailer selects PRAL as integrator.
4. Get **sandbox credentials** (federal via e.fbr.gov.pk/IRIS POS client registration; AJK via IRIS-AJK API MGT), and we build T3 against them.
5. Check Sturer's company status (incorporated? paid-up capital? P@SHA? audited accounts?) to know if a licence is even possible later.
6. Keep records of all FBR/PRAL replies in `docs/` — they replace a tax adviser's sign-off.

Draft email to PRAL (for Asim to send; not sent):
> To: mehboob.rehman@pral.com.pk; adeel.abbasi@pral.com.pk — Subject: POS software vendor – Tier-1 integration via PRAL (FBR and AJK)
> We develop DukaanDesk Pro, a Windows multi-till POS for Tier-1 retailers in Pakistan and AJK. Our customers will choose PRAL as
> licensed integrator. Please confirm: (1) a non-licensed software vendor may supply the POS software when the retailer integrates
> through PRAL; (2) one fiscal component on the shop's main PC may serve several registered POSIDs over the LAN; (3) the component
> issues valid fiscal invoice numbers while offline and uploads later; (4) acceptable practice for shops with intermittent internet
> under rule 150XC; (5) the current federal technical document and sandbox access for vendors; (6) whether the same applies for AJK-IRD.
