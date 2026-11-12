/**
 * Parse and validate the drug catalog and exclusion policy (schema 2).
 *
 * - Every problem is reported with a JSON path and a hint (actionable errors), not just the first.
 * - Invalid, incompatible (requires a newer rule set) or unapproved configuration fails closed:
 *   the loader returns an error and `evaluateExclusion` then returns UNSUPPORTED for everything,
 *   so no recall assessment can run (EX-9).
 * - Unapproved (draft/proposed) files are accepted only when the caller passes
 *   `allowUnapproved: true` (development and test builds; release builds must not, RG-8).
 *
 * The JSON Schemas in data/schemas/ describe the same structure for editors and for
 * `npm run config:validate`; this module is the runtime authority and also checks what a schema
 * cannot (references, duplicates, identifier formats, compatibility, cross-file consistency).
 */
import { isRecord } from '../models/lookup.ts';
import type {
  CatalogDrug,
  CatalogIngredient,
  ConfigStatus,
  DataLoadResult,
  DrugCatalog,
  DrugRestrictions,
  ExclusionPolicy,
  FormulationScope,
  IngredientRule,
  PolicyClass,
  ProductTypeRule,
  RouteRule,
  RxScope,
} from '../models/policy.ts';
import type { DoseFormFamily, ReleaseMechanism } from '../models/identity.ts';
import { splitIngredientName } from './ingredients.ts';
import { normalizeStrength } from './strength.ts';
import { RULESET_VERSION } from './version.ts';

export const SUPPORTED_CATALOG_SCHEMA = 2;
export const SUPPORTED_POLICY_SCHEMA = 2;

export interface ConfigProblem {
  severity: 'error' | 'warning';
  file: 'catalog' | 'policy' | 'config';
  path: string;
  message: string;
  hint?: string;
}

export interface LoadOptions {
  /** Accept DRAFT/PROPOSED files (development and tests only). Default false. */
  allowUnapproved?: boolean;
  /** Rule-set version of the running app (default: RULESET_VERSION). */
  rulesetVersion?: string;
}

const STATUSES: readonly ConfigStatus[] = ['APPROVED', 'DRAFT_PENDING_APPROVAL', 'PROPOSED_PENDING_APPROVAL', 'RETIRED'];
const DOSE_FORMS: readonly DoseFormFamily[] = ['TABLET', 'CAPSULE', 'SOLUTION', 'SUSPENSION', 'OTHER'];
const RELEASES: readonly ReleaseMechanism[] = ['IR', 'ER', 'DR'];
const RX_SCOPES: readonly RxScope[] = ['PRESCRIPTION_ONLY', 'OTC_ONLY', 'PRESCRIPTION_AND_OTC'];
const ID = /^[a-z][a-z0-9_]*$/;
const RULE_ID = /^[A-Z][A-Z0-9_-]*$/;
const RXCUI = /^\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** "YYYY-MM-DD" plus whole months, as a comparable "YYYY-MM-DD" string (day kept; no clock used). */
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Compare "a.b.c" versions numerically (pre-release suffix ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0]!.split('.').map(Number);
  const pb = b.split('-')[0]!.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

class Collector {
  readonly problems: ConfigProblem[] = [];
  constructor(private readonly file: ConfigProblem['file']) {}
  error(path: string, message: string, hint?: string): void {
    this.problems.push({ severity: 'error', file: this.file, path, message, ...(hint ? { hint } : {}) });
  }
  warn(path: string, message: string, hint?: string): void {
    this.problems.push({ severity: 'warning', file: this.file, path, message, ...(hint ? { hint } : {}) });
  }
  str(o: Record<string, unknown>, k: string, path: string, re?: RegExp, hint?: string): string {
    const v = o[k];
    if (typeof v !== 'string' || v.trim() === '') {
      this.error(`${path}.${k}`, 'must be a non-empty string', hint);
      return '';
    }
    if (re && !re.test(v)) this.error(`${path}.${k}`, `"${v}" has an invalid format (expected ${re})`, hint);
    return v;
  }
  strArray(o: Record<string, unknown>, k: string, path: string, opts: { required?: boolean; re?: RegExp; nonEmpty?: boolean } = {}): string[] {
    const v = o[k];
    if (v === undefined && !opts.required) return [];
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.trim() !== '')) {
      this.error(`${path}.${k}`, 'must be an array of non-empty strings');
      return [];
    }
    if (opts.nonEmpty && v.length === 0) this.error(`${path}.${k}`, 'must not be empty');
    if (opts.re) for (const [i, x] of (v as string[]).entries()) if (!opts.re.test(x)) this.error(`${path}.${k}[${i}]`, `"${x}" has an invalid format`);
    const dup = (v as string[]).find((x, i) => (v as string[]).indexOf(x) !== i);
    if (dup) this.error(`${path}.${k}`, `duplicate value "${dup}"`);
    return v as string[];
  }
  enumOf<T extends string>(o: Record<string, unknown>, k: string, path: string, allowed: readonly T[]): T {
    const v = o[k];
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      this.error(`${path}.${k}`, `must be one of ${allowed.join(', ')}`);
      return allowed[0] as T;
    }
    return v as T;
  }
  provenance(o: Record<string, unknown>, k: string, path: string): { source: string; verifiedOn: string } {
    const p = o[k];
    if (!isRecord(p)) {
      this.error(`${path}.${k}`, 'is required: { source, verified_on }', 'Record where the data came from and when it was verified.');
      return { source: '', verifiedOn: '' };
    }
    return { source: this.str(p, 'source', `${path}.${k}`), verifiedOn: this.str(p, 'verified_on', `${path}.${k}`, DATE) };
  }
}

function header(c: Collector, json: Record<string, unknown>, schema: number, versionKey: string, opts: LoadOptions) {
  if (json.schema_version !== schema) {
    c.error('$.schema_version', `unsupported schema_version ${String(json.schema_version)}; this app reads ${schema}`, 'Update the app, or migrate the file to the supported schema.');
  }
  const version = c.str(json, versionKey, '$', VERSION);
  const status = c.enumOf(json, 'status', '$', STATUSES);
  if (status === 'RETIRED') c.error('$.status', 'a RETIRED file cannot be used');
  if (status !== 'APPROVED' && !opts.allowUnapproved) {
    c.error('$.status', `status ${status} is not APPROVED`, 'Release builds require approved configuration (RG-8). Development builds may pass allowUnapproved.');
  }
  const eff = json.effective_date;
  if (eff !== null && (typeof eff !== 'string' || !DATE.test(eff))) c.error('$.effective_date', 'must be null or YYYY-MM-DD');
  if (status === 'APPROVED' && eff === null) c.error('$.effective_date', 'an APPROVED file needs an effective_date');
  let minRuleset = '0.0.0';
  if (!isRecord(json.compatibility)) c.error('$.compatibility', 'is required: { min_ruleset_version }');
  else {
    minRuleset = c.str(json.compatibility, 'min_ruleset_version', '$.compatibility', VERSION);
    const running = opts.rulesetVersion ?? RULESET_VERSION;
    if (minRuleset && compareVersions(minRuleset, running) > 0) {
      c.error('$.compatibility.min_ruleset_version', `requires rule set ${minRuleset}; this app runs ${running}`, 'This change needs an application update.');
    }
  }
  return { version, status, effectiveDate: (typeof eff === 'string' ? eff : null), minRuleset };
}

function parseRestrictions(c: Collector, v: unknown, path: string, ingredientIds: string[]): DrugRestrictions {
  const r: DrugRestrictions = { routes: null, doseForms: null, releaseTypes: null, strengths: null, preciseIngredients: {} };
  if (v === undefined) return r;
  if (!isRecord(v)) {
    c.error(path, 'must be an object');
    return r;
  }
  const known = ['routes', 'dose_forms', 'release_types', 'strengths', 'precise_ingredients'];
  for (const k of Object.keys(v)) if (!known.includes(k)) c.error(`${path}.${k}`, `unknown restriction "${k}"`, `Allowed: ${known.join(', ')}`);
  if (v.routes !== undefined) r.routes = c.strArray(v, 'routes', path, { nonEmpty: true }).map((x) => x.toUpperCase());
  if (v.dose_forms !== undefined) {
    r.doseForms = c.strArray(v, 'dose_forms', path, { nonEmpty: true }) as DoseFormFamily[];
    for (const f of r.doseForms) if (!DOSE_FORMS.includes(f)) c.error(`${path}.dose_forms`, `"${f}" is not one of ${DOSE_FORMS.join(', ')}`);
  }
  if (v.release_types !== undefined) {
    r.releaseTypes = c.strArray(v, 'release_types', path, { nonEmpty: true }) as ReleaseMechanism[];
    for (const f of r.releaseTypes) if (!RELEASES.includes(f)) c.error(`${path}.release_types`, `"${f}" is not one of ${RELEASES.join(', ')}`);
  }
  if (v.strengths !== undefined) {
    if (!isRecord(v.strengths)) c.error(`${path}.strengths`, 'must map ingredient ids to strength lists');
    else {
      r.strengths = {};
      for (const [ing, list] of Object.entries(v.strengths)) {
        if (!ingredientIds.includes(ing)) c.error(`${path}.strengths.${ing}`, `"${ing}" is not an ingredient of this drug`);
        const arr = c.strArray(v.strengths, ing, `${path}.strengths`, { nonEmpty: true, required: true });
        for (const s of arr) if (normalizeStrength(s) === null) c.error(`${path}.strengths.${ing}`, `"${s}" is not a strength`, 'Use forms like "100 mg", "0.4 mg", "10 mg/mL".');
        r.strengths[ing] = arr;
      }
    }
  }
  if (v.precise_ingredients !== undefined) {
    if (!isRecord(v.precise_ingredients)) c.error(`${path}.precise_ingredients`, 'must map ingredient ids to { allow?, deny? }');
    else {
      for (const [ing, spec] of Object.entries(v.precise_ingredients)) {
        const p = `${path}.precise_ingredients.${ing}`;
        if (!ingredientIds.includes(ing)) c.error(p, `"${ing}" is not an ingredient of this drug`);
        if (!isRecord(spec)) {
          c.error(p, 'must be { allow?: [rxcui], deny?: [rxcui] }');
          continue;
        }
        const allow = spec.allow === undefined ? null : c.strArray(spec, 'allow', p, { re: RXCUI, nonEmpty: true });
        const deny = c.strArray(spec, 'deny', p, { re: RXCUI });
        r.preciseIngredients[ing] = { allow, deny };
      }
    }
  }
  return r;
}

/** Parse and validate the catalog; returns every problem found. */
export function validateCatalog(json: unknown, opts: LoadOptions = {}): { catalog: DrugCatalog | null; problems: ConfigProblem[] } {
  const c = new Collector('catalog');
  if (!isRecord(json)) {
    c.error('$', 'catalog is not a JSON object');
    return { catalog: null, problems: c.problems };
  }
  const h = header(c, json, SUPPORTED_CATALOG_SCHEMA, 'catalog_version', opts);
  const sd = isRecord(json.scope_defaults) ? json.scope_defaults : (c.error('$.scope_defaults', 'is required'), {});
  const defaultRoutes = c.strArray(sd, 'routes', '$.scope_defaults', { required: true, nonEmpty: true }).map((r) => r.toUpperCase());
  const defaultRxScope = c.enumOf(sd, 'rx_scope', '$.scope_defaults', RX_SCOPES);
  if (sd.ingredient_set_match !== 'EXACT') c.error('$.scope_defaults.ingredient_set_match', 'must be "EXACT"');

  const ingredients: CatalogIngredient[] = [];
  const ingIds = new Set<string>();
  const nameOwner = new Map<string, string>();
  if (!Array.isArray(json.ingredients) || json.ingredients.length === 0) c.error('$.ingredients', 'must be a non-empty array');
  for (const [i, x] of (Array.isArray(json.ingredients) ? json.ingredients : []).entries()) {
    const p = `$.ingredients[${i}]`;
    if (!isRecord(x)) {
      c.error(p, 'must be an object');
      continue;
    }
    const id = c.str(x, 'id', p, ID, 'Lower-case letters, digits and underscores; never change an existing id.');
    if (ingIds.has(id)) c.error(`${p}.id`, `duplicate ingredient id "${id}"`);
    ingIds.add(id);
    const name = c.str(x, 'name', p).toLowerCase();
    let rxcui: string | null = null;
    if (x.rxcui !== null) rxcui = c.str(x, 'rxcui', p, RXCUI, 'An RxNorm IN RxCUI verified on RxNav, or null when none is verified.');
    if (x.tty !== undefined && x.tty !== 'IN' && x.tty !== 'MIN') c.error(`${p}.tty`, 'must be IN (or MIN)');
    const aliases = c.strArray(x, 'aliases', p).map((a) => a.toLowerCase());
    const pins: { rxcui: string; name: string }[] = [];
    if (x.precise_ingredients !== undefined) {
      if (!Array.isArray(x.precise_ingredients)) c.error(`${p}.precise_ingredients`, 'must be an array');
      else
        for (const [j, pin] of x.precise_ingredients.entries()) {
          if (!isRecord(pin)) {
            c.error(`${p}.precise_ingredients[${j}]`, 'must be { rxcui, name }');
            continue;
          }
          pins.push({ rxcui: c.str(pin, 'rxcui', `${p}.precise_ingredients[${j}]`, RXCUI), name: c.str(pin, 'name', `${p}.precise_ingredients[${j}]`).toLowerCase() });
        }
    }
    const provenance = c.provenance(x, 'provenance', p);
    for (const n of [name, ...aliases]) {
      const owner = nameOwner.get(n);
      if (owner !== undefined && owner !== id) c.error(p, `name or alias "${n}" is also used by ingredient "${owner}"`, 'Each name must identify exactly one ingredient.');
      nameOwner.set(n, id);
    }
    ingredients.push({ id, name, rxcui, aliases, preciseIngredients: pins, provenance });
  }
  const rxOwner = new Map<string, string>();
  for (const ing of ingredients) {
    for (const r of [ing.rxcui, ...ing.preciseIngredients.map((x) => x.rxcui)]) {
      if (r === null) continue;
      const o = rxOwner.get(r);
      if (o !== undefined && o !== ing.id) c.error(`$.ingredients[id=${ing.id}]`, `RxCUI ${r} is also listed under ingredient "${o}"`);
      rxOwner.set(r, ing.id);
    }
  }

  const drugs: CatalogDrug[] = [];
  const drugIds = new Set<string>();
  if (!Array.isArray(json.drugs) || json.drugs.length === 0) c.error('$.drugs', 'must be a non-empty array');
  for (const [i, x] of (Array.isArray(json.drugs) ? json.drugs : []).entries()) {
    const p = `$.drugs[${i}]`;
    if (!isRecord(x)) {
      c.error(p, 'must be an object');
      continue;
    }
    const id = c.str(x, 'id', p, ID, 'Lower-case letters, digits and underscores; saved medications reference it, so never rename or reuse it.');
    if (drugIds.has(id)) c.error(`${p}.id`, `duplicate drug id "${id}"`);
    drugIds.add(id);
    const displayName = c.str(x, 'display_name', p);
    const status = c.enumOf(x, 'status', p, ['ACTIVE', 'INACTIVE'] as const);
    const ingredientIds = c.strArray(x, 'ingredients', p, { required: true, nonEmpty: true });
    for (const ing of ingredientIds) if (!ingIds.has(ing)) c.error(`${p}.ingredients`, `unknown ingredient id "${ing}"`, 'Define it in $.ingredients first.');
    const aliases = c.strArray(x, 'aliases', p).map((a) => a.toLowerCase());
    const rxScope = x.rx_scope === undefined ? defaultRxScope : c.enumOf(x, 'rx_scope', p, RX_SCOPES);
    const restrictions = parseRestrictions(c, x.restrictions, `${p}.restrictions`, ingredientIds);
    for (const [ing, spec] of Object.entries(restrictions.preciseIngredients)) {
      const def = ingredients.find((d) => d.id === ing);
      for (const r of [...(spec.allow ?? []), ...spec.deny]) {
        if (def && !def.preciseIngredients.some((pi) => pi.rxcui === r)) {
          c.error(`${p}.restrictions.precise_ingredients.${ing}`, `RxCUI ${r} is not a precise ingredient listed for "${ing}"`, 'Add the verified precise ingredient to the ingredient definition first.');
        }
      }
    }
    const provenance = c.provenance(x, 'provenance', p);
    drugs.push({ id, displayName, status, ingredientIds, aliases, rxScope, restrictions, provenance });
  }
  // Two ACTIVE drugs with the same ingredient set and no distinguishing restriction are ambiguous.
  const active = drugs.filter((d) => d.status === 'ACTIVE');
  for (let a = 0; a < active.length; a++) {
    for (let b = a + 1; b < active.length; b++) {
      const A = active[a] as CatalogDrug;
      const B = active[b] as CatalogDrug;
      const same = A.ingredientIds.length === B.ingredientIds.length && A.ingredientIds.every((x) => B.ingredientIds.includes(x));
      const distinct = (k: 'doseForms' | 'releaseTypes') => {
        const x = A.restrictions[k] as string[] | null;
        const y = B.restrictions[k] as string[] | null;
        return x !== null && y !== null && !x.some((v) => y.includes(v));
      };
      if (same && !distinct('doseForms') && !distinct('releaseTypes')) {
        c.error('$.drugs', `drugs "${A.id}" and "${B.id}" have the same ingredient set and overlapping formulations`, 'Give them disjoint dose_forms or release_types, or set one INACTIVE.');
      }
    }
  }
  if (!Array.isArray(json.change_log) || json.change_log.length === 0) c.error('$.change_log', 'must record at least one change { date, version, change, source }');

  const ok = !c.problems.some((p) => p.severity === 'error');
  return {
    catalog: ok
      ? { schemaVersion: SUPPORTED_CATALOG_SCHEMA, catalogVersion: h.version, status: h.status, effectiveDate: h.effectiveDate, minRulesetVersion: h.minRuleset, defaultRoutes, defaultRxScope, ingredients, drugs }
      : null,
    problems: c.problems,
  };
}

function parseScope(c: Collector, v: unknown, path: string): FormulationScope {
  const s: FormulationScope = { routes: null, doseForms: null, releaseTypes: null };
  if (v === undefined || v === null) return s;
  if (!isRecord(v)) {
    c.error(path, 'must be an object { routes?, dose_forms?, release_types? }');
    return s;
  }
  if (v.routes !== undefined) s.routes = c.strArray(v, 'routes', path, { nonEmpty: true }).map((x) => x.toUpperCase());
  if (v.dose_forms !== undefined) {
    s.doseForms = c.strArray(v, 'dose_forms', path, { nonEmpty: true }) as DoseFormFamily[];
    for (const f of s.doseForms) if (!DOSE_FORMS.includes(f)) c.error(`${path}.dose_forms`, `"${f}" is not one of ${DOSE_FORMS.join(', ')}`);
  }
  if (v.release_types !== undefined) {
    s.releaseTypes = c.strArray(v, 'release_types', path, { nonEmpty: true }) as ReleaseMechanism[];
    for (const f of s.releaseTypes) if (!RELEASES.includes(f)) c.error(`${path}.release_types`, `"${f}" is not one of ${RELEASES.join(', ')}`);
  }
  return s;
}

/** Parse and validate the exclusion policy; returns every problem found. */
export function validatePolicy(json: unknown, opts: LoadOptions = {}): { policy: ExclusionPolicy | null; problems: ConfigProblem[] } {
  const c = new Collector('policy');
  if (!isRecord(json)) {
    c.error('$', 'policy is not a JSON object');
    return { policy: null, problems: c.problems };
  }
  const h = header(c, json, SUPPORTED_POLICY_SCHEMA, 'policy_version', opts);
  const lastReviewed = c.str(json, 'last_reviewed', '$', DATE);
  const nextReviewDue = c.str(json, 'next_review_due', '$', DATE);
  if (DATE.test(lastReviewed) && DATE.test(nextReviewDue) && nextReviewDue > addMonths(lastReviewed, 6)) {
    c.error('$.next_review_due', 'must be at most six months after last_reviewed (Document B)');
  }

  const classes: PolicyClass[] = [];
  for (const [i, x] of (Array.isArray(json.classes) ? json.classes : (c.error('$.classes', 'must be an array'), [])).entries()) {
    const p = `$.classes[${i}]`;
    if (!isRecord(x)) {
      c.error(p, 'must be an object');
      continue;
    }
    classes.push({
      id: c.str(x, 'id', p, RULE_ID),
      criterion: c.str(x, 'criterion', p),
      rationale: c.str(x, 'rationale', p),
      explanation: c.str(x, 'explanation', p, undefined, 'Plain-language text shown to the patient.'),
      fdaEpcSignals: c.strArray(x, 'fda_epc_signals', p),
      unlistedSignalBehavior: c.enumOf(x, 'unlisted_signal_behavior', p, ['NEEDS_CLARIFICATION', 'EXCLUDED', 'IGNORE'] as const),
    });
  }
  const classIds = new Set(classes.map((x) => x.id));
  if (classIds.size !== classes.length) c.error('$.classes', 'duplicate class id');

  const ruleIds = new Set<string>();
  const checkRuleId = (id: string, p: string) => {
    if (ruleIds.has(id)) c.error(`${p}.id`, `duplicate rule id "${id}"`);
    ruleIds.add(id);
  };
  const ingredientRules: IngredientRule[] = [];
  if (!Array.isArray(json.ingredient_rules) || json.ingredient_rules.length === 0) c.error('$.ingredient_rules', 'must be a non-empty array');
  for (const [i, x] of (Array.isArray(json.ingredient_rules) ? json.ingredient_rules : []).entries()) {
    const p = `$.ingredient_rules[${i}]`;
    if (!isRecord(x)) {
      c.error(p, 'must be an object');
      continue;
    }
    const id = c.str(x, 'id', p, RULE_ID);
    checkRuleId(id, p);
    const classId = c.str(x, 'class', p);
    if (classId && !classIds.has(classId)) c.error(`${p}.class`, `unknown class "${classId}"`, `Defined classes: ${[...classIds].join(', ')}`);
    if (typeof x.include_combinations !== 'boolean') c.error(`${p}.include_combinations`, 'must be true or false');
    ingredientRules.push({
      id,
      ingredient: c.str(x, 'ingredient', p).toLowerCase(),
      rxcuis: c.strArray(x, 'rxcuis', p, { required: true, nonEmpty: true, re: RXCUI }),
      names: c.strArray(x, 'names', p).map((n) => n.toLowerCase()),
      classId,
      decision: c.enumOf(x, 'decision', p, ['EXCLUDED', 'NEEDS_CLARIFICATION'] as const),
      appliesTo: parseScope(c, x.applies_to, `${p}.applies_to`),
      includeCombinations: x.include_combinations === true,
      explanation: typeof x.explanation === 'string' ? x.explanation : null,
      provenance: { source: c.str(x, 'source', p), verifiedOn: c.str(x, 'verified_on', p, DATE, 'Rules without a verification date are rejected (unverified data fails closed).') },
    });
  }
  const seenRx = new Map<string, string>();
  for (const r of ingredientRules) {
    for (const x of r.rxcuis) {
      const o = seenRx.get(x);
      if (o !== undefined && o !== r.id) c.error(`$.ingredient_rules[id=${r.id}]`, `RxCUI ${x} is also listed in rule ${o}`, 'One RxCUI must be governed by one rule; combine or narrow the rules.');
      seenRx.set(x, r.id);
    }
  }

  const routeRules: RouteRule[] = [];
  for (const [i, x] of (Array.isArray(json.route_rules) ? json.route_rules : []).entries()) {
    const p = `$.route_rules[${i}]`;
    if (!isRecord(x)) {
      c.error(p, 'must be an object');
      continue;
    }
    const id = c.str(x, 'id', p, RULE_ID);
    checkRuleId(id, p);
    const status = c.enumOf(x, 'status', p, ['OPEN_DECISION', 'APPROVED'] as const);
    const routes = x.routes === 'NON_ORAL' ? 'NON_ORAL' : c.strArray(x, 'routes', p, { required: true, nonEmpty: true }).map((r) => r.toUpperCase());
    const decision = status === 'APPROVED' ? c.enumOf(x, 'decision', p, ['EXCLUDED', 'NEEDS_CLARIFICATION'] as const) : null;
    routeRules.push({
      id,
      status,
      routes,
      scope: c.enumOf(x, 'scope', p, ['LISTED_INGREDIENTS', 'ALL'] as const),
      decision,
      interimDecision: status === 'OPEN_DECISION' ? c.enumOf(x, 'interim_decision', p, ['UNSUPPORTED', 'NEEDS_CLARIFICATION'] as const) : 'UNSUPPORTED',
      interimReason: status === 'OPEN_DECISION' ? c.str(x, 'interim_reason', p) : '',
    });
  }
  const productTypeRules: ProductTypeRule[] = [];
  for (const [i, x] of (Array.isArray(json.product_type_rules) ? json.product_type_rules : []).entries()) {
    const p = `$.product_type_rules[${i}]`;
    if (!isRecord(x)) {
      c.error(p, 'must be an object');
      continue;
    }
    const id = c.str(x, 'id', p, RULE_ID);
    checkRuleId(id, p);
    productTypeRules.push({
      id,
      productTypes: c.strArray(x, 'product_types', p, { required: true, nonEmpty: true }).map((t) => t.toUpperCase()),
      decision: c.enumOf(x, 'decision', p, ['EXCLUDED', 'NEEDS_CLARIFICATION'] as const),
      explanation: c.str(x, 'explanation', p),
    });
    c.str(x, 'source', p);
  }
  if (!Array.isArray(json.change_log) || json.change_log.length === 0) c.error('$.change_log', 'must record at least one change');
  else for (const [i, e] of json.change_log.entries()) if (!isRecord(e) || !e.date || !e.version || !e.source) c.error(`$.change_log[${i}]`, 'needs date, version and source');

  const ok = !c.problems.some((p) => p.severity === 'error');
  return {
    policy: ok
      ? {
          schemaVersion: SUPPORTED_POLICY_SCHEMA,
          policyVersion: h.version,
          status: h.status,
          effectiveDate: h.effectiveDate,
          lastReviewed,
          nextReviewDue,
          minRulesetVersion: h.minRuleset,
          classes,
          ingredientRules,
          routeRules,
          productTypeRules,
        }
      : null,
    problems: c.problems,
  };
}

/**
 * Cross-file checks. Overlaps between catalog and policy are allowed (exclusion wins) but are
 * reported so an editor sees that a catalog entry is unreachable.
 */
export function crossValidateConfig(catalog: DrugCatalog, policy: ExclusionPolicy): ConfigProblem[] {
  const out: ConfigProblem[] = [];
  for (const ing of catalog.ingredients) {
    const ids = [ing.rxcui, ...ing.preciseIngredients.map((p) => p.rxcui)].filter((x): x is string => x !== null);
    for (const r of policy.ingredientRules) {
      const byId = ids.some((x) => r.rxcuis.includes(x));
      const byName = [r.ingredient, ...r.names].some((n) => splitIngredientName(n).name === ing.name || ing.aliases.includes(n));
      if (byId || byName) {
        const drugs = catalog.drugs.filter((d) => d.ingredientIds.includes(ing.id)).map((d) => d.id);
        out.push({
          severity: 'warning',
          file: 'config',
          path: `catalog.ingredients[id=${ing.id}] × policy.ingredient_rules[id=${r.id}]`,
          message: `ingredient "${ing.id}" is covered by policy rule ${r.id} (${r.decision}); catalog drugs ${drugs.join(', ') || '(none)'} will not be assessed where the rule applies`,
          hint: 'Exclusions override catalog inclusion. Remove one side if this is not intended.',
        });
      }
    }
  }
  return out;
}

export interface RxConfig {
  catalog: DataLoadResult<DrugCatalog>;
  policy: DataLoadResult<ExclusionPolicy>;
  problems: ConfigProblem[];
}

const summarize = (ps: ConfigProblem[]) =>
  ps.filter((p) => p.severity === 'error').map((p) => `${p.path}: ${p.message}`).join('; ');

/** Load both files. Each side fails closed independently; exclusion evaluation then fails closed. */
export function loadRxConfig(catalogJson: unknown, policyJson: unknown, opts: LoadOptions = {}): RxConfig {
  const c = validateCatalog(catalogJson, opts);
  const p = validatePolicy(policyJson, opts);
  const cross = c.catalog && p.policy ? crossValidateConfig(c.catalog, p.policy) : [];
  return {
    catalog: c.catalog ? { ok: true, value: c.catalog } : { ok: false, error: summarize(c.problems) },
    policy: p.policy ? { ok: true, value: p.policy } : { ok: false, error: summarize(p.problems) },
    problems: [...c.problems, ...p.problems, ...cross],
  };
}

/** Back-compatible single-file loaders. */
export function parseCatalog(json: unknown, opts: LoadOptions = {}): DataLoadResult<DrugCatalog> {
  const r = validateCatalog(json, opts);
  return r.catalog ? { ok: true, value: r.catalog } : { ok: false, error: summarize(r.problems) };
}

export function parsePolicy(json: unknown, opts: LoadOptions = {}): DataLoadResult<ExclusionPolicy> {
  const r = validatePolicy(json, opts);
  return r.policy ? { ok: true, value: r.policy } : { ok: false, error: summarize(r.problems) };
}
