# Data Schemas

The app reads two configuration files that ship inside it, and keeps one database on the phone.
The machine-readable schemas are the source of truth:

| Data | File in the app | Machine-readable schema | Checked by |
|---|---|---|---|
| Drug catalog (which drugs are covered) | `data/drug_catalog.json` | `data/schemas/drug_catalog.schema.json` (JSON Schema draft-07) | `mobile/src/rules/catalog.ts`, `npm run config:validate` |
| Exclusion policy (which drugs are never checked) | `data/exclusion_policy.json` | `data/schemas/exclusion_policy.schema.json` | same |
| On-phone database (saved checks) | encrypted SQLite on the phone | `mobile/src/storage/migrations.ts` | storage tests |
| Extended-list review table (proposal only) | `data/proposals/extended_drug_list_review.csv` | this page, section 4 | `scripts/catalog/` |

Beyond JSON Schema, the validator also checks references (every drug's ingredients exist), duplicate
names and codes, catalog × policy overlaps, approval status and version compatibility, and runs a
precedence self-test: every active drug must be reachable, every exclusion must win.

## 1. Drug catalog (schema 2)

### File header

| Field | Type | Required | Meaning |
|---|---|---|---|
| `schema_version` | `2` | yes | Format version; an app that does not know it refuses the file |
| `catalog_version` | version string, e.g. `0.3.0-proposed` | yes | Recorded with every saved result |
| `status` | `APPROVED` · `DRAFT_PENDING_APPROVAL` · `PROPOSED_PENDING_APPROVAL` · `RETIRED` | yes | Pilot builds use `APPROVED` only |
| `effective_date` | date or `null` | yes | Set on approval |
| `compatibility.min_ruleset_version` | version | yes | Oldest app rules that can read the file |
| `description`, `provenance` | text, object | no | Where the scope and codes came from |
| `scope_defaults` | object | yes | Defaults for every drug: `routes` (`["ORAL"]`), `rx_scope` (`PRESCRIPTION_ONLY`), `ingredient_set_match` (`EXACT`) |
| `ingredients` | list of Ingredient | yes | Ingredient definitions (below) |
| `drugs` | list of Drug | yes | What the app covers (below) |
| `change_log` | list of {`date`, `version`, `change`, `source`} | yes | Every change, dated and sourced |

### Ingredient

| Field | Type | Required | Meaning | Example |
|---|---|---|---|---|
| `id` | lowercase id | yes | Internal key | `clopidogrel` |
| `name` | text | yes | RxNorm ingredient name | `clopidogrel` |
| `rxcui` | digits or `null` | yes | RxNorm ingredient code (IN or MIN) | `32968` |
| `tty` | `IN` · `MIN` | no | RxNorm term type | `IN` |
| `aliases` | list of text | yes | Other names seen in label or recall text, each with evidence | `["apap"]` for acetaminophen |
| `alias_provenance` | name → text | no | Where each alias was observed | |
| `precise_ingredients` | list of {`rxcui`, `name`} | no | Every RxNorm salt form (PIN) | `{"rxcui": "236991", "name": "clopidogrel bisulfate"}` |
| `provenance` | {`source`, `verified_on`} | yes | RxNav lookups and date | |

### Drug

| Field | Type | Required | Meaning | Example |
|---|---|---|---|---|
| `id` | lowercase id | yes | Internal key, shown in audits | `losartan_hydrochlorothiazide` |
| `display_name` | text | yes | Name shown to people | `Losartan/hydrochlorothiazide` |
| `status` | `ACTIVE` · `INACTIVE` | yes | `INACTIVE` = known but not checked ("not covered") | `ACTIVE` |
| `ingredients` | list of ingredient ids | yes | The exact ingredient set; a product with more or fewer ingredients is a different drug | `["losartan", "hydrochlorothiazide"]` |
| `aliases` | list of text | no | Other drug-level names | |
| `rx_scope` | `PRESCRIPTION_ONLY` · `OTC_ONLY` · `PRESCRIPTION_AND_OTC` | no | Defaults to the header | `PRESCRIPTION_ONLY` |
| `restrictions.routes` | list | no | Allowed routes | `["ORAL"]` |
| `restrictions.dose_forms` | `TABLET` · `CAPSULE` · `SOLUTION` · `SUSPENSION` · `OTHER` | no | Allowed forms | |
| `restrictions.release_types` | `IR` · `ER` · `DR` | no | Allowed release types | `["ER"]` (metoprolol succinate) |
| `restrictions.strengths` | ingredient → list | no | Allowed strengths | |
| `restrictions.precise_ingredients` | ingredient → {`allow` or `deny`: RxCUIs} | no | Salt limits | `{"metoprolol": {"allow": ["221124"]}}` |
| `part_d_rank_2023` | number | no | CMS Part D 2023 rank by total claims | `81` |
| `provenance` | {`source`, `verified_on`} | yes | Ranking, RxNav and FDA sources and date | |
| `notes` | text | no | Scope notes, CMS names, product counts, why inactive | |

Two drugs with the same ingredient set must have disjoint `dose_forms` or `release_types` (the
validator enforces it), so a product can never match two drugs.

## 2. Exclusion policy (schema 2)

| Part | Fields | Meaning |
|---|---|---|
| Header | `schema_version`, `policy_version`, `status`, `effective_date`, `last_reviewed`, `next_review_due`, `review_interval_months`, `compatibility`, `source_document`, `principles` | Versioned, dated, reviewed every 6 months |
| `classes[]` | `id`, `criterion`, `rationale`, `explanation` (shown to users), `fda_epc_signals` (FDA pharmacologic classes), `unlisted_signal_behavior` (`NEEDS_CLARIFICATION` · `EXCLUDED` · `IGNORE`) | Exclusion by published class, e.g. `ANTICOAGULANT` |
| `ingredient_rules[]` | `id`, `ingredient`, `rxcuis`, `names`, `class`, `decision` (`EXCLUDED` · `NEEDS_CLARIFICATION`), `applies_to` (routes, dose forms, release types), `include_combinations`, `source`, `verified_on`, `note` | One rule per excluded ingredient, e.g. `EXCL-WARFARIN` (RxCUI 11289) |
| `route_rules[]` | `id`, `status` (`OPEN_DECISION` · `APPROVED`), `decision_id`, `routes`, `scope`, `decision`, `interim_decision`, `interim_reason`, `statement` | The administration rule (OD-1), interim "not covered" |
| `product_type_rules[]` | `id`, `product_types`, `decision`, `explanation`, `source`, `decided_on` | e.g. `OTC-MVP`: over-the-counter products excluded |
| `change_log[]` | `date`, `version`, `change`, `source`, `approved_by` | Every change, dated and sourced |

Order of evaluation: data valid → ingredient rules → route rules → product type → class signals →
catalog. Exclusions always win over the catalog.

## 3. On-phone database (SQLite, encrypted; schema version 1)

Off in development builds until encryption is verified on a device. Never stores photos, label
text, patient names, pharmacy details, Rx numbers or device identifiers.

| Table | Columns | Holds |
|---|---|---|
| `schema_meta` | `key` (PK), `value` | Database schema version |
| `medication` | `id` (PK), `display_name`, `catalog_drug_id`, `identity_key`, `created_at`, `archived_at` | One row per medication the user keeps |
| `fill` | `id` (PK), `medication_id` → medication, `scanned_at`, `fill_date`, `package_ndc`, `product_ndc`, `identity_level` (`PRODUCT` · `CLINICAL_DRUG`), `identity_json`, `dose_form`, `release_mechanism` (`IR` · `ER` · `DR` · `UNSPECIFIED`), `labeler_name`, `lot`, `container_type` (`PHARMACY_VIAL` · `ORIGINAL_PACKAGE` · `UNKNOWN`) | One row per scanned bottle |
| `assessment` | `id` (PK), `fill_id` → fill, `evaluated_at`, `saved_at`, `finding` (`CONFIRMED_MATCH` · `POTENTIAL_MATCH` · `NO_MATCH_FOUND` · `UNRESOLVED`), `finding_json`, `ruleset_version`, `policy_version`, `catalog_version`, `dataset_last_updated`, `coverage_complete` (0/1) | One row per saved recall check |
| `assessment_evidence` | `assessment_id` → assessment, `recall_number` (PK together), `relevance` (`PRODUCT_MATCH` · `POSSIBLE_MATCH` · `OTHER_PRODUCT` · `UNPARSEABLE`), `classification`, `lot_result`, `reasons` | Each recall record behind a check |
| `source_cache` | `source`, `query_key` (PK together), `outcome` (`OK` · `NO_MATCH`), `body_json`, `source_last_updated`, `retrieved_at`, `expires_at` | Short-lived cache of public FDA/NIH answers; never errors |
| `config_snapshot` | `kind` (`CATALOG` · `POLICY`), `version` (PK together), `json`, `installed_at` | Each catalog and policy version results were made under |

Deleting a medication deletes its fills, checks and evidence. "Delete all data on this phone" erases
the database and its key.

## 4. Extended-list review table (proposal)

`data/proposals/extended_drug_list_review.csv`, one row per drug (CMS names of the same ingredient
merged):

| Column | Meaning |
|---|---|
| `rank` | CMS Part D 2023 rank by total claims (first name in the row) |
| `cms_generic_names` | CMS generic name(s) as published |
| `claims_2023`, `share_pct` | Total claims, and share of all 1,616,932,462 Part D claims in 2023 |
| `ingredients_rxcui` | RxNorm ingredient(s) and RxCUI, verified exactly on RxNav |
| `decision` | In the app now · Add (active) · Add (switched off) · Excluded by policy · Out of scope |
| `catalog_drug_id` | Drug `id` in `data/proposals/drug_catalog_0.3.0-proposed.json` |
| `fda_oral_rx_products` | Oral prescription products with exactly this ingredient set in FDA's NDC Directory |
| `recall_records_app_search` | Recall records the app's recall search finds today (openFDA enforcement) |
| `example_ndc` | The real FDA product used to check the drug with the app's own code |
| `reason` | Why a drug is excluded, out of scope or switched off |
