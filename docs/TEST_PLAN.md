# Test Plan

All automated tests are deterministic and offline unless marked **LIVE**. Fixtures come from real
public API responses captured by the feasibility harness (`tests/fixtures/api/`, `tests/fixtures/spl/`).
Synthetic values are permitted only for format-only tests and must be labeled in the test.

Status column: **Done** = implemented and passing in Task 1; otherwise the task that implements it.

## 1. Test layers

| Layer | Location | Runner | Scope |
|---|---|---|---|
| Unit | `tests/unit/` | `node --test` via `tsx` (Task 1); Jest in the RN app (Task 4+) | Pure rules, normalizers, parsers, classifiers, data files |
| Integration | `tests/integration/` | same | Rules + fixtures; services with a fake transport; storage with a test DB |
| Live feasibility | `scripts/check_api_feasibility.ts` | `npm run feasibility` | Real endpoints; not part of CI gating (network-dependent) |
| Device / E2E | `mobile/` (Task 6) | Detox or Maestro on emulator + physical device | Scan flows, offline, deletion, privacy audit |
| Usability | moderated sessions | — | Comprehension metrics (PRD §8) |

## 2. Required test areas

### 2.1 NDC normalization
| ID | Case | Status |
|---|---|---|
| NDC-1 | 4-4-2, 5-3-2, 5-4-1 hyphenated → 11-digit (real NDCs where available) | Done (`ndc.test.ts`) |
| NDC-2 | 11-digit → candidate set only where the padding digit is 0; ambiguous flagged | Done |
| NDC-3 | Unhyphenated 10-digit → three layouts, always ambiguous | Done |
| NDC-4 | UPC-A, 13-digit UPC, GTIN-14 with GS1 check digit; corrupted digit rejected (real UPCs) | Done |
| NDC-5 | Pharmacy-label number lookalikes (dates, phone, Rx#) rejected | Done |
| NDC-6 | NDCs extracted from real recall text; ZIP/phone/lot strings ignored | Done |
| NDC-7 | Real round-trip: package NDC ↔ RxNav ndc11 for all 14 fixtures | Done (`fixtures_contract.test.ts`) |
| NDC-8 | Directory confirmation: 0 / 1 / >1 confirmed candidates → rejected / resolved / ambiguous; any unavailable → unavailable | Done (`identity_rules.test.ts`) |

### 2.2 OCR cross-validation
| ID | Case | Status |
|---|---|---|
| OCR-1 | NDC whose directory ingredient/strength matches the printed name/strength → accepted | Done — rule (`identity_rules.test.ts`); OCR in Task 5 |
| OCR-2 | Single-digit OCR error yielding a valid but different product → mismatch → NDC discarded | Done (`identity_rules.test.ts`, `workflow.test.ts`) |
| OCR-3 | Store #, Rx #, ZIP, date misread as NDC → rejected by format or cross-validation | Done — format + cross-validation rule; OCR in Task 5 |
| OCR-4 | ER vs IR mismatch (e.g., "METFORMIN ER 500" vs IR NDC) → mismatch | Done (`identity_rules.test.ts`) |
| OCR-5 | mcg vs mg confusion (levothyroxine) → mismatch, not silently converted | Done (`identity_rules.test.ts`) |
| OCR-6 | Corpus of real label photos (consented/synthetic labels, no PHI) with ground truth | Task 5 |

### 2.3 Exclusion policy enforcement
| ID | Case | Status |
|---|---|---|
| EX-1 | Policy data invariants: 11 entries, classes, decisions, versioning, ≤6-month review, change log | Done (`data_files.test.ts`) |
| EX-2 | Each listed ingredient (oral) → `EXCLUDED` before any network effect is emitted | Done (`exclusion_rules.test.ts`, `workflow.test.ts`) |
| EX-3 | Everolimus → `NEEDS_CLARIFICATION` | Done |
| EX-4 | Combination containing an excluded ingredient → `EXCLUDED` | Done |
| EX-5 | Excluded ingredient, non-oral route → `UNSUPPORTED` / `ADMINISTRATION_RULE_PENDING` | Done |
| EX-6 | Unlisted ingredient with an anticoagulant EPC signal → `NEEDS_CLARIFICATION` | Done |
| EX-7 | Non-catalog drug (e.g., metoprolol tartrate, gabapentin enacarbil) → `UNSUPPORTED`, not `EXCLUDED` | Done |
| EX-8 | UI copy for `EXCLUDED` differs from `INSUFFICIENT_DATA` and includes the "does not imply safe" line | Task 4 |
| EX-9 | Invalid/missing policy file → fail closed (`UNSUPPORTED` for all) | Done |

### 2.4 Product identity ambiguity
| ID | Case | Status |
|---|---|---|
| ID-1 | Two confirmed candidates → `AMBIGUOUS_IDENTITY`; never auto-pick first (Doc A A-20) | Done (synthetic pairing; no real ambiguous pair found) |
| ID-2 | Same ingredient, multiple strengths/forms on one SPL → strength must be confirmed | Done (`recall_engine.test.ts`, Lupin amlodipine / Accord atorvastatin) |
| ID-3 | Name-only label → `INSUFFICIENT_DATA` with ingredient-level evidence labeled "may or may not apply" | Done |
| ID-4 | Exact ingredient-set matching: combination products never match single-ingredient catalog entries | Done |

### 2.5 Recall matching
| ID | Case | Status |
|---|---|---|
| RC-1 | Text NDC equals confirmed product → `PRODUCT_MATCH` (real fixture) | Done (`recall_engine.test.ts`) |
| RC-2 | openfda.product_ndc includes product but text strength differs → `OTHER_PRODUCT` (real D-0374-2023) | Done |
| RC-3 | Record without openfda block and without a parsable NDC, same ingredient/strength/form → `POSSIBLE_MATCH` | Done |
| RC-4 | Combination product record → `OTHER_PRODUCT` for single-ingredient identity | Done |
| RC-5 | Parsing failure on any required field → never `OTHER_PRODUCT` | Done (→ `UNRESOLVED` record; see §5.3 of ARCHITECTURE) |
| RC-6 | Pagination: results beyond first page are fetched (total > limit) | Done (`e2e_scenarios.test.ts` incomplete-response; `workflow.test.ts` two real pages) |

### 2.6 Lot-specific uncertainty
| ID | Case | Status |
|---|---|---|
| LOT-1 | User lot present in `code_info` (real formats: "Lot #JKU4639A", lists, ranges) → `LOT_LISTED` | Done (`text_parsing.test.ts`, `recall_engine.test.ts`) |
| LOT-2 | User lot absent → `LOT_NOT_FOUND_IN_LISTING`; explanation never says "not affected" | Done — rule; copy in Task 4 |
| LOT-3 | No lot provided → `LOT_UNKNOWN` | Done |
| LOT-4 | Normalization (case, spaces, leading "Lot") without fuzzy matching | Done |

### 2.7 Repackager relationships
| ID | Case | Status |
|---|---|---|
| RP-1 | Real repackager SPL: REPACK, no MANUFACTURE, source NDC extracted | Done (`strength_and_spl.test.ts`) |
| RP-2 | Traversal depth ≤ 3, cycle detection, chain recorded | Done — depth 3 + cycle set in `services/ports.ts`; real one-hop chain verified (`api_clients.test.ts`) |
| RP-3 | Source NDC not found → "originating manufacturer not identified" | Done — `NOT_ESTABLISHED`/`UNAVAILABLE` + limitation `SOURCE_PRODUCT_NOT_ESTABLISHED` |
| RP-4 | Recall on source product NDC is surfaced for the repackaged product as `POSSIBLE_MATCH` unless lot/text confirms | Done — rule (`relatedSourceProductNdcs`); traversal in Task 3 |

### 2.8 Missing manufacturer or facility information — removed (Task 2)
Manufacturer provenance is out of MVP v0.1. MF-1/MF-2 remain as Task 1 harness tests of
`scripts/lib/spl.ts` (feasibility record only). MF-3/MF-4 are withdrawn. A static test asserts the
app library contains no establishment/facility logic (`architecture_boundaries.test.ts`).

### 2.9 Network failures
| ID | Case | Status |
|---|---|---|
| NET-1 | 404 NOT_FOUND → NO_MATCH (openFDA only) | Done (`http_classification.test.ts`) |
| NET-2 | Gateway 404, 5xx, HTML error pages, truncated JSON, schema violations → `SOURCE_UNAVAILABLE` | Done |
| NET-3 | 429 with/without Retry-After → `RATE_LIMITED` | Done |
| NET-4 | DailyMed empty vs malformed; RxNav empty vs malformed | Done |
| NET-5 | Timeout and DNS failure → `SOURCE_UNAVAILABLE` (live harness verified) | Done (LIVE) |
| NET-6 | Retry/backoff budget and `Retry-After` honored (fake clock) | Done (`state_machine.test.ts`, `e2e` network-failure) |
| NET-7 | Positive-control query failure blocks `NO_MATCH_FOUND` | Done (`recall_engine.test.ts`, multi-field control recorded live) |

### 2.10 Cache expiration
| ID | Case | Status |
|---|---|---|
| CA-1 | Fresh cache used; expired cache not presented as fresh | Done (`api_clients.test.ts`, `storage.test.ts`) |
| CA-2 | Failures never cached | Done (`api_clients.test.ts`, CHECK constraint in `storage.test.ts`) |
| CA-3 | Offline with cache → `OFFLINE_CACHED_RESULT` showing age and source dates | Done — engine (`e2e` offline-cached); display in Task 4 |
| CA-4 | Offline without cache → `SOURCE_UNAVAILABLE` | Done (`e2e` network-failure) |
| CA-5 | Source `last_updated` stored and displayed | Done — stored (`source_cache.source_last_updated`, `assessment.dataset_last_updated`); display in Task 4 |

### 2.11 Privacy boundaries
| ID | Case | Status |
|---|---|---|
| PV-1 | Request audit: every outbound URL/header contains only allowlisted hosts and public identifiers (no lot, OCR text, IDs) | Done — library level (`api_clients.test.ts`, `e2e_scenarios.test.ts`); device in Task 6 |
| PV-2 | Backup exclusion and `allowBackup=false` verified in merged manifest | Task 6 |
| PV-3 | OCR/barcode run with network disabled; packet capture during scan shows no traffic | Task 5 |
| PV-4 | Delete-all removes DB file and key; uninstall leaves nothing | Done — Node SQLite (`storage.test.ts`); device + SQLCipher in Task 6 |
| PV-5 | Release logs contain no identifiers (log capture scan) | Task 6 |
| PV-6 | Dependency/manifest scan for telemetry SDKs | Task 6 |

## 3. State machine tests (Task 2) — Done

- Table-driven tests for every row of ARCHITECTURE §4.3 (`state_machine.test.ts`).
- Property (seeded, 400 random sequences): a recall fetch is emitted only for an ELIGIBLE, fully confirmed identity; `EXCLUDED`/`UNSUPPORTED`/`NEEDS_CLARIFICATION` emit no effects.
- Property (workflow, 60 seeded runs with random request failures): `NO_MATCH_FOUND` only ever comes from a bundle in which every page was `OK`/`NO_MATCH` and the control passed (`workflow.test.ts`).
- Retry budget bounded; `RATE_LIMITED` auto-retries at most once; late `RETRY_DUE` timers are ignored.

## 4. Fixture policy

- Captured with `npm run feasibility:fixtures`; each file records `capturedAt` and that it contains no patient data.
- Trimmed to ≤ 3 records; SPL XML stored whole (3 documents).
- Fixtures are immutable once referenced by a test; refresh by adding new files, not editing old ones.
- Synthetic failure bodies in unit tests reproduce shapes observed live (documented in the test).

## 5. Commands

```bash
npm test
```

```bash
npm run typecheck
```

```bash
NODE_USE_ENV_PROXY=1 npm run feasibility
```

## 6. Release gates (must all pass before any release build)

| Gate | Requirement |
|---|---|
| **RG-1** | A known recall must never be classified as a confirmed non-match because of a parsing or lookup failure. Injecting each failure (network, timeout, 5xx, 429, truncated JSON, missing field, schema change, incomplete pagination, query not run) yields `CONFIRMED_MATCH`/`POTENTIAL_MATCH` (when another query still found the recall) or `UNRESOLVED` — never `NO_MATCH_FOUND`. Rule level: Done (`recall_engine.test.ts`). |
| **RG-2** | Positive control: each session's recall queries include `recall_number:"D-0325-2021" AND product_description:"metformin" AND openfda.product_ndc:"62756-142"`, which exercises every field the plan uses (a drifted field returns 404 `NOT_FOUND`, verified live). If it does not return the record, or the parser cannot read its NDC, `NO_MATCH_FOUND` is blocked. Rule level: Done; client: Task 3. |
| **RG-3** | Excluded drugs never trigger a recall request (effect audit). Done at library level (`state_machine.test.ts` property, `workflow.test.ts` audit). |
| **RG-4** | No patient-facing string contains prohibited claims ("safe", "clean", "verified", "no issues", scores or grades); enforced by a copy lint plus review. Automated in Task 4A (`claims_and_copy.test.ts`: copy, screens, presented results, legal drafts); pharmacist review pending. |
| **RG-5** | Every result view shows sources, dataset dates, retrieval time and the standing disclaimer. Automated at view-model level in Task 4A; on-screen check in the device test plan. |
| **RG-6** | Privacy tests PV-1…PV-6 pass. |
| **RG-7** | Strength, dose form and IR/ER/DR are preserved end to end (identity → storage → refill diff). |
| **RG-8** | Exclusion policy is approved, versioned and within its six-month review window. |
| **RG-9** | `npm test`, typecheck and Android lint pass with zero failures; no skipped tests. |
| **RG-10** (Task 4A) | Uncertainty never becomes reassurance: NO_MATCH shown only with complete, fresh, controlled evidence; CONFIRMED only with product identity and a confirmed listed lot (negative + property tests). |
| **RG-11** (Task 4A) | `npm run release:gate` reports no blockers (approvals, legal documents, six sign-offs, device encryption). |

## 7. Task 1 results

`npm test`: **58 tests, 58 pass, 0 fail** (5 files). `npm run typecheck`: clean.
Live harness: 5 PASS / 5 WARN / 0 FAIL / 0 BLOCKED (see `docs/API_FEASIBILITY.md`).

## 8. Task 2 results

`npm test`: **234 tests, 234 pass, 0 fail, 0 skipped** (14 files: 5 from Task 1, 9 new). `npm run typecheck`: clean.
`npm run test:coverage` on `mobile/src`: **97.7% lines, 83.7% branches, 97.2% functions**.

State-machine refinement: `tests/unit/state_machine.test.ts` builds post-confirmation test states
with the exclusion decision and confirmation the real flow records (now required by the safety
gates); its assertions are unchanged. The layering test now includes the `fsm/` layer.

| File | Tests | Scope |
|---|---|---|
| `tests/unit/identity_rules.test.ts` | 26 | NDC keys, text NDC extraction, NDC-8, OCR-1…5, IR/ER, OCR confirmation, ID-1, ID-3 |
| `tests/unit/exclusion_rules.test.ts` | 16 | EX-2…7, EX-9, OTC, route, real FDA salt conflict |
| `tests/unit/text_parsing.test.ts` | 14 | Strengths, release markers, combination partners, LOT-1…4, lot scope |
| `tests/unit/state_machine.test.ts` | 51 | §4.3 table, confirmation gating, retry/rate-limit budgets, seeded properties |
| `tests/unit/architecture_boundaries.test.ts` | 6 | Module layering, no I/O in pure layers, no telemetry/LLM, no provenance code, fixture provenance |
| `tests/integration/recall_engine.test.ts` | 31 | RC-1…5, lot-specific recalls, multi-strength labels, combinations, RP-4, RG-1, RG-2, pagination, determinism, refills |
| `tests/integration/workflow.test.ts` | 12 | End-to-end runner with fixture ports, request audit (PV-1, library level), RG-3, retries, offline, ambiguity |
| `tests/integration/workflow_variants.test.ts` | 14 | Alternative workflow (no retries, save-first), optional patient-attestation state, six bypass attempts vetoed by the safety gates |
| `tests/unit/fsm_core.test.ts` | 6 | Generic core reused by a non-Rx document-approval machine: rules, guards, gates, validation, graph queries, run loop |

Fixtures: 33 real openFDA responses in `tests/fixtures/task2/` (records reduced to the fields the app
reads; captured 2026-11-12; `INDEX.json`). Task 1 test change: `strength_and_spl.test.ts` previously asserted "75 mcg ≠ 0.075 mg"; it now asserts exact unit conversion and that a wrong unit ("75 mg") still mismatches (R-ID-4). Synthetic inputs are limited to labeled format-only cases:
HTTP 429 bodies, network/timeout outcomes, an ambiguous-candidate pairing, and "modified real" records
(one field changed, labeled at use).

## 9. Task 3 results

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **323 tests, 323 pass, 0 fail, 0 skipped** (18 files). The Task 2 suite (234) still passes; see the note below. |
| `npm run test:coverage` (`mobile/src`) | 98.2% lines, 85.4% branches, 96.8% functions |
| `npm run config:test` | 0 errors, 0 warnings; precedence self-test 51/51 |
| `npm run e2e` (recorded) | 13/13 scenarios |
| `npm run e2e:live` (live HTTPS, 2026-11-12) | 13/13 scenarios |
| `npm run feasibility` (live, re-run) | 5 PASS, 5 WARN, 0 FAIL, 0 BLOCKED (`docs/feasibility/task3-run.json`) |

New test files:
- `tests/unit/config_validation.test.ts` (39): actionable errors, fail-closed loading, disable, alias, combination, restrictions, precedence.
- `tests/integration/api_clients.test.ts` (17): guard, timeouts, cancellation, failure kinds, input refusal, recorded responses, XML/SPL, cache rules, source verification.
- `tests/integration/storage.test.ts` (13): migrations (fresh, idempotent, rollback, newer-schema refusal), repositories, refill history, immutable history across policy versions, cache, delete-all, key store, op-sqlite adapter through a fake `open()` (native module untested).
- `tests/integration/e2e_scenarios.test.ts` (15): the 13 scenarios in recorded mode, scenario coverage, and the privacy audit.

Changed earlier tests (assertions updated for approved Task 3 decisions, not weakened):
- `data_files.test.ts`: the same invariants, restated for schema 2.
- `exclusion_rules.test.ts`:
  - OTC is now `EXCLUDED` (`OTC-MVP`, closing OD-3) instead of `UNSUPPORTED`/`OTC_PENDING_DECISION`;
  - the policy version is now `0.2.0-draft`;
  - the rule id and explanation are now asserted.
- `architecture_boundaries.test.ts`: covers the new layers; the Node-only SQLite driver is allowed only as an unimported module; the provenance check ignores comments.

Recorded fixtures: `tests/fixtures/task3/cassette.json` holds 34 real responses from openFDA, RxNav and DailyMed, recorded 2026-11-12 by `npm run e2e:record` and replayed by exact URL. An unrecorded request fails, so mocks are never silently substituted. Synthetic inputs are labeled per scenario: patient text, injected network failures, and a truncated page (modified real data).

**Not verified (needs an Android device, Tasks 4/6):**
- SQLCipher encryption at rest and the op-sqlite and react-native-keychain adapters against the native modules;
- backup exclusion in the merged manifest;
- network behavior from mobile networks;
- the OS key store under Keystore reset.

## 10. Task 4A results (2026-11-12)

| Command / check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run mobile:typecheck` (React Native screens, `mobile/tsconfig.json`) | clean |
| `npm test` | **380 tests, 380 pass, 0 fail, 0 skipped** (Task 3: 323, all still passing) |
| `npm run test:coverage` (`mobile/src`) | 98.5% lines, 85.9% branches, 96.9% functions (`presentation/present.ts` 98.2% lines; `app/screens.ts` 100% lines) |
| `npm run config:test` | 0 errors; precedence self-test 51/51 |
| `npm run e2e` (recorded) | 13/13 scenarios |
| `npm run release:gate` | **14 blockers** (exit 1) — pilot build refused, as intended |
| Metro production bundle (Android) | builds; no Node-only module in the bundle |
| `npm run android:dev` | **built**: `app-dev-release.apk`, 63.5 MB, `org.rxrecallcheck.app.dev`, versionName `0.1.0-dev`, versionCode 1, label "Rx Recall Check (DEV)", minSdk 24, targetSdk 36, ABIs arm64-v8a / armeabi-v7a / x86_64 |
| APK inspection (`aapt2`, `apksigner`, `unzip`) | permissions: `INTERNET` only (+ the app's own non-exported receiver permission; keychain's biometric permissions removed); not debuggable; `allowBackup=false`, data-extraction rules, cleartext off; JS bundled as Hermes bytecode (no Metro needed); `libop-sqlite.so` and `libcrypto.so` (SQLCipher/OpenSSL) present for each ABI; APK Signature Scheme v2 with the locally generated development key |

New tests in Task 4A:
- `tests/unit/claims_and_copy.test.ts` (27): four categories with supporting evidence; negative tests (incomplete coverage, failed control, unreadable/possible records, missing dataset date, stale result, stale dataset, network failure, incomplete pagination, missing records, confirmed without evidence, unknown repackager source, user-entered identity); 2,000-case property test; not-assessed never "passed"; evidence labels (verified vs user-entered, conflicting records, labeler terminology); prohibited wording in copy, screens, presented results and legal drafts; legal bundle freshness; consent versions; build profiles; release gate.
- `tests/integration/app_screens.test.ts` (16): screen model for every e2e scenario; OD-19 (no RxNav/DailyMed request when excluded, unsupported or configuration-blocked); confirmation requires each item; lot never transmitted.
- `tests/unit/screen_models.test.ts` (8), `tests/unit/encryption_self_test.test.ts` (3, SYNTHETIC fakes of op-sqlite), and 3 new architecture tests (native modules only in the platform adapter, dependency allowlist, manifest permissions/backup/cleartext).

Changed earlier behavior (approved OD-19): excluded, unsupported and invalid-policy scenarios now make
1 request (NDC Directory) instead of also calling RxNav/DailyMed; their e2e checks are unchanged.

**Not verified (no physical device or emulator in the build environment; `/dev/kvm` absent):** the
APK has not been installed or launched. Pending: `docs/ANDROID_DEVICE_TEST_PLAN.md` (all items),
on-device encryption self-test and file inspection (PV-4), TalkBack and font scaling, backup
exclusion on a device, network capture. Tests prove code behavior only; they are not clinical or
legal validation.

## 11. Task 4A.1 results (2026-11-12)

| Command / check | Result |
|---|---|
| Baseline on `task-4a/android-pilot` (`5d50dfa`) | 380/380 pass |
| `npm test` | **388 tests, 388 pass, 0 fail, 0 skipped** (+8 in `tests/unit/brand.test.ts`) |
| `npm run typecheck`, `npm run mobile:typecheck` | clean |
| `npm run config:test` | OK |
| `npm run e2e` (recorded) | 13/13 |
| `npm run release:gate` | **15 blockers** (adds the unclear product name) — pilot refused |
| `npm run android:dev` | built: label "MedLuma (DEV)", `org.rxrecallcheck.app.dev`, versionName `0.1.0-dev`, INTERNET only, not debuggable, same development certificate; SHA-256 `0718180fb5a107c0fb99bf6cc2ffde256c1b9a81a35b9380f44fe97bec2b3907` |
| Task 4A APK preserved | SHA-256 `648e9c07b4598ea570d22cefd11c5b9ff983bc56392cfb16f6ad9748fa00de11`, unchanged |

Unchanged in 4A.1: engine, safety gates, evidence classification and presentation rules (no test
assertions about them were changed). Physical-device testing is still pending
(`docs/FIRST_DEVICE_TEST_RUNBOOK.md`).

## 12. Task 4A.2 results (2026-11-12)

| Command / check | Result |
|---|---|
| Baseline (`task-4a1/medluma-brand`, `df0d120`) | 388/388 |
| `npm test` | **395 tests, 395 pass, 0 fail, 0 skipped** (+4 version, +2 screen-model, +1 Android packaging) |
| `npm run mobile:test` (new: real screens, recorded real responses) | **15/15 pass** |
| `npm run typecheck`, `npm run mobile:typecheck` | clean |
| `npm run config:test` / `npm run e2e` | OK / 13/13 |
| `npm run release:gate` | 15 blockers (unchanged) |
| `npm run android:dev` | build 3 (0.1.2-dev, versionCode 3): ARM64 15.2 MB, universal 29.6 MB; INTERNET only; SQLCipher/OpenSSL present per CPU type; not debuggable; same development certificate |

Physical device: **not tested** (no device or emulator; no `/dev/kvm`). Plan: `docs/FUNCTIONAL_TEST_PLAN.md`.

## 13. Task 4C results (2026-11-12)

**Automated / simulated (desktop):**

| Check | Result |
|---|---|
| `npm test` | **415 tests, 415 pass, 0 fail, 0 skipped** (+14 scanner extraction, +5 scanner end-to-end, +2 architecture) |
| `npm run mobile:test` (real screens) | **25/25** (+10 scan-flow UI tests with a fake scanner returning real OCR output) |
| Typechecks, `config:test`, `e2e` | clean / OK / 13/13 |
| OCR bake-off (32 synthetic labels) | PaddleOCR NDC 28/28, name 32/32, strength 31/32 after extraction; Tesseract NDC 24/28; ZXing-cpp 29/32 barcodes (`docs/task4c/OCR_EVALUATION.md`) |
| Scanned label → recall result, recorded real FDA data | 64/64 flows as expected (`tests/integration/scanner_flow.test.ts`) |
| Printable test sheet (7 labels), live FDA data | 7/7 as expected |
| `npm run android:dev` | build 4: ARM64 38.9 MB, universal 76.7 MB; privacy gate passed (INTERNET only; no telemetry classes/components) |

**Physical device:** not tested (no device/emulator available). Pixel test: `docs/task4c/PIXEL_SCAN_TEST_GUIDE.md`.

**Physical device — first result (team's Pixel, build 4, 2026-11-12):** every scan → "We couldn't read
your label / The photo could not be read." Root cause found in code: `zxingcpp.BarcodeReader.read(Bitmap,
Rect, int)` is Kotlin with a non-null `Rect`; the module passed `null`, so every analysis threw a
NullPointerException (confirmed from the library bytecode). Fixed in build 5 (0.1.4): full-image crop
rectangle; text and barcode reading isolated; development builds show the technical cause. Regression
tests: architecture (static) and UI (failure/partial-failure display). Build 5 not yet re-tested on the
device.

