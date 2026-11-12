/**
 * openFDA clients: NDC Directory (`/drug/ndc.json`) and drug enforcement reports
 * (`/drug/enforcement.json`). Keyless, direct HTTPS. Responses are schema-validated and classified;
 * pages are returned individually so the recall engine can account for completeness
 * (rules/recallEvidence.ts). This module never classifies recall relevance.
 */
import type { EnforcementPage, RecallQuery } from '../models/evidence.ts';
import type { LookupOutcome } from '../models/lookup.ts';
import { validateOpenFdaEnforcement, validateOpenFdaNdc, type OpenFdaEnvelope, type OpenFdaNdcProduct } from '../models/openfda.ts';
import { requestJson, unavailable, type ClientDeps } from './request.ts';

export const OPENFDA_BASE = 'https://api.fda.gov/drug';
/** openFDA limits: `limit` ≤ 1000 and `skip` ≤ 25000. */
export const OPENFDA_MAX_LIMIT = 1000;
export const OPENFDA_MAX_SKIP = 25_000;

const NDC = /^\d{4,5}-\d{3,4}(-\d{1,2})?$/;
/** Searches are built by planRecallQueries from public identifiers only; anything else is refused. */
const SAFE_SEARCH = /^[A-Za-z0-9_.:"() -]+$/;

export type NdcDirectoryOutcome = LookupOutcome<OpenFdaEnvelope<OpenFdaNdcProduct>>;

export interface OpenFdaClient {
  ndcByPackage(packageNdc: string): Promise<NdcDirectoryOutcome>;
  ndcByProduct(productNdc: string): Promise<NdcDirectoryOutcome>;
  enforcementPage(query: RecallQuery, skip: number): Promise<EnforcementPage>;
}

function url(endpoint: 'ndc' | 'enforcement', search: string, limit: number, skip = 0): string {
  const p = new URLSearchParams({ search, limit: String(limit) });
  if (skip > 0) p.set('skip', String(skip));
  return `${OPENFDA_BASE}/${endpoint}.json?${p.toString()}`;
}

export function ndcUrl(search: string): string {
  return url('ndc', search, 10);
}

export function enforcementUrl(query: RecallQuery, skip: number): string {
  return url('enforcement', query.search, Math.min(query.pageLimit, OPENFDA_MAX_LIMIT), skip);
}

export function createOpenFdaClient(deps: ClientDeps): OpenFdaClient {
  const ndcSearch = async (field: string, ndc: string): Promise<NdcDirectoryOutcome> => {
    const search = `${field}:"${ndc}"`;
    if (!NDC.test(ndc)) return unavailable('OPENFDA', '(not sent)', 'REQUEST_BLOCKED', `not an NDC: ${ndc}`, deps.now());
    return requestJson(deps, 'OPENFDA', ndcUrl(search), validateOpenFdaNdc);
  };
  return {
    ndcByPackage: (packageNdc) => ndcSearch('packaging.package_ndc', packageNdc),
    ndcByProduct: (productNdc) => ndcSearch('product_ndc', productNdc),
    async enforcementPage(query, skip) {
      if (!SAFE_SEARCH.test(query.search)) return unavailable('OPENFDA', '(not sent)', 'REQUEST_BLOCKED', 'search contains unexpected characters', deps.now());
      if (skip > OPENFDA_MAX_SKIP) return unavailable('OPENFDA', '(not sent)', 'HTTP_UNEXPECTED_STATUS', `skip ${skip} exceeds openFDA maximum`, deps.now());
      return requestJson(deps, 'OPENFDA', enforcementUrl(query, skip), validateOpenFdaEnforcement);
    },
  };
}
