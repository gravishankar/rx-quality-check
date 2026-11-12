/**
 * Types for the versioned local data files `data/drug_catalog.json` and `data/exclusion_policy.json`.
 * Parsing and validation live in `rules/catalog.ts` (fail closed on invalid files, EX-9).
 */

export interface CatalogIngredient {
  name: string;
  rxcui: string;
}

export interface CatalogDrug {
  id: string;
  displayName: string;
  ingredients: CatalogIngredient[];
  /** A salt-specific requirement, e.g. metoprolol succinate (tartrate is out of scope). */
  requiredPreciseIngredient: CatalogIngredient | null;
}

export interface DrugCatalog {
  catalogVersion: string;
  status: string;
  routes: string[];
  productTypes: string[];
  drugs: CatalogDrug[];
}

export type PolicyDecision = 'EXCLUDED' | 'NEEDS_CLARIFICATION';

export interface PolicyClass {
  id: string;
  criterion: string;
  rationale: string;
  fdaEpcSignals: string[];
}

export interface PolicyEntry {
  ingredient: string;
  rxcuis: string[];
  classId: string;
  decision: PolicyDecision;
}

export interface ExclusionPolicy {
  policyVersion: string;
  status: string;
  nextReviewDue: string;
  classes: PolicyClass[];
  entries: PolicyEntry[];
}

export type DataLoadResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type ExclusionReason =
  | 'POLICY_LISTED_EXCLUDED'
  | 'POLICY_INDICATION_DEPENDENT'
  | 'POLICY_CLASS_MATCH_UNLISTED'
  | 'ADMINISTRATION_RULE_PENDING'
  | 'NOT_IN_CATALOG'
  | 'COMBINATION_NOT_IN_CATALOG'
  | 'SALT_NOT_IN_SCOPE'
  | 'SALT_UNKNOWN'
  | 'ROUTE_OUT_OF_SCOPE'
  | 'ROUTE_UNKNOWN'
  | 'OTC_PENDING_DECISION'
  | 'PRODUCT_TYPE_OUT_OF_SCOPE'
  | 'POLICY_INVALID'
  | 'CATALOG_INVALID'
  | 'NO_INGREDIENTS';

export type ExclusionDecision =
  | { decision: 'ELIGIBLE'; catalogDrugId: string; matchedBy: 'RXCUI' | 'NAME'; policyVersion: string; catalogVersion: string }
  | { decision: 'EXCLUDED'; reason: ExclusionReason; ingredient: string; classId: string; rationale: string; policyVersion: string }
  | { decision: 'NEEDS_CLARIFICATION'; reason: ExclusionReason; ingredient: string | null; classId: string | null; policyVersion: string }
  | { decision: 'UNSUPPORTED'; reason: ExclusionReason; detail: string; policyVersion: string | null; catalogVersion: string | null };
