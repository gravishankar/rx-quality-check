# Architecture — Rx Quality Check MVP v0.1

Status: design for approval (Task 1). Interfaces below are specifications; code arrives in Tasks 2–6.

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
3. **Fail closed toward uncertainty.** Any failure moves toward `SOURCE_UNAVAILABLE` / `INSUFFICIENT_DATA` / `POSSIBLE_RECALL`, never toward "no match".
4. **User confirmation is an explicit state**, not an implicit side effect of OCR confidence.

## 3. Module boundaries

| Module (`mobile/src/…`) | Responsibility | May import | Must not import |
|---|---|---|---|
| `models/` | Shared types: identifiers, identity, evidence, result states | — | anything with I/O |
| `rules/` | NDC normalization, cross-validation, exclusion policy evaluation, recall relevance, lot comparison, refill diff, explanation selection | `models/`, `data/` (read-only JSON) | `services/`, `storage/`, `scanner/`, React |
| `state/` | Workflow state machine: states, events, transitions, effect descriptors | `models/` | `services/`, `storage/`, `scanner/`, React |
| `scanner/` | Camera capture, on-device OCR, barcode decode, field extraction to `RawExtraction` | `models/` | `services/` |
| `services/` | API clients (openFDA, DailyMed, RxNav), outcome classification, retry/backoff, cache read-through | `models/`, `storage/` (cache repo only) | `state/`, React |
| `storage/` | Encrypted SQLite, migrations, repositories, deletion | `models/` | `services/` |
| `screens/`, `components/` | Presentation; dispatch events; render view models; copy | `state/` (selectors), `models/` | `services/`, `storage/` directly |

The Task 1 helpers in `scripts/lib/` (`ndc.ts`, `http.ts`, `schemas.ts`, `strength.ts`, `spl.ts`)
are the seeds for `rules/` and `services/`. Task 2/3 move them under `mobile/src/` and keep their tests.

## 4. Deterministic workflow state machine

### 4.1 Main path

`SCAN → EXTRACT → IDENTIFY → CHECK_EXCLUSION → CONFIRM → FETCH_EVIDENCE → EVALUATE → EXPLAIN → SAVE`

### 4.2 States

| State | Kind | Description |
|---|---|---|
| `SCAN` | main | Capture image(s) or barcode; or manual entry |
| `EXTRACT` | main | On-device OCR/barcode → `RawExtraction` (NDC candidates, name, strength, form, mfr string, lot, expiry) |
| `IDENTIFY` | main | Normalize NDCs; confirm candidates against NDC Directory/RxNav; cross-validate with printed name/strength; resolve RxCUI (SCD) |
| `CHECK_EXCLUSION` | main | Evaluate catalog scope and exclusion policy on normalized ingredient RxCUIs |
| `CONFIRM` | main | User reviews identified product (each field marked scanned/derived/user-entered) |
| `FETCH_EVIDENCE` | main | Retrieve recall records, SPL establishment summary, source freshness; cache-aware |
| `EVALUATE` | main | Apply evidence rules → `EvidenceAssessment` |
| `EXPLAIN` | main | Select explanation templates for the assessment; render |
| `SAVE` | main | Persist medication, fill and assessment locally (user choice) |
| `AMBIGUOUS_IDENTITY` | alternative | >1 confirmed candidate product, or OCR fields conflict; user must choose or correct |
| `NEEDS_CLARIFICATION` | alternative/terminal | Exclusion eligibility depends on unknown information (e.g., everolimus indication, unlisted class match) |
| `EXCLUDED` | terminal | Recognized; deliberately not assessed |
| `UNSUPPORTED` | terminal | Outside MVP drug/formulation scope |
| `INSUFFICIENT_DATA` | alternative | Supported but product identity insufficient; may continue at ingredient-strength-form level |
| `SOURCE_UNAVAILABLE` | alternative | A required source failed (network, 5xx, invalid response) |
| `RATE_LIMITED` | alternative | A source returned 429; waits for `retryAfter` or user action |
| `USER_CORRECTION` | alternative | User edits a field; returns to `IDENTIFY` |
| `RETRY` | alternative | Bounded retry of the failed effect with backoff |
| `OFFLINE_CACHED_RESULT` | alternative/terminal | Showing a previously saved assessment because live sources are unavailable; age shown |

### 4.3 Transition table (events → next state)

| From | Event | To |
|---|---|---|
| `SCAN` | `CAPTURED` / `MANUAL_ENTRY` | `EXTRACT` |
| `EXTRACT` | `EXTRACTED` (≥1 usable field) | `IDENTIFY` |
| `EXTRACT` | `EXTRACTION_EMPTY` | `USER_CORRECTION` |
| `IDENTIFY` | `IDENTITY_RESOLVED` (exactly one product, cross-validation passed) | `CHECK_EXCLUSION` |
| `IDENTIFY` | `IDENTITY_AMBIGUOUS` | `AMBIGUOUS_IDENTITY` |
| `IDENTIFY` | `IDENTITY_PARTIAL` (RxCUI known, product unknown) | `CHECK_EXCLUSION` (flag `productLevel=false`) |
| `IDENTIFY` | `CROSS_VALIDATION_FAILED` | `IDENTIFY` with NDC discarded (once), then `USER_CORRECTION` |
| `IDENTIFY` | `LOOKUP_UNAVAILABLE` / `LOOKUP_RATE_LIMITED` | `SOURCE_UNAVAILABLE` / `RATE_LIMITED` |
| `AMBIGUOUS_IDENTITY` | `CANDIDATE_CHOSEN` | `CHECK_EXCLUSION` |
| `AMBIGUOUS_IDENTITY` | `EDIT_REQUESTED` | `USER_CORRECTION` |
| `CHECK_EXCLUSION` | policy → `EXCLUDED` | `EXCLUDED` |
| `CHECK_EXCLUSION` | policy → `NEEDS_CLARIFICATION` | `NEEDS_CLARIFICATION` |
| `CHECK_EXCLUSION` | policy → `UNSUPPORTED` | `UNSUPPORTED` |
| `CHECK_EXCLUSION` | policy → `ELIGIBLE` | `CONFIRM` |
| `CONFIRM` | `USER_CONFIRMED` | `FETCH_EVIDENCE` |
| `CONFIRM` | `EDIT_REQUESTED` | `USER_CORRECTION` |
| `USER_CORRECTION` | `FIELDS_UPDATED` | `IDENTIFY` |
| `FETCH_EVIDENCE` | `EVIDENCE_READY` (all required queries OK/NO_MATCH, controls passed) | `EVALUATE` |
| `FETCH_EVIDENCE` | `SOURCE_FAILED` | `RETRY` (if attempts remain) else `SOURCE_UNAVAILABLE` |
| `FETCH_EVIDENCE` | `RATE_LIMITED` | `RATE_LIMITED` |
| `RETRY` | `RETRY_DUE` | the state whose effect failed |
| `SOURCE_UNAVAILABLE` / `RATE_LIMITED` | `CACHE_AVAILABLE` | `OFFLINE_CACHED_RESULT` |
| `SOURCE_UNAVAILABLE` / `RATE_LIMITED` | `USER_RETRY` | `RETRY` |
| `EVALUATE` | `ASSESSED` | `EXPLAIN` |
| `EVALUATE` | `INSUFFICIENT` (no product-level identity) | `INSUFFICIENT_DATA` → `EXPLAIN` (ingredient-level evidence with "may or may not apply") |
| `EXPLAIN` | `SAVE_REQUESTED` | `SAVE` |
| `EXPLAIN` / terminal states | `DONE` / `RESTART` | `SCAN` |

Rules for the machine:
- Pure reducer `(state, event) → { state, effects[] }`. Effects (`RUN_OCR`, `LOOKUP_NDC`, `FETCH_RECALLS`, `PERSIST`…) are executed by the effect runner, which returns events.
- Every transition is total: unknown events in a state leave the state unchanged and are logged locally in debug builds only.
- Retry budget: max 3 attempts per effect, exponential backoff 2 s / 4 s / 8 s with jitter; `RATE_LIMITED` honors `Retry-After` and never auto-retries more than once.
- `EXCLUDED`, `UNSUPPORTED`, `NEEDS_CLARIFICATION` happen **before** any evidence fetch, so no recall query is sent for excluded drugs.

## 5. Local inference rules (`rules/`)

All rules are pure, versioned (`RULESET_VERSION`) and recorded with every saved assessment.

### 5.1 Identity rules
- **R-ID-1 NDC normalization:** enumerate candidates (`scripts/lib/ndc.ts`); barcode check digits must pass.
- **R-ID-2 Directory confirmation:** a candidate is confirmed only by an `OK` NDC Directory or RxNav `ndcstatus` ACTIVE response. Exactly one confirmed → resolved; >1 → ambiguous; 0 with any `SOURCE_UNAVAILABLE` → unavailable; 0 with all `NO_MATCH` → NDC rejected.
- **R-ID-3 Cross-validation:** confirmed NDC's ingredient set, normalized strength and release mechanism must equal the OCR/printed values (Doc A UC-2). Mismatch → discard NDC.
- **R-ID-4 Strength equivalence:** units are normalized (leading-dot decimals, per-unit concentration); mg ≠ mcg unless explicitly converted (`scripts/lib/strength.ts`).
- **R-ID-5 Repackager traversal:** SPL with REPACK/RELABEL and no MANUFACTURE → follow `asEquivalentEntity` source NDC; depth ≤ 3; cycle detection; result records the chain.

### 5.2 Exclusion rules (evaluated in order)
1. Any ingredient RxCUI listed in policy with decision `NEEDS_CLARIFICATION` → `NEEDS_CLARIFICATION`.
2. Any ingredient RxCUI listed with decision `EXCLUDED` and route oral or unknown → `EXCLUDED`.
3. Listed ingredient with a non-oral route → `UNSUPPORTED` (`ADMINISTRATION_RULE_PENDING`, OD-1).
4. Unlisted ingredient whose FDA EPC matches a policy class signal → `NEEDS_CLARIFICATION` (`POLICY_CLASS_MATCH_UNLISTED`).
5. Ingredient set not exactly equal to a catalog entry, or route/product type outside scope → `UNSUPPORTED`.
6. Otherwise → `ELIGIBLE`.

### 5.3 Evidence rules (recall relevance)
Per recall record, against a confirmed identity:
- **R-EV-1 Product match:** an NDC parsed from `product_description` has the confirmed product NDC (labeler-product). → `PRODUCT_MATCH`.
- **R-EV-2 Structured support:** confirmed product NDC appears in `openfda.product_ndc` **and** the description's strength and form match → `PRODUCT_MATCH`; if the strength in text differs → `OTHER_PRODUCT` (openfda over-includes every strength on a label; observed in D-0374-2023).
- **R-EV-3 Possible match:** ingredient set, strength and release mechanism match but no product-level evidence, or the record text cannot be parsed → `POSSIBLE_MATCH`.
- **R-EV-4 Other product:** explicit evidence of a different product NDC, strength, form or ingredient set (e.g., combination product) → `OTHER_PRODUCT`.
- **R-EV-5 Unparseable never clears:** if any required field is missing or ambiguous, the record is `POSSIBLE_MATCH`, never `OTHER_PRODUCT`.
- **R-EV-6 Lot comparison (user-supplied lot only):** `LOT_LISTED` if the normalized lot string appears in `code_info`; otherwise `LOT_NOT_FOUND_IN_LISTING` (explicitly not "unaffected"); `LOT_UNKNOWN` when no lot provided.
- **R-EV-7 Aggregation:** any `PRODUCT_MATCH` → `MATCHED_RECALL`; else any `POSSIBLE_MATCH` → `POSSIBLE_RECALL`; else `NO_MATCHING_RECALL_FOUND` **only if** every required query returned `OK`/`NO_MATCH` and the positive-control query for that source in this session returned `OK`.
- **R-EV-8 Establishment provenance:** report MANUFACTURE establishments count (0 → "not identified in public filings"; >1 → "one of N facilities; which one made your package cannot be determined"). No facility-level judgment.

No rule produces a numeric score.

### 5.4 Refill comparison rules
Compare current vs previous confirmed identity field by field: `productNdc`, `labeler`, `strength`, `doseForm`, `release`, `rxcui`. Output a list of typed differences; strength/form/release changes are flagged `CHECK_WITH_PHARMACIST`.

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
  result_state       TEXT NOT NULL,            -- MATCHED_RECALL|POSSIBLE_RECALL|NO_MATCHING_RECALL_FOUND|EXCLUDED|UNSUPPORTED|NEEDS_CLARIFICATION|INSUFFICIENT_DATA|SOURCE_UNAVAILABLE|RATE_LIMITED
  reason_codes       TEXT NOT NULL,            -- JSON array
  ruleset_version    TEXT NOT NULL,
  policy_version     TEXT NOT NULL,
  catalog_version    TEXT NOT NULL,
  source_snapshot    TEXT NOT NULL             -- JSON: per source {last_updated, retrieved_at, outcome}
);

CREATE TABLE assessment_evidence (
  assessment_id      TEXT NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
  recall_number      TEXT NOT NULL,
  relevance          TEXT NOT NULL CHECK (relevance IN ('PRODUCT_MATCH','POSSIBLE_MATCH','OTHER_PRODUCT')),
  lot_result         TEXT CHECK (lot_result IN ('LOT_LISTED','LOT_NOT_FOUND_IN_LISTING','LOT_UNKNOWN')),
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
  establishments(setId: string): Promise<LookupOutcome<SplEstablishmentSummary>>;
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
- TTLs (proposed, confirm in Task 3): NDC Directory/RxNav identity 30 days; SPL establishment summary 30 days; recall queries 24 hours.
- On `SOURCE_UNAVAILABLE`/`RATE_LIMITED`: if a saved assessment or cached evidence exists, enter `OFFLINE_CACHED_RESULT`, show the age ("Last checked 3 days ago; FDA data dated …") and a retry control. Never present cached `NO_MATCHING_RECALL_FOUND` without its date.
- Expired cache may be shown only as `OFFLINE_CACHED_RESULT`, never as a fresh result.
- Recall cache refresh strategy (OD-4): per-medication queries vs refreshing all 14 catalog drugs together. The latter avoids revealing which drug the user takes (≈28 requests per refresh) and is the recommended default.

## 10. Failure recovery

| Failure | Detection | Recovery |
|---|---|---|
| Network/timeout | `SOURCE_UNAVAILABLE` (`NETWORK_ERROR`/`TIMEOUT`) | Retry ×3 with backoff, then offline cache or retry control |
| HTTP 429 | `RATE_LIMITED` | Wait `Retry-After` (or 60 s), one automatic retry, then user-initiated |
| HTTP 5xx (incl. openFDA malformed query) | `HTTP_5XX` | Retry; if persistent, treat as query bug: log locally, surface `SOURCE_UNAVAILABLE` |
| Schema change | `SCHEMA_VIOLATION` | No retry; `SOURCE_UNAVAILABLE`; app update required |
| Misspelled field / silent query bug | Positive-control query fails to find known recall | Block `NO_MATCHING_RECALL_FOUND` for that session; show `SOURCE_UNAVAILABLE` |
| OCR misread NDC | Cross-validation mismatch | Discard NDC, fall back to name/strength path |
| Corrupt DB / migration failure | SQLite error on open | Restore from pre-migration copy; else offer reset (data loss warning) |
| Policy file invalid | Startup validation | Fail closed: treat all drugs as `UNSUPPORTED` until a valid policy is bundled |
| App killed mid-flow | Reducer state persisted per transition (no images) | Resume at last stable state or restart scan |

## 11. Future extension points

- Additional drugs: add catalog entries plus tests; no code change if rules are generic.
- Policy updates: new `exclusion_policy.json` version shipped in-app (no remote config in v0.1).
- Facility evidence (Doc A A-6) if an official, keyless public API is validated.
- Pill-imprint narrowing via RxNav `ndcproperties` (Doc A A-13/A-14).
- iOS build; background re-check with local notifications (requires battery and privacy decisions).
- Optional user-provided openFDA API key stored in Keystore (raises quotas; never shipped by us).
