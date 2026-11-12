# Reference documents

These documents are **design references, not implementation instructions**. Their original contents
are preserved unmodified in this directory. Decisions about which requirements the project adopts
are recorded below and in the documents that cite them.

| ID | File | Provenance | Integrity |
|----|------|------------|-----------|
| A | `Rx Provenance & Quality Resolution UX & Backend System Specification.pdf` | Uploaded by the project owner on 2026-11-12. Copied byte-for-byte; only the file name was restored (the upload's name had been sanitized to underscores). 12 pages; produced by the Google Docs renderer. | SHA-256 `bbede45e771ef131231f1fefe83b12916b1d4bf17ac01821463b18bfb7f533a2` |
| (PRD-Q) | Drug Quality Score App PRD (October 22, 2026) | **Referenced in Task 4B but not provided** to this project; not reviewed (OD-26). | — |
| B | `Drugs Exclusion List.md` | Supplied by the project owner as pasted text in the Task 1 conversation on 2026-11-12 (no file was uploaded). Saved verbatim as received. The trailing instruction "Use this additional data." was a message to the assistant, not document content, and was not included. Any Markdown formatting in an original file (e.g., table pipes or headings) was not visible in the paste and therefore could not be reproduced. **If an original `.md` file exists, replace this copy with it.** | Text as received |

## Adoption register

Status meanings: **Adopted** (implemented as written), **Modified** (implemented with stated
changes), **Deferred** (not in v0.1; scheduled or pending a decision), **Rejected** (will not be
implemented, with reason). "Verified" notes cite evidence from the Task 1 feasibility run
(`docs/feasibility/latest-run.json`, 2026-11-12).

### Scope update — Task 2 (2026-11-12)

Manufacturer provenance is removed from MVP v0.1: no manufacturing-facility identification,
establishment mapping, inspection history, plant risk scoring or provenance inference. Rows A-2, A-4,
A-7, A-10, A-16 and A-19 are updated below; A-6, A-17, A-18 and A-22 were already deferred, rejected or
not adopted. Labeler/manufacturer names remain only for product identity and recall matching.

### Document A — Rx Provenance & Quality Resolution Specification

| # | Requirement (section) | Status | Reason / change |
|---|---|---|---|
| A-1 | §1.1 Pill imprint cannot disambiguate plants within one product NDC; use imprint only to resolve an unknown product NDC. | **Adopted** | Sound regulatory reasoning; prevents dead-end prompts. Becomes rule `NO_IMPRINT_PROMPT_FOR_PLANTS`. |
| A-2 | §1.2 Repackager/relabeler traversal through `<asEquivalentEntity>` source NDCs. | **Modified (Task 2)** | Runs **on device** (no backend), with bounded depth (≤3 hops) and cycle detection. Verified: 15/15 one-hop traversals resolved to an originating labeler. Multi-hop chains exist (e.g., a repackager whose source is itself a distributor), so a chain that ends without a MANUFACTURE establishment resolves to "manufacturer not identified", never to a guess. Task 2: traversal is kept only to relate a repackaged product to its source product NDC for recall matching (RP-4); no establishment or manufacturer is resolved. |
| A-3 | §1.3 11-digit → 10-digit NDC candidate generation. | **Modified** | Adopted the 4-4-2 / 5-3-2 / 5-4-1 candidate rule. Corrections: (a) §1.3 says to strip the package segment and then also remove a zero from it; the implementation generates candidates from the full 11 digits. (b) Candidates are confirmed against the openFDA NDC Directory (`packaging.package_ndc`) and RxNav `ndcstatus`, not a separate "Labeler Directory". (c) More than one surviving candidate is surfaced as `AMBIGUOUS_IDENTITY`, never resolved by taking the first. Verified: 14/14 real NDCs round-tripped uniquely. |
| A-4 | §1.2, §3, §4 Operation code **C43215** = MANUFACTURE. | **Not used (Task 2); re-verified Task 4B: C43360 = MANUFACTURE, C82401 = "api manufacture" (observed 5×), C84382 = "STERILIZE"; C43215 still not observed (65 SPLs)** | Live DailyMed SPL XML uses **C43360** with `displayName="MANUFACTURE"`; C43215 was not observed in any of 20 parsed SPLs. The parser classifies operations by the code *and* the displayName in the document and logs unknown codes. C82401 (API MANUFACTURE) was not observed in this sample and remains unverified. Task 2: operation codes are no longer read by the app (provenance removed). |
| A-5 | UC-1 GS1 DataMatrix / UPC barcode input (GTIN-14, serial, lot, expiry). | **Adopted** (Task 5) | GTIN-14, UPC-A and 13-digit UPC forms are parsed with check-digit validation (Task 1 unit tests). DataMatrix lot/expiry extraction is scheduled for Task 5. |
| A-6 | UC-1 facility audit against FDA inspection classifications, Form 483s, warning letters, Import Alert 66-40. | **Deferred** | None of these are served by the four mandated APIs. Doc A's own mitigation (§3) is a daily DUNS↔FEI ETL and HTML scraping, which require a backend (prohibited). Revisit only if an official keyless API is identified and tested. |
| A-7 | UC-1A prompt for "Manufactured at / Made in" fine print on factory packaging. | **Removed (Task 2)** | Optional, user-supplied, displayed as label information. Not converted into a facility quality judgment because facility audit is deferred (A-6). Task 2: removed with manufacturer provenance. |
| A-8 | UC-1B authorized-generic join via `application_number`. | **Deferred** (Task 3) | Feasible: `application_number` is present in openFDA NDC records. Needs fixture-based tests before use. |
| A-9 | UC-2 cross-validation of OCR-extracted NDC against printed drug name and strength. | **Adopted** | Mandatory. On mismatch the OCR NDC is discarded and the flow continues as "no NDC" (Doc A UC-3 path). |
| A-10 | UC-2A Worst-Case Facility Set Bounding with a computed risk "score". | **Removed (Task 2)** | No numerical or ranked safety score is permitted in v0.1. All candidate establishments may be listed as provenance information with "the specific facility for your package cannot be determined". Task 2: removed with manufacturer provenance. |
| A-11 | UC-2A Narrow-therapeutic-index variance warning and "View Verified Single-Plant Alternatives". | **Rejected** (v0.1) | Makes clinical claims (bioavailability changes from plant switches) and product-switching suggestions that the app cannot support with the public data in scope. Levothyroxine remains assessable for recalls only. |
| A-12 | UC-3 pharmacy-mnemonic → labeler mapping table with trigram similarity. | **Modified** | `data/manufacturer_aliases.json` exists but is **empty**: Doc A gives only illustrative mnemonics, and no verified source was reviewed. Fuzzy matches may only propose candidates for user confirmation, filtered to labelers with an active product NDC for the RxCUI. |
| A-13 | UC-3B imprint prompt to choose among one labeler's multiple product NDCs. | **Adopted** (Task 5) | RxNav `ndcproperties` exposes `IMPRINT_CODE`, `COLOR`, `SHAPE` (observed 2026-11-12), so constrained choices can be built without a backend. |
| A-14 | UC-4 faceted pill-picker for vials with no NDC and no manufacturer. | **Deferred** (post-v0.1) | Usability and accuracy risk; requires imprint data for all market products per RxCUI. v0.1 returns ingredient/strength-level evidence labeled "may or may not apply to your product". |
| A-15 | UC-4A deduplicate repackager NDCs to the root application/product. | **Adopted** (Task 3) | Same mechanism as A-2. |
| A-16 | UC-5 never show "green/clean" when facility data is empty; opaque provenance alert. | **Adopted, generalized (Task 2)** | v0.1 has no "safe/green" state at all. Missing establishment data produces an explicit "manufacturer/facility not identified in public filings" explanation. Task 2: the "no green/clean state" rule stays; the facility-data part is moot (no facility data is shown). |
| A-17 | §3 Daily ETL crosswalk (DECRS, GDUFA lists, geo matching). | **Rejected** | Requires a backend and bulk processing; outside the architecture. |
| A-18 | §3 Import Alert 66-40 HTML scraper. | **Rejected** (v0.1) | Scraping, backend-dependent, not one of the mandated APIs. |
| A-19 | §3 Treat every listed MANUFACTURE establishment in an active SPL as a candidate ("dormant facility bloat"). | **Removed (Task 2)** | Informational listing only; no inference about which facility made a given package. Task 2: removed with manufacturer provenance. |
| A-20 | §4 Pseudocode `productNDC = candidateNDCs.first()`. | **Rejected** | Silently selects among candidates. Replaced by "exactly one directory-confirmed candidate, otherwise `AMBIGUOUS_IDENTITY`". |
| A-21 | "Backend" as the execution location throughout. | **Modified** | All resolution logic runs on the phone (the "resolution engine"). |
| A-22 | UC-5 statistic "~5–10% of active SPL XML files omit establishments". | **Not adopted as fact** | Unverified. Task 1 sample (n = 20, biased toward repackagers) found 2 SPLs with no establishment section and 15 with no MANUFACTURE establishment. |
| A-23 | UC-5 "14–30 day lag" for new SPLs reaching openFDA/DailyMed. | **Not adopted as fact** | Unverified assumption; the app shows source dataset dates instead (C8). |
| A-24 | §3 NTI watchlist and "strict single-plant preference rules". | **Rejected** (v0.1) | See A-11. Warfarin, tacrolimus and cyclosporine on that list are excluded by policy anyway. |

### Document B — Drugs Exclusion List

| # | Requirement | Status | Reason / change |
|---|---|---|---|
| B-1 | Medicare Part D 2023 top-15 list as the candidate scope. | **Adopted** | 14 MVP drugs = top 15 minus apixaban (excluded). See `data/drug_catalog.json`. |
| B-2 | 11-drug exclusion list. | **Adopted, provisional** | Document B labels the list "proposed, pending your decision". Encoded as policy `0.1.0-draft`, status `PROPOSED_PENDING_APPROVAL` (open decision OD-2). |
| B-3 | Exclusions set by drug class against a published criterion. | **Adopted** | Entries are matched by RxNorm ingredient RxCUI. FDA Established Pharmacologic Class (EPC) strings observed in openFDA are recorded as class signals; an unlisted ingredient with a matching signal yields `NEEDS_CLARIFICATION` for policy review rather than silently extending the list. |
| B-4 | Administration rule for injectable / hospital-administered drugs. | **Deferred — open decision OD-1** | Not invented. Interim: non-oral products are outside MVP formulation scope (`UNSUPPORTED`, reason `ADMINISTRATION_RULE_PENDING`). |
| B-5 | Distinct messages for "excluded/not assessed" vs "no data". | **Adopted** | Separate result states `EXCLUDED` vs `INSUFFICIENT_DATA` with separate copy. |
| B-6 | Every result states that exclusion does not imply other drugs are safe. | **Adopted** | Standing disclaimer on every result screen. |
| B-7 | Six-month review against FDA labels; log each change with date and source. | **Adopted** | `next_review_due` and `change_log` in `data/exclusion_policy.json`, enforced by unit test. |
| B-8 | Boxed-warning rationale "not yet checked against current versions". | **Deferred** | Must be verified against current FDA labels before policy approval (prerequisite for release, Task 6). |
| B-9 | "Everolimus (transplant)". | **Modified** | The app cannot establish indication from a label, and oral everolimus has non-transplant uses. Policy decision: `NEEDS_CLARIFICATION`. It is outside MVP scope, so it is never assessed either way. |
| B-10 | Azathioprine, mycophenolate (also used outside transplantation). | **Adopted, flagged** | Excluded by ingredient as listed; flagged for the first policy review because the "transplant immunosuppressant" criterion is indication-based. |
