/**
 * Recall evidence types (FDA drug enforcement reports, openFDA `/drug/enforcement`).
 *
 * Finding classes (Task 2 terminology; see docs/ARCHITECTURE.md §5.3):
 *  - CONFIRMED_MATCH  verified product identity AND the recall's applicability criteria are met,
 *                     including the lot when the recall is lot-specific.
 *  - POTENTIAL_MATCH  relevant product or recall evidence exists, applicability is uncertain.
 *  - NO_MATCH_FOUND   no applicable record among records that were successfully retrieved and
 *                     evaluated, with complete coverage; reported with its coverage and limitations.
 *  - UNRESOLVED       evidence is insufficient, ambiguous, incomplete or unavailable.
 */
import type { LookupOutcome } from './lookup.ts';
import type { OpenFdaEnforcement, OpenFdaEnvelope } from './openfda.ts';

export type FindingClass = 'CONFIRMED_MATCH' | 'POTENTIAL_MATCH' | 'NO_MATCH_FOUND' | 'UNRESOLVED';

/** A public recall query. `search` contains only public identifiers (ingredient names, NDCs). */
export interface RecallQuery {
  id: string;
  kind: 'INGREDIENT_TEXT' | 'PRODUCT_NDC_STRUCTURED' | 'RELATED_PRODUCT_NDC_STRUCTURED' | 'POSITIVE_CONTROL';
  /** openFDA `search` expression for /drug/enforcement.json. */
  search: string;
  /** Page size the service should use. */
  pageLimit: number;
}

export interface RecallQueryPlan {
  /** Query-plan version (QUERY_PLAN_VERSION); optional only so older recorded bundles still read. */
  version?: string;
  queries: RecallQuery[];
  /** The positive control the session must pass before NO_MATCH_FOUND may be reported (RG-2). */
  positiveControl: PositiveControlSpec;
}

export interface PositiveControlSpec {
  query: RecallQuery;
  recallNumber: string;
  /** Product NDC the control record's description must name (parser self-check). */
  expectedProductNdc: string;
}

/** One page of one query, as classified by the service layer. */
export type EnforcementPage = LookupOutcome<OpenFdaEnvelope<OpenFdaEnforcement>>;

export interface QueryResult {
  queryId: string;
  /** Pages in the order requested. A query that was never sent has no entry at all. */
  pages: EnforcementPage[];
}

export interface RecallEvidenceBundle {
  plan: RecallQueryPlan;
  results: QueryResult[];
  /** Device time of the evaluation (ISO-8601). */
  evaluatedAt: string;
}

export type CoverageStatus =
  | 'COMPLETE'
  | 'NOT_RUN'
  | 'SOURCE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INCOMPLETE_PAGINATION'
  | 'INCONSISTENT_PAGINATION'
  | 'PARSE_ERROR';

export interface QueryCoverage {
  queryId: string;
  kind: RecallQuery['kind'];
  status: CoverageStatus;
  /** 'OK' or 'NO_MATCH' per page, or the failure kind. */
  pageOutcomes: string[];
  recordsRetrieved: number;
  totalReported: number | null;
  /** openFDA meta.last_updated of the first successful page. */
  datasetLastUpdated: string | null;
  retrievedAt: string | null;
  detail: string | null;
}

export interface PositiveControlResult {
  status: 'PASSED' | 'FAILED' | 'NOT_RUN';
  detail: string;
}

export type RecordRelevance = 'PRODUCT_MATCH' | 'POSSIBLE_MATCH' | 'OTHER_PRODUCT' | 'UNPARSEABLE';

export type LotScope =
  | { kind: 'ALL_LOTS' }
  | { kind: 'ALL_LOTS_CONDITIONAL'; text: string }
  | { kind: 'LOT_SPECIFIC'; lots: string[]; hasRanges: boolean; hasPatterns: boolean }
  | { kind: 'UNKNOWN' };

export type LotComparison =
  | 'LOT_LISTED'
  | 'LOT_POSSIBLY_LISTED'
  | 'LOT_NOT_FOUND_IN_LISTING'
  | 'LOT_UNKNOWN'
  | 'LOT_NOT_REQUIRED';

/** Machine-readable reasons; explanation templates are chosen from these. */
export type RecordReason =
  | 'TEXT_NDC_MATCHES_PRODUCT'
  | 'TEXT_NDC_MATCHES_RELATED_SOURCE_PRODUCT'
  | 'TEXT_NDC_NAMES_OTHER_PRODUCTS'
  | 'TEXT_NDC_LIST_INCOMPLETE'
  | 'TEXT_NDC_STRENGTH_CONFLICT'
  | 'PACKAGE_NOT_LISTED'
  | 'STRUCTURED_NDC_ONLY'
  | 'STRUCTURED_NDC_EXCLUDES_PRODUCT'
  | 'NO_PRODUCT_LEVEL_EVIDENCE'
  | 'PRODUCT_NOT_IDENTIFIED'
  | 'INGREDIENT_NOT_IN_TEXT'
  | 'COMBINATION_PRODUCT'
  | 'DIFFERENT_SALT'
  | 'STRENGTH_DIFFERS'
  | 'STRENGTH_NOT_STATED'
  | 'STRENGTH_PARTIALLY_STATED'
  | 'STRENGTH_ASSOCIATION_UNCLEAR'
  | 'SOURCE_PRODUCT_UNRESOLVED'
  | 'DOSE_FORM_DIFFERS'
  | 'DOSE_FORM_NOT_STATED'
  | 'RELEASE_DIFFERS'
  | 'RELEASE_NOT_STATED'
  | 'RELEASE_CONFLICTING_IN_TEXT'
  | 'NON_ORAL_OR_NOT_FINISHED_PRODUCT'
  | 'LOT_REQUIRED'
  | 'LOT_LISTED'
  | 'LOT_NOT_FOUND_IN_LISTING'
  | 'LOT_POSSIBLY_LISTED'
  | 'LOT_SCOPE_CONDITIONAL'
  | 'LOT_SCOPE_UNPARSED'
  | 'ALL_LOTS'
  | 'RECORD_SCHEMA_INVALID';

export interface RecordAssessment {
  recallNumber: string;
  relevance: RecordRelevance;
  classification: 'CONFIRMED_MATCH' | 'POTENTIAL_MATCH' | 'NOT_APPLICABLE' | 'UNRESOLVED';
  lotScope: LotScope;
  lot: LotComparison;
  reasons: RecordReason[];
  /** Fields shown to the user, as published. */
  published: {
    classification: string;
    status: string;
    reportDate: string;
    recallInitiationDate: string | null;
    terminationDate: string | null;
    recallingFirm: string;
    reasonForRecall: string;
    productDescription: string;
    codeInfo: string;
  } | null;
  /** Query IDs that returned this record. */
  foundBy: string[];
}

export type Limitation =
  | 'ABSENCE_IS_NOT_SAFETY'
  | 'FDA_DATA_MAY_BE_INCOMPLETE_OR_DELAYED'
  | 'FREE_TEXT_PARSED_CONSERVATIVELY'
  | 'REPACKAGED_PRODUCTS_MAY_NOT_NAME_YOUR_NDC'
  | 'TEXT_QUERY_MAY_MISS_ABBREVIATIONS'
  | 'PRODUCT_NOT_IDENTIFIED'
  | 'LOT_NOT_PROVIDED'
  | 'SOME_QUERIES_INCOMPLETE'
  | 'SEARCH_TERMS_INCOMPLETE'
  | 'DATASET_DATE_INVALID'
  | 'POSITIVE_CONTROL_NOT_PASSED'
  | 'SOME_RECORDS_UNPARSEABLE'
  | 'SOURCE_PRODUCT_NOT_ESTABLISHED';

export interface RecallFinding {
  finding: FindingClass;
  /** Records grouped for display; NOT_APPLICABLE records are kept for transparency. */
  confirmed: RecordAssessment[];
  potential: RecordAssessment[];
  unresolved: RecordAssessment[];
  notApplicable: RecordAssessment[];
  coverage: {
    /** Every query fully retrieved, the positive control passed, and the search was adequate. */
    complete: boolean;
    /**
     * The plan asked for every ingredient name and alias and every required NDC (C2). Distinct from
     * pagination: all pages of an inadequate search can be retrieved and still miss records.
     * Optional only so results saved before C2 still read; absent is treated as not adequate.
     */
    searchAdequate?: boolean;
    /** Version of the query plan the searches were built with (review item 2). */
    queryPlanVersion?: string;
    queries: QueryCoverage[];
    positiveControl: PositiveControlResult;
    datasetLastUpdated: string | null;
  };
  limitations: Limitation[];
  rulesetVersion: string;
  evaluatedAt: string;
}
