# Validation Scenarios and Test Specifications (Task 4B)

**Provisional scenario set.** The seven scenarios of the Drug Quality Score App PRD (Oct 22, 2026)
could not be read (document not provided, OD-26). The seven below are derived from Document A's use
cases, plus the imprint-conflict scenario. Re-map when the PRD is available.

Every product example below was **re-verified live on 2026-11-12** (DailyMed SPL, openFDA, RxNav;
`docs/research/task4b/probe-results.json`). Historical assertions from Document A were checked and
corrected where data disagreed (C43215 → C43360; C82401 observed; "5–10%" not adopted). Before any of
these becomes a test fixture, the response must be re-captured and trimmed with provenance metadata
(CLAUDE.md §4); regulatory-evidence fixtures (inspections, letters) cannot be captured from this
environment and need the snapshot pipeline (OD-25).

## Research scenarios

| # | Scenario (source) | Re-verified example | Expected behavior |
|---|---|---|---|
| R1 | Factory bottle, single plant (A UC-1) | Umedica atorvastatin 60290-041 → SPL lists 1 MANUFACTURE site (UMEDICA LABORATORIES PRIVATE LIMITED, DUNS 920635096) | Scan barcode → product → one listed site (still "listed in labeling", not "made at") |
| R2 | Factory packaging, multiple plants (A UC-1A) | Zydus losartan 65841-730 → 3 MANUFACTURE sites | All 3 shown equally; optional printed "Manufactured by" only narrows on an exact match to one listed site |
| R3 | Authorized generic / shared application (A UC-1B) | Apotex Corp. atorvastatin 60505-2578 (ANDA090548 → sponsor APOTEX INC) — SPL has no establishment section | "Labeling does not list a manufacturing site"; application holder shown as listed; no inference of plant |
| R4 | Pharmacy vial with NDC, multi-plant (A UC-2/2A) | Biocon rosuvastatin 70377-008 → contract site Recipharm + Biocon (+ API site) | OCR NDC cross-validated; candidates shown; company (Biocon) vs contract facility (Recipharm) kept distinct; no imprint prompt |
| R5 | Vial without NDC, manufacturer abbreviation (A UC-3) | Typed/OCR "MFR: AUROBINDO" with losartan 50 mg | Abbreviation shown as read; no automatic labeler mapping (A-12 rejected); user picks from directory candidates |
| R6 | Vial with no NDC, no manufacturer (A UC-4) | Name + strength only | Ingredient-level recall evidence; provenance "cannot be determined from your label" |
| R7 | Opaque supply chain (A UC-5) | GSMS amlodipine 51407-950 — no establishment section | "Not listed" state; never "clean"; recall check still runs |
| R8 | **Imprint conflict** (A §1.1) | Scanned NDC 60505-2578 (RxNav imprint APO;A10) but user reports tablet marking ATO;40 (Umedica 60290-041) | `CONFLICTING`: "The marking you entered belongs to a different product." NDC not trusted; no plant inference |

## Test specifications (to implement in Task 4D/4E, test-first)

| Test | Fixture | Assertion |
|---|---|---|
| Multiple possible facilities | R2/R4 SPL (re-captured) | Graph has k ≥ 2 `LISTS_ESTABLISHMENT` edges, all candidates; presentation lists all, unordered by evidence; text "may have been made at another listed site" |
| Unknown actual factory | Any multi-plant or repackager | No edge or text asserts "made at"; property test over all fixtures |
| Repackager relationships | Bryant Ranch 71335-1278 (sources 67877-199/198), Asclemed 76420-946 (4 sources) | Single source → `VERIFIED_EXACT_ID`; several → `AMBIGUOUS`, facilities of each source shown under "possible source products" |
| Company-versus-facility attribution | Warning letter addressed to a firm without FEI match (snapshot fixture) | Scope `COMPANY`, shown only under "Company-level records" |
| Different production lines | Inspection with project area other than the product's (snapshot fixture) | Relevance note `PROJECT_AREA_MAY_NOT_COVER_THIS_PRODUCT` |
| Stale or pending inspections | Snapshot older than 120 days; inspection newer than snapshot absent | `STALE` banner; "recent or pending inspections may not be included" always present |
| Unrelated product recalls | Recall by the same recalling firm for a different product (existing cassette has such records) | Recall finding for the patient's product unchanged; company-level context only |
| Missing regulatory data | Facility DUNS not in DECRS snapshot | `UNMATCHED` → "could not match this site"; never "no inspections" |
| Conflicting source records | Metoprolol 50090-6448 salt conflict (existing fixture); DUNS mapped to 2 FEIs | `CONFLICTING`; no choice made |
| Rx number never an NDC (scanner) | SYNTHETIC label text with "Rx# 1234567890" and "NDC 62756-142-02" | Only the anchored NDC is extracted; Rx number goes to `privateText` and is blocked from requests |
| Lot never inferred (scanner) | Barcode without AI(10); label without "LOT" | `lot = null`; no lot shown as found |
| No scoring | All evidence views | Lint: no numeric score, rank, grade, "worst", "best", "safest" |
