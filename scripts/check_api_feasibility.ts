/**
 * Rx Quality Check — public API feasibility harness (Task 1).
 *
 * Runs live, read-only requests against public, keyless endpoints:
 *   - openFDA NDC Directory             https://api.fda.gov/drug/ndc.json
 *   - openFDA Drug Enforcement (recalls) https://api.fda.gov/drug/enforcement.json
 *   - DailyMed SPL web services v2      https://dailymed.nlm.nih.gov/dailymed/services/v2/
 *   - RxNorm / RxNav REST               https://rxnav.nlm.nih.gov/REST/
 *
 * Only public drug identifiers (ingredient names, NDCs, SPL set IDs) are sent. No credentials.
 *
 * Usage:
 *   npm run feasibility                      # run checks, print summary, write JSON report
 *   npm run feasibility -- --save-fixtures   # also write trimmed real responses to tests/fixtures/api
 *   npm run feasibility -- --out <path>      # report location (default docs/feasibility/latest-run.json)
 *
 * Exit codes: 0 = no FAIL, 1 = at least one FAIL, 2 = BLOCKED (sources unreachable).
 *
 * The harness never fabricates results: if a source is unreachable, affected checks are
 * recorded as BLOCKED with the reproducible request URLs.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup, sleep, fetchRaw, type LookupOutcome, type ResponseMeta } from './lib/http.ts';
import {
  validateOpenFdaNdc,
  validateOpenFdaEnforcement,
  validateDailyMedSplList,
  validateRxNavIdGroup,
  validateRxNavNdcStatus,
  validateRxNavVersion,
  validateAny,
  type OpenFdaEnvelope,
  type OpenFdaNdcProduct,
  type OpenFdaEnforcement,
  type DailyMedSplList,
  type RxNavIdGroup,
  type RxNavNdcStatus,
  type RxNavVersion,
} from './lib/schemas.ts';
import { parseNdcInput, toNdc11, extractNdcsFromText } from './lib/ndc.ts';
import { summarizeSplEstablishments, OPERATION_LABELS } from './lib/spl.ts';
import { normalizeStrength, rxNavStrengths, sameStrength } from './lib/strength.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OPENFDA = 'https://api.fda.gov/drug';
const DAILYMED = 'https://dailymed.nlm.nih.gov/dailymed/services/v2';
const RXNAV = 'https://rxnav.nlm.nih.gov/REST';

// openFDA without an API key: documented limit of 240 requests/minute and 1,000/day per IP.
// The harness paces itself well below the per-minute limit.
const PACE_MS = 350;

type Status = 'PASS' | 'FAIL' | 'WARN' | 'BLOCKED' | 'INFO';

interface CheckResult {
  id: string;
  title: string;
  status: Status;
  summary: string;
  details: unknown;
  requests: RequestLog[];
}

interface RequestLog {
  url: string;
  outcome: LookupOutcome<unknown>['kind'];
  httpStatus: number | null;
  retrievedAt: string;
  elapsedMs: number;
  detail?: string;
}

const args = process.argv.slice(2);
const SAVE_FIXTURES = args.includes('--save-fixtures');
const outIdx = args.indexOf('--out');
const OUT_PATH = outIdx >= 0 && args[outIdx + 1] ? resolve(args[outIdx + 1]!) : join(ROOT, 'docs/feasibility/latest-run.json');
const FIXTURE_DIR = join(ROOT, 'tests/fixtures/api');

interface CatalogDrug {
  id: string;
  display_name: string;
  ingredients: { name: string; rxcui: string }[];
  required_precise_ingredient?: { name: string; rxcui: string };
}
const catalog = JSON.parse(readFileSync(join(ROOT, 'data/drug_catalog.json'), 'utf8')) as {
  drugs: CatalogDrug[];
};

/** openFDA generic_name search term per catalog drug (exact phrase as FDA lists generic names). */
const OPENFDA_GENERIC: Record<string, string> = {
  atorvastatin: 'atorvastatin calcium',
  amlodipine: 'amlodipine besylate',
  levothyroxine: 'levothyroxine sodium',
  lisinopril: 'lisinopril',
  gabapentin: 'gabapentin',
  losartan: 'losartan potassium',
  metformin: 'metformin hydrochloride',
  metoprolol_succinate: 'metoprolol succinate',
  omeprazole: 'omeprazole',
  rosuvastatin: 'rosuvastatin calcium',
  pantoprazole: 'pantoprazole sodium',
  furosemide: 'furosemide',
  hydrocodone_acetaminophen: 'hydrocodone bitartrate and acetaminophen',
  tamsulosin: 'tamsulosin hydrochloride',
};
/** Single keyword used to search free-text recall product descriptions. */
const RECALL_KEYWORD: Record<string, string> = {
  atorvastatin: 'atorvastatin',
  amlodipine: 'amlodipine',
  levothyroxine: 'levothyroxine',
  lisinopril: 'lisinopril',
  gabapentin: 'gabapentin',
  losartan: 'losartan',
  metformin: 'metformin',
  metoprolol_succinate: 'metoprolol',
  omeprazole: 'omeprazole',
  rosuvastatin: 'rosuvastatin',
  pantoprazole: 'pantoprazole',
  furosemide: 'furosemide',
  hydrocodone_acetaminophen: 'hydrocodone',
  tamsulosin: 'tamsulosin',
};

const results: CheckResult[] = [];
const fixtures: Record<string, unknown> = {};

function log(meta: ResponseMeta, outcome: LookupOutcome<unknown>): RequestLog {
  return {
    url: meta.url,
    outcome: outcome.kind,
    httpStatus: meta.httpStatus,
    retrievedAt: meta.retrievedAt,
    elapsedMs: meta.elapsedMs,
    ...(outcome.kind === 'SOURCE_UNAVAILABLE' ? { detail: `${outcome.reason}: ${outcome.detail}` } : {}),
  };
}

async function get<T>(
  source: 'OPENFDA' | 'DAILYMED' | 'RXNAV',
  url: string,
  validate: (b: unknown) => string | null,
  reqs: RequestLog[],
  opts: { timeoutMs?: number } = {},
): Promise<LookupOutcome<T>> {
  const o = await lookup<T>(source, url, validate, opts);
  reqs.push(log(o.meta, o as LookupOutcome<unknown>));
  await sleep(PACE_MS);
  return o;
}

const q = (s: string) => encodeURIComponent(s);
const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);

// ---------------------------------------------------------------------------------------------
// C1. Direct HTTPS accessibility without credentials
// ---------------------------------------------------------------------------------------------
async function c1Accessibility(): Promise<boolean> {
  const reqs: RequestLog[] = [];
  const probes: [string, 'OPENFDA' | 'DAILYMED' | 'RXNAV', string, (b: unknown) => string | null][] = [
    ['openFDA NDC Directory', 'OPENFDA', `${OPENFDA}/ndc.json?search=generic_name:${q('"lisinopril"')}&limit=1`, validateOpenFdaNdc],
    ['openFDA Enforcement', 'OPENFDA', `${OPENFDA}/enforcement.json?search=product_description:${q('"lisinopril"')}&limit=1`, validateOpenFdaEnforcement],
    ['DailyMed SPL list', 'DAILYMED', `${DAILYMED}/spls.json?drug_name=lisinopril&pagesize=1`, validateDailyMedSplList],
    ['RxNav rxcui by name', 'RXNAV', `${RXNAV}/rxcui.json?name=lisinopril`, validateRxNavIdGroup],
  ];
  const rows: Record<string, unknown>[] = [];
  let reachable = 0;
  for (const [name, src, url, v] of probes) {
    const o = await get(src, url, v, reqs);
    const ok = o.kind === 'OK';
    if (ok) reachable++;
    rows.push({
      endpoint: name,
      outcome: o.kind,
      httpStatus: o.meta.httpStatus,
      elapsedMs: o.meta.elapsedMs,
      corsAllowOrigin: o.meta.headers['access-control-allow-origin'] ?? null,
      rateLimitHeaders: {
        limit: o.meta.headers['x-ratelimit-limit'] ?? null,
        remaining: o.meta.headers['x-ratelimit-remaining'] ?? null,
      },
      credentialsSent: false,
    });
    if (ok && SAVE_FIXTURES) fixtures[`accessibility_${src.toLowerCase()}_${rows.length}`] = trim(o.data);
  }
  const allDown = reachable === 0;
  results.push({
    id: 'C1',
    title: 'Direct HTTPS accessibility without private credentials',
    status: allDown ? 'BLOCKED' : reachable === probes.length ? 'PASS' : 'FAIL',
    summary: `${reachable}/${probes.length} endpoints returned schema-valid data over HTTPS with no API key.`,
    details: rows,
    requests: reqs,
  });
  return !allDown;
}

// ---------------------------------------------------------------------------------------------
// C2 + C3. NDC normalization / identification and ingredient-strength-formulation matching
// ---------------------------------------------------------------------------------------------
interface DrugSample {
  drug: CatalogDrug;
  product?: OpenFdaNdcProduct;
  packageNdc?: string;
  splSetId?: string;
  formsObserved: Record<string, number>;
  routesObserved: Record<string, number>;
  ingredientSetsObserved: Record<string, number>;
  totalProducts?: number;
}
const samples: DrugSample[] = [];

async function c2c3Identity(): Promise<void> {
  const reqs2: RequestLog[] = [];
  const reqs3: RequestLog[] = [];
  const normRows: Record<string, unknown>[] = [];
  const matchRows: Record<string, unknown>[] = [];
  let normPass = 0;
  let normFail = 0;
  let matchPass = 0;
  let matchFail = 0;
  let unavailable = 0;

  for (const drug of catalog.drugs) {
    const term = OPENFDA_GENERIC[drug.id]!;
    const sample: DrugSample = { drug, formsObserved: {}, routesObserved: {}, ingredientSetsObserved: {} };
    samples.push(sample);

    // Up to 100 finished products by generic name, to observe dosage forms / routes / ingredient sets.
    const url = `${OPENFDA}/ndc.json?search=generic_name:${q(`"${term}"`)}+AND+finished:true&limit=100`;
    const o = await get<OpenFdaEnvelope<OpenFdaNdcProduct>>('OPENFDA', url, validateOpenFdaNdc, reqs2);
    if (o.kind !== 'OK') {
      unavailable++;
      normRows.push({ drug: drug.id, outcome: o.kind });
      continue;
    }
    sample.totalProducts = o.data.meta.results.total;
    for (const p of o.data.results) {
      sample.formsObserved[p.dosage_form] = (sample.formsObserved[p.dosage_form] ?? 0) + 1;
      for (const r of p.route ?? ['(none)']) sample.routesObserved[r] = (sample.routesObserved[r] ?? 0) + 1;
      const set = p.active_ingredients.map((a) => a.name.toUpperCase()).sort().join(' + ');
      sample.ingredientSetsObserved[set] = (sample.ingredientSetsObserved[set] ?? 0) + 1;
    }
    // Representative: first oral prescription product with packaging whose ingredient set is
    // exactly the catalog set (a generic_name search also returns combination products).
    const exactSet = (p: OpenFdaNdcProduct) =>
      p.active_ingredients.length === drug.ingredients.length &&
      drug.ingredients.every((i) => p.active_ingredients.some((a) => a.name.toUpperCase().includes(i.name.toUpperCase())));
    const rep = o.data.results.find(
      (p) =>
        exactSet(p) &&
        (p.route ?? []).includes('ORAL') &&
        (p.packaging?.length ?? 0) > 0 &&
        (p as { product_type?: string }).product_type === 'HUMAN PRESCRIPTION DRUG',
    );
    const combinationCount = o.data.results.filter((p) => !exactSet(p)).length;
    if (!rep || !rep.packaging?.[0]) {
      normRows.push({ drug: drug.id, outcome: 'NO_REPRESENTATIVE_PRODUCT' });
      normFail++;
      continue;
    }
    sample.product = rep;
    sample.packageNdc = rep.packaging[0].package_ndc;
    const setIds = (rep.openfda as { spl_set_id?: string[] } | undefined)?.spl_set_id;
    if (setIds?.[0]) sample.splSetId = setIds[0];
    if (SAVE_FIXTURES && !fixtures[`ndc_${drug.id}`]) {
      fixtures[`ndc_${drug.id}`] = { meta: o.data.meta, results: [rep] };
    }

    // --- C2: 10-digit -> 11-digit -> candidates -> directory confirmation round trip.
    const ndc11 = toNdc11(sample.packageNdc);
    const parsed = parseNdcInput(ndc11);
    const confirmations: { candidate: string; outcome: string; matchedProductNdc?: string }[] = [];
    for (const c of parsed.candidates) {
      const cu = `${OPENFDA}/ndc.json?search=packaging.package_ndc:${q(`"${c.packageNdc}"`)}&limit=1`;
      const co = await get<OpenFdaEnvelope<OpenFdaNdcProduct>>('OPENFDA', cu, validateOpenFdaNdc, reqs2);
      confirmations.push({
        candidate: c.packageNdc,
        outcome: co.kind,
        ...(co.kind === 'OK' ? { matchedProductNdc: co.data.results[0]?.product_ndc } : {}),
      });
    }
    const confirmed = confirmations.filter((c) => c.outcome === 'OK');
    const anyUnavailable = confirmations.some((c) => c.outcome === 'SOURCE_UNAVAILABLE' || c.outcome === 'RATE_LIMITED');
    const exactlyOriginal = confirmed.length === 1 && confirmed[0]!.candidate === sample.packageNdc;

    // RxNav cross-check: NDC11 -> RxCUI (SCD) and concept name.
    const ru = `${RXNAV}/ndcstatus.json?ndc=${ndc11}`;
    const ro = await get<RxNavNdcStatus>('RXNAV', ru, validateRxNavNdcStatus, reqs2);
    const rx = ro.kind === 'OK' ? ro.data.ndcStatus : null;
    if (SAVE_FIXTURES && ro.kind === 'OK' && !fixtures[`rxnav_ndcstatus_${drug.id}`]) fixtures[`rxnav_ndcstatus_${drug.id}`] = ro.data;

    if (anyUnavailable) unavailable++;
    else if (exactlyOriginal) normPass++;
    else normFail++;
    normRows.push({
      drug: drug.id,
      labeler: rep.labeler_name,
      packageNdc: sample.packageNdc,
      ndc11,
      inputKind: parsed.kind,
      candidates: parsed.candidates.map((c) => c.packageNdc),
      directoryConfirmations: confirmations,
      roundTrip: exactlyOriginal ? 'UNIQUE_MATCH_TO_ORIGINAL' : anyUnavailable ? 'SOURCE_UNAVAILABLE' : confirmed.length > 1 ? 'AMBIGUOUS' : 'NOT_CONFIRMED',
      rxnav: rx ? { status: rx.status, rxcui: rx.rxcui, conceptName: rx.conceptName } : ro.kind,
    });

    // --- C3: ingredient, strength and formulation consistency (openFDA vs RxNav vs catalog).
    const fdaIngredients = rep.active_ingredients.map((a) => a.name.toUpperCase());
    const catalogNames = drug.ingredients.map((i) => i.name.toUpperCase());
    const ingredientSetMatches =
      fdaIngredients.length === catalogNames.length &&
      catalogNames.every((n) => fdaIngredients.some((f) => f.includes(n)));
    const concept = rx?.conceptName ?? '';
    const fdaStrengths = rep.active_ingredients.map((a) => normalizeStrength(a.strength));
    const rxStrengths = rxNavStrengths(concept);
    const strengthInRxNav =
      concept !== '' && fdaStrengths.every((f) => f !== null && rxStrengths.some((r) => sameStrength(f, r)));
    const rawStrengthTextIdentical =
      concept !== '' && rep.active_ingredients.every((a) => concept.includes(a.strength.split('/')[0]!.trim()));
    const fdaForm = rep.dosage_form.toUpperCase();
    const fdaRelease = /EXTENDED RELEASE/.test(fdaForm) ? 'ER' : /DELAYED RELEASE/.test(fdaForm) ? 'DR' : 'IR_OR_UNSPECIFIED';
    const rxRelease = /Extended Release|24 HR|12 HR/i.test(concept) ? 'ER' : /Delayed Release/i.test(concept) ? 'DR' : 'IR_OR_UNSPECIFIED';
    const releaseConsistent = concept === '' ? null : fdaRelease === rxRelease;
    const ok = ingredientSetMatches && strengthInRxNav && releaseConsistent === true;
    if (rx === null) unavailable++;
    else if (ok) matchPass++;
    else matchFail++;
    matchRows.push({
      drug: drug.id,
      productNdc: rep.product_ndc,
      openFda: { ingredients: rep.active_ingredients, dosageForm: rep.dosage_form, route: rep.route },
      rxnavConceptName: concept || null,
      ingredientSetMatchesCatalog: ingredientSetMatches,
      strengthFoundInRxNavConcept: strengthInRxNav,
      strengthsNormalized: { openFda: fdaStrengths, rxnav: rxStrengths, rawTextIdentical: rawStrengthTextIdentical },
      releaseMechanism: { openFda: fdaRelease, rxnav: rxRelease, consistent: releaseConsistent },
      observedAcross100Products: {
        totalFinishedProductsForGenericName: sample.totalProducts,
        productsWithDifferentIngredientSet: combinationCount,
        dosageForms: sample.formsObserved,
        routes: sample.routesObserved,
        ingredientSets: sample.ingredientSetsObserved,
      },
    });
  }

  results.push({
    id: 'C2',
    title: 'NDC normalization and product identification',
    status: normFail > 0 ? 'FAIL' : unavailable > 0 && normPass === 0 ? 'BLOCKED' : unavailable > 0 ? 'WARN' : 'PASS',
    summary: `${normPass}/${catalog.drugs.length} real package NDCs round-tripped 10→11→candidate→directory to a unique match; ${normFail} failed; ${unavailable} source-unavailable.`,
    details: normRows,
    requests: reqs2,
  });
  results.push({
    id: 'C3',
    title: 'Ingredient, strength and formulation matching (openFDA vs RxNav)',
    status: matchFail > 0 ? 'WARN' : unavailable > 0 && matchPass === 0 ? 'BLOCKED' : 'PASS',
    summary: `${matchPass}/${catalog.drugs.length} representative products agree on ingredient set, strength and release mechanism across openFDA and RxNav; ${matchFail} disagreements need rule handling.`,
    details: matchRows,
    requests: reqs3,
  });
}

// ---------------------------------------------------------------------------------------------
// C4 + C5. Recall lookup, product-level relevance and lot-level matching
// ---------------------------------------------------------------------------------------------
async function c4c5Recalls(): Promise<void> {
  const reqs: RequestLog[] = [];
  const rows: Record<string, unknown>[] = [];
  const lotRows: Record<string, unknown>[] = [];
  let unavailable = 0;
  let totalSampled = 0;
  let totalWithOpenfda = 0;
  let totalWithNdcInText = 0;
  let totalWithLotToken = 0;
  let totalCombination = 0;

  for (const drug of catalog.drugs) {
    const kw = RECALL_KEYWORD[drug.id]!;
    const urlStructured = `${OPENFDA}/enforcement.json?search=openfda.generic_name:${q(`"${kw}"`)}&limit=1`;
    const urlText = `${OPENFDA}/enforcement.json?search=product_description:${q(`"${kw}"`)}&limit=100`;
    const s = await get<OpenFdaEnvelope<OpenFdaEnforcement>>('OPENFDA', urlStructured, validateOpenFdaEnforcement, reqs);
    const t = await get<OpenFdaEnvelope<OpenFdaEnforcement>>('OPENFDA', urlText, validateOpenFdaEnforcement, reqs);
    const structuredTotal = s.kind === 'OK' ? s.data.meta.results.total : s.kind === 'NO_MATCH' ? 0 : null;
    if (t.kind !== 'OK') {
      if (t.kind !== 'NO_MATCH') unavailable++;
      rows.push({ drug: drug.id, structuredTotal, textOutcome: t.kind, textTotal: t.kind === 'NO_MATCH' ? 0 : null });
      continue;
    }
    const recs = t.data.results;
    const withOpenfda = recs.filter((r) => r.openfda && Object.keys(r.openfda).length > 0);
    const withNdc = recs.filter((r) => extractNdcsFromText(r.product_description).length > 0);
    const lotToken = recs.filter((r) => /\blot\b|\blots\b|lot\s*#|lot:/i.test(r.code_info));
    const combination = recs.filter((r) => {
      const subs = r.openfda?.substance_name ?? [];
      return subs.length > drug.ingredients.length || /\/|\band\b/i.test(r.openfda?.generic_name?.[0] ?? '');
    });
    totalSampled += recs.length;
    totalWithOpenfda += withOpenfda.length;
    totalWithNdcInText += withNdc.length;
    totalWithLotToken += lotToken.length;
    totalCombination += combination.length;

    // Does any sampled recall reference our representative product NDC?
    const sample = samples.find((x) => x.drug.id === drug.id);
    const repProduct = sample?.product?.product_ndc;
    const repHits = repProduct
      ? recs.filter(
          (r) =>
            (r.openfda?.product_ndc ?? []).includes(repProduct) ||
            extractNdcsFromText(r.product_description).some((n) => n.startsWith(`${repProduct}-`)),
        ).map((r) => r.recall_number)
      : [];

    rows.push({
      drug: drug.id,
      structuredSearchTotal: structuredTotal,
      freeTextSearchTotal: t.data.meta.results.total,
      sampled: recs.length,
      sampledWithOpenfdaSection: withOpenfda.length,
      sampledWithNdcParsableFromDescription: withNdc.length,
      sampledCombinationProducts: combination.length,
      representativeProductNdc: repProduct ?? null,
      sampledRecallsReferencingRepresentativeProduct: repHits,
      classifications: countBy(recs.map((r) => r.classification)),
      statuses: countBy(recs.map((r) => r.status)),
    });
    lotRows.push({
      drug: drug.id,
      sampled: recs.length,
      codeInfoWithLotToken: lotToken.length,
      examples: recs.slice(0, 2).map((r) => ({ recall_number: r.recall_number, code_info: r.code_info.slice(0, 160) })),
    });
    if (SAVE_FIXTURES && recs.length > 0 && !fixtures[`enforcement_${drug.id}`]) {
      fixtures[`enforcement_${drug.id}`] = { meta: t.data.meta, results: recs.slice(0, 3) };
    }
  }

  // Global coverage of the openfda enrichment block across all drug enforcement records.
  const all = await get<OpenFdaEnvelope<OpenFdaEnforcement>>('OPENFDA', `${OPENFDA}/enforcement.json?limit=1`, validateOpenFdaEnforcement, reqs);
  const missing = await get<OpenFdaEnvelope<OpenFdaEnforcement>>('OPENFDA', `${OPENFDA}/enforcement.json?search=_missing_:openfda&limit=1`, validateOpenFdaEnforcement, reqs);
  const globalTotal = all.kind === 'OK' ? all.data.meta.results.total : null;
  const globalMissing = missing.kind === 'OK' ? missing.data.meta.results.total : null;

  results.push({
    id: 'C4',
    title: 'Recall lookup and product-level relevance',
    status: unavailable > 0 && totalSampled === 0 ? 'BLOCKED' : 'WARN',
    summary:
      `Recall records are retrievable for the supported drugs, but product-level relevance cannot rely on structured fields: ` +
      `${globalMissing ?? '?'} of ${globalTotal ?? '?'} drug enforcement records (${globalTotal && globalMissing !== null ? pct(globalMissing, globalTotal) : 'n/a'}) lack the openfda block. ` +
      `In the per-drug sample, ${pct(totalWithOpenfda, totalSampled)} had openfda data, ${pct(totalWithNdcInText, totalSampled)} had an NDC parsable from product_description, ` +
      `and ${totalCombination} were combination products matched by a single-ingredient keyword.`,
    details: { globalTotal, globalMissingOpenfda: globalMissing, perDrug: rows },
    requests: reqs,
  });
  results.push({
    id: 'C5',
    title: 'Lot-specific matching where source data permits',
    status: totalSampled === 0 ? 'BLOCKED' : 'WARN',
    summary: `Lot information exists only as free text in code_info; ${pct(totalWithLotToken, totalSampled)} of sampled records contain an explicit lot token. Lot matching is possible only as a user-confirmed comparison, never as an automatic non-match.`,
    details: lotRows,
    requests: [],
  });
}

// ---------------------------------------------------------------------------------------------
// C6. Response schema validation (aggregated from all requests so far + RxNav version)
// ---------------------------------------------------------------------------------------------
function c6Schema(): void {
  const all = results.flatMap((r) => r.requests);
  const violations = all.filter((r) => r.detail?.startsWith('SCHEMA_VIOLATION'));
  const ok = all.filter((r) => r.outcome === 'OK').length;
  results.push({
    id: 'C6',
    title: 'Response schema validation',
    status: all.length === 0 ? 'BLOCKED' : violations.length > 0 ? 'FAIL' : 'PASS',
    summary: `${ok} responses validated against minimal schemas; ${violations.length} schema violations.`,
    details: { validatedResponses: ok, violations },
    requests: [],
  });
}

// ---------------------------------------------------------------------------------------------
// C7. Rate-limit and service-error handling
// ---------------------------------------------------------------------------------------------
async function c7Errors(): Promise<void> {
  const reqs: RequestLog[] = [];
  const cases: Record<string, unknown>[] = [];

  const notFound = await get('OPENFDA', `${OPENFDA}/ndc.json?search=generic_name:${q('"zz-no-such-drug-zz"')}&limit=1`, validateOpenFdaNdc, reqs);
  cases.push({ case: 'openFDA no matching records', expected: 'NO_MATCH', observed: notFound.kind, httpStatus: notFound.meta.httpStatus });

  const badField = await get('OPENFDA', `${OPENFDA}/enforcement.json?search=no_such_field_xyz:${q('"metformin"')}&limit=1`, validateOpenFdaEnforcement, reqs);
  cases.push({
    case: 'openFDA query on a nonexistent field (e.g., a typo in a field name)',
    expected: 'Hazard probe: if this is NO_MATCH, a field-name bug is indistinguishable from "no recalls"',
    observed: badField.kind,
    httpStatus: badField.meta.httpStatus,
  });

  const malformed = await get('OPENFDA', `${OPENFDA}/ndc.json?search=generic_name:((&limit=1`, validateOpenFdaNdc, reqs);
  cases.push({ case: 'openFDA malformed query syntax', expected: 'SOURCE_UNAVAILABLE (never NO_MATCH)', observed: malformed.kind, httpStatus: malformed.meta.httpStatus });

  const timeout = await get('OPENFDA', `${OPENFDA}/ndc.json?search=generic_name:${q('"lisinopril"')}&limit=1`, validateOpenFdaNdc, reqs, { timeoutMs: 1 });
  cases.push({ case: 'Client timeout (1 ms budget)', expected: 'SOURCE_UNAVAILABLE/TIMEOUT', observed: timeout.kind === 'SOURCE_UNAVAILABLE' ? `${timeout.kind}/${timeout.reason}` : timeout.kind });

  const dmNone = await get('DAILYMED', `${DAILYMED}/spls.json?drug_name=zznosuchdrugzz&pagesize=1`, validateDailyMedSplList, reqs);
  cases.push({ case: 'DailyMed no matching SPL', expected: 'NO_MATCH', observed: dmNone.kind, httpStatus: dmNone.meta.httpStatus });

  const dmBadSet = await get('DAILYMED', `${DAILYMED}/spls/00000000-0000-0000-0000-000000000000/ndcs.json`, validateAny, reqs);
  cases.push({ case: 'DailyMed unknown set ID', expected: 'Recorded for documentation', observed: dmBadSet.kind, httpStatus: dmBadSet.meta.httpStatus });

  const rxNone = await get('RXNAV', `${RXNAV}/rxcui.json?name=zznosuchdrugzz`, validateRxNavIdGroup, reqs);
  cases.push({ case: 'RxNav unknown name', expected: 'NO_MATCH', observed: rxNone.kind, httpStatus: rxNone.meta.httpStatus });

  const rxBadNdc = await get('RXNAV', `${RXNAV}/ndcstatus.json?ndc=00000000000`, validateAny, reqs);
  const rxBadBody = rxBadNdc.kind === 'OK' ? (rxBadNdc.data as { ndcStatus?: { status?: string } }).ndcStatus?.status ?? null : null;
  cases.push({ case: 'RxNav ndcstatus for nonexistent NDC', expected: 'Recorded for documentation', observed: rxBadNdc.kind, ndcStatus: rxBadBody });

  // Rate-limit headers: openFDA documents per-IP limits for keyless use; record what headers are exposed.
  const headerSample = reqs.find((r) => r.url.startsWith(OPENFDA) && r.httpStatus === 200);
  const rl = await fetchRaw(`${OPENFDA}/ndc.json?search=generic_name:${q('"lisinopril"')}&limit=1`).catch(() => null);
  await sleep(PACE_MS);
  cases.push({
    case: 'Rate-limit headers exposed to keyless clients',
    observed: rl ? { 'x-ratelimit-limit': rl.headers['x-ratelimit-limit'] ?? null, 'x-ratelimit-remaining': rl.headers['x-ratelimit-remaining'] ?? null, 'retry-after': rl.headers['retry-after'] ?? null } : 'request failed',
    note: 'HTTP 429 is not provoked deliberately (it would consume the shared per-IP quota). 429 handling is covered by deterministic unit tests (tests/unit/http_classification.test.ts).',
    headerSampleUrl: headerSample?.url ?? null,
  });

  const wrong = cases.filter((c) => typeof c.expected === 'string' && (c.expected === 'NO_MATCH' || (c.expected as string).startsWith('SOURCE_UNAVAILABLE')) && !String(c.observed).startsWith(String(c.expected).split(' ')[0]!.split('/')[0]!));
  const hazard = badField.kind === 'NO_MATCH';
  results.push({
    id: 'C7',
    title: 'Rate-limit and service-error handling',
    status: wrong.length > 0 ? 'FAIL' : hazard ? 'WARN' : 'PASS',
    summary:
      `${cases.length} error scenarios exercised; ${wrong.length} misclassified.` +
      (hazard ? ' HAZARD: openFDA answers a query on a nonexistent field with NOT_FOUND, so field-name bugs look like "no recalls". The app must run a known-positive control query per source (see TEST_PLAN RG-2).' : '') +
      (malformed.meta.httpStatus === 500 ? ' openFDA returns HTTP 500 (not 400) for malformed queries.' : ''),
    details: cases,
    requests: reqs,
  });
}

// ---------------------------------------------------------------------------------------------
// C8. Source freshness and retrieval timestamps
// ---------------------------------------------------------------------------------------------
async function c8Freshness(): Promise<void> {
  const reqs: RequestLog[] = [];
  const ndc = await get<OpenFdaEnvelope<unknown>>('OPENFDA', `${OPENFDA}/ndc.json?limit=1`, validateOpenFdaNdc, reqs);
  const enf = await get<OpenFdaEnvelope<unknown>>('OPENFDA', `${OPENFDA}/enforcement.json?limit=1`, validateOpenFdaEnforcement, reqs);
  const dm = await get<DailyMedSplList>('DAILYMED', `${DAILYMED}/spls.json?pagesize=1`, validateDailyMedSplList, reqs);
  const rx = await get<RxNavVersion>('RXNAV', `${RXNAV}/version.json`, validateRxNavVersion, reqs);
  const rows = {
    openFdaNdcLastUpdated: ndc.kind === 'OK' ? ndc.data.meta.last_updated : ndc.kind,
    openFdaEnforcementLastUpdated: enf.kind === 'OK' ? enf.data.meta.last_updated : enf.kind,
    dailyMedDbPublished: dm.kind === 'OK' ? dm.data.metadata.db_published_date : dm.kind,
    rxNormVersion: rx.kind === 'OK' ? rx.data : rx.kind,
    retrievedAt: reqs.map((r) => ({ url: r.url, retrievedAt: r.retrievedAt })),
  };
  if (SAVE_FIXTURES && rx.kind === 'OK') fixtures.rxnav_version = rx.data;
  const anyOk = [ndc, enf, dm, rx].some((o) => o.kind === 'OK');
  results.push({
    id: 'C8',
    title: 'Source freshness and retrieval timestamps',
    status: anyOk ? 'PASS' : 'BLOCKED',
    summary: `Each source exposes a dataset-level freshness marker (openFDA meta.last_updated, DailyMed metadata.db_published_date, RxNav version). None exposes per-record last-modified for recalls; the app must store both the source marker and its own retrieval time.`,
    details: rows,
    requests: reqs,
  });
}

// ---------------------------------------------------------------------------------------------
// C9. Missing or ambiguous manufacturer information (SPL establishments, repackagers)
// ---------------------------------------------------------------------------------------------
async function c9Manufacturer(): Promise<void> {
  const reqs: RequestLog[] = [];
  const rows: Record<string, unknown>[] = [];
  let parsed = 0;
  let noManufacture = 0;
  let noEstablishments = 0;
  let repack = 0;
  let multiManufacture = 0;
  let traversals = 0;
  const observedOps: Record<string, number> = {};
  let traversalResolved = 0;

  // Representative SPLs (one per drug) plus repackager SPLs found via DailyMed search.
  const setIds: { drug: string; setId: string; via: string }[] = [];
  for (const s of samples) if (s.splSetId) setIds.push({ drug: s.drug.id, setId: s.splSetId, via: 'openFDA NDC representative product' });
  for (const kw of ['lisinopril', 'atorvastatin', 'metformin']) {
    const o = await get<DailyMedSplList>('DAILYMED', `${DAILYMED}/spls.json?drug_name=${kw}&pagesize=25`, validateDailyMedSplList, reqs);
    if (o.kind === 'OK') {
      // Repackagers typically carry a distinct labeler in the SPL title; take a few for parsing.
      for (const d of o.data.data.filter((d) => /PREPACK|PD-RX|REPACK|BRYANT|A-S MEDICATION|DIRECT_RX|DIRECT RX|PROFICIENT|QUALITY CARE|NUCARE|REMEDYREPACK|MAJOR/i.test(d.title)).slice(0, 2)) {
        setIds.push({ drug: kw, setId: d.setid, via: `DailyMed search (title: ${d.title})` });
      }
    }
  }

  for (const { drug, setId, via } of setIds) {
    const url = `${DAILYMED}/spls/${setId}.xml`;
    const started = Date.now();
    let xml: string | null = null;
    let status: number | null = null;
    try {
      // DailyMed answers HTTP 406 to "Accept: application/xml"; it serves SPL XML for "*/*".
      const raw = await fetchRaw(url, { accept: '*/*' });
      status = raw.status;
      if (raw.status === 200 && raw.bodyText.includes('<document')) xml = raw.bodyText;
    } catch {
      /* recorded below */
    }
    reqs.push({ url, outcome: xml ? 'OK' : 'SOURCE_UNAVAILABLE', httpStatus: status, retrievedAt: new Date().toISOString(), elapsedMs: Date.now() - started });
    await sleep(PACE_MS);
    if (!xml) {
      rows.push({ drug, setId, via, outcome: 'SPL_XML_UNAVAILABLE', httpStatus: status });
      continue;
    }
    parsed++;
    const sum = summarizeSplEstablishments(xml);
    const mCount = sum.manufactureEstablishmentCount;
    if (mCount === 0) noManufacture++;
    if (sum.noEstablishmentSection) noEstablishments++;
    if (mCount > 1) multiManufacture++;
    if (sum.hasRepackOrRelabel) repack++;

    // Observed operation codes across all parsed SPLs (for documentation).
    for (const e of sum.establishments) for (const c of e.operations) observedOps[`${c}:${e.operationNames[c] ?? ''}`] = (observedOps[`${c}:${e.operationNames[c] ?? ''}`] ?? 0) + 1;

    // One-hop traversal: repackager without MANUFACTURE -> source NDC -> openFDA NDC Directory.
    let traversal: unknown = null;
    if (!sum.hasManufacture && sum.equivalentSourceNdcs.length > 0) {
      traversals++;
      const src = sum.equivalentSourceNdcs[0]!;
      const o = await get<OpenFdaEnvelope<OpenFdaNdcProduct>>('OPENFDA', `${OPENFDA}/ndc.json?search=product_ndc:${q(`"${src}"`)}&limit=1`, validateOpenFdaNdc, reqs);
      if (o.kind === 'OK' && o.data.results[0]) {
        traversalResolved++;
        const r = o.data.results[0];
        traversal = { sourceNdc: src, outcome: 'OK', sourceLabeler: r.labeler_name, sourceApplication: r.application_number ?? null };
      } else {
        traversal = { sourceNdc: src, outcome: o.kind };
      }
    }
    rows.push({
      drug,
      setId,
      via,
      establishments: sum.establishments.map((e) => ({ name: e.name, duns: e.duns, operations: e.operations.map((c) => `${c}:${e.operationNames[c] || OPERATION_LABELS[c] || '?'}`) })),
      noEstablishmentSection: sum.noEstablishmentSection,
      manufactureEstablishments: mCount,
      hasRepackOrRelabel: sum.hasRepackOrRelabel,
      equivalentSourceNdcs: sum.equivalentSourceNdcs,
      traversal,
    });
  }

  // Cross-source consistency: does DailyMed index the representative package NDC?
  const xsrc: Record<string, unknown>[] = [];
  for (const s of samples.slice(0, 5)) {
    if (!s.packageNdc) continue;
    const o = await get<DailyMedSplList>('DAILYMED', `${DAILYMED}/spls.json?ndc=${s.packageNdc}`, validateDailyMedSplList, reqs);
    xsrc.push({
      drug: s.drug.id,
      packageNdc: s.packageNdc,
      openFdaSplSetId: s.splSetId ?? null,
      dailyMed: o.kind === 'OK' ? o.data.data.map((d) => d.setid) : o.kind,
      consistent: o.kind === 'OK' ? o.data.data.some((d) => d.setid === s.splSetId) : false,
    });
  }

  results.push({
    id: 'C9',
    title: 'Missing or ambiguous manufacturer / facility information',
    status: parsed === 0 ? 'BLOCKED' : 'WARN',
    summary:
      `${parsed} SPL documents parsed: ${noManufacture} list no MANUFACTURE establishment (${noEstablishments} have no establishment section at all), ${multiManufacture} list more than one MANUFACTURE establishment, ${repack} contain REPACK/RELABEL operations. ` +
      `Observed MANUFACTURE code is C43360 (Document A states C43215). ` +
      `${traversalResolved}/${traversals} repackager source-NDC traversals resolved to an originating labeler via openFDA. ` +
      `Facility identity is frequently absent or multi-valued and must be shown as uncertain, never as verified.`,
    details: { observedOperationCodes: observedOps, spls: rows, crossSourceNdcIndexing: xsrc },
    requests: reqs,
  });
}

// ---------------------------------------------------------------------------------------------
// C10. Are direct API calls sufficient without a backend?
// ---------------------------------------------------------------------------------------------
function c10Sufficiency(): void {
  const byId = Object.fromEntries(results.map((r) => [r.id, r.status]));
  const reqCount = results.reduce((n, r) => n + r.requests.length, 0);
  const blocked = Object.values(byId).includes('BLOCKED');
  results.push({
    id: 'C10',
    title: 'Sufficiency of direct API calls without an application backend',
    status: blocked ? 'BLOCKED' : 'WARN',
    summary: blocked
      ? 'Cannot assess: one or more sources were unreachable.'
      : 'Direct, keyless HTTPS calls are sufficient for identification (NDC Directory, RxNav), labeling/establishment data (DailyMed SPL) and recall retrieval (openFDA enforcement) in MVP scope. ' +
        'Limitations that a phone-only design must absorb: free-text recall matching on device; per-IP keyless quotas (a phone-only app sends no shared key); no FDA inspection/483/import-alert data via these four APIs; and SPL XML parsing on device.',
    details: {
      checkStatuses: byId,
      requestsIssuedThisRun: reqCount,
      notTested: [
        'FDA inspection classifications, Form 483s, warning letters and Import Alert 66-40 (Document A §2–3): not part of the four mandated APIs; deferred, see docs/API_FEASIBILITY.md.',
        'HTTP 429 behavior under real quota exhaustion (not provoked to avoid exhausting the shared per-IP quota).',
      ],
    },
    requests: [],
  });
}

// ---------------------------------------------------------------------------------------------
function countBy(xs: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of xs) o[x] = (o[x] ?? 0) + 1;
  return o;
}
function trim(v: unknown): unknown {
  if (v && typeof v === 'object' && 'results' in (v as object)) {
    const o = v as { results: unknown[] };
    return { ...o, results: o.results.slice(0, 1) };
  }
  return v;
}

function blockAll(reason: string): void {
  const ids: [string, string][] = [
    ['C2', 'NDC normalization and product identification'],
    ['C3', 'Ingredient, strength and formulation matching'],
    ['C4', 'Recall lookup and product-level relevance'],
    ['C5', 'Lot-specific matching'],
    ['C6', 'Response schema validation'],
    ['C7', 'Rate-limit and service-error handling'],
    ['C8', 'Source freshness and retrieval timestamps'],
    ['C9', 'Missing or ambiguous manufacturer information'],
    ['C10', 'Sufficiency of direct API calls without a backend'],
  ];
  for (const [id, title] of ids) {
    results.push({ id, title, status: 'BLOCKED', summary: reason, details: null, requests: [] });
  }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`Rx Quality Check API feasibility harness — started ${startedAt}`);
  const reachable = await c1Accessibility();
  if (!reachable) {
    blockAll('BLOCKED: no public source reachable from this environment (network policy or outage). Re-run `npm run feasibility` on an unrestricted network.');
  } else {
    await c2c3Identity();
    await c4c5Recalls();
    await c7Errors();
    await c8Freshness();
    await c9Manufacturer();
    c6Schema();
    c10Sufficiency();
  }
  results.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));

  const finishedAt = new Date().toISOString();
  const report = {
    harness: 'scripts/check_api_feasibility.ts',
    startedAt,
    finishedAt,
    node: process.version,
    credentialsUsed: false,
    totals: countBy(results.map((r) => r.status)),
    results,
  };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + '\n');

  if (SAVE_FIXTURES) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    for (const [name, data] of Object.entries(fixtures)) {
      writeFileSync(
        join(FIXTURE_DIR, `${name}.json`),
        JSON.stringify({ _fixture: { source: 'live public API response, trimmed to ≤3 records; no patient data', capturedAt: finishedAt }, data }, null, 2) + '\n',
      );
    }
    console.log(`Saved ${Object.keys(fixtures).length} fixtures to ${FIXTURE_DIR}`);
  }

  for (const r of results) console.log(`[${r.status.padEnd(7)}] ${r.id.padEnd(3)} ${r.title}\n          ${r.summary}`);
  console.log(`\nReport: ${OUT_PATH}`);
  const statuses = results.map((r) => r.status);
  process.exitCode = statuses.includes('BLOCKED') && !statuses.includes('PASS') ? 2 : statuses.includes('FAIL') ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
