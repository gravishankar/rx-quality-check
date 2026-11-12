/**
 * Types for the versioned local configuration: `data/drug_catalog.json` (schema 2) and
 * `data/exclusion_policy.json` (schema 2). JSON Schemas: `data/schemas/`. Parsing, validation and
 * cross-file checks live in `rules/catalog.ts`; evaluation in `rules/exclusion.ts`.
 *
 * The catalog separates ingredient definitions (RxNorm ingredient with verified precise
 * ingredients and aliases) from drug-level eligibility (an exact ingredient set plus optional
 * formulation and prescription-scope restrictions).
 */
import type { DoseFormFamily, ReleaseMechanism } from './identity.ts';

export type ConfigStatus = 'APPROVED' | 'DRAFT_PENDING_APPROVAL' | 'PROPOSED_PENDING_APPROVAL' | 'RETIRED';

export interface Provenance {
  source: string;
  verifiedOn: string;
}

export interface PreciseIngredient {
  rxcui: string;
  /** RxNorm name, e.g. "metoprolol succinate". */
  name: string;
}

export interface CatalogIngredient {
  /** Stable identifier referenced by drugs (never reused for a different ingredient). */
  id: string;
  /** Normalized base name, lower case. */
  name: string;
  /** RxNorm IN RxCUI; null when no verified identifier exists (then matched by name only). */
  rxcui: string | null;
  aliases: string[];
  preciseIngredients: PreciseIngredient[];
  provenance: Provenance;
}

export type RxScope = 'PRESCRIPTION_ONLY' | 'OTC_ONLY' | 'PRESCRIPTION_AND_OTC';

export interface DrugRestrictions {
  /** Allowed routes (upper case); null = catalog default. */
  routes: string[] | null;
  doseForms: DoseFormFamily[] | null;
  releaseTypes: ReleaseMechanism[] | null;
  /** Allowed strengths per ingredient id, as strength strings ("100 mg"); null = any. */
  strengths: Record<string, string[]> | null;
  /** Allowed / denied precise ingredients (RxCUIs) per ingredient id. */
  preciseIngredients: Record<string, { allow: string[] | null; deny: string[] }>;
}

export interface CatalogDrug {
  /** Stable identifier stored with saved medications; never renamed or reused. */
  id: string;
  displayName: string;
  status: 'ACTIVE' | 'INACTIVE';
  /** Ingredient ids; the exact set (order irrelevant). Two or more = combination product. */
  ingredientIds: string[];
  aliases: string[];
  rxScope: RxScope;
  restrictions: DrugRestrictions;
  provenance: Provenance;
}

export interface DrugCatalog {
  schemaVersion: number;
  catalogVersion: string;
  status: ConfigStatus;
  effectiveDate: string | null;
  minRulesetVersion: string;
  defaultRoutes: string[];
  defaultRxScope: RxScope;
  ingredients: CatalogIngredient[];
  drugs: CatalogDrug[];
}

export type PolicyDecision = 'EXCLUDED' | 'NEEDS_CLARIFICATION';

export interface PolicyClass {
  id: string;
  criterion: string;
  rationale: string;
  explanation: string;
  fdaEpcSignals: string[];
  /** What a class signal on an ingredient NOT listed in ingredient_rules does. */
  unlistedSignalBehavior: 'NEEDS_CLARIFICATION' | 'EXCLUDED' | 'IGNORE';
}

export interface FormulationScope {
  /** Rule applies only to these routes (unknown route counts as applicable). null = any. */
  routes: string[] | null;
  doseForms: DoseFormFamily[] | null;
  releaseTypes: ReleaseMechanism[] | null;
}

export interface IngredientRule {
  id: string;
  ingredient: string;
  rxcuis: string[];
  /** Additional RxNorm names of the same moiety ("mycophenolic acid"). */
  names: string[];
  classId: string;
  decision: PolicyDecision;
  appliesTo: FormulationScope;
  includeCombinations: boolean;
  explanation: string | null;
  provenance: Provenance;
}

export interface RouteRule {
  id: string;
  status: 'OPEN_DECISION' | 'APPROVED';
  /** 'NON_ORAL' or an explicit list of routes. */
  routes: 'NON_ORAL' | string[];
  scope: 'LISTED_INGREDIENTS' | 'ALL';
  /** Applied when APPROVED. */
  decision: PolicyDecision | null;
  /** Applied while OPEN_DECISION. */
  interimDecision: 'UNSUPPORTED' | 'NEEDS_CLARIFICATION';
  interimReason: string;
}

export interface ProductTypeRule {
  id: string;
  productTypes: string[];
  decision: PolicyDecision;
  explanation: string;
}

export interface ExclusionPolicy {
  schemaVersion: number;
  policyVersion: string;
  status: ConfigStatus;
  effectiveDate: string | null;
  lastReviewed: string;
  nextReviewDue: string;
  minRulesetVersion: string;
  classes: PolicyClass[];
  ingredientRules: IngredientRule[];
  routeRules: RouteRule[];
  productTypeRules: ProductTypeRule[];
}

export type DataLoadResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type ExclusionReason =
  | 'POLICY_LISTED_EXCLUDED'
  | 'POLICY_INDICATION_DEPENDENT'
  | 'POLICY_CLASS_MATCH_UNLISTED'
  | 'POLICY_ROUTE_EXCLUDED'
  | 'PRODUCT_TYPE_EXCLUDED'
  | 'ADMINISTRATION_RULE_PENDING'
  | 'NOT_IN_CATALOG'
  | 'COMBINATION_NOT_IN_CATALOG'
  | 'DRUG_DISABLED'
  | 'CATALOG_AMBIGUOUS'
  | 'SALT_NOT_IN_SCOPE'
  | 'SALT_UNKNOWN'
  | 'PRECISE_INGREDIENT_NOT_IN_SCOPE'
  | 'DOSE_FORM_NOT_IN_SCOPE'
  | 'RELEASE_NOT_IN_SCOPE'
  | 'RELEASE_UNKNOWN'
  | 'STRENGTH_NOT_IN_SCOPE'
  | 'STRENGTH_UNKNOWN'
  | 'ROUTE_OUT_OF_SCOPE'
  | 'ROUTE_UNKNOWN'
  | 'OTC_PENDING_DECISION'
  | 'PRODUCT_TYPE_OUT_OF_SCOPE'
  | 'POLICY_INVALID'
  | 'CATALOG_INVALID'
  | 'CONFIG_INCOMPATIBLE'
  | 'NO_INGREDIENTS';

export type ExclusionDecision =
  | { decision: 'ELIGIBLE'; catalogDrugId: string; matchedBy: 'RXCUI' | 'NAME'; policyVersion: string; catalogVersion: string }
  | {
      decision: 'EXCLUDED';
      reason: ExclusionReason;
      ingredient: string | null;
      classId: string | null;
      rationale: string;
      policyVersion: string;
      /** Policy rule that excluded the medication. */
      ruleId?: string;
      /** Human-readable explanation from the policy. */
      explanation?: string;
    }
  | {
      decision: 'NEEDS_CLARIFICATION';
      reason: ExclusionReason;
      ingredient: string | null;
      classId: string | null;
      policyVersion: string;
      ruleId?: string;
      explanation?: string;
    }
  | { decision: 'UNSUPPORTED'; reason: ExclusionReason; detail: string; policyVersion: string | null; catalogVersion: string | null; ruleId?: string };
