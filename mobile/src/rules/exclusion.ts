/**
 * Exclusion and scope evaluation (ARCHITECTURE §5.2), evaluated in order, before any recall lookup.
 *
 *  1. Listed ingredient with decision NEEDS_CLARIFICATION              → NEEDS_CLARIFICATION
 *  2. Listed ingredient with decision EXCLUDED, route oral or unknown   → EXCLUDED
 *  3. Listed ingredient, non-oral route                                 → UNSUPPORTED (ADMINISTRATION_RULE_PENDING, OD-1)
 *  4. Unlisted ingredient with a policy-class EPC signal                → NEEDS_CLARIFICATION (POLICY_CLASS_MATCH_UNLISTED)
 *  5. Ingredient set / salt / route / product type outside the catalog → UNSUPPORTED
 *  6. Otherwise                                                         → ELIGIBLE
 *
 * Exclusion matching uses RxCUIs when known and normalized ingredient names otherwise. Name-only
 * matching errs toward exclusion, which is the safe direction (the drug is then not assessed).
 * Invalid policy or catalog data fails closed (UNSUPPORTED for everything, EX-9).
 */
import type { DoseFormFamily, IdentityIngredient } from '../models/identity.ts';
import type {
  DataLoadResult,
  DrugCatalog,
  ExclusionDecision,
  ExclusionPolicy,
  ExclusionReason,
  PolicyEntry,
} from '../models/policy.ts';

export type { ExclusionDecision, ExclusionReason } from '../models/policy.ts';
import { splitIngredientName } from './ingredients.ts';

export interface ExclusionInput {
  ingredients: Pick<IdentityIngredient, 'name' | 'salt' | 'rxcui'>[];
  /** Routes as published (upper case). Empty when unknown. */
  routes: string[];
  /** e.g. 'HUMAN PRESCRIPTION DRUG'; null when unknown (name-only identity). */
  productType: string | null;
  pharmClassEpc: string[];
  doseForm: DoseFormFamily;
}

const ORAL_FORMS: ReadonlySet<DoseFormFamily> = new Set(['TABLET', 'CAPSULE']);

function entryFor(policy: ExclusionPolicy, ing: ExclusionInput['ingredients'][number]): PolicyEntry | null {
  for (const e of policy.entries) {
    if (ing.rxcui !== null && e.rxcuis.includes(ing.rxcui)) return e;
  }
  const base = splitIngredientName(ing.name).name;
  for (const e of policy.entries) {
    if (splitIngredientName(e.ingredient).name === base) return e;
  }
  return null;
}

export function evaluateExclusion(
  input: ExclusionInput,
  policyLoad: DataLoadResult<ExclusionPolicy>,
  catalogLoad: DataLoadResult<DrugCatalog>,
): ExclusionDecision {
  if (!policyLoad.ok) {
    return { decision: 'UNSUPPORTED', reason: 'POLICY_INVALID', detail: policyLoad.error, policyVersion: null, catalogVersion: null };
  }
  const policy = policyLoad.value;
  if (!catalogLoad.ok) {
    return { decision: 'UNSUPPORTED', reason: 'CATALOG_INVALID', detail: catalogLoad.error, policyVersion: policy.policyVersion, catalogVersion: null };
  }
  const catalog = catalogLoad.value;
  const pv = policy.policyVersion;
  const cv = catalog.catalogVersion;
  if (input.ingredients.length === 0) {
    return { decision: 'UNSUPPORTED', reason: 'NO_INGREDIENTS', detail: 'No ingredient identified', policyVersion: pv, catalogVersion: cv };
  }

  const routes = input.routes.map((r) => r.toUpperCase());
  const routeKnown = routes.length > 0;
  const oralOrUnknown = !routeKnown || routes.every((r) => r === 'ORAL');
  const classOf = (id: string) => policy.classes.find((c) => c.id === id);

  // Rules 1–3: listed ingredients (any ingredient of a combination counts).
  const listed = input.ingredients.map((i) => ({ i, e: entryFor(policy, i) })).filter((x) => x.e !== null) as {
    i: ExclusionInput['ingredients'][number];
    e: PolicyEntry;
  }[];
  const clar = listed.find((x) => x.e.decision === 'NEEDS_CLARIFICATION');
  if (clar) {
    return { decision: 'NEEDS_CLARIFICATION', reason: 'POLICY_INDICATION_DEPENDENT', ingredient: clar.e.ingredient, classId: clar.e.classId, policyVersion: pv };
  }
  const excl = listed.find((x) => x.e.decision === 'EXCLUDED');
  if (excl) {
    if (oralOrUnknown) {
      return {
        decision: 'EXCLUDED',
        reason: 'POLICY_LISTED_EXCLUDED',
        ingredient: excl.e.ingredient,
        classId: excl.e.classId,
        rationale: classOf(excl.e.classId)?.rationale ?? '',
        policyVersion: pv,
      };
    }
    return {
      decision: 'UNSUPPORTED',
      reason: 'ADMINISTRATION_RULE_PENDING',
      detail: `${excl.e.ingredient} with route ${routes.join('/')}`,
      policyVersion: pv,
      catalogVersion: cv,
    };
  }

  // Rule 4: unlisted ingredient carrying a policy-class EPC signal.
  const signals = new Set(policy.classes.flatMap((c) => c.fdaEpcSignals));
  const hit = input.pharmClassEpc.find((p) => signals.has(p));
  if (hit) {
    const cls = policy.classes.find((c) => c.fdaEpcSignals.includes(hit)) ?? null;
    return { decision: 'NEEDS_CLARIFICATION', reason: 'POLICY_CLASS_MATCH_UNLISTED', ingredient: null, classId: cls?.id ?? null, policyVersion: pv };
  }

  // Rule 5: catalog scope.
  const unsupported = (reason: ExclusionReason, detail: string): ExclusionDecision => ({
    decision: 'UNSUPPORTED',
    reason,
    detail,
    policyVersion: pv,
    catalogVersion: cv,
  });
  if (routeKnown && !routes.every((r) => catalog.routes.includes(r))) {
    return unsupported('ROUTE_OUT_OF_SCOPE', routes.join('/'));
  }
  if (input.productType !== null) {
    const pt = input.productType.toUpperCase();
    if (!catalog.productTypes.includes(pt)) {
      return unsupported(pt === 'HUMAN OTC DRUG' ? 'OTC_PENDING_DECISION' : 'PRODUCT_TYPE_OUT_OF_SCOPE', pt);
    }
  }

  const names = input.ingredients.map((i) => splitIngredientName(i.name).name);
  const nameSet = new Set(names);
  const drug = catalog.drugs.find((d) => {
    if (d.ingredients.length !== nameSet.size) return false;
    return d.ingredients.every((ci) => nameSet.has(ci.name));
  });
  if (!drug) {
    const anyCatalogIngredient = catalog.drugs.some((d) => d.ingredients.some((ci) => nameSet.has(ci.name)));
    return unsupported(
      anyCatalogIngredient && nameSet.size > 1 ? 'COMBINATION_NOT_IN_CATALOG' : 'NOT_IN_CATALOG',
      names.join(' + '),
    );
  }
  if (drug.requiredPreciseIngredient) {
    const req = splitIngredientName(drug.requiredPreciseIngredient.name);
    const ing = input.ingredients.find((i) => splitIngredientName(i.name).name === req.name);
    const salt = ing?.salt ?? splitIngredientName(ing?.name ?? '').salt;
    if (salt === null || salt === undefined) {
      return { decision: 'NEEDS_CLARIFICATION', reason: 'SALT_UNKNOWN', ingredient: req.name, classId: null, policyVersion: pv };
    }
    if (salt !== req.salt) return unsupported('SALT_NOT_IN_SCOPE', `${req.name} ${salt}`);
  }
  if (!routeKnown && !ORAL_FORMS.has(input.doseForm)) {
    // A liquid with no stated route could be oral or injectable; do not assume.
    return { decision: 'NEEDS_CLARIFICATION', reason: 'ROUTE_UNKNOWN', ingredient: null, classId: null, policyVersion: pv };
  }

  const matchedBy: 'RXCUI' | 'NAME' = input.ingredients.every(
    (i) => i.rxcui !== null && drug.ingredients.some((ci) => ci.rxcui === i.rxcui),
  )
    ? 'RXCUI'
    : 'NAME';
  return { decision: 'ELIGIBLE', catalogDrugId: drug.id, matchedBy, policyVersion: pv, catalogVersion: cv };
}
