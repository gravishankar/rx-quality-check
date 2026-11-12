/**
 * Configuration checks used by `npm run catalog:validate`, `policy:validate`, `config:validate` and
 * `config:test` (scripts/config_validate.ts) and by tests.
 *
 *  1. JSON syntax (with the parser's position).
 *  2. JSON Schema (data/schemas/*.schema.json, via ajv).
 *  3. Runtime validation (mobile/src/rules/catalog.ts): identifiers, duplicates, references,
 *     provenance, approval status, rule-set compatibility. This is what the app itself enforces.
 *  4. Cross-file checks (catalog × policy overlaps, reported as warnings).
 *  5. Precedence self-test (config:test only): every ACTIVE catalog drug, every exclusion rule,
 *     every product-type rule and every INACTIVE drug is evaluated with the production
 *     `evaluateExclusion`, plus the hand-written cases in data/config_expectations.json.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv, type ErrorObject } from 'ajv';
import { validateCatalog, validatePolicy, crossValidateConfig, type ConfigProblem, type LoadOptions } from '../../mobile/src/rules/catalog.ts';
import { evaluateExclusion, type ExclusionInput } from '../../mobile/src/rules/exclusion.ts';
import { normalizeStrength } from '../../mobile/src/rules/strength.ts';
import type { DrugCatalog, ExclusionPolicy } from '../../mobile/src/models/policy.ts';
import type { DoseFormFamily } from '../../mobile/src/models/identity.ts';


export interface CheckReport {
  problems: ConfigProblem[];
  precedence: { name: string; expected: string; actual: string; pass: boolean }[];
  catalog: DrugCatalog | null;
  policy: ExclusionPolicy | null;
}

function readJson(path: string, file: ConfigProblem['file']): { json: unknown; problems: ConfigProblem[] } {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { json: null, problems: [{ severity: 'error', file, path: '$', message: `cannot read ${path}: ${(e as Error).message}` }] };
  }
  try {
    return { json: JSON.parse(text), problems: [] };
  } catch (e) {
    return { json: null, problems: [{ severity: 'error', file, path: '$', message: `invalid JSON in ${path}: ${(e as Error).message}`, hint: 'Fix the syntax (trailing commas and comments are not allowed).' }] };
  }
}

function schemaProblems(root: string, schemaFile: string, json: unknown, file: ConfigProblem['file']): ConfigProblem[] {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schema = JSON.parse(readFileSync(join(root, 'data', 'schemas', schemaFile), 'utf8')) as object;
  const validate = ajv.compile(schema);
  if (validate(json)) return [];
  return (validate.errors ?? []).map((e: ErrorObject) => ({
    severity: 'error' as const,
    file,
    path: `$${e.instancePath.replace(/\//g, '.')}`,
    message: `schema: ${e.message ?? 'invalid'}${e.params && 'additionalProperty' in e.params ? ` ("${String((e.params as { additionalProperty: string }).additionalProperty)}")` : ''}${e.params && 'allowedValues' in e.params ? ` (${JSON.stringify((e.params as { allowedValues: unknown }).allowedValues)})` : ''}`,
  }));
}

/** Synthetic identity for self-testing (format-only; no real product). */
function identityFor(ingredients: { name: string; salt: string | null; rxcui: string | null; strength?: ReturnType<typeof normalizeStrength> }[], over: Partial<ExclusionInput> = {}): ExclusionInput {
  return { ingredients, routes: ['ORAL'], productType: 'HUMAN PRESCRIPTION DRUG', pharmClassEpc: [], doseForm: 'TABLET', release: 'IR', ...over };
}

export function precedenceSelfTest(root: string, catalog: DrugCatalog, policy: ExclusionPolicy, expectationsPath?: string): CheckReport['precedence'] {
  const out: CheckReport['precedence'] = [];
  const P = { ok: true as const, value: policy };
  const C = { ok: true as const, value: catalog };
  const record = (name: string, expected: string, input: ExclusionInput) => {
    const d = evaluateExclusion(input, P, C);
    const actual = d.decision === 'ELIGIBLE' ? `ELIGIBLE:${d.catalogDrugId}` : `${d.decision}:${d.reason}`;
    out.push({ name, expected, actual, pass: actual === expected || (expected.endsWith(':*') && actual.startsWith(expected.slice(0, -1))) });
  };

  // Every ACTIVE drug is reachable with a formulation that satisfies its own restrictions,
  // unless an exclusion rule covers one of its ingredients (then it must be EXCLUDED/NEEDS_CLARIFICATION).
  for (const d of catalog.drugs) {
    const ings = d.ingredientIds.map((id) => {
      const def = catalog.ingredients.find((x) => x.id === id)!;
      const allow = d.restrictions.preciseIngredients[id]?.allow;
      const pin = allow ? def.preciseIngredients.find((p) => allow.includes(p.rxcui)) : undefined;
      const salt = pin ? (pin.name.slice(def.name.length).trim() || null) : null;
      const strengthText = d.restrictions.strengths?.[id]?.[0];
      return { name: def.name, salt, rxcui: def.rxcui, strength: strengthText ? normalizeStrength(strengthText) : null };
    });
    const input = identityFor(ings, {
      doseForm: (d.restrictions.doseForms?.[0] ?? 'TABLET') as DoseFormFamily,
      release: d.restrictions.releaseTypes?.[0] ?? 'IR',
      routes: [d.restrictions.routes?.[0] ?? catalog.defaultRoutes[0] ?? 'ORAL'],
      productType: d.rxScope === 'OTC_ONLY' ? 'HUMAN OTC DRUG' : 'HUMAN PRESCRIPTION DRUG',
    });
    const covered = policy.ingredientRules.some((r) => d.ingredientIds.some((id) => r.ingredient === id || r.names.includes(id)));
    if (d.status === 'INACTIVE') record(`inactive drug ${d.id} is not assessed`, 'UNSUPPORTED:DRUG_DISABLED', input);
    else record(`active drug ${d.id} is eligible`, covered ? 'EXCLUDED:*' : `ELIGIBLE:${d.id}`, input);
  }
  // Every ingredient rule wins over everything, alone and (when configured) in a combination.
  for (const r of policy.ingredientRules) {
    const one = { name: r.ingredient, salt: null, rxcui: r.rxcuis[0] ?? null };
    record(`rule ${r.id} applies (oral)`, `${r.decision}:*`, identityFor([one]));
    const supported = catalog.ingredients[0];
    if (supported && r.includeCombinations) {
      record(`rule ${r.id} applies to a combination`, `${r.decision}:*`, identityFor([one, { name: supported.name, salt: null, rxcui: supported.rxcui }]));
    }
  }
  // Product-type rules override catalog inclusion.
  const first = catalog.drugs.find((d) => d.status === 'ACTIVE' && d.ingredientIds.length === 1);
  if (first) {
    const def = catalog.ingredients.find((x) => x.id === first.ingredientIds[0])!;
    for (const r of policy.productTypeRules) {
      for (const pt of r.productTypes) record(`product-type rule ${r.id} overrides catalog (${first.id})`, `${r.decision}:PRODUCT_TYPE_EXCLUDED`, identityFor([{ name: def.name, salt: null, rxcui: def.rxcui }], { productType: pt }));
    }
  }
  // Hand-written regression cases.
  if (expectationsPath) {
    const x = JSON.parse(readFileSync(expectationsPath, 'utf8')) as { cases: { name: string; input: ExclusionInput; expect: string }[] };
    for (const c of x.cases) {
      const input = { ...c.input, ingredients: c.input.ingredients.map((i) => ({ ...i, strength: (i as { strength_text?: string }).strength_text ? normalizeStrength((i as { strength_text?: string }).strength_text as string) : null })) };
      record(c.name, c.expect, input);
    }
  }
  return out;
}

export function checkConfig(
  root: string,
  opts: { catalogPath?: string; policyPath?: string; which?: 'catalog' | 'policy' | 'all'; precedence?: boolean; load?: LoadOptions; expectationsPath?: string },
): CheckReport {
  const which = opts.which ?? 'all';
  const load = opts.load ?? { allowUnapproved: true };
  const problems: ConfigProblem[] = [];
  let catalog: DrugCatalog | null = null;
  let policy: ExclusionPolicy | null = null;
  if (which !== 'policy') {
    const r = readJson(opts.catalogPath ?? join(root, 'data', 'drug_catalog.json'), 'catalog');
    problems.push(...r.problems);
    if (r.json !== null) {
      problems.push(...schemaProblems(root, 'drug_catalog.schema.json', r.json, 'catalog'));
      const v = validateCatalog(r.json, load);
      problems.push(...v.problems);
      catalog = v.catalog;
    }
  }
  if (which !== 'catalog') {
    const r = readJson(opts.policyPath ?? join(root, 'data', 'exclusion_policy.json'), 'policy');
    problems.push(...r.problems);
    if (r.json !== null) {
      problems.push(...schemaProblems(root, 'exclusion_policy.schema.json', r.json, 'policy'));
      const v = validatePolicy(r.json, load);
      problems.push(...v.problems);
      policy = v.policy;
    }
  }
  if (catalog && policy) problems.push(...crossValidateConfig(catalog, policy));
  const precedence = opts.precedence && catalog && policy ? precedenceSelfTest(root, catalog, policy, opts.expectationsPath) : [];
  return { problems, precedence, catalog, policy };
}

export function formatReport(r: CheckReport): { text: string; ok: boolean } {
  const lines: string[] = [];
  const errors = r.problems.filter((p) => p.severity === 'error');
  const warnings = r.problems.filter((p) => p.severity === 'warning');
  for (const p of errors) lines.push(`ERROR   [${p.file}] ${p.path}: ${p.message}${p.hint ? `\n        hint: ${p.hint}` : ''}`);
  for (const p of warnings) lines.push(`warning [${p.file}] ${p.path}: ${p.message}`);
  if (r.catalog) lines.push(`catalog ${r.catalog.catalogVersion} (${r.catalog.status}): ${r.catalog.drugs.filter((d) => d.status === 'ACTIVE').length} active / ${r.catalog.drugs.length} drugs, ${r.catalog.ingredients.length} ingredients`);
  if (r.policy) lines.push(`policy ${r.policy.policyVersion} (${r.policy.status}): ${r.policy.ingredientRules.length} ingredient rules, ${r.policy.productTypeRules.length} product-type rules, ${r.policy.routeRules.length} route rules`);
  const failed = r.precedence.filter((x) => !x.pass);
  if (r.precedence.length > 0) {
    for (const f of failed) lines.push(`FAIL    precedence: ${f.name}: expected ${f.expected}, got ${f.actual}`);
    lines.push(`precedence self-test: ${r.precedence.length - failed.length}/${r.precedence.length} passed`);
  }
  const ok = errors.length === 0 && failed.length === 0;
  lines.push(ok ? 'OK' : `FAILED: ${errors.length} error(s), ${failed.length} precedence failure(s)`);
  return { text: lines.join('\n'), ok };
}
