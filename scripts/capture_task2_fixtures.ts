/**
 * Task 2 fixture capture: real openFDA responses for the recall evidence engine tests.
 *
 * Usage (live network; behind a proxy add NODE_USE_ENV_PROXY=1):
 *   npm run fixtures:task2
 *   npm run fixtures:task2 -- --only enf_control_fields,enf_control_fields_drifted
 *
 * Writes tests/fixtures/task2/*.json. Each file stores the HTTP status, the request URL and the
 * response body exactly as received, except that records are reduced to the fields the app reads
 * (sanitization: no field values are edited, only unused fields are dropped). Responses contain
 * public regulatory data only; no patient data is sent or stored.
 *
 * Only public identifiers are sent: product NDCs, package NDCs, ingredient names, recall numbers.
 * Fixtures are immutable once referenced by tests; re-capturing writes the same names, so review the
 * diff before committing a refresh.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRaw, sleep } from './lib/http.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests/fixtures/task2');
const OPENFDA = 'https://api.fda.gov/drug';
const PACE_MS = 400;

interface Spec {
  name: string;
  endpoint: 'enforcement' | 'ndc';
  search: string;
  limit?: number;
  skip?: number;
  purpose: string;
}

const ENFORCEMENT_KEEP = [
  'recall_number',
  'status',
  'classification',
  'product_description',
  'code_info',
  'recalling_firm',
  'reason_for_recall',
  'report_date',
  'recall_initiation_date',
  'termination_date',
  'product_type',
  'product_quantity',
];
const ENFORCEMENT_OPENFDA_KEEP = ['product_ndc', 'generic_name', 'brand_name', 'substance_name', 'route'];
const NDC_KEEP = [
  'product_ndc',
  'generic_name',
  'brand_name',
  'labeler_name',
  'dosage_form',
  'route',
  'product_type',
  'marketing_category',
  'application_number',
  'finished',
  'active_ingredients',
  'packaging',
  'pharm_class',
];

const SPECS: Spec[] = [
  // --- Recall queries (enforcement) ---
  { name: 'enf_pndc_62756-142', endpoint: 'enforcement', search: 'openfda.product_ndc:"62756-142"', purpose: 'Known recalled product (metformin ER 500 mg, Sun); four lot-specific recalls, complete result set' },
  { name: 'enf_pndc_68180-455', endpoint: 'enforcement', search: 'openfda.product_ndc:"68180-455"', purpose: 'Multiple strengths under one label: structured product_ndc over-includes 2.5/5/10 mg (Lupin amlodipine)' },
  { name: 'enf_pndc_16729-046', endpoint: 'enforcement', search: 'openfda.product_ndc:"16729-046"', purpose: 'Structured match for atorvastatin 40 mg returns an 80 mg recall (D-0374-2023)' },
  { name: 'enf_pndc_16729-047', endpoint: 'enforcement', search: 'openfda.product_ndc:"16729-047"', purpose: 'Atorvastatin 80 mg (Accord) recall with batch list' },
  { name: 'enf_pndc_31722-997', endpoint: 'enforcement', search: 'openfda.product_ndc:"31722-997"', purpose: 'Combination product recall (hydrocodone/acetaminophen 10/325 mg, Camber)' },
  { name: 'enf_pndc_71610-910', endpoint: 'enforcement', search: 'openfda.product_ndc:"71610-910"', purpose: 'Well-formed no-results answer (HTTP 404 NOT_FOUND) for a product without linked recalls' },
  { name: 'enf_text_tamsulosin', endpoint: 'enforcement', search: 'product_description:"tamsulosin"', limit: 100, purpose: 'Complete ingredient text query (small total)' },
  { name: 'enf_text_rosuvastatin', endpoint: 'enforcement', search: 'product_description:"rosuvastatin"', limit: 100, purpose: 'Complete ingredient text query (small total)' },
  { name: 'enf_text_metformin', endpoint: 'enforcement', search: 'product_description:"metformin"', limit: 100, purpose: 'Complete ingredient text query; IR, ER and combination metformin records' },
  { name: 'enf_text_hydrocodone_acetaminophen', endpoint: 'enforcement', search: 'product_description:"hydrocodone" AND product_description:"acetaminophen"', limit: 100, purpose: 'Complete text query for a combination product' },
  { name: 'enf_text_amlodipine_p1', endpoint: 'enforcement', search: 'product_description:"amlodipine"', limit: 50, skip: 0, purpose: 'Pagination page 1 of 2' },
  { name: 'enf_text_amlodipine_p2', endpoint: 'enforcement', search: 'product_description:"amlodipine"', limit: 50, skip: 50, purpose: 'Pagination page 2 of 2' },
  { name: 'enf_control_D-0325-2021', endpoint: 'enforcement', search: 'recall_number:"D-0325-2021"', purpose: 'Positive-control query (RG-2)' },
  { name: 'enf_control_fields', endpoint: 'enforcement', search: 'recall_number:"D-0325-2021" AND product_description:"metformin" AND openfda.product_ndc:"62756-142"', limit: 1, purpose: 'Positive control exercising every field the recall queries use (RG-2)' },
  { name: 'enf_control_fields_drifted', endpoint: 'enforcement', search: 'recall_number:"D-0325-2021" AND product_descriptionx:"metformin" AND openfda.product_ndc:"62756-142"', limit: 1, purpose: 'Positive control with one drifted field name: openFDA answers 404 NOT_FOUND' },
  { name: 'enf_misspelled_field', endpoint: 'enforcement', search: 'openfda.product_ndcx:"62756-142"', purpose: 'Misspelled field: openFDA answers 404 NOT_FOUND, indistinguishable from no results' },
  { name: 'enf_malformed_query', endpoint: 'enforcement', search: 'product_description:"metformin" AND (', purpose: 'Malformed query: openFDA answers HTTP 500' },
  // --- NDC Directory ---
  { name: 'ndc_pkg_62756-142-02', endpoint: 'ndc', search: 'packaging.package_ndc:"62756-142-02"', purpose: 'Directory confirmation of a real package NDC' },
  { name: 'ndc_pkg_62756-0142-2', endpoint: 'ndc', search: 'packaging.package_ndc:"62756-0142-2"', purpose: 'Directory answer for the non-existent 5-4-1 candidate of 62756014202' },
  { name: 'ndc_prod_68180-721', endpoint: 'ndc', search: 'product_ndc:"68180-721"', purpose: 'Amlodipine 10 mg (Lupin); used for OCR misread / strength cross-validation' },
  { name: 'ndc_prod_16729-046', endpoint: 'ndc', search: 'product_ndc:"16729-046"', purpose: 'Atorvastatin 40 mg (Accord)' },
  { name: 'ndc_prod_16729-047', endpoint: 'ndc', search: 'product_ndc:"16729-047"', purpose: 'Atorvastatin 80 mg (Accord)' },
  { name: 'ndc_prod_67877-514', endpoint: 'ndc', search: 'product_ndc:"67877-514"', purpose: 'Atorvastatin 80 mg (Ascend); refill labeler change' },
  { name: 'ndc_prod_31722-997', endpoint: 'ndc', search: 'product_ndc:"31722-997"', purpose: 'Hydrocodone/acetaminophen 10/325 mg (Camber)' },
  { name: 'ndc_warfarin', endpoint: 'ndc', search: 'generic_name:"warfarin" AND route:"ORAL" AND finished:true', limit: 1, purpose: 'Excluded ingredient (anticoagulant)' },
  { name: 'ndc_apixaban', endpoint: 'ndc', search: 'generic_name:"apixaban" AND route:"ORAL" AND finished:true', limit: 1, purpose: 'Excluded ingredient (anticoagulant)' },
  { name: 'ndc_everolimus', endpoint: 'ndc', search: 'generic_name:"everolimus" AND route:"ORAL" AND finished:true', limit: 1, purpose: 'Indication-dependent exclusion (NEEDS_CLARIFICATION)' },
  { name: 'ndc_mycophenolic_acid', endpoint: 'ndc', search: 'generic_name:"mycophenolic" AND route:"ORAL" AND finished:true', limit: 1, purpose: 'Excluded ingredient under an alternate RxNorm name' },
  { name: 'ndc_tacrolimus_topical', endpoint: 'ndc', search: 'generic_name:"tacrolimus" AND route:"TOPICAL" AND finished:true', limit: 1, purpose: 'Excluded ingredient, non-oral route (administration rule pending)' },
  { name: 'ndc_metoprolol_tartrate', endpoint: 'ndc', search: 'generic_name:"metoprolol tartrate" AND route:"ORAL" AND finished:true', limit: 1, purpose: 'Unsupported salt (not in catalog)' },
  { name: 'ndc_amlodipine_benazepril', endpoint: 'ndc', search: 'generic_name:"amlodipine and benazepril" AND finished:true', limit: 1, purpose: 'Combination containing a supported ingredient (UNSUPPORTED)' },
  { name: 'ndc_omeprazole_otc', endpoint: 'ndc', search: 'generic_name:"omeprazole" AND product_type:"HUMAN OTC DRUG" AND finished:true', limit: 1, purpose: 'OTC version of a supported ingredient (OD-3 pending)' },
  { name: 'ndc_metformin_er_other', endpoint: 'ndc', search: 'generic_name:"metformin" AND dosage_form:"TABLET, EXTENDED RELEASE" AND finished:true AND product_type:"HUMAN PRESCRIPTION DRUG"', limit: 1, purpose: 'Metformin extended-release product for IR/ER distinction' },
];

function pick(o: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in o) out[k] = o[k];
  return out;
}

function sanitize(endpoint: Spec['endpoint'], body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { results?: unknown }).results)) {
    return body;
  }
  const b = body as { meta?: Record<string, unknown>; results: Record<string, unknown>[] };
  const meta = b.meta ? pick(b.meta, ['last_updated', 'results']) : undefined;
  const results = b.results.map((r) => {
    if (endpoint === 'enforcement') {
      const o = pick(r, ENFORCEMENT_KEEP);
      if (r.openfda && typeof r.openfda === 'object') {
        o.openfda = pick(r.openfda as Record<string, unknown>, ENFORCEMENT_OPENFDA_KEEP);
      }
      return o;
    }
    const o = pick(r, NDC_KEEP);
    if (Array.isArray(o.packaging)) {
      o.packaging = (o.packaging as Record<string, unknown>[]).map((p) => pick(p, ['package_ndc', 'description']));
    }
    if (r.openfda && typeof r.openfda === 'object') {
      o.openfda = pick(r.openfda as Record<string, unknown>, ['rxcui', 'is_original_packager']);
    }
    return o;
  });
  return { meta, results };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // --only a,b captures just the named fixtures (existing fixtures are immutable once referenced).
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set((process.argv[onlyIdx + 1] ?? '').split(',')) : null;
  const index: { name: string; httpStatus: number; total: number | null; purpose: string }[] = [];
  for (const s of SPECS.filter((x) => only === null || only.has(x.name))) {
    const params = new URLSearchParams({ search: s.search, limit: String(s.limit ?? 100) });
    if (s.skip !== undefined) params.set('skip', String(s.skip));
    const url = `${OPENFDA}/${s.endpoint}.json?${params.toString()}`;
    const raw = await fetchRaw(url);
    let body: unknown;
    try {
      body = JSON.parse(raw.bodyText);
    } catch {
      body = { _unparseable_body_text: raw.bodyText.slice(0, 2000) };
    }
    const fixture = {
      _fixture: {
        source: 'live public openFDA response; records reduced to fields the app reads; no patient data',
        capturedAt: new Date().toISOString(),
        endpoint: s.endpoint,
        search: s.search,
        limit: s.limit ?? 100,
        skip: s.skip ?? 0,
        url,
        purpose: s.purpose,
      },
      http: { status: raw.status, headers: pick(raw.headers, ['content-type']) },
      body: sanitize(s.endpoint, body),
    };
    writeFileSync(join(OUT, `${s.name}.json`), JSON.stringify(fixture, null, 1) + '\n');
    const total =
      typeof body === 'object' && body !== null
        ? (((body as { meta?: { results?: { total?: number } } }).meta?.results?.total) ?? null)
        : null;
    index.push({ name: s.name, httpStatus: raw.status, total, purpose: s.purpose });
    console.log(`${raw.status} ${String(total).padStart(5)}  ${s.name}`);
    await sleep(PACE_MS);
  }
  if (only === null) {
    writeFileSync(join(OUT, 'INDEX.json'), JSON.stringify({ capturedAt: new Date().toISOString(), fixtures: index }, null, 1) + '\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
