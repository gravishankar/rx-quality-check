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
| NDC-8 | Directory confirmation: 0 / 1 / >1 confirmed candidates → rejected / resolved / ambiguous; any unavailable → unavailable | Task 2 |

### 2.2 OCR cross-validation
| ID | Case | Status |
|---|---|---|
| OCR-1 | NDC whose directory ingredient/strength matches the printed name/strength → accepted | Task 2 (rule), Task 5 (OCR) |
| OCR-2 | Single-digit OCR error yielding a valid but different product → mismatch → NDC discarded | Task 2 |
| OCR-3 | Store #, Rx #, ZIP, date misread as NDC → rejected by format or cross-validation | Task 2/5 |
| OCR-4 | ER vs IR mismatch (e.g., "METFORMIN ER 500" vs IR NDC) → mismatch | Task 2 |
| OCR-5 | mcg vs mg confusion (levothyroxine) → mismatch, not silently converted | Task 2 (strength part Done) |
| OCR-6 | Corpus of real label photos (consented/synthetic labels, no PHI) with ground truth | Task 5 |

### 2.3 Exclusion policy enforcement
| ID | Case | Status |
|---|---|---|
| EX-1 | Policy data invariants: 11 entries, classes, decisions, versioning, ≤6-month review, change log | Done (`data_files.test.ts`) |
| EX-2 | Each listed ingredient (oral) → `EXCLUDED` before any network effect is emitted | Task 2 |
| EX-3 | Everolimus → `NEEDS_CLARIFICATION` | Task 2 (data Done) |
| EX-4 | Combination containing an excluded ingredient → `EXCLUDED` | Task 2 |
| EX-5 | Excluded ingredient, non-oral route → `UNSUPPORTED` / `ADMINISTRATION_RULE_PENDING` | Task 2 |
| EX-6 | Unlisted ingredient with an anticoagulant EPC signal → `NEEDS_CLARIFICATION` | Task 2 |
| EX-7 | Non-catalog drug (e.g., metoprolol tartrate, gabapentin enacarbil) → `UNSUPPORTED`, not `EXCLUDED` | Task 2 |
| EX-8 | UI copy for `EXCLUDED` differs from `INSUFFICIENT_DATA` and includes the "does not imply safe" line | Task 4 |
| EX-9 | Invalid/missing policy file → fail closed (`UNSUPPORTED` for all) | Task 2 |

### 2.4 Product identity ambiguity
| ID | Case | Status |
|---|---|---|
| ID-1 | Two confirmed candidates → `AMBIGUOUS_IDENTITY`; never auto-pick first (Doc A A-20) | Task 2 |
| ID-2 | Same ingredient, multiple strengths/forms on one SPL → strength must be confirmed | Task 2 |
| ID-3 | Name-only label → `INSUFFICIENT_DATA` with ingredient-level evidence labeled "may or may not apply" | Task 2 |
| ID-4 | Exact ingredient-set matching: combination products never match single-ingredient catalog entries | Task 2 (harness behavior Done) |

### 2.5 Recall matching
| ID | Case | Status |
|---|---|---|
| RC-1 | Text NDC equals confirmed product → `PRODUCT_MATCH` (real fixture) | Task 2 |
| RC-2 | openfda.product_ndc includes product but text strength differs → `OTHER_PRODUCT` (real D-0374-2023) | Task 2 (hazard documented Done) |
| RC-3 | Record without openfda block and without a parsable NDC, same ingredient/strength/form → `POSSIBLE_MATCH` | Task 2 |
| RC-4 | Combination product record → `OTHER_PRODUCT` for single-ingredient identity | Task 2 |
| RC-5 | Parsing failure on any required field → `POSSIBLE_MATCH`, never `OTHER_PRODUCT` | Task 2 |
| RC-6 | Pagination: results beyond first page are fetched (total > limit) | Task 3 |

### 2.6 Lot-specific uncertainty
| ID | Case | Status |
|---|---|---|
| LOT-1 | User lot present in `code_info` (real formats: "Lot #JKU4639A", lists, ranges) → `LOT_LISTED` | Task 2 |
| LOT-2 | User lot absent → `LOT_NOT_FOUND_IN_LISTING`; explanation never says "not affected" | Task 2/4 |
| LOT-3 | No lot provided → `LOT_UNKNOWN` | Task 2 |
| LOT-4 | Normalization (case, spaces, leading "Lot") without fuzzy matching | Task 2 |

### 2.7 Repackager relationships
| ID | Case | Status |
|---|---|---|
| RP-1 | Real repackager SPL: REPACK, no MANUFACTURE, source NDC extracted | Done (`strength_and_spl.test.ts`) |
| RP-2 | Traversal depth ≤ 3, cycle detection, chain recorded | Task 3 |
| RP-3 | Source NDC not found → "originating manufacturer not identified" | Task 3 |
| RP-4 | Recall on source product NDC is surfaced for the repackaged product as `POSSIBLE_MATCH` unless lot/text confirms | Task 2/3 |

### 2.8 Missing manufacturer or facility information
| ID | Case | Status |
|---|---|---|
| MF-1 | SPL with no establishment section → flagged (real fixture) | Done |
| MF-2 | MANUFACTURE detected via C43360 / displayName; C43215 absent in live data | Done |
| MF-3 | >1 MANUFACTURE establishment → "one of N; cannot determine" (no imprint prompt) | Task 2 |
| MF-4 | No result state is ever "verified/clean" when establishments are empty | Task 2/4 |

### 2.9 Network failures
| ID | Case | Status |
|---|---|---|
| NET-1 | 404 NOT_FOUND → NO_MATCH (openFDA only) | Done (`http_classification.test.ts`) |
| NET-2 | Gateway 404, 5xx, HTML error pages, truncated JSON, schema violations → `SOURCE_UNAVAILABLE` | Done |
| NET-3 | 429 with/without Retry-After → `RATE_LIMITED` | Done |
| NET-4 | DailyMed empty vs malformed; RxNav empty vs malformed | Done |
| NET-5 | Timeout and DNS failure → `SOURCE_UNAVAILABLE` (live harness verified) | Done (LIVE) |
| NET-6 | Retry/backoff budget and `Retry-After` honored (fake clock) | Task 3 |
| NET-7 | Positive-control query failure blocks `NO_MATCHING_RECALL_FOUND` | Task 3 |

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

## 3. State machine tests (Task 2)

- Table-driven tests for every row of ARCHITECTURE §4.3.
- Property test: no event sequence reaches `NO_MATCHING_RECALL_FOUND` if any fetch effect returned `SOURCE_UNAVAILABLE`/`RATE_LIMITED`.
- Property test: `EXCLUDED`/`UNSUPPORTED`/`NEEDS_CLARIFICATION` emit no `FETCH_*` effects.
- Retry budget bounded; `RATE_LIMITED` auto-retries at most once.

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
| **RG-1** | A known recall must never be classified as a confirmed non-match because of a parsing or lookup failure. For every recall fixture, injecting each failure (network, timeout, 5xx, 429, truncated JSON, missing field, schema change) yields `SOURCE_UNAVAILABLE`, `RATE_LIMITED` or `POSSIBLE_RECALL` — never `NO_MATCHING_RECALL_FOUND`. |
| **RG-2** | Positive control: each session's recall queries include a known-positive query (e.g., `recall_number` D-0325-2021). If it does not return the record, `NO_MATCHING_RECALL_FOUND` is blocked. Guards against field-name drift returning `NOT_FOUND`. |
| **RG-3** | Excluded drugs never trigger a recall request (effect audit). |
| **RG-4** | No patient-facing string contains prohibited claims ("safe", "clean", "verified", "no issues", scores or grades); enforced by a copy lint plus review. |
| **RG-5** | Every result view shows sources, dataset dates, retrieval time and the standing disclaimer. |
| **RG-6** | Privacy tests PV-1…PV-6 pass. |
| **RG-7** | Strength, dose form and IR/ER/DR are preserved end to end (identity → storage → refill diff). |
| **RG-8** | Exclusion policy is approved, versioned and within its six-month review window. |
| **RG-9** | `npm test`, typecheck and Android lint pass with zero failures; no skipped tests. |

## 7. Task 1 results

`npm test`: **58 tests, 58 pass, 0 fail** (5 files). `npm run typecheck`: clean.
Live harness: 5 PASS / 5 WARN / 0 FAIL / 0 BLOCKED (see `docs/API_FEASIBILITY.md`).
