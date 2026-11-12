# API Feasibility — Task 1 Results

| Field | Value |
|---|---|
| Harness | `scripts/check_api_feasibility.ts` |
| Run | 2026-11-12 02:03:32Z → 02:04:49Z (UTC), Node v22, 135 live requests, no credentials |
| Network | Claude Code cloud container via egress proxy (`NODE_USE_ENV_PROXY=1`) after adding the three API hosts to the environment allowlist |
| Machine-readable report | `docs/feasibility/latest-run.json` |
| Fixtures produced | `tests/fixtures/api/*.json` (47 trimmed real responses), `tests/fixtures/spl/*.xml` (3 real SPL documents) |
| Totals | **5 PASS, 5 WARN, 0 FAIL, 0 BLOCKED** |

An earlier run in the same session, before the network allowlist was updated, correctly reported
**all checks BLOCKED** (DNS failure through the proxy). That confirmed the harness does not fabricate
results when sources are unreachable.

## Reproduce

```bash
npm install
```

```bash
npm run feasibility
```

Behind an HTTPS proxy:

```bash
NODE_USE_ENV_PROXY=1 npm run feasibility
```

Exit code: 0 = no FAIL, 1 = FAIL present, 2 = BLOCKED.

## Representative records

One real finished, oral, prescription product NDC per supported drug, selected automatically from
the NDC Directory with an exact ingredient-set match (see `tests/fixtures/api/ndc_*.json`):

| Drug | Package NDC | Labeler (as published) | RxNav concept |
|---|---|---|---|
| Atorvastatin | 68071-2991-3 | NuCare Pharmaceuticals, Inc. (repackager) | atorvastatin 40 MG Oral Tablet |
| Amlodipine | 68180-455-01 | Lupin Pharmaceuticals, Inc. | amlodipine 5 MG Oral Tablet |
| Levothyroxine | 68788-8793-3 | Preferred Pharmaceuticals Inc. (repackager) | levothyroxine sodium 0.175 MG Oral Tablet |
| Lisinopril | 23155-878-01 | Heritage Pharmaceuticals Inc. d/b/a Avet | lisinopril 10 MG Oral Tablet |
| Gabapentin | 60760-669-30 | St. Mary's Medical Park Pharmacy (repackager) | gabapentin 100 MG Oral Capsule |
| Losartan | 50090-4712-0 | A-S Medication Solutions (repackager) | losartan potassium 100 MG Oral Tablet |
| Metformin | 43353-982-30 | Aphena Pharma Solutions – Tennessee (repackager) | metformin hydrochloride 500 MG Oral Tablet |
| Metoprolol succinate | 50090-6448-0 | A-S Medication Solutions (repackager) | 24 HR metoprolol succinate 50 MG Extended Release Oral Tablet |
| Omeprazole | 55111-643-01 | Dr. Reddy's Laboratories Limited | omeprazole 10 MG Delayed Release Oral Capsule |
| Rosuvastatin | 82009-018-10 | Quallent Pharmaceuticals Health LLC | rosuvastatin calcium 10 MG Oral Tablet |
| Pantoprazole | 68071-1963-3 | NuCare Pharmaceuticals, Inc. (repackager) | pantoprazole 40 MG Delayed Release Oral Tablet |
| Furosemide | 68094-756-62 | Precision Dose Inc. | furosemide 10 MG/ML Oral Solution |
| Hydrocodone/APAP | 13107-213-01 | Aurolife Pharma, LLC | acetaminophen 300 MG / hydrocodone bitartrate 10 MG Oral Tablet |
| Tamsulosin | 71610-910-30 | Aphena Pharma Solutions – Tennessee (repackager) | tamsulosin hydrochloride 0.4 MG Oral Capsule |

## Results by verification item

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Direct HTTPS without private credentials | **PASS** | 4/4 endpoint families returned schema-valid data, no key, no auth headers. |
| 2 | NDC normalization and product identification | **PASS** | 14/14 package NDCs converted 10→11 digits, expanded to candidates (1–2 each), and exactly one candidate was confirmed by the NDC Directory — always the original. RxNav `ndcstatus` returned ACTIVE with an SCD RxCUI for all 14. |
| 3 | Ingredient, strength, formulation matching | **PASS** (after normalization) | 14/14 agree on ingredient set, strength and IR/ER/DR between openFDA and RxNav. The first run found 4 disagreements that were representation differences, not data errors (`.175 mg` vs `0.175 MG`; `40 mg/4mL` vs `10 MG/ML`) plus one harness bug (a combination product picked as representative). Fixed with strength normalization and exact ingredient-set selection, both now unit-tested. |
| 4 | Recall lookup and product-level relevance | **WARN** | Retrieval works for all 14 drugs (5–188 records each). But 83.8% of all drug enforcement records lack the `openfda` block; structured searches miss 38–76% of keyword matches (by drug); `openfda.product_ndc` over-includes all strengths of a label; 84 of 664 sampled records were combination products. **Product relevance must be decided on device by parsing `product_description`** (87.0% contain an NDC) and by strength and form checks. Three real recalls referenced the amlodipine representative's product NDC 68180-455. |
| 5 | Lot-specific matching | **WARN** | Lots exist only in free-text `code_info` (77.1% contain a "lot" token, many formats). Feasible only as a user-confirmed comparison; absence of a lot from the listing can never clear a product. |
| 6 | Response schema validation | **PASS** | 125 responses validated, 0 violations. Validators reject truncated JSON and missing fields (unit tests). |
| 7 | Rate-limit and service-error handling | **WARN** | 0 misclassifications in 9 scenarios. Findings: (a) openFDA "no matches" = HTTP 404 `NOT_FOUND`; (b) **a nonexistent field also returns 404 `NOT_FOUND`**, so a field-name bug looks like "no recalls" — positive controls required; (c) malformed queries return HTTP 500, not 400; (d) DailyMed unknown set ID returns 200 with empty strings; (e) RxNav unknown NDC returns 200 `status: ALIEN`; (f) no rate-limit headers are exposed to keyless clients. HTTP 429 was not provoked (to avoid exhausting the shared quota); its handling is covered by unit tests. |
| 8 | Source freshness and retrieval timestamps | **PASS** | openFDA NDC `last_updated` 2026-11-11; enforcement `last_updated` 2026-11-04; DailyMed `db_published_date` Nov 11, 2026 08:02 PM EST; RxNorm 02-Nov-2026 (API 3.1.357). Only dataset-level markers exist; the app stores these plus its own retrieval time. |
| 9 | Missing or ambiguous manufacturer information | **WARN** | 20 SPLs parsed: 15 have no MANUFACTURE establishment (13 contain REPACK/RELABEL), 2 have no establishment section at all, and 1 lists two MANUFACTURE establishments (amlodipine, Lupin). 15/15 one-hop repackager → source-NDC traversals resolved to an originating labeler with an ANDA. MANUFACTURE is coded **C43360** in live data (Document A says C43215). Facility identity is often unknown and must be presented as such. |
| 10 | Direct calls sufficient without a backend? | **WARN → GO for MVP scope** | Identification, labeling and recall retrieval work directly from a device without keys. A phone-only design must absorb: on-device free-text recall parsing, keyless per-IP quotas (~6–12 requests per new medication), on-device SPL XML parsing (60–220 KB per document) and the lack of facility inspection data in these APIs (deferred by design). |

## Assessment

Direct public API calls are **sufficient for the MVP's identification and recall-retrieval goals
without a backend**, provided the app:

1. Treats structured recall fields as supporting evidence only and implements text-based product matching with strength and form checks (R-EV-1…R-EV-5).
2. Runs a positive-control recall query per session before it may report "no matching recall found" (RG-2).
3. Treats every non-`OK` / non-`NO_MATCH` outcome as `SOURCE_UNAVAILABLE` or `RATE_LIMITED` (RG-1, implemented in `scripts/lib/http.ts`).
4. Supports repackaged NDCs as first-class identities and traverses to the source labeler where possible.
5. Presents facility information as unknown or multi-valued; no facility quality assessment in v0.1.

## Not tested / limitations of this run

- HTTP 429 under real quota exhaustion; documented quotas are not verified.
- Behavior from a real Android device and mobile networks (Task 3/6).
- `download.open.fda.gov` bulk downloads (host allowlisted, not exercised).
- SPL sample is small (n = 20) and biased toward repackagers; establishment statistics are illustrative, not population estimates.
- `C82401` (API MANUFACTURE) not observed; authorized-generic joins (Doc A UC-1B) not tested.
- The representative product for each drug is the first qualifying record returned by openFDA, not a random sample.
