# Architecture — Rx Quality Check MVP v0.1

Status: Task 2 implemented `models/`, `rules/`, `state/`, `engine/` and `fsm/`. Task 3 added
`services/` (live public-API clients), `storage/` (SQLite with migrations and repositories) and
`app/` (composition root), together with the schema-2 catalog and policy (§11). Task 4A added the
React Native shell (Android and iOS projects), the presentation layer, the copy file, legal documents,
build profiles and the release gate (§13). Shared logic remains pure TypeScript under `mobile/src/`.

**Scope update (Task 2):** manufacturer provenance is removed from MVP v0.1. The app does not identify
manufacturing facilities, map establishments, show inspection history, score plants or infer where a
product was made. Labeler names are kept only where they are part of product identity or appear in
recall records.

## 1. Phone-only architecture

```
┌──────────────────────────── Android phone ─────────────────────────────┐
│                                                                        │
│  UI (screens, components)                                              │
│        │  events                       ▲ view models                   │
│        ▼                               │                               │
│  state/  Deterministic workflow state machine (pure reducer)           │
│        │  commands (effects)           ▲ effect results                │
│        ▼                               │                               │
│  Effect runner ──► scanner/  (camera, on-device OCR, barcode)          │
│        │      ──► services/ (HTTPS API clients, cache-aware)  ─────────┼──► api.fda.gov
│        │      ──► storage/  (encrypted SQLite repositories)            │    dailymed.nlm.nih.gov
│        │      ──► rules/    (pure evidence & exclusion rules)          │    rxnav.nlm.nih.gov
│        ▼                                                               │
│  models/ shared types · data/ versioned catalog, policy, aliases       │
└────────────────────────────────────────────────────────────────────────┘
```

There is no server operated by this project. The only network peers are the three public hosts above,
reached directly over HTTPS with no credentials.

## 2. Design principles

1. **Pure core, thin shell.** `state/` and `rules/` are pure TypeScript with no I/O, so they can be tested exhaustively with fixtures.
2. **The state machine decides *what happens next*; the rules decide *what evidence means*.** Neither imports the other's internals. The machine calls rules through a typed interface and treats the output as data.
3. **Fail closed toward uncertainty.** Any failure moves toward `SOURCE_UNAVAILABLE` / `UNRESOLVED` / `POTENTIAL_MATCH`, never toward "no match".
4. **User confirmation is an explicit state**, not an implicit side effect of OCR confidence.

## 3. Module boundaries

| Module (`mobile/src/…`) | Responsibility | May import | Must not import |
|---|---|---|---|
| `models/` | Shared types: identifiers, identity, evidence, result states | — | anything with I/O |
| `rules/` | NDC normalization, cross-validation, exclusion policy evaluation, recall relevance, lot comparison, refill diff, explanation selection | `models/`, `data/` (read-only JSON) | `services/`, `storage/`, `scanner/`, React |
| `state/` | Workflow state machine: states, events, transitions, effect descriptors | `models/` | `rules/`, `services/`, `storage/`, `scanner/`, React |
| `fsm/` | Generic state-machine core (rules, gates, validation, run loop); no app knowledge | — | everything else |
| `engine/` | Effect runner: executes effects with injected ports and the pure rules, returns events | `models/`, `rules/`, `state/` | concrete network, storage or OCR code (received as ports) |
| `scanner/` | Camera capture, on-device OCR, barcode decode, field extraction to `RawExtraction` | `models/` | `services/` |
| `services/` | Transport (timeouts, cancellation, host allowlist, privacy guard, audit), outcome classification, clients for openFDA, RxNav and DailyMed, production `Ports` with cache read-through and identity enrichment | `models/`, `rules/` (pure helpers), `engine/` and `state/` (types only) | `storage/` implementations (it uses `SourceCache` and `AssessmentStore` interfaces), React |
| `storage/` | SQL driver interface (op-sqlite/SQLCipher adapter for the app; Node SQLite for tests), key store, migrations, repositories, delete-all | `models/`, `rules/` (refill diff), `services/` and `state/` (types only) | network |
| `app/` | Composition root `createRecallCheck`: configuration, clients, guard, ports, storage, existing workflow | everything in the library | — |
| `presentation/` | Maps internal findings to what a patient may be shown; may only weaken a classification (`docs/EVIDENCE_AND_CLAIMS_POLICY.md`) | `models/`, `copy/` | network, storage, React |
| `copy/` | All patient-facing text (single reviewed file) | — | everything else |
| `legal/` | Bundled legal documents (generated from `docs/legal/`) and acknowledgement versions | — | network |
| `app/screens.ts` | Pure screen models from workflow state (shared by Android and iOS) | `presentation/`, `copy/`, `state/` (types) | React, native modules |
| `mobile/app/` (outside `src/`) | React Native screens and UI kit; render screen models; send events | `mobile/src/**` | native modules except in `mobile/app/platform/native.ts` |
| `mobile/app/platform/` | Platform-neutral `PlatformServices` interface + its React Native implementation (op-sqlite/SQLCipher, keychain, fetch, Linking) | native libraries (cross-platform) | — |

Task 2 moved `scripts/lib/ndc.ts` → `rules/ndc.ts`, `schemas.ts` → `models/openfda.ts`, the
strength helpers → `rules/strength.ts` and the `LookupOutcome` types → `models/lookup.ts`; the old
paths re-export them for the feasibility harness. `http.ts` (fetch + classification) moves to
`services/` in Task 3. `spl.ts` (establishment scanning) stays a Task 1 feasibility tool only and is not
part of the app. Module boundaries are enforced by `tests/unit/architecture_boundaries.test.ts`.

## 4. Deterministic workflow state machine

### 4.1 Main path

`SCAN → EXTRACT → IDENTIFY → CHECK_EXCLUSION → CONFIRM → FETCH_EVIDENCE → EVALUATE → EXPLAIN → SAVE`

### 4.2 States

| State | Kind | Description |
|---|---|---|
| `SCAN` | main | Capture image(s) or barcode; or manual entry |
| `EXTRACT` | main | On-device OCR/barcode → `LabelExtraction` (NDC texts, name, strength, form, labeler text, lot, expiry), each field tagged with origin and OCR confidence |
| `IDENTIFY` | main | Normalize NDCs; confirm candidates against the NDC Directory; cross-validate with printed name/strength/form/release; otherwise build an ingredient-level identity from printed fields |
| `CHECK_EXCLUSION` | main | Evaluate catalog scope and exclusion policy; compute the fields the user must confirm |
| `CONFIRM` | main | User reviews the identity; uncertain OCR fields, the lot and an unprinted release mechanism must be confirmed before anything is fetched |
| `FETCH_EVIDENCE` | main | Retrieve recall records (all pages of every planned query, plus the positive control); cache-aware |
| `EVALUATE` | main | Apply evidence rules → `RecallFinding` |
| `EXPLAIN` | main | Select explanation templates for the finding; render. An ingredient-level identity is explained with `IDENTITY_INGREDIENT_LEVEL_ONLY` (the former `INSUFFICIENT_DATA` presentation) |
| `SAVE` | main | Persist medication, fill and assessment locally (user choice) |
| `SAVED` | terminal | Assessment stored |
| `AMBIGUOUS_IDENTITY` | alternative | ≥2 directory-confirmed candidates consistent with the label; user must choose or correct |
| `MISSING_INFORMATION` | alternative | Nothing usable was read, a required field is missing, or the NDC was discarded twice; user enters or corrects fields |
| `USER_CORRECTION` | alternative | User edits fields on request; returns to `IDENTIFY` |
| `NEEDS_CLARIFICATION` | terminal | Eligibility depends on unknown information (everolimus indication, unlisted class match, unknown salt, unknown route) |
| `EXCLUDED` | terminal | Recognized; deliberately not assessed |
| `UNSUPPORTED` | terminal | Outside MVP drug/formulation scope, or policy/catalog invalid (fail closed) |
| `SOURCE_UNAVAILABLE` | alternative | A required source failed after the retry budget, with no evidence retrieved |
| `RATE_LIMITED` | alternative | A source returned 429; one automatic retry, then user action |
| `RETRY` | alternative | Waiting for a scheduled bounded retry of the failed effect |
| `OFFLINE_CACHED_RESULT` | alternative | Showing a previously saved assessment because live sources are unavailable; age shown |

### 4.3 Transition table (events → next state)

Implemented in `mobile/src/state/machine.ts`; every row has a table-driven test (`tests/unit/state_machine.test.ts`).

| From | Event | To (effects) |
|---|---|---|
| `SCAN` | `CAPTURED` (image or manual entry) | `EXTRACT` (`RUN_EXTRACTION`) |
| `EXTRACT` | `EXTRACTED` | `IDENTIFY` (`RESOLVE_IDENTITY`) |
| `EXTRACT` | `EXTRACTION_EMPTY` | `MISSING_INFORMATION` |
| `IDENTIFY` | `IDENTITY_RESOLVED` (one confirmed product, cross-validation not contradicted) / `IDENTITY_PARTIAL` (ingredient-level) | `CHECK_EXCLUSION` (`CHECK_EXCLUSION`) |
| `IDENTIFY` | `IDENTITY_AMBIGUOUS` (≥2 options) | `AMBIGUOUS_IDENTITY` |
| `IDENTIFY` | `CROSS_VALIDATION_FAILED` / `NDC_REJECTED` | `IDENTIFY` with the NDC discarded (once), then `MISSING_INFORMATION` |
| `IDENTIFY` | `IDENTITY_INCOMPLETE` | `MISSING_INFORMATION` |
| `IDENTIFY` | `LOOKUP_UNAVAILABLE` / `LOOKUP_RATE_LIMITED` | `RETRY` / `RATE_LIMITED` (bounded; see below) |
| `AMBIGUOUS_IDENTITY` | `CANDIDATE_CHOSEN` / `EDIT_REQUESTED` | `CHECK_EXCLUSION` / `USER_CORRECTION` |
| `CHECK_EXCLUSION` | `EXCLUSION_DECIDED` → EXCLUDED / UNSUPPORTED / NEEDS_CLARIFICATION / ELIGIBLE | same-named state / `CONFIRM` |
| `CONFIRM` | `USER_CONFIRMED` with every required field (and a release if unprinted) | `FETCH_EVIDENCE` (`FETCH_RECALL_EVIDENCE`) |
| `CONFIRM` | `USER_CONFIRMED` missing a required field | `CONFIRM` (lists unconfirmed fields; no effect) |
| `CONFIRM` | `EDIT_REQUESTED` | `USER_CORRECTION` |
| `USER_CORRECTION` / `MISSING_INFORMATION` | `FIELDS_UPDATED` | `IDENTIFY` |
| `FETCH_EVIDENCE` | `EVIDENCE_READY` | `EVALUATE` (`EVALUATE_EVIDENCE`) |
| `FETCH_EVIDENCE` | `SOURCE_FAILED` | `RETRY` while attempts remain; then `EVALUATE` if any evidence was retrieved, else `SOURCE_UNAVAILABLE` (`LOAD_CACHED_RESULT`) |
| `FETCH_EVIDENCE` | `RATE_LIMITED` | `RATE_LIMITED` with one automatic retry; a second time: `EVALUATE` (partial) or `RATE_LIMITED` (`LOAD_CACHED_RESULT`) |
| `RETRY` | `RETRY_DUE` (only while a retry is pending) | the state whose effect failed, re-emitting it |
| `SOURCE_UNAVAILABLE` / `RATE_LIMITED` | `CACHE_AVAILABLE` / `USER_RETRY` | `OFFLINE_CACHED_RESULT` / the failed step |
| `OFFLINE_CACHED_RESULT` | `USER_RETRY` | the failed step |
| `EVALUATE` | `ASSESSED` | `EXPLAIN` |
| `EXPLAIN` | `SAVE_REQUESTED` | `SAVE` (`PERSIST_ASSESSMENT`) → `SAVED`, or back to `EXPLAIN` on `PERSIST_FAILED` |
| `EXCLUDED` / `UNSUPPORTED` / `NEEDS_CLARIFICATION` | `EDIT_REQUESTED` | `USER_CORRECTION` |
| result, terminal and waiting states | `DONE` / `RESTART` | `SCAN` |

Rules for the machine (how to change them: `docs/STATE_MACHINE_GUIDE.md`):
- Transitions are the ordered, declarative rule table `RX_RULES` (first match wins), run by the generic core `fsm/core.ts`. Six mandatory safety gates (`RX_SAFETY_GATES`) check every transition of every workflow variant: an exclusion decision and a user confirmation for the current identity must exist before any recall fetch, evaluation or save; both may only come from their own events; a finding may only come from evaluating the retrieved evidence; non-eligible decisions cannot continue. Variants are built with `createRxWorkflow`.
- Pure reducer `(state, event) → { state, effects[], ignored, ruleId, rejectedBy }`. Effects are descriptors (`RUN_EXTRACTION`, `RESOLVE_IDENTITY`, `CHECK_EXCLUSION`, `FETCH_RECALL_EVIDENCE`, `EVALUATE_EVIDENCE`, `PERSIST_ASSESSMENT`, `LOAD_CACHED_RESULT`, `SCHEDULE_RETRY`) executed by the effect runner (`mobile/src/engine/runner.ts`), which calls the pure rules and injected I/O ports and returns events. The reducer imports only `models/`.
- Every transition is total: unknown events leave the state unchanged and return `ignored: true`.
- Retry budget: 3 attempts per effect, backoff 2 s / 4 s (the runner may add jitter). `RATE_LIMITED` honors `Retry-After` (default 60 s) and retries automatically at most once. A `RETRY_DUE` with no outstanding retry (late timer) is ignored.
- Evidence already retrieved when retries run out is still evaluated, so a recall found by one query is never hidden by another query's failure; the finding then carries `SOME_QUERIES_INCOMPLETE`.
- `EXCLUDED`, `UNSUPPORTED` and `NEEDS_CLARIFICATION` are reached before any evidence fetch and emit no effects, so no recall query is ever sent for them (RG-3, property-tested).

## 5. Local inference rules (`rules/`)

All rules are pure and versioned (`RULESET_VERSION`, `mobile/src/rules/version.ts`, currently `0.2.0`), and recorded with every saved assessment.

### 5.1 Identity rules
- **R-ID-1 NDC normalization:** enumerate candidates (`rules/ndc.ts`); barcode check digits must pass. NDCs are compared by a layout-independent 9-digit product key / 11-digit package key, which also reads hyphenated 5-4-2 forms such as `00591-0540-05` seen in recall text.
- **R-ID-2 Directory confirmation:** a candidate is confirmed only by an `OK` NDC Directory answer that lists that exact package. Exactly one confirmed and every candidate answered → resolved; ≥2 → ambiguous (never "take the first"); any candidate unanswered (unavailable / rate-limited) → unavailable, even if another candidate was confirmed; all `NO_MATCH` → NDC rejected.
- **R-ID-3 Cross-validation:** the confirmed NDC's ingredient set, strength, dose form and release mechanism must not contradict the printed label (Doc A UC-2). A contradiction discards the NDC; an unprinted value (e.g. no "ER" on an ER product) requires user confirmation. When several confirmed candidates exist, only those consistent with the label are offered; if exactly one remains it is used and still shown for confirmation.
- **R-ID-4 Strength equivalence:** units are normalized; mcg and g are converted to mg exactly (so "175 MCG" equals ".175 mg/1"), while a value printed with the wrong unit ("175 MG") stays different. Liquids normalize to per-mL. Combination strengths compare as multisets.
- **R-ID-5 Release mechanism:** directory `dosage_form` is authoritative (IR / ER / DR). In free text, absence of a marker is `UNSPECIFIED` (never assumed IR) and contradictory markers are `CONFLICTING`.
- **R-ID-6 Source conflicts:** if the directory's generic name and active-ingredient list disagree on the salt (observed: product 50090-6448, "Metoprolol Succinate" ER listing METOPROLOL TARTRATE), the salt is treated as unknown.
- **R-ID-7 User confirmation:** OCR fields without a confidence or below 0.90, an OCR NDC not corroborated by cross-validation, any lot, and an unprinted release mechanism must be confirmed in `CONFIRM`. A lot is used for matching only when confirmed there.
- **R-ID-8 Repackager source products (identity only, Task 3):** a repackaged product may carry the product NDCs it was repackaged from (`relatedSourceProductNdcs`), used solely to surface recalls of the source product as potential matches (RP-4). No manufacturing facility, establishment or site is inferred.

### 5.2 Exclusion rules (evaluated in order)
1. Any ingredient listed in policy with decision `NEEDS_CLARIFICATION` → `NEEDS_CLARIFICATION`.
2. Any ingredient listed with decision `EXCLUDED` and route oral or unknown → `EXCLUDED`.
3. Listed ingredient with a non-oral route → `UNSUPPORTED` (`ADMINISTRATION_RULE_PENDING`, OD-1).
4. Unlisted ingredient whose FDA EPC matches a policy class signal → `NEEDS_CLARIFICATION` (`POLICY_CLASS_MATCH_UNLISTED`).
5. Route / product type outside scope (`ROUTE_OUT_OF_SCOPE`, `OTC_PENDING_DECISION`), ingredient set not exactly a catalog entry (`NOT_IN_CATALOG`, `COMBINATION_NOT_IN_CATALOG`), required salt different (`SALT_NOT_IN_SCOPE`) → `UNSUPPORTED`; required salt unknown (`SALT_UNKNOWN`) or a liquid with no stated route (`ROUTE_UNKNOWN`) → `NEEDS_CLARIFICATION`.
6. Otherwise → `ELIGIBLE`, recording whether the catalog match was by RxCUI or by normalized name.

Policy entries match by RxCUI when the identity carries one, otherwise by normalized base name (errs toward exclusion). An invalid policy or catalog fails closed: `UNSUPPORTED` (`POLICY_INVALID` / `CATALOG_INVALID`) for every medication.

### 5.3 Recall evidence rules (`rules/recallRecord.ts`, `rules/recallEvidence.ts`)

**Queries.** For a confirmed identity: (1) `product_description:"<ingredient>"` (AND-ed for combinations), (2) `openfda.product_ndc:"<product NDC>"` when the product is known, (3) one query per related source product NDC, and (4) the positive control. Every page of every query is fetched. Only public identifiers are sent; never the lot, label text or images.

**Per record** (against the confirmed identity):
- **R-EV-1 Product match:** the record's own text (description, or a labeled NDC in `code_info`) names the identity's product NDC → `PRODUCT_MATCH`. If the same text states a different strength, form, release or ingredient set, it is downgraded to potential (`TEXT_NDC_STRENGTH_CONFLICT`). If the user's package NDC is known and the record lists only other packages of that product → potential (`PACKAGE_NOT_LISTED`).
- **R-EV-2 Structured support only:** `openfda.product_ndc` lists the product but the text names no NDC → `POSSIBLE_MATCH` (`STRUCTURED_NDC_ONLY`). `openfda.product_ndc` covers every strength on a label, so it never establishes a product match by itself.
- **R-EV-3 Possible match:** ingredient set, strength, form and release are compatible or unstated and there is no product-level evidence either way → `POSSIBLE_MATCH`. Ingredient-level identities can only ever reach `POSSIBLE_MATCH` (`PRODUCT_NOT_IDENTIFIED`).
- **R-EV-4 Other product (explicit evidence only):** a fully parsed text NDC list that names only other products; or an explicitly different ingredient set (combination partner joined by "and", "&", "/", "+", "with" or a list comma), salt, strength, dose form, release, a non-oral route or an active-ingredient (API) record → `OTHER_PRODUCT`.
- **R-EV-5 Unparseable never clears:** an "NDC" mention that cannot be parsed (e.g. `NDC 53746-0178-BULK`) makes the NDC list incomplete → `POSSIBLE_MATCH`; a record missing required fields → `UNPARSEABLE`.
- **R-EV-6 Lot (user-confirmed lot only):** lot scope is read from `code_info` (`ALL_LOTS`, conditional all-lots, lot-specific with lots / ranges / patterns, or unknown). Comparison is exact after normalizing case, whitespace and a leading "Lot"/"#"; hyphen-only differences or partial codes are `LOT_POSSIBLY_LISTED`. Absence is `LOT_NOT_FOUND_IN_LISTING`, never "not affected".

**Record classification.** `PRODUCT_MATCH` + (`ALL_LOTS`, or lot-specific / unknown scope with `LOT_LISTED`) → `CONFIRMED_MATCH`. Any other `PRODUCT_MATCH` (lot not provided, not found, possibly listed, conditional scope, package not listed) and every `POSSIBLE_MATCH` → `POTENTIAL_MATCH`. `OTHER_PRODUCT` → `NOT_APPLICABLE` (kept visible). `UNPARSEABLE` → `UNRESOLVED`. A product-level NDC match alone never confirms a lot-specific recall.

**R-EV-7 Coverage and aggregation.** A query is `COMPLETE` only when it returned a single well-formed "no results" answer, or OK pages whose `skip` values are contiguous, whose `total` is constant and whose records add up to `total`. Anything else is `NOT_RUN`, `SOURCE_UNAVAILABLE`, `RATE_LIMITED`, `INCOMPLETE_PAGINATION`, `INCONSISTENT_PAGINATION` or `PARSE_ERROR`. The positive control passes only if it returns D-0325-2021 **and** the parser reads its NDC.

| Finding | Condition |
|---|---|
| `CONFIRMED_MATCH` | ≥1 record `CONFIRMED_MATCH` |
| `POTENTIAL_MATCH` | else ≥1 record `POTENTIAL_MATCH` |
| `UNRESOLVED` | else any query not `COMPLETE`, the control not passed, or any record `UNRESOLVED` |
| `NO_MATCH_FOUND` | else (complete coverage, control passed, every record parsed and not applicable) |

Every finding carries per-query coverage (outcome per page, records retrieved vs reported total, dataset `last_updated`, retrieval time), the control result and limitations. Standing limitations: `ABSENCE_IS_NOT_SAFETY`, `FDA_DATA_MAY_BE_INCOMPLETE_OR_DELAYED`, `FREE_TEXT_PARSED_CONSERVATIVELY`, `REPACKAGED_PRODUCTS_MAY_NOT_NAME_YOUR_NDC`, `TEXT_QUERY_MAY_MISS_ABBREVIATIONS`; contextual: `PRODUCT_NOT_IDENTIFIED`, `LOT_NOT_PROVIDED`, `SOME_QUERIES_INCOMPLETE`, `POSITIVE_CONTROL_NOT_PASSED`, `SOME_RECORDS_UNPARSEABLE`.

**Positive control (RG-2).** openFDA answers a misspelled or renamed field with HTTP 404 `NOT_FOUND`, identical to a real empty result. The control therefore queries `recall_number:"D-0325-2021" AND product_description:"metformin" AND openfda.product_ndc:"62756-142"`, exercising every field the plan uses; drift in any field fails the control (verified live 2026-11-12) and blocks `NO_MATCH_FOUND`.

No rule produces a numeric score.

### 5.4 Refill comparison rules
Compare current vs previous confirmed identity: product NDC (by product key), labeler, ingredient set, strength, dose form, release. Output typed differences; ingredient, strength, form and release changes are flagged `checkWithPharmacist`; a labeler change alone is reported neutrally. Any difference requires re-evaluation of recall evidence for the new fill.

## 6. Data model and SQLite schema

Encrypted database (SQLCipher-compatible library; selection in Task 3, OD-6). All timestamps ISO-8601 UTC.

```sql
CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- e.g. ('schema_version','1'), ('ruleset_version','0.1.0'), ('policy_version','0.1.0-draft')

CREATE TABLE medication (
  id               TEXT PRIMARY KEY,           -- random UUID, never sent off device
  display_name     TEXT NOT NULL,
  catalog_drug_id  TEXT,                       -- data/drug_catalog.json id; NULL if not eligible
  created_at       TEXT NOT NULL,
  archived_at      TEXT
);

CREATE TABLE fill (
  id                 TEXT PRIMARY KEY,
  medication_id      TEXT NOT NULL REFERENCES medication(id) ON DELETE CASCADE,
  scanned_at         TEXT NOT NULL,
  fill_date          TEXT,                     -- from label if read, user-editable
  package_ndc        TEXT,                     -- hyphenated FDA form
  product_ndc        TEXT,
  ndc11              TEXT,
  rxcui_scd          TEXT,
  ingredient_rxcuis  TEXT NOT NULL,            -- JSON array
  strength_text      TEXT,
  dose_form          TEXT,
  release_mechanism  TEXT CHECK (release_mechanism IN ('IR','ER','DR','UNSPECIFIED')),
  labeler_name       TEXT,
  lot                TEXT,                     -- user-supplied only; never transmitted
  expiry             TEXT,
  identity_source    TEXT NOT NULL,            -- JSON: per-field 'SCANNED'|'DERIVED'|'USER'
  container_type     TEXT CHECK (container_type IN ('PHARMACY_VIAL','ORIGINAL_PACKAGE','UNKNOWN'))
);

CREATE TABLE assessment (
  id                 TEXT PRIMARY KEY,
  fill_id            TEXT NOT NULL REFERENCES fill(id) ON DELETE CASCADE,
  evaluated_at       TEXT NOT NULL,
  result_state       TEXT NOT NULL,            -- CONFIRMED_MATCH|POTENTIAL_MATCH|NO_MATCH_FOUND|UNRESOLVED|EXCLUDED|UNSUPPORTED|NEEDS_CLARIFICATION|SOURCE_UNAVAILABLE|RATE_LIMITED
  reason_codes       TEXT NOT NULL,            -- JSON array
  ruleset_version    TEXT NOT NULL,
  policy_version     TEXT NOT NULL,
  catalog_version    TEXT NOT NULL,
  source_snapshot    TEXT NOT NULL             -- JSON: per source {last_updated, retrieved_at, outcome}
);

CREATE TABLE assessment_evidence (
  assessment_id      TEXT NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
  recall_number      TEXT NOT NULL,
  relevance          TEXT NOT NULL CHECK (relevance IN ('PRODUCT_MATCH','POSSIBLE_MATCH','OTHER_PRODUCT','UNPARSEABLE')),
  classification     TEXT NOT NULL CHECK (classification IN ('CONFIRMED_MATCH','POTENTIAL_MATCH','NOT_APPLICABLE','UNRESOLVED')),
  lot_result         TEXT CHECK (lot_result IN ('LOT_LISTED','LOT_POSSIBLY_LISTED','LOT_NOT_FOUND_IN_LISTING','LOT_UNKNOWN','LOT_NOT_REQUIRED')),
  rule_ids           TEXT NOT NULL,            -- JSON array of rule IDs that fired
  PRIMARY KEY (assessment_id, recall_number)
);

-- Public data cache (contains no patient data; keys are public identifiers)
CREATE TABLE source_cache (
  source             TEXT NOT NULL,            -- OPENFDA_NDC|OPENFDA_ENFORCEMENT|DAILYMED_SPL|RXNAV
  query_key          TEXT NOT NULL,            -- canonical query string
  outcome            TEXT NOT NULL,            -- OK|NO_MATCH  (failures are never cached)
  body_json          TEXT,                     -- trimmed response
  source_last_updated TEXT,                    -- dataset-level marker from the source
  retrieved_at       TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  PRIMARY KEY (source, query_key)
);

CREATE TABLE policy_snapshot (
  policy_version     TEXT PRIMARY KEY,
  json               TEXT NOT NULL,
  installed_at       TEXT NOT NULL
);

CREATE INDEX idx_fill_med ON fill(medication_id, scanned_at);
CREATE INDEX idx_cache_exp ON source_cache(expires_at);
```

Images are **not** stored (OD: optional user-saved label photo is out of scope for v0.1).

## 7. API client interfaces (`services/`)

```ts
type LookupOutcome<T> =
  | { kind: 'OK'; data: T; meta: ResponseMeta }
  | { kind: 'NO_MATCH'; meta: ResponseMeta }
  | { kind: 'RATE_LIMITED'; retryAfterSeconds: number | null; meta: ResponseMeta }
  | { kind: 'SOURCE_UNAVAILABLE'; reason: UnavailableReason; detail: string; meta: ResponseMeta };

interface NdcDirectoryClient {
  byPackageNdc(packageNdc: string): Promise<LookupOutcome<NdcProduct[]>>;
  byProductNdc(productNdc: string): Promise<LookupOutcome<NdcProduct[]>>;
}
interface RxNormClient {
  ndcStatus(ndc11: string): Promise<LookupOutcome<NdcStatus>>;
  ndcProperties(ndc: string): Promise<LookupOutcome<NdcProperty[]>>;   // imprint/color/shape (Task 5)
  rxcuiByName(name: string): Promise<LookupOutcome<string[]>>;
  approximateTerm(text: string): Promise<LookupOutcome<Candidate[]>>;
  version(): Promise<LookupOutcome<{ version: string }>>;
}
interface RecallClient {
  // Free-text and structured queries are both run; results are merged by recall_number.
  byIngredientKeyword(keyword: string, opts: { limit: number; skip?: number }): Promise<LookupOutcome<Enforcement[]>>;
  byProductNdc(productNdc: string): Promise<LookupOutcome<Enforcement[]>>;
  positiveControl(): Promise<LookupOutcome<Enforcement[]>>;            // known recall_number must be returned
}
interface SplClient {
  setIdsByNdc(packageNdc: string): Promise<LookupOutcome<SplSummary[]>>;
  // Repackager source product NDCs only (R-ID-8). No establishment or facility data is read.
  sourceProductNdcs(setId: string): Promise<LookupOutcome<string[]>>;
}
```

Implementation requirements: classification exactly as `scripts/lib/http.ts`; timeouts 20 s; schema
validation on every response; pagination for result sets above the page limit (openFDA `limit` ≤ 1000,
`skip`; DailyMed `page`); generic `User-Agent`; no cookies; certificate validation on (no pinning in v0.1, see PRIVACY).

## 8. Privacy boundaries

| Boundary | Allowed to cross | Never crosses |
|---|---|---|
| Camera → OCR | Image frames in memory | Disk (unless user saves, out of scope), network |
| OCR → state | Extracted fields | Raw image |
| Device → openFDA / DailyMed / RxNav | Public identifiers: NDC, product NDC, ingredient keyword, RxCUI, SPL set ID | Images, OCR text, lot, expiry, fill dates, medication list, user/device IDs |
| App → storage | Medication, fill, assessment, public cache | — |
| Storage → OS backup | Nothing (`allowBackup=false`, data extraction rules exclude DB) | Database, keys |

Details in `docs/PRIVACY.md`.

## 9. Offline and cached-data behavior

- Cache keys are public queries; failures are never cached.
- TTLs (proposed, confirm in Task 3): NDC Directory/RxNav identity 30 days; SPL repackager source NDCs 30 days; recall queries 24 hours.
- On `SOURCE_UNAVAILABLE`/`RATE_LIMITED`: if a saved assessment or cached evidence exists, enter `OFFLINE_CACHED_RESULT`, show the age ("Last checked 3 days ago; FDA data dated …") and a retry control. Never present a cached `NO_MATCH_FOUND` without its date and coverage.
- Expired cache may be shown only as `OFFLINE_CACHED_RESULT`, never as a fresh result.
- Recall cache refresh strategy (OD-4): per-medication queries vs refreshing all 14 catalog drugs together. The latter avoids revealing which drug the user takes (≈28 requests per refresh) and is the recommended default.

## 10. Failure recovery

| Failure | Detection | Recovery |
|---|---|---|
| Network/timeout | `SOURCE_UNAVAILABLE` (`NETWORK_ERROR`/`TIMEOUT`) | Retry ×3 with backoff, then offline cache or retry control |
| HTTP 429 | `RATE_LIMITED` | Wait `Retry-After` (or 60 s), one automatic retry, then user-initiated |
| HTTP 5xx (incl. openFDA malformed query) | `HTTP_5XX` | Retry; if persistent, treat as query bug: log locally, surface `SOURCE_UNAVAILABLE` |
| Schema change | `SCHEMA_VIOLATION` | No retry; `SOURCE_UNAVAILABLE`; app update required |
| Misspelled field / silent query bug | Multi-field positive-control query fails to return and parse the known recall | Block `NO_MATCH_FOUND`; finding is `UNRESOLVED` |
| OCR misread NDC | Cross-validation mismatch | Discard NDC, fall back to name/strength path |
| Corrupt DB / migration failure | SQLite error on open | Restore from pre-migration copy; else offer reset (data loss warning) |
| Policy file invalid | Startup validation | Fail closed: treat all drugs as `UNSUPPORTED` until a valid policy is bundled |
| App killed mid-flow | Reducer state persisted per transition (no images) | Resume at last stable state or restart scan |

## 11. Task 3 implementation notes

- **Configuration.** The catalog and policy (schema 2) are validated at load time (`rules/catalog.ts`) and fail closed. Eligibility precedence is in `docs/EXCLUSION_POLICY_GUIDE.md` §3. Extending them: `docs/DRUG_CATALOG_GUIDE.md`. `RULESET_VERSION` is 0.3.0.
- **Retrieval for a confirmed identity**, all through the existing `Ports`; the state machine and recall engine are unchanged:
  - `planRecallQueries` gives the ingredient text query, the structured product-NDC query, one query per verified source product NDC, and the multi-field positive control.
  - Every page of every query is fetched (`MAX_SKIP` 25,000).
  - Pages are cached for 24 h; NDC Directory answers for 30 days. Only `OK` and `NO_MATCH` are cached, and cached answers keep their original retrieval time.
  - The positive control is never served from the cache.
- **Identity enrichment** (`Ports.enrichIdentity`): adds RxNav IN RxCUIs (exact name match only) and repackager source products. A source counts only when the repackager's own SPL declares it (`asEquivalentEntity`) *and* the NDC Directory confirms the same ingredients, strengths, form and release. Chains are followed to depth 3 with cycle detection. When a source cannot be established, `SOURCE_PRODUCT_NOT_ESTABLISHED` is added to the finding's limitations. Nothing is inferred from manufacturer names.
- **Retries** stay in the state machine (3 attempts, 2/4 s; one automatic rate-limit retry). Clients make one attempt per call. Timeouts (20 s) and caller cancellation are classified as `TIMEOUT` and `CANCELLED`.
- **Storage.** The schema is in `storage/migrations.ts` and supersedes §6's sketch:
  - assessments are immutable rows stamped with the catalog, policy and rule-set versions;
  - medications group fills by ingredient set, so refill changes are detected;
  - the offline cached result is matched to the exact product.
- **Command-line integration:** `npm run e2e` (recorded real responses), `npm run e2e:live`, `npm run e2e:record`.

## 12. Future extension points

- Additional drugs: add catalog entries plus tests; no code change if rules are generic.
- Policy updates: new `exclusion_policy.json` version shipped in-app (no remote config in v0.1).
- Manufacturer provenance (facilities, establishments, inspections) is out of MVP scope; any return requires a new product decision and an official keyless API.
- Pill-imprint narrowing via RxNav `ndcproperties` (Doc A A-13/A-14).
- iOS build (`docs/IOS_BUILD.md`, roadmap in `docs/IMPLEMENTATION_PLAN.md`); background re-check with local notifications (requires battery and privacy decisions).
- Optional user-provided openFDA API key stored in Keystore (raises quotas; never shipped by us).

## 13. Task 4A: app shell, presentation and release controls

```
mobile/
  index.js, App.tsx           entry (polyfills CSPRNG, registers the app)
  app/                        React Native screens + UI kit (Android and iOS)
    platform/types.ts         PlatformServices — platform-neutral interface
    platform/native.ts        the only file importing native modules
  src/                        shared TypeScript (unchanged boundaries, tested by npm test)
  android/                    Android project: flavors dev/pilot, backup exclusion, HTTPS-only config
  ios/                        iOS project (not built yet; docs/IOS_BUILD.md)
  config/build_profile.json   development | pilot (written by build scripts)
```

- **Flow.** Screen → `useRecallSession` → `createRecallCheck` (unchanged) → state machine + safety
  gates + recall engine → `screenFor(state)` → `presentResult` / `presentNotAssessed` → screen.
  Screens never read a finding directly.
- **Presentation rules.** `presentResult` shows NO_MATCH only with complete coverage, a passed
  control, completed queries, no possible/confirmed/unreadable records, a result ≤ 24 h old and FDA
  data ≤ 45 days old; CONFIRMED only with product-level identity and a user-confirmed listed lot (or
  all-lots recall). Otherwise it downgrades (CONFIRMED → POTENTIAL, NO_MATCH → UNABLE) and flags
  inconsistencies.
- **Build profiles (OD-18).** `development`: draft configuration allowed, history off, DEV label and
  app ID suffix. `pilot`: approved configuration only (otherwise every check is CONFIG_BLOCKED),
  history only when encryption was verified on a device. Gradle refuses a flavor/profile mismatch;
  `scripts/android_build.sh pilot` runs `release:gate` first.
- **Exclusion before enrichment (OD-19).** `engine/runner.ts` evaluates the local policy first and
  calls RxNav/DailyMed only for eligible medications.
- **Storage on the phone.** Only when `persistHistory` is true: op-sqlite (SQLCipher) with a 256-bit
  random key in the OS key store (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). Development builds write
  nothing. `storage/encryptionSelfTest.ts` verifies SQLCipher on a device (PV-4).
- **Dependencies and network behavior.**

| Library | Version | Platforms | Network behavior |
|---|---|---|---|
| react-native | 0.88.1 | Android, iOS | fetch used only via the guarded transport |
| @op-engineering/op-sqlite | 19.0.5 (SQLCipher) | Android, iOS | none (local database); build pulls OpenSSL from Maven / CocoaPods |
| react-native-keychain | 11.0.0 | Android (Keystore), iOS (Keychain) | none |
| react-native-get-random-values | 2.0.0 | Android, iOS | none |
| react-native-safe-area-context | 5.11.1 | Android, iOS | none |

- **Cross-platform.** Nothing in `mobile/src/` or the screens is platform-specific; enforced by
  `tests/unit/architecture_boundaries.test.ts`. iOS open items: `docs/IOS_BUILD.md`.

## 14. Task 4A.1: brand configuration

- `config/brand.json` is the single source of product identity: name, name status, tagline, feature
  names, version, legal-entity reference, display labels. It is separate from `data/` (drug catalog,
  exclusion policy), the workflow and the evidence rules.
- `npm run brand:bundle` generates `mobile/src/brand/brand.ts` (imported by `copy/`, `app/` and the
  screens only) and writes the iOS `CFBundleDisplayName`. Android's `app/build.gradle` reads the JSON
  for `app_name` and `versionName`. Legal documents contain `{{PRODUCT_NAME}}`, filled by
  `npm run legal:bundle`.
- Not derived from the brand: application/bundle IDs, signing keys, repository and project names.
- Enforced by `tests/unit/brand.test.ts`: generated files fresh; no hard-coded product name in
  shared code, screens or legal sources; rules/state/fsm/engine/services/storage/models never import
  the brand; brand wording passes the claims rules; a non-cleared name is a release-gate blocker.
- Adding a feature: add a `features.<id>` entry and its screens; the core identity is unchanged.

## 15. Task 4A.2: versioning, UI flow tests, packaging

- `config/app_version.json` → `npm run version:bundle` → `mobile/src/app/version.ts` and the iOS
  project; Gradle reads it for `versionCode`/`versionName`. Separate from `config/brand.json`.
- `mobile/__tests__/flows.test.tsx` (`npm run mobile:test`) renders the real screens with a fake
  `PlatformServices` (recorded responses; fake key store/self-test) — test-only dependencies `jest`,
  `react-test-renderer`, `@react-native/jest-preset` (no runtime network use; not in the APK).
- `AppRoot` keeps entry values, shows a progress screen while the engine works, handles Android Back
  (a no-op on iOS) and accepts an injectable acknowledgement store. Nothing Android-only was added to
  shared code.
- Android packaging: explicit ABI filter from `reactNativeArchitectures`; compressed native
  libraries; ARM64-only APK from a second Gradle pass.

## 16. Task 4C: scanner

```
ScanHome ─ platform.scanner.scanLabel() ─► RxScannerModule (Android, Java)
                                             camera app → private file → memory → delete
                                             PpOcr (PaddleOCR via ONNX Runtime 1.28.0) + ZXing-cpp
          ◄─ { lines[], barcodes[], timings } ─┘
readScan (mobile/src/scanner, pure TS): barcode.ts (UPC/GS1 → NDC, lot, expiry; Rx barcodes rejected)
                                        labelText.ts (NDC anchoring, Rx-line exclusion, O/0 fixes in numbers,
                                        word segmentation, labeled lot only, privateText)
  → LabelExtraction(origin OCR/BARCODE) → existing engine (directory lookup, cross-validation,
    exclusion, confirmation gates, recall evidence) → presentation (new evidence level SCANNED;
    confirmation groups VERIFIED / READ_OR_ENTERED / NEEDS_INPUT)
```

- `scanner/` may import only `models/` and `rules/` (architecture test).
- iOS: `PlatformServices.scanner` is absent → manual entry; an iOS implementation (Apple Vision or ONNX
  Runtime iOS with the same models) can be added behind the same interface.
