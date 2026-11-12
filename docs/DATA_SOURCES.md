# Data Sources

All sources are public, keyless and reached directly from the phone over HTTPS. "Verified" means
observed by `scripts/check_api_feasibility.ts` on **2026-11-12** (report:
`docs/feasibility/latest-run.json`; fixtures: `tests/fixtures/api/`, `tests/fixtures/spl/`).
"Documented" means stated by the provider and **not** verified by the harness.

## 1. openFDA — NDC Directory

| Item | Detail |
|---|---|
| Endpoint | `GET https://api.fda.gov/drug/ndc.json` |
| Query format | `search=<field>:"<value>"[+AND+<field>:<value>]&limit=<n>&skip=<n>` (Lucene-style; values URL-encoded) |
| Queries used | `generic_name:"<name>"+AND+finished:true`, `packaging.package_ndc:"<10-digit hyphenated>"`, `product_ndc:"<labeler-product>"` |
| Fields relied on | `product_ndc`, `generic_name`, `labeler_name`, `brand_name`, `dosage_form`, `route[]`, `product_type`, `marketing_category`, `application_number`, `active_ingredients[{name,strength}]`, `packaging[{package_ndc,description}]`, `pharm_class[]`, `openfda.spl_set_id[]`, `openfda.rxcui[]`, `spl_id`, `finished` |
| Response envelope | `{ meta: { disclaimer, terms, license, last_updated, results: { skip, limit, total } }, results: [...] }` |
| No-match response | **HTTP 404** with `{"error":{"code":"NOT_FOUND","message":"No matches found!"}}` (verified) |
| Malformed query | **HTTP 500** with `{"error":{"code":"SERVER_ERROR",...,"details":"[parse_exception]..."}}` (verified) |
| Freshness marker | `meta.last_updated` (verified `2026-11-11`) |
| CORS | `access-control-allow-origin: *` (verified; irrelevant for native apps) |

Limitations (verified unless noted):
- `strength` formats vary (`".175 mg/1"`, `"40 mg/4mL"`); normalization is required to compare with RxNorm (`"0.175 MG"`, `"10 MG/ML"`).
- `generic_name` searches return combination products (e.g., 30 of the first 100 "metformin hydrochloride" products had a different ingredient set; 37 for amlodipine besylate). Exact ingredient-set filtering is mandatory.
- The first results for a generic name are often **repackagers** (9 of 14 representative products in the Task 1 run were repackaged NDCs). Repackager labels are real dispensed products and must be supported.
- Strength and form are per product NDC; release mechanism is encoded in `dosage_form` text (`TABLET, EXTENDED RELEASE`, `CAPSULE, DELAYED RELEASE`, …).

## 2. openFDA — Drug Enforcement Reports (recalls)

| Item | Detail |
|---|---|
| Endpoint | `GET https://api.fda.gov/drug/enforcement.json` |
| Queries used | `product_description:"<keyword>"`, `openfda.generic_name:"<name>"`, `openfda.product_ndc:"<product ndc>"`, `_missing_:openfda` |
| Fields relied on | `recall_number`, `status` (Ongoing/Completed/Terminated), `classification` (Class I/II/III), `product_description`, `code_info`, `reason_for_recall`, `recalling_firm`, `report_date`, `recall_initiation_date`, `termination_date`, `product_quantity`, `distribution_pattern`, `openfda{product_ndc[],package_ndc[],generic_name[],substance_name[],manufacturer_name[],rxcui[],spl_set_id[],is_original_packager[],original_packager_product_ndc[],upc[]}` |
| Freshness marker | `meta.last_updated` (verified `2026-11-04`) |

Limitations (verified):
- **83.8% of drug enforcement records (15,176 of 18,110) have no `openfda` block.** Structured searches (`openfda.generic_name`) return only 24–62% of the records that a `product_description` keyword search returns (e.g., metformin 32 vs 91; losartan 32 vs 117; tamsulosin 2 vs 5).
- Product identity must therefore be parsed from free text: 87.0% of sampled records contained a hyphenated NDC in `product_description`.
- When present, `openfda.product_ndc` lists **every product NDC on the label's SPL**, not just the recalled one (record D-0374-2023 recalls only 80 mg but lists 10/20/40/80 mg product NDCs).
- Keyword searches return combination products, injectables, compounding kits and bulk active ingredient (84 combination products in the sample of 664 records).
- Lot numbers exist only as free text in `code_info`; 77.1% of sampled records contained an explicit "lot" token. Formats vary widely.
- A query on a **nonexistent field returns 404 NOT_FOUND**, identical to "no recalls" (verified hazard). Positive-control queries are required (TEST_PLAN RG-2).
- Enforcement reports describe recalls classified by FDA; they do not include market withdrawals that are not recalls, inspection outcomes, or warning letters.

## 3. DailyMed — SPL web services v2

| Item | Detail |
|---|---|
| List endpoint | `GET https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=<name>&pagesize=<n>&page=<n>` or `?ndc=<package ndc>` |
| SPL document | `GET https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/<setid>.xml` (send `Accept: */*`; `Accept: application/xml` returned **HTTP 406**, verified) |
| NDCs for an SPL | `GET .../spls/<setid>/ndcs.json` |
| List response | `{ data: [{ setid, title, spl_version, published_date }], metadata: { db_published_date, total_elements, total_pages, current_page, next_page_url, ... } }` |
| No-match response | HTTP 200 with `data: []` and `metadata.total_elements: 0` (verified) |
| Unknown set ID (`/ndcs.json`) | HTTP 200 with a data object of empty strings (verified) — must be treated as no data, not a valid document |
| Freshness marker | `metadata.db_published_date` (verified `Nov 11, 2026 08:02:44PM EST`) |

SPL XML elements used (verified on 20 documents):
- Establishments: `author/assignedEntity/representedOrganization/assignedEntity/assignedOrganization` with DUNS `id[@root="1.3.6.1.4.1.519.1"]/@extension`, `name`, and `performance/actDefinition/code` operation codes.
- Operation codes observed: `C43360` MANUFACTURE, `C84731` PACK, `C84732` LABEL, `C25391` ANALYSIS, `C73606` REPACK, `C73607` RELABEL. **Document A's `C43215` for MANUFACTURE was not observed.** `C82401` (API MANUFACTURE) was not observed in this sample.
- `displayName` casing varies between documents (`MANUFACTURE` vs `manufacture`).
- Repackager source: `asEquivalentEntity/definingMaterialKind/code/@code` (source product NDC). 15/15 sampled traversals resolved via the openFDA NDC Directory.

Limitations (verified): in the sample of 20 SPLs, 15 listed no MANUFACTURE establishment (mostly repackagers), 2 had no establishment section at all, and 1 listed two MANUFACTURE establishments. XML documents are 60–220 KB each.

## 4. RxNorm / RxNav REST

| Item | Detail |
|---|---|
| Base | `https://rxnav.nlm.nih.gov/REST/` |
| Name → RxCUI | `rxcui.json?name=<name>` → `{ idGroup: { rxnormId: [...] } }`; unknown name → `{ idGroup: {} }` (HTTP 200, verified) |
| Concept properties | `rxcui/<id>/properties.json` (tty, name) |
| Related concepts | `rxcui/<id>/related.json?tty=IN+PIN` |
| NDC status | `ndcstatus.json?ndc=<ndc11>` → `{ ndcStatus: { ndc11, status, rxcui, conceptName, ndcHistory[] } }`; nonexistent NDC → `status: "ALIEN"` with HTTP 200 (verified) |
| NDC properties | `ndcproperties.json?id=<ndc>` → packaging, labeler, ANDA, `IMPRINT_CODE`, `COLOR`, `SHAPE`, `SCORE` (verified) |
| Version | `version.json` → `{ version: "02-Nov-2026", apiVersion: "3.1.357" }` (verified) |

Limitations (verified): `ndcstatus` and `ndcproperties` can disagree on RxCUI for the same NDC over time (history); the current `rxcui` must be used and the history kept for audit. Some SPL set IDs referenced in RxNav are absent from current DailyMed.

## 5. Rate limits

| Source | Limit | Status |
|---|---|---|
| openFDA (no API key) | 240 requests/minute and 1,000 requests/day per IP address | Documented by openFDA; **not verified**. No rate-limit headers were returned to keyless clients (verified). |
| openFDA (with free API key) | Higher daily quota | Documented; not used (no keys shipped in the app). |
| RxNav | 20 requests/second per IP address | Documented by NLM; not verified. |
| DailyMed | No limit identified in the sources reviewed | Treat conservatively (≤ 1 request/second). |

Per-scan budget estimate (from the Task 1 run): identity ≈ 3–5 requests, recalls ≈ 2–4, SPL ≈ 1–3 →
roughly 6–12 requests per new medication, well inside the keyless quotas for a single device.
Carrier-grade NAT can make many users share one IP; the client must handle `429` gracefully.

## 6. Sources considered and not used in v0.1

| Source | Reason |
|---|---|
| FDA Data Dashboard (inspections, 483s), warning letters, Import Alerts | Not in the mandated set; Doc A's approach needs a backend ETL/scraping (see references A-6, A-17, A-18) |
| `download.open.fda.gov` bulk files | Not tested in Task 1; possible future offline-refresh path (size and update cadence unknown) |
| Commercial drug databases (e.g., imprint libraries) | Licensing and privacy; not public |
