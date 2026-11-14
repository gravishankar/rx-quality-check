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
import { sourceProductUncertain } from './sourceProduct.ts';
export { sourceProductUncertain } from './sourceProduct.ts';
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

/**
 * Version of the recall query plan. 1: ingredient names joined with AND. 2 (Task 4H, review item 2):
 * each ingredient searched by its name OR any reviewed alias. Recorded with every finding.
 */
export const QUERY_PLAN_VERSION = '2';

const quote = (s: string) => `"${s.replace(/["\\]/g, '')}"`;

/** A calendar date written exactly as YYYY-MM-DD that exists (2026-02-30 does not). */
export function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return days !== undefined && d >= 1 && d <= days;
}

/**
 * C4: a dataset date can support a result only if it is a real calendar date that is not after the
 * evaluation, and the evaluation time is a valid UTC instant (ISO-8601 with Z, as stored).
 */
export function datasetDateUsable(date: string, evaluatedAt: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(evaluatedAt) || !Number.isFinite(Date.parse(evaluatedAt))) return false;
  return isCalendarDate(date) && date <= evaluatedAt.slice(0, 10);
}

/** Terms a search may carry: the characters openFDA's client accepts inside a quoted phrase. */
const SAFE_TERM = /^[a-z0-9 .-]+$/;

/** Every term the ingredient-text search must ask for: each ingredient's name and its aliases. */
export function requiredSearchTerms(identity: MedicationIdentity): string[][] {
  const by = new Map<string, Set<string>>();
  for (const i of identity.ingredients) {
    const name = i.name.toLowerCase();
    const set = by.get(name) ?? new Set<string>([name]);
    for (const a of i.aliases ?? []) set.add(a.toLowerCase());
    by.set(name, set);
  }
  return [...by.keys()].sort().map((n) => [n, ...[...(by.get(n) ?? [])].filter((t) => t !== n).sort()]);
}

const termClause = (t: string) => `product_description:${quote(t)}`;

/**
 * Plan recall queries for a confirmed identity. Only public identifiers are used: ingredient base
 * names and product NDCs. Lot numbers, labels and OCR text are never part of a query.
 */
export function planRecallQueries(identity: MedicationIdentity): RecallQueryPlan {
  const queries: RecallQuery[] = [];
  // One group per ingredient: its name OR any alias (C2). Terms the client would refuse are left
  // out here and then reported by searchIsAdequate, so the result cannot be a no-match.
  const groups = requiredSearchTerms(identity).map((terms) => terms.filter((t) => SAFE_TERM.test(t)));
  queries.push({
    id: 'ingredient_text',
    kind: 'INGREDIENT_TEXT',
    search: groups
      .filter((g) => g.length > 0)
      .map((g) => (g.length === 1 ? termClause(g[0] as string) : `(${g.map(termClause).join(' OR ')})`))
      .join(' AND '),
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
  return { version: QUERY_PLAN_VERSION, queries, positiveControl: POSITIVE_CONTROL };
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
    } else if (d.lastUpdated !== cov.datasetLastUpdated) {
      // C4: pages from two different releases of the dataset cannot be combined.
      return { coverage: { ...cov, status: 'INCONSISTENT_PAGINATION', totalReported: total, detail: `dataset date changed from ${cov.datasetLastUpdated} to ${d.lastUpdated} between pages` }, records };
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

/**
 * Search adequacy (C2), separate from pagination: did the plan ask for everything it should have?
 * The ingredient-text search must name every ingredient and every alias; a product identified by NDC
 * must have its product-NDC search; every related source NDC must have its own search. A plan that
 * misses any of these cannot support a no-match, however completely its pages were retrieved.
 */
export function searchIsAdequate(identity: MedicationIdentity, plan: RecallQueryPlan): boolean {
  const text = plan.queries.filter((q) => q.kind === 'INGREDIENT_TEXT').map((q) => q.search);
  if (text.length !== 1) return false;
  const search = text[0] as string;
  if (!requiredSearchTerms(identity).every((terms) => terms.every((t) => search.includes(termClause(t))))) return false;
  const ndcSearches = new Set(plan.queries.filter((q) => q.kind !== 'INGREDIENT_TEXT' && q.kind !== 'POSITIVE_CONTROL').map((q) => q.search));
  if (identity.level === 'PRODUCT' && identity.productNdc !== null && !ndcSearches.has(`openfda.product_ndc:${quote(identity.productNdc)}`)) return false;
  return identity.relatedSourceProductNdcs.every((n) => ndcSearches.has(`openfda.product_ndc:${quote(n)}`));
}

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
  const searchAdequate = searchIsAdequate(identity, bundle.plan);
  const queryDates = [...readouts.map((r) => r.coverage), control.coverage].map((q) => q.datasetLastUpdated).filter((d): d is string => d !== null);
  const datesUsable = queryDates.every((d) => datasetDateUsable(d, bundle.evaluatedAt));
  const complete = queriesComplete && controlPassed && searchAdequate && datesUsable;

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
  if (!searchAdequate) limitations.push('SEARCH_TERMS_INCOMPLETE');
  if (!datesUsable) limitations.push('DATASET_DATE_INVALID');
  if (unresolved.length > 0) limitations.push('SOME_RECORDS_UNPARSEABLE');
  // A repackaged product whose source could not be verified: recalls naming the original product's
  // NDC cannot be matched, so a negative result is weaker than usual.
  if (sourceProductUncertain(identity)) limitations.push('SOURCE_PRODUCT_NOT_ESTABLISHED');

  const queries = [...readouts.map((r) => r.coverage), control.coverage];
  const dates = queries.map((q) => q.datasetLastUpdated).filter((d): d is string => d !== null).sort();
  const invalidDate = dates.find((d) => !datasetDateUsable(d, bundle.evaluatedAt));

  return {
    finding,
    confirmed,
    potential,
    unresolved,
    notApplicable,
    coverage: {
      complete,
      searchAdequate,
      queryPlanVersion: bundle.plan.version ?? '1',
      queries,
      positiveControl: control.result,
      // An unusable date is carried as-is (never replaced by a valid one) so every reader rejects it.
      datasetLastUpdated: invalidDate ?? dates[0] ?? null,
    },
    limitations,
    rulesetVersion: RULESET_VERSION,
    evaluatedAt: bundle.evaluatedAt,
  };
}
