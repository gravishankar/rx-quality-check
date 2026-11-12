/**
 * Parse and validate the bundled drug catalog and exclusion policy. Invalid files fail closed: the
 * caller receives an error and exclusion evaluation then returns UNSUPPORTED for every medication
 * (EX-9). Parsing is pure; the JSON is read by the caller.
 */
import { isRecord } from '../models/lookup.ts';
import type {
  CatalogDrug,
  CatalogIngredient,
  DataLoadResult,
  DrugCatalog,
  ExclusionPolicy,
  PolicyClass,
  PolicyEntry,
} from '../models/policy.ts';

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function ingredient(v: unknown): CatalogIngredient | null {
  if (!isRecord(v) || !isStr(v.name) || !isStr(v.rxcui) || !/^\d+$/.test(v.rxcui)) return null;
  return { name: v.name.toLowerCase(), rxcui: v.rxcui };
}

export function parseCatalog(json: unknown): DataLoadResult<DrugCatalog> {
  const fail = (error: string): DataLoadResult<DrugCatalog> => ({ ok: false, error });
  if (!isRecord(json)) return fail('catalog: not an object');
  if (json.schema_version !== 1) return fail('catalog: unsupported schema_version');
  if (!isStr(json.catalog_version)) return fail('catalog: catalog_version missing');
  if (!isStr(json.status)) return fail('catalog: status missing');
  const rules = json.scope_rules;
  if (!isRecord(rules) || !isStrArray(rules.routes) || !isStrArray(rules.product_types)) {
    return fail('catalog: scope_rules.routes / product_types missing');
  }
  if (rules.ingredient_set_match !== 'EXACT') return fail('catalog: ingredient_set_match must be EXACT');
  if (!Array.isArray(json.drugs) || json.drugs.length === 0) return fail('catalog: drugs missing');
  const drugs: CatalogDrug[] = [];
  const ids = new Set<string>();
  for (const [i, d] of json.drugs.entries()) {
    if (!isRecord(d) || !isStr(d.id) || !isStr(d.display_name) || !Array.isArray(d.ingredients)) {
      return fail(`catalog: drugs[${i}] malformed`);
    }
    if (ids.has(d.id)) return fail(`catalog: duplicate id ${d.id}`);
    ids.add(d.id);
    const ings = d.ingredients.map(ingredient);
    if (ings.length === 0 || ings.some((x) => x === null)) return fail(`catalog: drugs[${i}].ingredients malformed`);
    let precise: CatalogIngredient | null = null;
    if (d.required_precise_ingredient !== undefined) {
      precise = ingredient(d.required_precise_ingredient);
      if (precise === null) return fail(`catalog: drugs[${i}].required_precise_ingredient malformed`);
    }
    drugs.push({
      id: d.id,
      displayName: d.display_name,
      ingredients: ings as CatalogIngredient[],
      requiredPreciseIngredient: precise,
    });
  }
  return {
    ok: true,
    value: {
      catalogVersion: json.catalog_version,
      status: json.status,
      routes: rules.routes.map((r) => r.toUpperCase()),
      productTypes: rules.product_types.map((r) => r.toUpperCase()),
      drugs,
    },
  };
}

export function parsePolicy(json: unknown): DataLoadResult<ExclusionPolicy> {
  const fail = (error: string): DataLoadResult<ExclusionPolicy> => ({ ok: false, error });
  if (!isRecord(json)) return fail('policy: not an object');
  if (json.schema_version !== 1) return fail('policy: unsupported schema_version');
  if (!isStr(json.policy_version)) return fail('policy: policy_version missing');
  if (!isStr(json.status)) return fail('policy: status missing');
  if (!isStr(json.next_review_due) || !/^\d{4}-\d{2}-\d{2}$/.test(json.next_review_due)) {
    return fail('policy: next_review_due missing');
  }
  if (!Array.isArray(json.classes) || !Array.isArray(json.entries) || json.entries.length === 0) {
    return fail('policy: classes/entries missing');
  }
  const classes: PolicyClass[] = [];
  for (const [i, c] of json.classes.entries()) {
    if (!isRecord(c) || !isStr(c.id) || !isStr(c.criterion) || !isStr(c.rationale) || !isStrArray(c.fda_epc_signals)) {
      return fail(`policy: classes[${i}] malformed`);
    }
    classes.push({ id: c.id, criterion: c.criterion, rationale: c.rationale, fdaEpcSignals: c.fda_epc_signals });
  }
  const classIds = new Set(classes.map((c) => c.id));
  const entries: PolicyEntry[] = [];
  for (const [i, e] of json.entries.entries()) {
    if (
      !isRecord(e) ||
      !isStr(e.ingredient) ||
      !isStrArray(e.rxcuis) ||
      e.rxcuis.length === 0 ||
      !isStr(e.class) ||
      !classIds.has(e.class) ||
      (e.decision !== 'EXCLUDED' && e.decision !== 'NEEDS_CLARIFICATION')
    ) {
      return fail(`policy: entries[${i}] malformed`);
    }
    entries.push({ ingredient: e.ingredient.toLowerCase(), rxcuis: e.rxcuis, classId: e.class, decision: e.decision });
  }
  return {
    ok: true,
    value: {
      policyVersion: json.policy_version,
      status: json.status,
      nextReviewDue: json.next_review_due,
      classes,
      entries,
    },
  };
}
