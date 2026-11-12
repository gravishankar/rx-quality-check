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
| RC-6 | Pagination: results beyond first page are fetched (total > limit) | Done — rule level (real 2-page fixture); client in Task 3 |

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
| RP-2 | Traversal depth ≤ 3, cycle detection, chain recorded | Task 3 |
| RP-3 | Source NDC not found → "originating manufacturer not identified" | Task 3 |
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
| NET-6 | Retry/backoff budget and `Retry-After` honored (fake clock) | Task 3 |
| NET-7 | Positive-control query failure blocks `NO_MATCH_FOUND` | Done — rule level (`recall_engine.test.ts`); client in Task 3 |

### 2.10 Cache expiration
| ID | Case | Status |
|---|---|---|
| CA-1 | Fresh cache used; expired cache not presented as fresh | Task 3 |
| CA-2 | Failures never cached | Task 3 |
| CA-3 | Offline with cache → `OFFLINE_CACHED_RESULT` showing age and source dates | Task 3/4 |
| CA-4 | Offline without cache → `SOURCE_UNAVAILABLE` | Task 3 |
| CA-5 | Source `last_updated` stored and displayed | Task 3/4 |

### 2.11 Privacy boundaries
| ID | Case | Status |
|---|---|---|
| PV-1 | Request audit: every outbound URL/header contains only allowlisted hosts and public identifiers (no lot, OCR text, IDs) | Task 3 (client), Task 6 (device) |
| PV-2 | Backup exclusion and `allowBackup=false` verified in merged manifest | Task 6 |
| PV-3 | OCR/barcode run with network disabled; packet capture during scan shows no traffic | Task 5 |
| PV-4 | Delete-all removes DB file and key; uninstall leaves nothing | Task 3/6 |
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
| **RG-4** | No patient-facing string contains prohibited claims ("safe", "clean", "verified", "no issues", scores or grades); enforced by a copy lint plus review. |
| **RG-5** | Every result view shows sources, dataset dates, retrieval time and the standing disclaimer. |
| **RG-6** | Privacy tests PV-1…PV-6 pass. |
| **RG-7** | Strength, dose form and IR/ER/DR are preserved end to end (identity → storage → refill diff). |
| **RG-8** | Exclusion policy is approved, versioned and within its six-month review window. |
| **RG-9** | `npm test`, typecheck and Android lint pass with zero failures; no skipped tests. |

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
