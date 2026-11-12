# Implementation Plan

Six independently verifiable tasks. Each task is done on its own branch, ends with a report, and
**stops for approval** before the next begins.

**Scope update (Task 2):** manufacturer provenance is removed from MVP v0.1 — no facility
identification, establishment mapping, inspection history, plant risk scoring or provenance
inference. Labeler/manufacturer names are kept only for product identity and recall matching.

## Task 1 — Repository initialization and FDA API feasibility

| | |
|---|---|
| Deliverables | Directory structure; CLAUDE.md, AGENTS.md, README; PRD, ARCHITECTURE, DATA_SOURCES, PRIVACY, EXCLUSIONS, API_FEASIBILITY, TEST_PLAN, this plan; reference docs A and B + adoption register; `data/` catalog, exclusion policy, aliases (empty); feasibility harness and helpers; real-response fixtures; unit and integration tests |
| Dependencies | None |
| Acceptance | Harness runs live against all four source families or reports BLOCKED; no fabricated data; tests pass; references preserved unmodified; open decisions listed |
| Tests | `npm test` (58 passing), `npm run typecheck`, `npm run feasibility` |
| Status | **Complete** |

## Task 2 — State machine and recall evidence engine

| | |
|---|---|
| Deliverables | Pure TypeScript library under `mobile/src/`: `models/` (identity, evidence, policy, lookup, openFDA types), `rules/` (NDC keys and text extraction, strength / dose form / release, ingredient sets, catalog + policy parsing, exclusion, directory confirmation, cross-validation, OCR confirmation gating, lot scope and comparison, per-record recall relevance, query planning, coverage, positive control, aggregation, refill diff, explanation selection, `RULESET_VERSION`), `state/machine.ts` (pure reducer with effect descriptors), `engine/runner.ts` (effect runner with injected ports). Task 1 helpers moved with re-export shims. Refinement: generic `fsm/` core, declarative rule table, mandatory safety gates, `createRxWorkflow` variants, `RxRules` interface for the runner, `docs/STATE_MACHINE_GUIDE.md`. 33 new real openFDA fixtures (`tests/fixtures/task2/`, capture script `npm run fixtures:task2`). Provenance removed from docs. |
| Dependencies | Task 1 approved; OD-2 (draft policy used, flagged) |
| Acceptance | Every transition in ARCHITECTURE §4.3 tested; state-machine property tests pass; RG-1, RG-2 (rule level), RG-3, RG-7 pass with real fixtures; no I/O imports in `models/`, `rules/`, `state/` (static test) |
| Tests | NDC-8, OCR-1…5, EX-2…7/9, ID-1…4, RC-1…5, LOT-1…4, RP-4, refill diff, state-machine table and property tests, workflow integration with request audit. `npm test`: 234 pass. Coverage of `mobile/src`: 97.7% lines, 83.7% branches (`npm run test:coverage`) |
| Status | **Complete — awaiting approval** |

## Task 3 — API integration and local storage

| | |
|---|---|
| Deliverables | `services/` clients implementing the `engine/runner.ts` ports: openFDA NDC, enforcement (pagination, multi-field positive control), DailyMed SPL (repackager source NDCs only, real XML parser), RxNav (ingredient RxCUIs for catalog matching); retry/backoff; request audit hook; `storage/` encrypted SQLite (library chosen per OD-6), migrations, repositories, cache with TTL, delete-all |
| Dependencies | Task 2 |
| Acceptance | Clients classify outcomes exactly as `http.ts`; RG-2 implemented; cache never stores failures; delete-all removes DB and key; request audit shows only allowlisted hosts and public identifiers; harness rerun still green |
| Tests | RC-6, RP-2/3, NET-6/7, CA-1…5, PV-1 (client level), PV-4, storage migration tests with a test DB |

## Task 4 — Patient-facing mobile interface

| | |
|---|---|
| Deliverables | React Native Android app scaffold under `mobile/`; screens: Home/medication list, Scan entry (manual entry first), Confirm identity, Result (grouped evidence, uncertainty, sources/dates, disclaimer), Excluded/Unsupported/Needs-clarification, Medication detail and history, Settings (delete data, about data sources, policy version); centralized copy; accessibility (TalkBack, dynamic type, contrast) |
| Dependencies | Tasks 2–3 |
| Acceptance | All result states render with distinct copy; RG-4 copy lint passes; RG-5 satisfied on every result; manual-entry flow works end to end on emulator against live APIs; accessibility checks pass |
| Tests | Component tests per state; EX-8; snapshot of copy; E2E manual-entry happy path and each alternative state |

## Task 5 — Camera, OCR and refill comparison

| | |
|---|---|
| Deliverables | `scanner/`: camera capture, on-device OCR and barcode (UPC/GTIN/DataMatrix incl. lot/expiry) with engine chosen per OD-5; label field extraction; cross-validation wiring; container-type prompt; optional fine-print capture (Doc A A-7); refill scan → diff view; imprint-based disambiguation among one labeler's product NDCs if in approved scope (A-13) |
| Dependencies | Task 4 |
| Acceptance | OCR runs with network disabled (PV-3); cross-validation rejects all seeded misreads in the label corpus; scan-to-confirm targets from PRD §8 measured on the corpus; refill diff flags strength/form/release changes |
| Tests | OCR-6 corpus tests, PV-3, refill diff tests, barcode decode tests with real package codes |

## Task 6 — Security verification, testing and Android release preparation

| | |
|---|---|
| Deliverables | Backup/data-extraction rules; network security config (HTTPS only); R8; dependency and manifest telemetry scan; log-scan test; Detox/Maestro E2E suite; privacy audit report; policy review (B-8 boxed-warning check against current labels); release checklist; signed release build process (keys outside repo) |
| Dependencies | Tasks 1–5 |
| Acceptance | All release gates RG-1…RG-9 pass; physical-device test on ≥ 2 Android versions; privacy audit has no findings; documented build reproducibility |
| Tests | PV-2, PV-5, PV-6, full E2E, regression of all prior suites |

## 7. Cross-task rules

- Tests first; no task may lower existing coverage of release gates.
- Each task updates `docs/` it affects and records new open decisions.
- Live API checks are rerun at the end of Tasks 3, 4 and 6.

## 8. Open decisions

| ID | Decision needed | Owner | Needed by |
|---|---|---|---|
| OD-1 | Administration-based exclusion rule (injectable / hospital-administered) | Product owner | Before release (Task 6); interim behavior defined |
| OD-2 | Approve exclusion policy `0.1.0-draft` (Document B says "pending your decision"); confirm ingredient- vs indication-based criterion for azathioprine/mycophenolate | Product owner | Task 2 (can proceed with draft) |
| OD-3 | Include OTC versions of supported ingredients (e.g., omeprazole)? | Product owner | Task 2 |
| OD-4 | Recall refresh strategy: per-medication vs all-14 refresh (privacy vs bandwidth); recommendation: all-14 | Product owner + architect | Task 3 |
| OD-5 | OCR/barcode engine, subject to offline/no-telemetry verification | Architect | Task 5 |
| OD-6 | Encrypted SQLite library and key-wrapping approach | Architect | Task 3 |
| OD-7 | ~~Show SPL establishment/facility list to patients?~~ **Closed (Task 2):** manufacturer provenance removed from MVP v0.1; nothing about facilities is shown. | Product owner | — |
| OD-8 | Which recalls to show by default (all history vs ongoing + last N years); terminated recalls collapsed? | Product owner | Task 4 |
| OD-9 | Default branch: the repository had no commits at Task 1, so whichever branch is pushed first becomes GitHub's default. Decide whether to create `main` from the approved Task 1 commit and set it as default | Repository owner | Before Task 2 |
| OD-10 | Minimum supported Android version and target devices | Product owner | Task 4 |
| OD-11 | Replace Document B transcript with the original `.md` file if one exists | Product owner | Any time |
| OD-12 | Catalog matching uses normalized ingredient names until Task 3 supplies ingredient RxCUIs from RxNav (CLAUDE.md §3 prefers RxCUIs). Every ELIGIBLE decision records `matchedBy: NAME/RXCUI`. Accept name matching as the interim rule? | Product owner + architect | Task 3 |
| OD-13 | FDA records with internal conflicts (product 50090-6448: generic name "Metoprolol Succinate", active ingredient METOPROLOL TARTRATE) currently yield `NEEDS_CLARIFICATION` (salt unknown). Should the user be allowed to resolve such conflicts by confirming the label, or should they stay unassessed? | Product owner | Task 4 |
| OD-14 | When several directory-confirmed NDC candidates exist and exactly one agrees with the printed name/strength/form, the engine uses it (still shown in CONFIRM). Approve, or always show `AMBIGUOUS_IDENTITY`? | Product owner | Task 4 |
| OD-15 | Lot comparison treats hyphen-only differences and partial codes (`J0668398` vs `J0668398-121422`) as `LOT_POSSIBLY_LISTED` → potential match, never confirmed. Confirm this policy. | Product owner | Task 4 |
| OD-16 | Records whose NDC list cannot be read and whose strength is not stated (e.g. bulk tablets, `NDC 53746-0178-BULK`) are shown as potential matches for every same-ingredient product with a compatible release. Accept the extra "might match" items, or collapse them by default? | Product owner | Task 4 |
