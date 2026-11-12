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

## Task 3 — Live FDA integration, local database, extensible catalog and policy

| | |
|---|---|
| Deliverables | **Configuration:** schema-2 catalog (ingredient definitions with RxNav-verified precise ingredients and aliases; drugs with status, rx scope and restrictions) and policy (ingredient, route and product-type rules; class signal behavior; explanations); JSON Schemas; fail-closed runtime validation; documented precedence; `catalog:validate`, `policy:validate`, `config:validate` and `config:test`; worked examples (`data/examples/`); `docs/DRUG_CATALOG_GUIDE.md`; `docs/EXCLUSION_POLICY_GUIDE.md`. **Services:** transport (timeout, cancellation, allowlist, privacy guard, audit); openFDA, RxNav and DailyMed clients; production `Ports` with cache and identity enrichment (RxNav RxCUIs, verified repackager source products). **Storage:** driver interface, op-sqlite/SQLCipher and keychain adapters, Node SQLite for tests, migrations, repositories, immutable versioned assessments, delete-all. **App:** composition root and configurable display name ("Rx Recall Check"). **Integration:** `npm run e2e` (recorded real responses), `e2e:live`, `e2e:record` |
| Dependencies | Task 2 |
| Acceptance | All met at library level: Task 2 tests still pass; adding a drug or an exclusion needs no state-machine or recall-engine change (e2e scenarios); exclusions override the catalog; invalid configuration cannot authorize an assessment; API failures never yield `NO_MATCH_FOUND`; pagination and completeness verified; migrations tested; privacy audit passes; a complete assessment runs on live and recorded data. Device-only items are listed in TEST_PLAN §9. |
| Tests | 323 pass (`npm test`); e2e 13/13 recorded and live; `config:test` 51/51; feasibility re-run 5 PASS / 5 WARN / 0 FAIL |
| Status | **Complete — awaiting approval** (branch `task-3/live-integration`) |

## Task 4A — Android pilot: evidence safety, legal and regulatory readiness

| | |
|---|---|
| Deliverables | React Native 0.88.1 app in `mobile/` (Android + iOS projects; shared TypeScript in `mobile/src/`, screens in `mobile/app/`, native code only behind `mobile/app/platform/`); presentation layer that never shows more than the evidence (`presentation/present.ts`) and one copy file (`copy/en.ts`); screens: entry, product choice, confirmation with evidence labels, result with sources/limitations, not-assessed, errors, history (disabled without verified encryption), about/legal/privacy/delete-all, first-launch notice; build profiles (development/pilot) with product flavors; release gate; encryption self-test; draft legal documents; `EVIDENCE_AND_CLAIMS_POLICY.md`, `LEGAL_REGULATORY_REVIEW.md`, ADR-0001, Android build/install, device test plan, iOS build doc, release-readiness checklist |
| Decisions | OD-2, OD-4, OD-17, OD-18, OD-19 decided by the product owner (ADR-0001) |
| Acceptance | All Task 3 tests still pass; uncertainty can never be presented as reassurance (negative and property tests); prohibited wording absent from copy, screens and legal drafts; excluded/unsupported/blocked never presented as passed; no RxNav/DailyMed request for locally excluded medications; development APK builds without Metro; pilot build impossible while the release gate has blockers |
| Tests | See TEST_PLAN §10 and `EVIDENCE_AND_CLAIMS_POLICY.md` §6 |
| Not done (blocked) | Physical-device testing (no device in the build environment); on-device encryption verification (PV-4); pilot APK (14 release-gate blockers); legal, regulatory and clinical reviews (external) |
| Status | **Complete — awaiting review** (branch `task-4a/android-pilot`) |

## Task 4B — Pilot hardening (next, not started)

Candidate scope (to be approved): persist acknowledgements and history in the encrypted database once
PV-4 passes; app-switcher privacy (FLAG_SECURE / iOS snapshot) decision; TalkBack/large-font fixes
from device testing; OD-8, OD-13, OD-14, OD-15, OD-16 product decisions reflected in copy.

## iOS track (roadmap)

| Step | Content | Depends on |
|---|---|---|
| iOS-1 | Close architectural items B-iOS-1 (exclude database from iCloud backup), B-iOS-2 (Dev/Pilot schemes reading `build_profile.json`), B-iOS-3 (no local networking in release) — `docs/IOS_BUILD.md` | Task 4A |
| iOS-2 | Build and run on the owner's iPhone from Xcode on a MacBook Pro; run the device test plan and the encryption self-test on iOS | iOS-1 |
| iOS-3 | Apple Developer Program enrollment (organization), bundle ID registration, signing in the owner's Apple account | Legal entity |
| iOS-4 | TestFlight internal testing; then external testing after Beta App Review | Release gate passes |
| iOS-5 | App Store submission: App Privacy label, review guidelines 1.4.1 / 5.1.3, regulatory documentation if requested | Legal/regulatory sign-off |

No iOS IPA is built in Task 4A.

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
| OD-2 | **Decided (Task 4A, ADR-0001):** keep the draft; mark `APPROVED` only after review of the exact contents and version (not a legal/clinical approval); pilot builds refuse unapproved files. Remaining action: the review itself. Earlier note — approve exclusion policy (now `0.2.0-draft`). **Partly decided (Task 3):** azathioprine and mycophenolate are excluded by ingredient regardless of indication; listed anticoagulants and transplant immunosuppressants are excluded. Formal approval (status `APPROVED`, effective date) is still needed; release builds refuse unapproved files. | Product owner | Before release |
| OD-3 | ~~Include OTC versions of supported ingredients?~~ **Closed (Task 3):** OTC products are excluded from MVP v0.1 (policy rule `OTC-MVP`). | Product owner | — |
| OD-4 | ~~Recall refresh strategy~~ **Decided (Task 4A, ADR-0001):** per-medication lookup on request; no monitoring or notifications implied; every result shows retrieval date, coverage and refresh status. | Product owner | — |
| OD-5 | OCR/barcode engine, subject to offline/no-telemetry verification | Architect | Task 5 |
| OD-6 | ~~Encrypted SQLite library and key wrapping~~ **Decided (Task 3):** `@op-engineering/op-sqlite` 19.0.5 with SQLCipher; key in `react-native-keychain` 11.0.0 (Android Keystore). Adapters written and tested with fakes; **device verification pending (Task 6)**. | Architect | Task 6 (verify) |
| OD-7 | ~~Show SPL establishment/facility list to patients?~~ **Closed (Task 2):** manufacturer provenance removed from MVP v0.1; nothing about facilities is shown. | Product owner | — |
| OD-8 | Which recalls to show by default (all history vs ongoing + last N years); terminated recalls collapsed? | Product owner | Task 4 |
| OD-9 | Default branch: the repository had no commits at Task 1, so whichever branch is pushed first becomes GitHub's default. Decide whether to create `main` from the approved Task 1 commit and set it as default | Repository owner | Before Task 2 |
| OD-10 | Minimum supported Android version and target devices | Product owner | Task 4 |
| OD-11 | Replace Document B transcript with the original `.md` file if one exists | Product owner | Any time |
| OD-12 | Catalog matching by name is now the fallback only. Directory-confirmed products get RxNav IN RxCUIs (exact name match) and match by RxCUI; name-only labels still match by name (recorded as `matchedBy: NAME`). Accept? | Product owner + architect | Task 4 |
| OD-13 | FDA records with internal conflicts (product 50090-6448: generic name "Metoprolol Succinate", active ingredient METOPROLOL TARTRATE) currently yield `NEEDS_CLARIFICATION` (salt unknown). Should the user be allowed to resolve such conflicts by confirming the label, or should they stay unassessed? | Product owner | Task 4 |
| OD-14 | When several directory-confirmed NDC candidates exist and exactly one agrees with the printed name/strength/form, the engine uses it (still shown in CONFIRM). Approve, or always show `AMBIGUOUS_IDENTITY`? | Product owner | Task 4 |
| OD-15 | Lot comparison treats hyphen-only differences and partial codes (`J0668398` vs `J0668398-121422`) as `LOT_POSSIBLY_LISTED` → potential match, never confirmed. Confirm this policy. | Product owner | Task 4 |
| OD-16 | Records whose NDC list cannot be read and whose strength is not stated (e.g. bulk tablets, `NDC 53746-0178-BULK`) are shown as potential matches for every same-ingredient product with a compatible release. Accept the extra "might match" items, or collapse them by default? | Product owner | Task 4 |
| OD-17 | **Decided (Task 4A, ADR-0001):** accept conservative uncertainty; no inference; no unqualified no-match when missing source information could affect coverage; never identify plant/manufacturer/source NDC without evidence. Background — openFDA omits `is_original_packager` for some products (e.g. 68094-756). The app then reads the product's own SPL: a declared and verified source is used; if none is declared, the status is `NOT_ESTABLISHED`, which adds the limitation `SOURCE_PRODUCT_NOT_ESTABLISHED`. Accept this conservative default? | Product owner | Task 4 |
| OD-18 | **Decided (Task 4A, ADR-0001):** drafts only in explicitly labeled development builds (`.dev` app ID, DEV name and banner), never in pilot/release APKs; enforced by build profile + Gradle check + release gate. Background — development builds accept draft configuration (`config/app_config.json` `accept_unapproved_config: true`); release builds must not. Confirm the build-flag approach for Task 6. | Architect | Task 6 |
| OD-19 | **Decided and implemented (Task 4A, ADR-0001):** local exclusions run before optional RxNav/DailyMed lookups; identifiers per service documented. Background — identity enrichment called RxNav and DailyMed before the exclusion check, so an excluded drug's public identifiers are still looked up there (no recall request is sent). Move enrichment after an ELIGIBLE decision to reduce queries? | Architect | Task 4 |
| OD-20 | Application ID `org.rxrecallcheck.app` is a placeholder (no domain owned). Confirm before any distribution; it cannot change afterwards. | Product owner | Before pilot |
| OD-21 | Should the app hide its content in the Android recents screen / iOS app switcher (FLAG_SECURE)? It protects privacy but blocks tester screenshots. | Product owner | Task 4B |
| OD-22 | Development builds show the first-launch notice at every launch because nothing is persisted. Acceptable until encrypted persistence is verified? | Product owner | Task 4B |
