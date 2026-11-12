/**
 * Test helpers: load real, sanitized API fixtures and turn them into classified LookupOutcomes with
 * the production classifier (scripts/lib/http.ts → classifyResponse), so rule tests exercise the
 * same OK / NO_MATCH / SOURCE_UNAVAILABLE / RATE_LIMITED path the app uses.
 *
 * Any value that is not a real response is created by a function whose name starts with
 * `synthetic` and is documented as format-only.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyResponse, type RawResponse } from '../../scripts/lib/http.ts';
import {
  validateOpenFdaEnforcement,
  validateOpenFdaNdc,
  type OpenFdaEnforcement,
  type OpenFdaEnvelope,
  type OpenFdaNdcProduct,
} from '../../mobile/src/models/openfda.ts';
import type { EnforcementPage, QueryResult, RecallEvidenceBundle, RecallQueryPlan } from '../../mobile/src/models/evidence.ts';
import type { MedicationIdentity } from '../../mobile/src/models/identity.ts';
import { parseCatalog, parsePolicy } from '../../mobile/src/rules/catalog.ts';
import { directoryProductFrom, identityFromProduct, type NdcDirectoryOutcome } from '../../mobile/src/rules/identity.ts';
import type { RulesConfig } from '../../mobile/src/engine/runner.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TASK2 = join(ROOT, 'tests', 'fixtures', 'task2');
const API = join(ROOT, 'tests', 'fixtures', 'api');

export const RETRIEVED_AT = '2026-11-12T12:00:00.000Z';

interface Task2Fixture {
  _fixture: { search: string; url: string; skip: number; limit: number; endpoint: string };
  http: { status: number; headers: Record<string, string> };
  body: unknown;
}

export function task2(name: string): Task2Fixture {
  return JSON.parse(readFileSync(join(TASK2, `${name}.json`), 'utf8')) as Task2Fixture;
}

/** Raw HTTP response reconstructed from a stored real response (status + body as received). */
export function rawOf(name: string): RawResponse {
  const f = task2(name);
  return { status: f.http.status, headers: f.http.headers, bodyText: JSON.stringify(f.body) };
}

export function enforcementOutcome(raw: RawResponse, url = 'https://api.fda.gov/drug/enforcement.json'): EnforcementPage {
  return classifyResponse<OpenFdaEnvelope<OpenFdaEnforcement>>('OPENFDA', url, raw, validateOpenFdaEnforcement, {
    retrievedAt: RETRIEVED_AT,
    elapsedMs: 0,
  });
}

export function ndcOutcome(raw: RawResponse, url = 'https://api.fda.gov/drug/ndc.json'): NdcDirectoryOutcome {
  return classifyResponse<OpenFdaEnvelope<OpenFdaNdcProduct>>('OPENFDA', url, raw, validateOpenFdaNdc, {
    retrievedAt: RETRIEVED_AT,
    elapsedMs: 0,
  });
}

/** Classified outcome of a stored real enforcement response. */
export function enf(name: string): EnforcementPage {
  return enforcementOutcome(rawOf(name), task2(name)._fixture.url);
}

/** Classified outcome of a stored real NDC Directory response. */
export function ndc(name: string): NdcDirectoryOutcome {
  return ndcOutcome(rawOf(name), task2(name)._fixture.url);
}

/** Task 1 fixtures (tests/fixtures/api) store `{ _fixture, data }` with HTTP 200 bodies. */
export function apiData<T>(name: string): T {
  return (JSON.parse(readFileSync(join(API, `${name}.json`), 'utf8')) as { data: T }).data;
}

export function apiEnforcement(name: string): EnforcementPage {
  return enforcementOutcome({ status: 200, headers: {}, bodyText: JSON.stringify(apiData(name)) });
}

export function firstNdcRecord(name: string): OpenFdaNdcProduct {
  const o = ndc(name);
  if (o.kind !== 'OK' || !o.data.results[0]) throw new Error(`${name}: not an OK NDC fixture`);
  return o.data.results[0];
}

export function apiNdcRecord(name: string): OpenFdaNdcProduct {
  const d = apiData<OpenFdaEnvelope<OpenFdaNdcProduct>>(name);
  if (!d.results[0]) throw new Error(name);
  return d.results[0];
}

/** Product-level identity from a real NDC Directory record. */
export function productIdentity(rec: OpenFdaNdcProduct, packageNdc: string | null, lot: string | null = null): MedicationIdentity {
  return identityFromProduct(directoryProductFrom(rec), packageNdc, lot);
}

export function rulesConfig(): RulesConfig {
  return {
    catalog: parseCatalog(JSON.parse(readFileSync(join(ROOT, 'data', 'drug_catalog.json'), 'utf8'))),
    policy: parsePolicy(JSON.parse(readFileSync(join(ROOT, 'data', 'exclusion_policy.json'), 'utf8'))),
  };
}

/** Build an evidence bundle: queryId → pages (in order). Queries left out were "not run". */
export function bundle(plan: RecallQueryPlan, pages: Record<string, EnforcementPage[]>): RecallEvidenceBundle {
  const results: QueryResult[] = Object.entries(pages).map(([queryId, p]) => ({ queryId, pages: p }));
  return { plan, results, evaluatedAt: RETRIEVED_AT };
}

/** The real positive-control answer (D-0325-2021, queried on every field the plan uses). */
export const control = (): EnforcementPage => enf('enf_control_fields');

/** The real answer to the same control with one field name drifted: 404 NOT_FOUND. */
export const controlDrifted = (): EnforcementPage => enf('enf_control_fields_drifted');

/** Real openFDA "no matches" answer (HTTP 404 NOT_FOUND), classified. */
export const realNoMatch = (): EnforcementPage => enf('enf_pndc_71610-910');

// ---------------------------------------------------------------------------------------------
// Failure injection (RG-1). Each builds on a real body where one exists.
// ---------------------------------------------------------------------------------------------

/** Real HTTP 500 body returned by openFDA for a malformed query. */
export const realServerError = (): EnforcementPage => enf('enf_malformed_query');

/** Real body cut in half: invalid JSON. */
export function truncated(name: string): EnforcementPage {
  const raw = rawOf(name);
  return enforcementOutcome({ ...raw, bodyText: raw.bodyText.slice(0, Math.floor(raw.bodyText.length / 2)) });
}

/** Real body with a required field removed from every record (simulated schema change). */
export function schemaChanged(name: string, field: string): EnforcementPage {
  const f = task2(name);
  const body = JSON.parse(JSON.stringify(f.body)) as { results?: Record<string, unknown>[] };
  for (const r of body.results ?? []) delete r[field];
  return enforcementOutcome({ status: f.http.status, headers: {}, bodyText: JSON.stringify(body) });
}

/** Format-only synthetic: HTTP 429 (not provoked live to protect the shared quota; shape per docs). */
export function synthetic429(retryAfter: string | null = '30'): EnforcementPage {
  return enforcementOutcome({ status: 429, headers: retryAfter === null ? {} : { 'retry-after': retryAfter }, bodyText: '{"error":{"code":"OVER_RATE_LIMIT"}}' });
}

/** Format-only synthetic: a transport failure as produced by `lookup()` for a thrown fetch error. */
export function syntheticNetworkError(): EnforcementPage {
  return {
    kind: 'SOURCE_UNAVAILABLE',
    reason: 'NETWORK_ERROR',
    detail: 'TypeError: fetch failed',
    meta: { source: 'OPENFDA', url: 'https://api.fda.gov/drug/enforcement.json', httpStatus: null, retrievedAt: RETRIEVED_AT, elapsedMs: 0, headers: {} },
  };
}

/** Format-only synthetic: a timeout as produced by `lookup()`. */
export function syntheticTimeout(): EnforcementPage {
  return { ...syntheticNetworkError(), reason: 'TIMEOUT', detail: 'AbortError: This operation was aborted' } as EnforcementPage;
}

/** Keep only the first `n` records of a real page while leaving meta.results.total untouched. */
export function firstRecordsOnly(page: EnforcementPage, n: number): EnforcementPage {
  if (page.kind !== 'OK') return page;
  return { ...page, data: { ...page.data, results: page.data.results.slice(0, n) } };
}
