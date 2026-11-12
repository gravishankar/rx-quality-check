/**
 * Recall evidence engine: query planning, coverage accounting and aggregation (R-EV-7, RG-1, RG-2).
 *
 * NO_MATCH_FOUND is reported only when every planned query completed (all pages retrieved, totals
 * consistent), the positive-control query returned the known recall and the parser read it, every
 * record was parseable, and no record was a confirmed or potential match. Any failed query,
 * incomplete pagination, parse error or failed control yields UNRESOLVED instead.
 */
import type {
  FindingClass,
  Limitation,
  PositiveControlResult,
  PositiveControlSpec,
  QueryCoverage,
  RecallEvidenceBundle,
  RecallFinding,
  RecallQuery,
  RecallQueryPlan,
  RecordAssessment,
} from '../models/evidence.ts';
import type { MedicationIdentity } from '../models/identity.ts';
import { isRecord } from '../models/lookup.ts';
import { extractNdcsWithKeys, productKeyOfProductNdc } from './ndc.ts';
import { assessRecord } from './recallRecord.ts';
import { RULESET_VERSION } from './version.ts';

/**
 * Positive control (RG-2): recall D-0325-2021, metformin ER 500 mg, NDC 62756-142-02. Observed in
 * openFDA on 2026-11-12 (tests/fixtures/task2/enf_control_fields.json).
 *
 * openFDA answers a query on a misspelled or renamed field with "no matches" (404), exactly like a
 * genuine empty result. The control therefore uses every field the recall queries use
 * (product_description and openfda.product_ndc), so drift in any of them fails the control and
 * blocks NO_MATCH_FOUND.
 */
export const POSITIVE_CONTROL: PositiveControlSpec = {
  query: {
    id: 'control',
    kind: 'POSITIVE_CONTROL',
    search: 'recall_number:"D-0325-2021" AND product_description:"metformin" AND openfda.product_ndc:"62756-142"',
    pageLimit: 1,
  },
  recallNumber: 'D-0325-2021',
  expectedProductNdc: '62756-142',
};

export const PAGE_LIMIT = 100;

const quote = (s: string) => `"${s.replace(/["\\]/g, '')}"`;

/**
 * Plan recall queries for a confirmed identity. Only public identifiers are used: ingredient base
 * names and product NDCs. Lot numbers, labels and OCR text are never part of a query.
 */
export function planRecallQueries(identity: MedicationIdentity): RecallQueryPlan {
  const queries: RecallQuery[] = [];
  const names = [...new Set(identity.ingredients.map((i) => i.name.toLowerCase()))].sort();
  queries.push({
    id: 'ingredient_text',
    kind: 'INGREDIENT_TEXT',
    search: names.map((n) => `product_description:${quote(n)}`).join(' AND '),
    pageLimit: PAGE_LIMIT,
  });
  if (identity.level === 'PRODUCT' && identity.productNdc !== null) {
    queries.push({
      id: 'product_ndc',
      kind: 'PRODUCT_NDC_STRUCTURED',
      search: `openfda.product_ndc:${quote(identity.productNdc)}`,
      pageLimit: PAGE_LIMIT,
    });
  }
  identity.relatedSourceProductNdcs.forEach((n, i) => {
    queries.push({
      id: `related_ndc_${i}`,
      kind: 'RELATED_PRODUCT_NDC_STRUCTURED',
      search: `openfda.product_ndc:${quote(n)}`,
      pageLimit: PAGE_LIMIT,
    });
  });
  return { queries, positiveControl: POSITIVE_CONTROL };
}

interface PageData {
  total: number;
  skip: number;
  lastUpdated: string;
  results: unknown[];
}

function pageData(data: unknown): PageData | null {
  if (!isRecord(data) || !isRecord(data.meta) || !isRecord(data.meta.results) || !Array.isArray(data.results)) return null;
  const { total, skip } = data.meta.results;
  if (typeof total !== 'number' || typeof skip !== 'number' || typeof data.meta.last_updated !== 'string') return null;
  return { total, skip, lastUpdated: data.meta.last_updated, results: data.results };
}

interface QueryReadout {
  coverage: QueryCoverage;
  records: unknown[];
}

/** Account for one query: were all its pages retrieved and consistent? */
export function readQuery(query: RecallQuery, bundle: RecallEvidenceBundle): QueryReadout {
  const res = bundle.results.find((r) => r.queryId === query.id);
  const base: QueryCoverage = {
    queryId: query.id,
    kind: query.kind,
    status: 'NOT_RUN',
    pageOutcomes: [],
    recordsRetrieved: 0,
    totalReported: null,
    datasetLastUpdated: null,
    retrievedAt: null,
    detail: null,
  };
  if (!res || res.pages.length === 0) return { coverage: { ...base, detail: 'query was not run' }, records: [] };

  const cov: QueryCoverage = { ...base, pageOutcomes: res.pages.map((p) => p.kind) };
  cov.retrievedAt = res.pages[0]?.meta.retrievedAt ?? null;
  const records: unknown[] = [];

  for (const p of res.pages) {
    if (p.kind === 'RATE_LIMITED') return { coverage: { ...cov, status: 'RATE_LIMITED', detail: 'source asked the app to wait' }, records };
    if (p.kind === 'SOURCE_UNAVAILABLE') return { coverage: { ...cov, status: 'SOURCE_UNAVAILABLE', detail: `${p.reason}: ${p.detail}` }, records };
  }

  // A single well-formed "no results" answer is complete coverage with zero records.
  if (res.pages.length === 1 && res.pages[0]?.kind === 'NO_MATCH') {
    return { coverage: { ...cov, status: 'COMPLETE', totalReported: 0 }, records };
  }

  let expectedSkip = 0;
  let total: number | null = null;
  for (const [i, p] of res.pages.entries()) {
    if (p.kind === 'NO_MATCH') {
      // "No results" after earlier pages: nothing more to add; completeness is checked below.
      continue;
    }
    if (p.kind !== 'OK') continue;
    const d = pageData(p.data);
    if (d === null) return { coverage: { ...cov, status: 'PARSE_ERROR', detail: `page ${i}: envelope unreadable` }, records };
    if (total === null) {
      total = d.total;
      cov.datasetLastUpdated = d.lastUpdated;
    } else if (d.total !== total) {
      return { coverage: { ...cov, status: 'INCONSISTENT_PAGINATION', totalReported: total, detail: `total changed from ${total} to ${d.total} between pages` }, records };
    }
    if (d.skip !== expectedSkip) {
      return { coverage: { ...cov, status: 'INCONSISTENT_PAGINATION', totalReported: total, detail: `page ${i} starts at ${d.skip}, expected ${expectedSkip}` }, records };
    }
    expectedSkip += d.results.length;
    records.push(...d.results);
  }
  cov.totalReported = total;
  cov.recordsRetrieved = records.length;
  if (total === null) return { coverage: { ...cov, status: 'PARSE_ERROR', detail: 'no readable page' }, records };
  if (records.length < total) {
    return { coverage: { ...cov, status: 'INCOMPLETE_PAGINATION', detail: `retrieved ${records.length} of ${total}` }, records };
  }
  return { coverage: { ...cov, status: 'COMPLETE' }, records };
}

/** RG-2: the control query must return the known recall and the parser must read its NDC. */
export function checkPositiveControl(spec: PositiveControlSpec, bundle: RecallEvidenceBundle): { result: PositiveControlResult; coverage: QueryCoverage } {
  const { coverage, records } = readQuery(spec.query, bundle);
  if (coverage.status === 'NOT_RUN') return { result: { status: 'NOT_RUN', detail: 'control query was not run' }, coverage };
  if (coverage.status !== 'COMPLETE') return { result: { status: 'FAILED', detail: `control query ${coverage.status}` }, coverage };
  const rec = records.find((r) => isRecord(r) && r.recall_number === spec.recallNumber);
  if (!rec || !isRecord(rec) || typeof rec.product_description !== 'string') {
    return { result: { status: 'FAILED', detail: `control record ${spec.recallNumber} not returned` }, coverage };
  }
  const key = productKeyOfProductNdc(spec.expectedProductNdc);
  const found = extractNdcsWithKeys(rec.product_description).ndcs.some((n) => n.productKey === key);
  if (!found) return { result: { status: 'FAILED', detail: 'parser did not read the control record NDC' }, coverage };
  return { result: { status: 'PASSED', detail: `${spec.recallNumber} returned and parsed` }, coverage };
}

const STANDING_LIMITATIONS: Limitation[] = [
  'ABSENCE_IS_NOT_SAFETY',
  'FDA_DATA_MAY_BE_INCOMPLETE_OR_DELAYED',
  'FREE_TEXT_PARSED_CONSERVATIVELY',
  'REPACKAGED_PRODUCTS_MAY_NOT_NAME_YOUR_NDC',
  'TEXT_QUERY_MAY_MISS_ABBREVIATIONS',
];

/** Evaluate all retrieved recall evidence for a confirmed identity. Pure and deterministic. */
export function evaluateRecallEvidence(identity: MedicationIdentity, bundle: RecallEvidenceBundle): RecallFinding {
  const readouts = bundle.plan.queries.map((q) => readQuery(q, bundle));
  const control = checkPositiveControl(bundle.plan.positiveControl, bundle);

  // Merge records across queries by recall number; unreadable records are kept individually.
  const byNumber = new Map<string, { raw: unknown; foundBy: string[] }>();
  const unreadable: { raw: unknown; foundBy: string[] }[] = [];
  readouts.forEach((ro) => {
    for (const r of ro.records) {
      const rn = isRecord(r) && typeof r.recall_number === 'string' && r.recall_number !== '' ? r.recall_number : null;
      if (rn === null) {
        unreadable.push({ raw: r, foundBy: [ro.coverage.queryId] });
        continue;
      }
      const prev = byNumber.get(rn);
      if (prev) {
        if (!prev.foundBy.includes(ro.coverage.queryId)) prev.foundBy.push(ro.coverage.queryId);
      } else {
        byNumber.set(rn, { raw: r, foundBy: [ro.coverage.queryId] });
      }
    }
  });

  const assessments: RecordAssessment[] = [...byNumber.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => assessRecord(identity, v.raw, v.foundBy));
  for (const u of unreadable) assessments.push(assessRecord(identity, u.raw, u.foundBy));

  const confirmed = assessments.filter((a) => a.classification === 'CONFIRMED_MATCH');
  const potential = assessments.filter((a) => a.classification === 'POTENTIAL_MATCH');
  const unresolved = assessments.filter((a) => a.classification === 'UNRESOLVED');
  const notApplicable = assessments.filter((a) => a.classification === 'NOT_APPLICABLE');

  const queriesComplete = readouts.every((r) => r.coverage.status === 'COMPLETE');
  const controlPassed = control.result.status === 'PASSED';
  const complete = queriesComplete && controlPassed;

  let finding: FindingClass;
  if (confirmed.length > 0) finding = 'CONFIRMED_MATCH';
  else if (potential.length > 0) finding = 'POTENTIAL_MATCH';
  else if (!complete || unresolved.length > 0) finding = 'UNRESOLVED';
  else finding = 'NO_MATCH_FOUND';

  const limitations: Limitation[] = [...STANDING_LIMITATIONS];
  if (identity.level !== 'PRODUCT') limitations.push('PRODUCT_NOT_IDENTIFIED');
  if (identity.lot === null) limitations.push('LOT_NOT_PROVIDED');
  if (!queriesComplete) limitations.push('SOME_QUERIES_INCOMPLETE');
  if (!controlPassed) limitations.push('POSITIVE_CONTROL_NOT_PASSED');
  if (unresolved.length > 0) limitations.push('SOME_RECORDS_UNPARSEABLE');
  // A repackaged product whose source could not be verified: recalls naming the original product's
  // NDC cannot be matched, so a negative result is weaker than usual.
  if (identity.sourceProductStatus === 'NOT_ESTABLISHED' || identity.sourceProductStatus === 'UNAVAILABLE') {
    limitations.push('SOURCE_PRODUCT_NOT_ESTABLISHED');
  }

  const queries = [...readouts.map((r) => r.coverage), control.coverage];
  const dates = queries.map((q) => q.datasetLastUpdated).filter((d): d is string => d !== null).sort();

  return {
    finding,
    confirmed,
    potential,
    unresolved,
    notApplicable,
    coverage: {
      complete,
      queries,
      positiveControl: control.result,
      datasetLastUpdated: dates[0] ?? null,
    },
    limitations,
    rulesetVersion: RULESET_VERSION,
    evaluatedAt: bundle.evaluatedAt,
  };
}
