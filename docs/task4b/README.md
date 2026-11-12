# Task 4B — Medication Provenance, Regulatory Evidence and Scanner-First Proposal

Status: **PROPOSAL FOR REVIEW — nothing implemented.** No application code, APK or branch merge was
changed in Task 4B. Date: 2026-11-12. Branch: `task-4b/provenance-proposal`.

## Documents

| # | Deliverable | File |
|---|---|---|
| 1 | PRD-to-implementation traceability matrix | `TRACEABILITY_MATRIX.md` |
| 2 | Evidence source feasibility report | `EVIDENCE_SOURCE_FEASIBILITY.md` |
| 3 | Proposed data architecture (provenance graph) | `PROVENANCE_DATA_ARCHITECTURE.md` |
| 4 | Patient-facing screen designs (scanner, A, B, C) | `SCREEN_DESIGNS.md` |
| 5 | Scanner technical design and library comparison (revised priority) | `SCANNER_TECHNICAL_DESIGN.md` |
| 6 | Validation scenarios and test specifications | `VALIDATION_SCENARIOS.md` |
| 7 | Risk and privacy assessment | `RISK_AND_PRIVACY.md` |
| — | Live research data (re-verified 2026-11-12) | `../research/task4b/probe-results.json` (+ `probe.ts`) |

## Source documents and a gap you need to close

- **Rx Provenance & Quality Resolution specification** (Document A,
  `docs/references/…Specification.pdf`, SHA-256 `bbede45e…33a2`) — read in full.
- **"Drug Quality Score App PRD (October 22, 2026)" — NOT AVAILABLE.** It is not in the repository,
  its history, or anything uploaded in this project. The traceability matrix therefore covers
  Document A, the project's own `docs/PRD.md`, and your Task 4B instructions; rows that depend on the
  missing PRD are marked **PRD-Q (not reviewed)**. The "seven original PRD scenarios" could not be
  read; `VALIDATION_SCENARIOS.md` uses seven scenarios derived from Document A's use cases plus the
  imprint-conflict scenario, marked **provisional** until you provide the PRD.

## Headline findings (re-verified live where the environment allowed)

1. **Facility candidates are obtainable on the phone, today, from an allowed source.** DailyMed SPL
   labeling lists establishments with DUNS numbers and operations. In 65 live labels for the 14
   catalog drugs: 27 of 39 original-packager labels list exactly one MANUFACTURE establishment, 4
   list 2–3, and **8 list none** (often a U.S. distributor such as Apotex Corp. or Viatris Specialty).
   All 26 repackager labels list no manufacturer but **all** declare their source product NDC(s).
2. **The "actual factory" of a patient's bottle is generally not knowable from public data**
   (multi-plant labels; repackagers; no lot-to-plant data). The app must show *candidate* facilities
   listed in labeling, never "made at".
3. **Inspection, warning-letter and import-alert data are first-party and public, but not reachable
   the way the app works today.** They key on FDA's FEI number (SPL gives DUNS; the DUNS→FEI link is
   in FDA's DECRS download), the FDA Data Dashboard API requires a per-user authorization key, import
   alerts are HTML pages only, and none of these hosts is in the app's network allowlist. A
   **build-time, versioned regulatory snapshot bundled with the app** is the only design compatible
   with "no backend" — and it needs your approval (OD-25).
4. **Document A corrections confirmed:** MANUFACTURE is NCI code C43360 (not C43215, never observed);
   C82401 = "api manufacture" (now observed, 5×); C84382 = "STERILIZE" (new).
5. **Scanner:** the most common React Native OCR/barcode engine (Google ML Kit) keeps images and text
   on the device but, per its terms and third-party analyses, may send usage/diagnostic metrics to
   Google with no supported opt-out — in tension with the project's no-telemetry rule. Open-source
   alternatives exist (ZXing-cpp for barcodes, Apple Vision on iOS, PaddleOCR/Tesseract on Android)
   at the cost of more native work and APK size. A short measured spike decides (OD-27).

## Go / no-go per capability

Answers to your five questions: (1) data obtainable? (2) reliably associated with the patient's
medication? (3) presentable without unsupported conclusions? (4) patient value (5) cost.

| Capability | (1) Data | (2) Association | (3) Presentable | (4) Value | (5) Cost | Recommendation |
|---|---|---|---|---|---|---|
| **S. Camera scanning — barcodes** (UPC-A / GTIN-14 / GS1 DataMatrix → NDC, lot, expiry) | Yes, on device; existing NDC/GTIN parser | Strong for factory bottles/cartons; pharmacy-label barcodes usually encode Rx numbers and must be ignored | Yes (scanned vs verified labels) | High (removes typing) | Medium | **GO — Task 4C, first** |
| **S. Camera scanning — OCR of pharmacy labels** (name, strength, form, NDC, mfr abbreviation, lot) | Yes, on device | Good *after* existing cross-validation (NDC must match printed name/strength) | Yes, with three evidence classes | High | Medium–high | **GO — Task 4C, after a 2–3-day engine spike (OD-27)** |
| A. Identification extras: imprint picker (UC-3B/UC-4), pharmacy-mnemonic matching (UC-3) | Imprint: yes (RxNav ndcproperties, 39/40 products); mnemonics: no verified source | Imprint: only to choose between product NDCs, never plants; mnemonics: weak | Yes as user choice | Medium | Medium | **Imprint: GO later (4D). Mnemonic table: NO-GO until a verified source exists** |
| B1. Product recalls (existing engine) | Yes (openFDA) | Product-level; already conservative | Yes (shipped) | High | Low | **GO (keep)** |
| B2. Provenance view: labeler → repackager source → candidate facilities (SPL) | Yes (DailyMed, allowed host) | Labeling-level; candidate only; 8/39 labels list no manufacturer | Yes, with "listed in labeling, not proven to have made your bottle" | Medium–high | Medium | **GO — Task 4D (after scanner)** |
| B3. Facility inspection history (NAI/VAI/OAI, dates, project area) | Yes, first-party, weekly; via FEI | Facility-level only, via DUNS→FEI (DECRS) — needs crosswalk verification | Yes, if dated, scoped and shown for **every** candidate facility equally | High (core of the new direction) | High (pipeline + review) | **CONDITIONAL — design spike + legal review; ship only with OD-25 approved** |
| B4. Warning letters (and seizures/injunctions) | Yes, first-party (Data Dashboard compliance actions with FEI; warning-letter index) | Facility-level when FEI given; otherwise company-level | Yes, labeled company vs facility | High | High (same pipeline) | **CONDITIONAL — with B3** |
| B5. Import alerts (e.g., 66-40) | First-party but HTML only; firm identifiers unverified | Facility/firm-level; name matching risk | Risky without identifier join | Medium | High, fragile | **NO-GO for now; revisit if a structured feed or reliable FEI is confirmed** |
| B6. Form 483 observations / inspection citations | Partial (Data Dashboard citations dataset; 483 documents not systematically public) | Facility-level | Hard to summarize without overstating | Medium | High | **NO-GO for v1 of the evidence viewer** |
| C. Refill comparison (two confirmed records) | Yes (on device; `rules/refill.ts` exists) | Exact (user-confirmed records) | Yes ("what changed", no verdict) | Medium–high | Low–medium | **GO after encrypted storage is verified on a device (PV-4)** |
| Lot-to-factory inference | No public data | — | Would be unsupported | — | — | **NO-GO (rejected)** |
| Scores, rankings, "worst-case" plant scoring, NTI switching advice | — | — | No | — | — | **NO-GO (product decision)** |

## Competitive differentiation (honest assessment)

| Existing tool | What it does well | What it does not do conveniently |
|---|---|---|
| **ProPublica Rx Inspector** (web) — maps generics to manufacturer and factory with inspection reports and compliance actions; ProPublica obtained a partial factory-location list from FDA through litigation ([ProPublica](https://www.propublica.org/article/rx-inspector-prescription-drug-lookup), [MM+M](https://www.mmm-online.com/news/rx-inspector-prescription-drug-lookup/)) | Closest competitor; broad factory mapping, including data not in public SPLs | Typed search (drug + company on bottle, optional pill features/NDC); web, not a private on-phone flow; no recall-applicability engine for *your* product/lot; ProPublica itself cautions a troubling report does not mean your drug is compromised |
| **FDA tools** — NDC Directory, DailyMed, Enforcement Reports, Data Dashboard, Import Alerts | Authoritative, free, first-party | Separate sites with different identifiers (NDC, DUNS, FEI, firm names); built for professionals; no link from a pharmacy bottle to the evidence |
| **Consumer medication apps** (reminders, prices, drug info, general recall news) | Convenience, reminders | Not built around the patient's exact product, labeler/repackager chain or facility evidence; recall news is not product/lot-specific |

**What this app could uniquely deliver:** scan-your-actual-bottle → exact product (with repackager
traversal) → product-level recall applicability (existing conservative engine, lot-aware) → the
labeling's candidate facilities and their *first-party, dated* regulatory record, each labeled
product-level / facility-level / company-level — all on the phone, no account, no tracking. The
honest gap: Rx Inspector has FOIA-obtained factory data we cannot reproduce; our facility coverage is
limited to what SPLs list (and 8 of 39 sampled labels list no manufacturer). Differentiation rests on
privacy, scanning, exact-product precision, evidence-strength labeling and recall integration — not on
more data.

## Recommended Task 4C (scanner-first) — awaiting your approval

| Step | Content | Exit criterion |
|---|---|---|
| 4C.0 Device baseline | Run `docs/FUNCTIONAL_TEST_PLAN.md` on your phone with build 3 (still pending) | Results recorded; blocking defects fixed |
| 4C.1 Scanner spike (2–3 days, throwaway branch) | VisionCamera v5 on RN 0.88.1 (New Architecture) on a Pixel; barcode: ZXing-cpp plugin vs ML Kit; OCR: ML Kit v2 vs PaddleOCR/ONNX vs Tesseract on a synthetic label set; measure accuracy, latency, APK delta, and **network traffic** (proxy capture) | Written bake-off; you choose the engines (OD-27, OD-28) |
| 4C.2 Barcode MVP | Camera screen; UPC-A/GTIN-14/GS1 DataMatrix → existing NDC parser → existing identification + recall flow; lot/expiry from GS1 AIs as *scanned, to confirm* | Unit + UI tests; device test on Pixel |
| 4C.3 OCR MVP | Photo of pharmacy label (in memory) → pure-TS field extractor (Rx-number exclusion, NDC anchoring) → `LabelExtraction` → confirmation screen with **Read from label / Matched in FDA records / Needs your input** | Extractor unit tests on synthetic labels; UI tests; device test |
| 4C.4 Privacy & accessibility hardening | CAMERA permission only at scan time; no image retention; no gallery writes; screen-reader guidance; manual fallback on every step | Manifest/privacy tests; device checklist |

After 4C: **4D** provenance view (B2) + imprint picker; **4E** regulatory evidence snapshot (B3/B4) if
OD-25 is approved and counsel reviews; **4F** refill comparison after PV-4.

## Decisions needed from you

| ID | Decision |
|---|---|
| OD-25 | Allow a **build-time regulatory-evidence snapshot** (FDA public downloads → versioned, reviewed data file shipped in the app; no server). Required for B3/B4. |
| OD-26 | Provide the **Drug Quality Score App PRD (Oct 22, 2026)** so the traceability matrix and the seven scenarios can be completed. |
| OD-27 | Scanner OCR engine policy: allow Google ML Kit (on-device, but may send usage metrics to Google; must be disclosed) **or** require an open-source, no-telemetry engine (larger APK, more work). Recommendation: decide after the 4C.1 measurement; default to no-telemetry. |
| OD-28 | CAMERA permission and an updated privacy policy/claims for scanning. |
| OD-29 | Whether facility-level evidence (B3/B4) is shown for **all** candidate facilities of a multi-plant product, with no attempt to pick one (recommended), and whether company-level evidence is shown in a separate section (recommended). |
