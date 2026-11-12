# PRD-to-Implementation Traceability Matrix (Task 4B)

Baseline: Task 4A.2 (`3292efc`, development build 0.1.2 / build 3). Sources: **A** = Rx Provenance &
Quality Resolution specification (`docs/references/`), **P** = project PRD (`docs/PRD.md`),
**T** = Task 4B instructions (2026-11-12), **PRD-Q** = Drug Quality Score App PRD (Oct 22, 2026) —
**not available, not reviewed** (OD-26). Not every original requirement is assumed valid; the last
column says whether to keep it.

Priority: **P0** next task (4C), **P1** following tasks (4D–4F), **P2** later / conditional,
**X** rejected.

| ID | Original requirement (source) | Current implementation | Missing capability | Data availability | Technical feasibility | Regulatory / legal concern | Priority |
|---|---|---|---|---|---|---|---|
| T-1 | Camera-first identification (T, revised) | Manual entry only | Camera, barcode, OCR, extraction, confirmation UI | On device | Feasible; engine choice open (OD-27) | CAMERA permission disclosure; no image retention | **P0** |
| A-5 | Barcode input: UPC-A, GS1-128, GS1 DataMatrix (GTIN-14 + serial + lot + exp) (A UC-1) | NDC/UPC/GTIN parsing with check digits (`rules/ndc.ts`); no camera | Camera decoding; GS1 AI parsing (01/10/17/21) | On device | Feasible | Serial number is not needed — do not store it | **P0** |
| A-9 | OCR NDC cross-validated against printed name and strength; mismatch → discard NDC (A UC-2) | Implemented for manual entry (cross-validation, `ndcDiscarded`) | OCR producer | On device | Feasible; reuse | Rx number must never be treated as NDC (T) | **P0** |
| T-2 | Confirmation distinguishing scanned text, verified data, unresolved fields (T) | Evidence labels exist (`VERIFIED_SOURCE`, `USER_ENTERED`, …) | `SCANNED` evidence level and per-field correction | — | Feasible (presentation) | Claims policy update | **P0** |
| T-3 | Manual correction and fallback when recognition fails (T) | Manual entry exists | Wiring from scan to editable fields | — | Feasible | — | **P0** |
| T-4 | No automatic photo upload, analytics or image retention (T) | No images today; privacy guard on requests | Image lifecycle controls; engine network audit | — | Feasible; ML Kit metrics risk | Telemetry rule (CLAUDE.md §2) | **P0** |
| A-1 | Imprint only to resolve an unknown product NDC; never to pick a plant (A §1.1) | Rule adopted; no imprint UI | Imprint picker | RxNav ndcproperties imprint/color/shape (39/40 sampled) | Feasible | — | P1 |
| A-13 | Imprint choice among one labeler's product NDCs (A UC-3B) | — | Picker | As above | Feasible | — | P1 |
| A-14 | Faceted pill picker for vials with no NDC and no manufacturer (A UC-4) | Ingredient-level recall evidence only | Picker over all market products | RxNav, but completeness unverified | Medium | Misidentification risk | P2 |
| A-12 | Pharmacy mnemonic → labeler mapping with trigram matching (A UC-3) | Empty `manufacturer_aliases.json` | Verified mapping source | **No verified source** | Low | Wrong mapping → wrong product | X until a verified source exists |
| A-2 / A-15 | Repackager traversal via `asEquivalentEntity` (A §1.2, UC-4A) | Implemented for recall matching (verified sources only) | Show the chain to the user | DailyMed (26/26 sampled repackagers declare sources) | Done (engine) | — | P1 (display) |
| A-3 | 11→10-digit NDC candidates (A §1.3) | Implemented (corrected; ambiguity not resolved by "first") | — | — | Done | — | Done |
| A-20 | `candidateNDCs.first()` (A §4) | Rejected; `AMBIGUOUS_IDENTITY` | — | — | — | Silent selection | X |
| A-4 / A-19 | Partition SPL establishments by operation (MANUFACTURE, API, repack); treat all listed plants as candidates (A §3) | Not implemented (removed in Task 2) | SPL establishment parser in app; candidate list | DailyMed; MANUFACTURE = **C43360** (A's C43215 never observed); C82401 "api manufacture" and C84382 "STERILIZE" observed | Feasible on device | Must say "listed in labeling", not "made at" | P1 |
| A-6 | Facility audit: inspection classifications, 483s, warning letters, import alerts, recalls (A UC-1) | Recalls only | Evidence ingestion + DUNS→FEI crosswalk + viewer | First-party: Data Dashboard (key-gated API, weekly; downloads), DECRS (daily zip), warning-letter index, import-alert HTML | Only via build-time snapshot (OD-25) | Facility vs company attribution; staleness; defamation/misrepresentation risk if overstated; counsel review | P2 (conditional) |
| A-17 / A-18 | Daily ETL crosswalk; Import Alert HTML scraper (A §3) | Rejected (backend) | Build-time pipeline instead of daily server ETL | Public downloads | Feasible offline; scraping fragile | Terms/robots for scraped pages | P2 (ETL as snapshot); import-alert scraping **X** for now |
| A-7 | Prompt for "Manufactured at / Made in" fine print on factory packaging (A UC-1A) | Removed (Task 2) | OCR of fine print; exact match to a listed establishment | User's own package | Feasible with OCR | Only narrows if it exactly matches one listed establishment; otherwise shown as "printed on your package" | P2 |
| A-8 | Authorized-generic join via `application_number` (A UC-1B) | Not implemented | Join to the application holder's SPL establishments | openFDA NDC `application_number`, Drugs@FDA sponsor (25/25 resolved) | Feasible | AG labels may share a plant; still "candidate" | P2 |
| A-10 | Worst-case facility set bounding with a computed score (A UC-2A) | Removed | — | — | — | **Scores prohibited (T)** | **X** |
| A-11 / A-24 | NTI variance warning, single-plant alternatives (A UC-2A, §3) | Rejected | — | — | — | Clinical/switching advice | **X** |
| A-16 | Never show green/clean when facility data is empty; opaque provenance alert (A UC-5) | No green state anywhere | "Manufacturer not listed in labeling" state | — | Feasible | Wording: A's "cannot be verified as compliant" overstates; use neutral "not listed" | P1 |
| A-22 / A-23 | "5–10% of SPLs omit establishments"; "14–30 day lag" (A UC-5) | Not adopted as fact | — | Our sample: 13/65 SPLs had no establishment section (biased sample) | — | Do not publish unverified statistics | X (as facts) |
| P-1 | Product-level recall applicability with lot (P §7) | Implemented (engine, presentation) | — | openFDA | Done | — | Keep |
| P-2 | Exclusions, unsupported, clarification distinct (P §4) | Implemented | — | — | Done | Policy approval pending (OD-2) | Keep |
| P-3 | Refill comparison (P, Task 5) | `rules/refill.ts` diff; no UI; history disabled | Saved records + compare UI | On device | Feasible after PV-4 | Encryption must be verified first | P1 |
| P-4 | Encrypted local history (P, PRIVACY) | Adapters + self-test; persistence off | Device verification (PV-4) | — | Pending device | — | P1 (blocker for C) |
| T-5 | No scores, rankings, safety verdicts or treatment recommendations (T) | Enforced by tests (prohibited wording, no success tone) | Extend lint to evidence viewer copy | — | Done/extend | — | Keep |
| T-6 | Present unfavorable findings with scope, date, relevance, limitations; don't omit (T) | n/a (no facility evidence yet) | Evidence cards with scope/date/attribution | First-party | With B3/B4 | Fairness to firms; accuracy; counsel review | P2 |
| T-7 | Distinguish product-, facility-, company-level evidence (T) | Product-level only | Evidence-scope model (`PROVENANCE_DATA_ARCHITECTURE.md`) | — | Feasible | — | P1 (model), P2 (data) |
| PRD-Q-* | Requirements of the Drug Quality Score App PRD (Oct 22, 2026) | — | — | — | — | — | **Not reviewed — document not provided (OD-26)** |
