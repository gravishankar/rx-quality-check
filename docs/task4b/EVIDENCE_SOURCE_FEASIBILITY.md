# Evidence Source Feasibility Report (Task 4B)

Research date 2026-11-12. **Verified** = observed live from this environment (probe:
`docs/research/task4b/probe.ts`, results `probe-results.json`). **Documented** = stated by the
official source page (read via web search; the build environment's network policy blocks
fda.gov / accessdata.fda.gov / datadashboard.fda.gov, so these pages could not be fetched directly).
**Unverified** = third-party or not confirmed. FDA-produced data are U.S. Government works and
generally not subject to copyright; each source's own terms and disclaimers still apply and must be
reviewed by counsel before display (`docs/LEGAL_REGULATORY_REVIEW.md` §10).

## Summary

| Need | Best first-party source | Reachable by the app today | Identifier | Verdict |
|---|---|---|---|---|
| NDC / product identity | openFDA NDC Directory | **Yes** (api.fda.gov) | product/package NDC, SPL set ID, application no. | In use |
| Labeling & establishments | DailyMed SPL XML | **Yes** (dailymed.nlm.nih.gov) | SPL set ID; establishment **DUNS** | Feasible on device |
| Labeler ↔ repackager | SPL `asEquivalentEntity` + NDC Directory `is_original_packager` | **Yes** | source product NDC | In use for recalls |
| Application holder / AG | openFDA Drugs@FDA | **Yes** (api.fda.gov) | application number | Feasible |
| DUNS ↔ FEI crosswalk | FDA DECRS download (zip) | No (accessdata.fda.gov) | DUNS + FEI | Build-time only |
| Inspection classifications | FDA Data Dashboard | No (key-gated API / downloads) | **FEI** | Build-time only |
| Warning letters, seizures, injunctions | Data Dashboard compliance actions; FDA warning-letter index | No | FEI (compliance actions); firm name (letters) | Build-time only |
| Import alerts | FDA Import Alert pages (accessdata) | No; HTML only | firm name/address (FEI unverified) | Not now |
| Recalls | openFDA Enforcement Reports | **Yes** | recall number; product NDC (openfda block); recalling firm | In use |

## 1. NDC and medication identity — openFDA NDC Directory

- **Fields (verified):** `product_ndc`, `packaging[].package_ndc`, `generic_name`, `brand_name`,
  `labeler_name`, `dosage_form`, `route`, `active_ingredients[{name,strength}]`, `application_number`,
  `marketing_category`, `finished`, `openfda.spl_set_id`, `openfda.is_original_packager`,
  `openfda.rxcui`, `pharm_class`.
- **Identifier compatibility:** NDC ↔ SPL set ID ↔ application number (direct). No DUNS/FEI.
- **Update frequency:** `meta.last_updated` (2026-11-11 at Task 3; Drugs@FDA 2026-11-10 in this probe).
- **Missing:** manufacturing sites; `is_original_packager` absent for some products (OD-17).
- **Attribution/licensing:** openFDA terms and CC0 dedication with attribution requested; openFDA
  states its data are not validated for clinical use. ([terms](https://open.fda.gov/terms/),
  [license](https://open.fda.gov/license/))

## 2. Structured Product Labeling — DailyMed SPL XML

- **Fields (verified):** establishment name, **DUNS** (OID 1.3.6.1.4.1.519.1; present for 62/62
  establishments sampled), operations by NCI code with displayName, product NDCs, `asEquivalentEntity`
  source NDCs.
- **Operation codes (verified 2026-11-12):** C43360 MANUFACTURE (36), C25391 ANALYSIS (28), C73606 REPACK
  (20), C84731 PACK (14), C73607 RELABEL (12), C84732 LABEL (10), **C82401 "api manufacture" (5)**,
  **C84382 "STERILIZE" (2)**. Document A's C43215 was not observed.
- **Sample (65 labels, 14 catalog drugs, ≤3 original + ≤2 repackager labels per drug):**

  | Label type | n | 0 MANUFACTURE | 1 | 2 | 3 | No establishment section | Declares source NDC |
  |---|---|---|---|---|---|---|---|
  | Original packager | 39 | 8 | 27 | 3 | 1 | 13 (incl. repackagers) | — |
  | Repackager | 26 | 26 | 0 | 0 | 0 | | **26** |

  Multi-plant examples: Zydus losartan 65841-730 (3 sites), Aurobindo losartan 65862-201 (2),
  Biocon rosuvastatin 70377-008 (contract site Recipharm + Biocon; plus API site), NorthStar furosemide
  72603-474 (Emcure + Maiva). No-manufacturer examples: Apotex Corp. atorvastatin 60505-2578, Viatris
  Specialty amlodipine 58151-355, GSMS amlodipine 51407-950 (no establishment section at all).
- **Update frequency:** per label version (SPL `effectiveTime`/version); DailyMed updates daily.
- **Missing:** which site made a given lot; FEI; whether a listed site is active; labels may omit
  establishments.
- **Attribution/licensing:** NLM DailyMed terms; content is manufacturer-submitted labeling.
  ([about DailyMed](https://dailymed.nlm.nih.gov/dailymed/about-dailymed.cfm))

## 3. Manufacturer, labeler, repackager relationships

- **Labeler** = NDC Directory `labeler_name` (company named in the listing; not necessarily the maker).
- **Repackager → source:** SPL `asEquivalentEntity` (26/26 sampled) — sometimes several source NDCs
  (e.g., Asclemed 76420-946 declares 4 source product NDCs, 67877-511 to 67877-514), so the specific source can be ambiguous.
- **Application holder:** openFDA Drugs@FDA `sponsor_name` by `application_number` (25/25 resolved; e.g.,
  ANDA090548 → APOTEX INC, while the NDC labeler is Apotex Corp. and its SPL lists no site).
- **Missing:** corporate parent/affiliate relationships (no first-party structured source found).

## 4. Candidate manufacturing facilities

- **Source:** SPL establishments with MANUFACTURE (and API manufacture) operations, of the label or —
  for repackagers — of the declared source label(s).
- **What it supports:** "facilities listed in the labeling for this product". It does **not** support
  "your bottle was made at X" (multi-plant labels; dormant sites may remain listed per Document A §3,
  unverified) and cannot be narrowed by imprint (A §1.1).
- **Lot-to-factory:** no public source. **Not implemented, by decision.**

## 5. FDA inspection classifications — FDA Data Dashboard

- **Documented:** API at `https://api-datadashboard.fda.gov/v1/inspections_classifications` (POST),
  fields include `FEINumber`, legal name, country, inspection end date, project area, classification
  (NAI / VAI / OAI); authorization requires an `Authorization-User` / `Authorization-Key` issued per
  requester via FDA's OII Unified Logon ([API docs](https://datadashboard.fda.gov/oii/api/index.htm),
  [field definitions](https://datadashboard.fda.gov/oii/api/api-definitions-inspections.htm)). Full
  dataset downloads are offered on the dashboard.
- **Update frequency (documented):** weekly; final classifications only; letters typically follow
  inspection close by ~45–90 days; inspections awaiting final enforcement action, state inspections,
  pre-approval inspections are excluded ([Inspections](https://datadashboard.fda.gov/oii/cd/inspections.htm),
  [Classification Database](https://www.fda.gov/ICECI/Inspections/ucm222557.htm)). FDA notes OAI does
  not by itself mean an enforcement action follows ([FSER](https://datadashboard.fda.gov/oii/fd/fser.htm)).
- **Identifier compatibility:** FEI only → requires DUNS→FEI (DECRS) from SPL DUNS.
- **Missing:** pending/recent inspections; which product line was inspected (project area is broad).
- **Restrictions:** per-user API key cannot be embedded in a public app (it is a credential) → use
  downloads in a build-time snapshot (OD-25). Terms/disclaimer text: not retrieved — counsel to review.

## 6. Warning letters

- **Documented:** Data Dashboard compliance actions (`/v1/compliance_actions`): warning letters,
  seizures, injunctions; **FEINumber** field; finalized actions only; weekly; one action may map to
  several establishments ([definitions](https://datadashboard.fda.gov/oii/api/api-definitions-compliance-actions.htm),
  [Compliance Actions](https://datadashboard.fda.gov/oii/cd/complianceactions.htm)). FDA's warning-letter
  index (company, issue date, issuing office, subject; spreadsheet export; data.gov XML record)
  ([data.gov](https://catalog.data.gov/dataset/warning-letters)).
- **Attribution limit:** letters are addressed to a firm (sometimes the corporate parent) — must be shown
  as **company-level** unless the compliance-action FEI matches a candidate facility.

## 7. Import alerts

- **Documented:** Import Alert pages, e.g., 66-40 (drugs, cGMP) "Red List" of firms subject to
  detention without physical examination, HTML only ([66-40](https://www.accessdata.fda.gov/cms_ia/importalert_189.html),
  [list](https://www.accessdata.fda.gov/cms_ia/ialist.html)). No structured feed found; identifier
  (FEI) presence not verified.
- **Verdict:** not now (scraping, name matching, removal dates). Revisit if FDA publishes a structured feed.

## 8. Product recalls — openFDA Enforcement Reports (existing)

- **Fields (verified):** recall number, classification, status, dates, reason, `code_info` (lots),
  `recalling_firm` + address, `openfda.product_ndc`/`application_number`/`manufacturer_name`.
  **No FEI** → a recall cannot be attributed to a facility from this data; it is product-level when the
  record names the product, otherwise company-level ("recalling firm").
- **Unrelated product recalls:** a recall by the same firm for a different product is company-level
  context only and must never change the product's recall result.

## 9. DUNS ↔ FEI — DECRS

- **Documented:** FDA's Drug Establishments Current Registration Site offers a daily zip download of
  registered establishments ([DECRS](https://www.fda.gov/drugs/drug-approvals-and-databases/drug-establishments-current-registration-site));
  third-party descriptions report DUNS and FEI columns (unverified). Excludes outsourcing facilities.
- **Risk:** stale or missing DUNS↔FEI pairs; one DUNS ↔ several FEIs. Links must carry
  `VERIFIED_EXACT_ID` vs `UNMATCHED` status; no name/address fuzzy matching in v1.

## 10. Other sources considered

- **Orange Book data files** (monthly; products, applicant, TE codes) — useful for application/holder
  context, not facilities ([Orange Book files](https://www.fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files)).
- **RxNav ndcproperties** (imprint, color, shape) — verified for 39/40 sampled products; for the imprint
  picker only.
- **ProPublica Rx Inspector** — not a first-party source; contains FOIA-obtained data; licensing not
  reviewed. Not proposed as a data source.
