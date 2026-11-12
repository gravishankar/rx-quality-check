/**
 * Eligibility evaluation: exclusion policy first, then the supported-drug catalog. Deterministic,
 * evaluated in this exact order (docs/EXCLUSION_POLICY_GUIDE.md §3):
 *
 *  0. Configuration: an invalid, incompatible or unapproved catalog or policy → UNSUPPORTED
 *     (POLICY_INVALID / CATALOG_INVALID / CONFIG_INCOMPATIBLE). Fail closed: nothing is assessed.
 *  1. Identity: no ingredient → UNSUPPORTED (NO_INGREDIENTS).
 *  2. Ingredient rules: every rule whose ingredient matches (by RxCUI, RxNorm name or salt form),
 *     whose formulation scope applies (unknown route/form/release counts as applicable) and that
 *     covers combinations when the product is one. Any EXCLUDED match → EXCLUDED (the first such
 *     rule in policy order is reported); otherwise any NEEDS_CLARIFICATION match →
 *     NEEDS_CLARIFICATION. Conflicting matches therefore resolve to the most restrictive decision.
 *  3. Listed ingredient whose rule does not apply because of the route → route rules: APPROVED →
 *     its decision; OPEN_DECISION → its interim decision (UNSUPPORTED, ADMINISTRATION_RULE_PENDING).
 *  4. APPROVED route rules with scope ALL → their decision.
 *  5. Product-type rules (e.g. OTC) → their decision.
 *  6. A policy class signal (FDA EPC) on an unlisted ingredient → the class's
 *     unlisted_signal_behavior (NEEDS_CLARIFICATION by default; a class label alone never excludes
 *     unless the policy says EXCLUDED explicitly).
 *  7. Catalog: ACTIVE drugs with exactly the identity's ingredient set. None → UNSUPPORTED
 *     (NOT_IN_CATALOG / COMBINATION_NOT_IN_CATALOG / ROUTE_OUT_OF_SCOPE / DRUG_DISABLED). Each
 *     candidate's restrictions (route, prescription scope, precise ingredient, dose form, release,
 *     strength) are checked; unknown values a restriction depends on → NEEDS_CLARIFICATION.
 *     Exactly one candidate passes → ELIGIBLE; more than one → NEEDS_CLARIFICATION
 *     (CATALOG_AMBIGUOUS); none → the first candidate's NEEDS_CLARIFICATION, else its UNSUPPORTED.
 *
 * Exclusions therefore always override catalog inclusion, and no catalog change can skip steps 2–6.
 */
import type { DoseFormFamily, IdentityIngredient, ReleaseMechanism, Strength } from '../models/identity.ts';
import type {
  CatalogDrug,
  CatalogIngredient,
  DataLoadResult,
  DrugCatalog,
  ExclusionDecision,
  ExclusionPolicy,
  ExclusionReason,
  IngredientRule,
} from '../models/policy.ts';
import { splitIngredientName } from './ingredients.ts';
import { normalizeStrength, sameStrength } from './strength.ts';

export type { ExclusionDecision, ExclusionReason } from '../models/policy.ts';

export interface ExclusionInput {
  ingredients: (Pick<IdentityIngredient, 'name' | 'salt' | 'rxcui'> & { strength?: Strength | null })[];
  /** Routes as published (upper case). Empty when unknown. */
  routes: string[];
  /** e.g. 'HUMAN PRESCRIPTION DRUG'; null when unknown (name-only identity). */
  productType: string | null;
  pharmClassEpc: string[];
  doseForm: DoseFormFamily;
  /** Release mechanism; omitted or UNSPECIFIED when unknown. */
  release?: ReleaseMechanism;
}

type Ing = ExclusionInput['ingredients'][number];

const ORAL_FORMS: ReadonlySet<DoseFormFamily> = new Set(['TABLET', 'CAPSULE']);
const fullName = (i: Ing) => (i.salt ? `${i.name} ${i.salt}` : i.name).toLowerCase();

// ---------------------------------------------------------------------------------------------
// Matching identity ingredients
// ---------------------------------------------------------------------------------------------

function ruleMatches(rule: IngredientRule, ing: Ing): boolean {
  if (ing.rxcui !== null && rule.rxcuis.includes(ing.rxcui)) return true;
  const base = splitIngredientName(ing.name).name;
  const full = fullName(ing);
  return [rule.ingredient, ...rule.names].some((n) => n === full || splitIngredientName(n).name === base);
}

function scopeApplies(rule: IngredientRule, input: ExclusionInput): { applies: boolean; routeExcluded: boolean } {
  const s = rule.appliesTo;
  const routes = input.routes.map((r) => r.toUpperCase());
  const routeOk = s.routes === null || routes.length === 0 || routes.some((r) => (s.routes as string[]).includes(r));
  const formOk = s.doseForms === null || input.doseForm === 'OTHER' || s.doseForms.includes(input.doseForm);
  const rel = input.release ?? 'UNSPECIFIED';
  const relOk = s.releaseTypes === null || rel === 'UNSPECIFIED' || s.releaseTypes.includes(rel);
  return { applies: routeOk && formOk && relOk, routeExcluded: !routeOk && formOk && relOk };
}

interface CatalogMatch {
  def: CatalogIngredient;
  /** Precise ingredient RxCUI when the salt form is known and listed. */
  precise: string | null;
  byRxcui: boolean;
}

function catalogIngredientFor(cat: DrugCatalog, ing: Ing): CatalogMatch | null {
  if (ing.rxcui !== null) {
    for (const def of cat.ingredients) {
      if (def.rxcui === ing.rxcui) return { def, precise: preciseBySalt(def, ing), byRxcui: true };
      const pin = def.preciseIngredients.find((p) => p.rxcui === ing.rxcui);
      if (pin) return { def, precise: pin.rxcui, byRxcui: true };
    }
  }
  const base = splitIngredientName(ing.name).name;
  const full = fullName(ing);
  for (const def of cat.ingredients) {
    const pinByFull = def.preciseIngredients.find((p) => p.name === full);
    if (pinByFull) return { def, precise: pinByFull.rxcui, byRxcui: false };
    if (def.name === base || def.aliases.includes(base) || def.aliases.includes(full)) return { def, precise: preciseBySalt(def, ing), byRxcui: false };
  }
  return null;
}

function preciseBySalt(def: CatalogIngredient, ing: Ing): string | null {
  if (ing.salt === null) return null;
  const pin = def.preciseIngredients.find((p) => {
    const s = splitIngredientName(p.name);
    return s.name === def.name && s.salt === ing.salt;
  });
  return pin?.rxcui ?? null;
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

type DrugCheck = { ok: true } | { ok: false; decision: 'UNSUPPORTED' | 'NEEDS_CLARIFICATION'; reason: ExclusionReason; detail: string };

function checkDrug(drug: CatalogDrug, cat: DrugCatalog, input: ExclusionInput, matches: Map<Ing, CatalogMatch>): DrugCheck {
  const no = (decision: 'UNSUPPORTED' | 'NEEDS_CLARIFICATION', reason: ExclusionReason, detail: string): DrugCheck => ({ ok: false, decision, reason, detail });
  const r = drug.restrictions;
  const routes = input.routes.map((x) => x.toUpperCase());
  const allowedRoutes = r.routes ?? cat.defaultRoutes;
  if (routes.length > 0 && !routes.every((x) => allowedRoutes.includes(x))) return no('UNSUPPORTED', 'ROUTE_OUT_OF_SCOPE', routes.join('/'));

  if (input.productType !== null) {
    const pt = input.productType.toUpperCase();
    const allowed =
      drug.rxScope === 'PRESCRIPTION_ONLY' ? ['HUMAN PRESCRIPTION DRUG'] : drug.rxScope === 'OTC_ONLY' ? ['HUMAN OTC DRUG'] : ['HUMAN PRESCRIPTION DRUG', 'HUMAN OTC DRUG'];
    if (!allowed.includes(pt)) return no('UNSUPPORTED', pt === 'HUMAN OTC DRUG' ? 'OTC_PENDING_DECISION' : 'PRODUCT_TYPE_OUT_OF_SCOPE', pt);
  }

  for (const [ing, m] of matches) {
    const spec = r.preciseIngredients[m.def.id];
    if (!spec) continue;
    if (m.precise !== null && spec.deny.includes(m.precise)) return no('UNSUPPORTED', 'PRECISE_INGREDIENT_NOT_IN_SCOPE', fullName(ing));
    if (spec.allow !== null) {
      if (m.precise === null && ing.salt === null) return no('NEEDS_CLARIFICATION', 'SALT_UNKNOWN', m.def.name);
      if (m.precise === null || !spec.allow.includes(m.precise)) return no('UNSUPPORTED', 'SALT_NOT_IN_SCOPE', fullName(ing));
    }
  }

  if (r.doseForms !== null && !r.doseForms.includes(input.doseForm)) return no('UNSUPPORTED', 'DOSE_FORM_NOT_IN_SCOPE', input.doseForm);
  if (r.releaseTypes !== null) {
    const rel = input.release ?? 'UNSPECIFIED';
    if (rel === 'UNSPECIFIED') return no('NEEDS_CLARIFICATION', 'RELEASE_UNKNOWN', `allowed: ${r.releaseTypes.join('/')}`);
    if (!r.releaseTypes.includes(rel)) return no('UNSUPPORTED', 'RELEASE_NOT_IN_SCOPE', rel);
  }
  if (r.strengths !== null) {
    for (const [ing, m] of matches) {
      const list = r.strengths[m.def.id];
      if (!list) continue;
      if (!ing.strength) return no('NEEDS_CLARIFICATION', 'STRENGTH_UNKNOWN', m.def.name);
      const allowed = list.map(normalizeStrength).filter((s): s is NonNullable<typeof s> => s !== null);
      const st = ing.strength;
      if (!allowed.some((s) => sameStrength(s, st))) {
        return no('UNSUPPORTED', 'STRENGTH_NOT_IN_SCOPE', `${m.def.name} ${st.value} ${st.unit}`);
      }
    }
  }
  if (routes.length === 0 && !ORAL_FORMS.has(input.doseForm)) {
    // A liquid with no stated route could be oral or injectable; do not assume.
    return no('NEEDS_CLARIFICATION', 'ROUTE_UNKNOWN', input.doseForm);
  }
  return { ok: true };
}

export function evaluateExclusion(
  input: ExclusionInput,
  policyLoad: DataLoadResult<ExclusionPolicy>,
  catalogLoad: DataLoadResult<DrugCatalog>,
): ExclusionDecision {
  // 0. Configuration (fail closed).
  if (!policyLoad.ok) {
    const reason: ExclusionReason = /requires rule set/.test(policyLoad.error) ? 'CONFIG_INCOMPATIBLE' : 'POLICY_INVALID';
    return { decision: 'UNSUPPORTED', reason, detail: policyLoad.error, policyVersion: null, catalogVersion: null };
  }
  const policy = policyLoad.value;
  const pv = policy.policyVersion;
  if (!catalogLoad.ok) {
    const reason: ExclusionReason = /requires rule set/.test(catalogLoad.error) ? 'CONFIG_INCOMPATIBLE' : 'CATALOG_INVALID';
    return { decision: 'UNSUPPORTED', reason, detail: catalogLoad.error, policyVersion: pv, catalogVersion: null };
  }
  const catalog = catalogLoad.value;
  const cv = catalog.catalogVersion;
  const unsupported = (reason: ExclusionReason, detail: string, ruleId?: string): ExclusionDecision => ({
    decision: 'UNSUPPORTED',
    reason,
    detail,
    policyVersion: pv,
    catalogVersion: cv,
    ...(ruleId ? { ruleId } : {}),
  });
  const classOf = (id: string) => policy.classes.find((c) => c.id === id);

  // 1. Identity.
  if (input.ingredients.length === 0) return unsupported('NO_INGREDIENTS', 'No ingredient identified');
  const isCombination = input.ingredients.length > 1;

  // 2. Ingredient rules.
  const applicable: IngredientRule[] = [];
  const routeBlocked: IngredientRule[] = [];
  for (const rule of policy.ingredientRules) {
    if (isCombination && !rule.includeCombinations) continue;
    if (!input.ingredients.some((i) => ruleMatches(rule, i))) continue;
    const s = scopeApplies(rule, input);
    if (s.applies) applicable.push(rule);
    else if (s.routeExcluded) routeBlocked.push(rule);
  }
  const excl = applicable.find((r) => r.decision === 'EXCLUDED');
  if (excl) {
    const cls = classOf(excl.classId);
    return {
      decision: 'EXCLUDED',
      reason: 'POLICY_LISTED_EXCLUDED',
      ingredient: excl.ingredient,
      classId: excl.classId,
      rationale: cls?.rationale ?? '',
      policyVersion: pv,
      ruleId: excl.id,
      explanation: excl.explanation ?? cls?.explanation ?? '',
    };
  }
  const clar = applicable.find((r) => r.decision === 'NEEDS_CLARIFICATION');
  if (clar) {
    return {
      decision: 'NEEDS_CLARIFICATION',
      reason: 'POLICY_INDICATION_DEPENDENT',
      ingredient: clar.ingredient,
      classId: clar.classId,
      policyVersion: pv,
      ruleId: clar.id,
      explanation: clar.explanation ?? classOf(clar.classId)?.explanation ?? '',
    };
  }

  // 3–4. Route rules.
  const routes = input.routes.map((r) => r.toUpperCase());
  const routeMatches = (rr: (typeof policy.routeRules)[number]) =>
    routes.length > 0 && (rr.routes === 'NON_ORAL' ? routes.some((r) => r !== 'ORAL') : routes.some((r) => (rr.routes as string[]).includes(r)));
  for (const rr of policy.routeRules) {
    const inScope = rr.scope === 'ALL' || routeBlocked.length > 0;
    if (!inScope || !routeMatches(rr)) continue;
    const listed = routeBlocked[0];
    if (rr.status === 'APPROVED' && rr.decision !== null) {
      if (rr.decision === 'EXCLUDED') {
        return { decision: 'EXCLUDED', reason: 'POLICY_ROUTE_EXCLUDED', ingredient: listed?.ingredient ?? null, classId: listed?.classId ?? null, rationale: '', policyVersion: pv, ruleId: rr.id, explanation: '' };
      }
      return { decision: 'NEEDS_CLARIFICATION', reason: 'POLICY_ROUTE_EXCLUDED', ingredient: listed?.ingredient ?? null, classId: listed?.classId ?? null, policyVersion: pv, ruleId: rr.id };
    }
    if (rr.status === 'OPEN_DECISION' && rr.scope === 'LISTED_INGREDIENTS') {
      const detail = `${listed?.ingredient ?? 'listed ingredient'} with route ${routes.join('/')}`;
      if (rr.interimDecision === 'UNSUPPORTED') return unsupported('ADMINISTRATION_RULE_PENDING', detail, rr.id);
      return { decision: 'NEEDS_CLARIFICATION', reason: 'ADMINISTRATION_RULE_PENDING', ingredient: listed?.ingredient ?? null, classId: listed?.classId ?? null, policyVersion: pv, ruleId: rr.id };
    }
  }

  // 5. Product-type rules.
  if (input.productType !== null) {
    const pt = input.productType.toUpperCase();
    const ptr = policy.productTypeRules.find((r) => r.productTypes.includes(pt));
    if (ptr) {
      if (ptr.decision === 'EXCLUDED') {
        return { decision: 'EXCLUDED', reason: 'PRODUCT_TYPE_EXCLUDED', ingredient: null, classId: null, rationale: ptr.explanation, policyVersion: pv, ruleId: ptr.id, explanation: ptr.explanation };
      }
      return { decision: 'NEEDS_CLARIFICATION', reason: 'PRODUCT_TYPE_EXCLUDED', ingredient: null, classId: null, policyVersion: pv, ruleId: ptr.id, explanation: ptr.explanation };
    }
  }

  // 6. Class signals on unlisted ingredients.
  for (const cls of policy.classes) {
    if (cls.unlistedSignalBehavior === 'IGNORE') continue;
    if (!input.pharmClassEpc.some((p) => cls.fdaEpcSignals.includes(p))) continue;
    if (cls.unlistedSignalBehavior === 'EXCLUDED') {
      return { decision: 'EXCLUDED', reason: 'POLICY_CLASS_MATCH_UNLISTED', ingredient: null, classId: cls.id, rationale: cls.rationale, policyVersion: pv, explanation: cls.explanation };
    }
    return { decision: 'NEEDS_CLARIFICATION', reason: 'POLICY_CLASS_MATCH_UNLISTED', ingredient: null, classId: cls.id, policyVersion: pv };
  }

  // 7. Catalog.
  const matches = new Map<Ing, CatalogMatch>();
  for (const ing of input.ingredients) {
    const m = catalogIngredientFor(catalog, ing);
    if (m) matches.set(ing, m);
  }
  const names = input.ingredients.map((i) => splitIngredientName(i.name).name).join(' + ');
  const idSet = new Set([...matches.values()].map((m) => m.def.id));
  const candidates =
    matches.size === input.ingredients.length
      ? catalog.drugs.filter((d) => d.ingredientIds.length === idSet.size && d.ingredientIds.every((x) => idSet.has(x)))
      : [];
  if (candidates.length === 0) {
    if (routes.length > 0 && !routes.every((r) => catalog.defaultRoutes.includes(r))) return unsupported('ROUTE_OUT_OF_SCOPE', routes.join('/'));
    return unsupported(matches.size > 0 && isCombination ? 'COMBINATION_NOT_IN_CATALOG' : 'NOT_IN_CATALOG', names);
  }
  const active = candidates.filter((d) => d.status === 'ACTIVE');
  if (active.length === 0) return unsupported('DRUG_DISABLED', candidates.map((d) => d.id).join(', '));

  const results = active.map((d) => ({ d, r: checkDrug(d, catalog, input, matches) }));
  const passed = results.filter((x) => x.r.ok);
  if (passed.length > 1) {
    return { decision: 'NEEDS_CLARIFICATION', reason: 'CATALOG_AMBIGUOUS', ingredient: null, classId: null, policyVersion: pv };
  }
  if (passed.length === 1) {
    const drug = (passed[0] as { d: CatalogDrug }).d;
    const matchedBy: 'RXCUI' | 'NAME' = [...matches.values()].every((m) => m.byRxcui) ? 'RXCUI' : 'NAME';
    return { decision: 'ELIGIBLE', catalogDrugId: drug.id, matchedBy, policyVersion: pv, catalogVersion: cv };
  }
  const failures = results.map((x) => x.r).filter((r): r is Extract<DrugCheck, { ok: false }> => !r.ok);
  const clarify = failures.find((f) => f.decision === 'NEEDS_CLARIFICATION');
  if (clarify) return { decision: 'NEEDS_CLARIFICATION', reason: clarify.reason, ingredient: clarify.detail, classId: null, policyVersion: pv };
  const f = failures[0] as Extract<DrugCheck, { ok: false }>;
  return unsupported(f.reason, f.detail);
}
