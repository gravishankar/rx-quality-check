/**
 * Catalog and policy configuration (Task 3): validation with actionable errors, fail-closed loading,
 * data-driven extension (disable, alias, combination, formulation and strength restrictions) and
 * the documented precedence. Mutations of the shipped files are labeled; identities are synthetic
 * (format-only) unless built from a real NDC Directory fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateCatalog, validatePolicy, loadRxConfig, compareVersions } from '../../mobile/src/rules/catalog.ts';
import { evaluateExclusion, type ExclusionInput } from '../../mobile/src/rules/exclusion.ts';
import { normalizeStrength } from '../../mobile/src/rules/strength.ts';
import { checkConfig, formatReport } from '../../scripts/lib/config_check.ts';
import { ROOT, firstNdcRecord, productIdentity } from '../helpers/fixtures.ts';

const CATALOG = () => JSON.parse(readFileSync(join(ROOT, 'data', 'drug_catalog.json'), 'utf8'));
const POLICY = () => JSON.parse(readFileSync(join(ROOT, 'data', 'exclusion_policy.json'), 'utf8'));
const DEV = { allowUnapproved: true };
const errorsOf = (r: { problems: { severity: string; path: string; message: string; hint?: string }[] }) => r.problems.filter((p) => p.severity === 'error');

function decide(catalogJson: unknown, policyJson: unknown, input: ExclusionInput) {
  const cfg = loadRxConfig(catalogJson, policyJson, DEV);
  return evaluateExclusion(input, cfg.policy, cfg.catalog);
}
const oral = (ingredients: ExclusionInput['ingredients'], over: Partial<ExclusionInput> = {}): ExclusionInput => ({
  ingredients, routes: ['ORAL'], productType: 'HUMAN PRESCRIPTION DRUG', pharmClassEpc: [], doseForm: 'TABLET', release: 'IR', ...over,
});

// ---------------------------------------------------------------- shipped configuration

test('shipped catalog and policy validate (development mode) with no errors or warnings', () => {
  const r = checkConfig(ROOT, { precedence: true, expectationsPath: join(ROOT, 'data', 'config_expectations.json') });
  const { text, ok } = formatReport(r);
  assert.ok(ok, text);
  assert.deepEqual(r.problems, []);
  assert.ok(r.precedence.length >= 50);
});

test('release mode refuses unapproved configuration (RG-8) and the engine then fails closed', () => {
  const cfg = loadRxConfig(CATALOG(), POLICY(), {});
  assert.equal(cfg.policy.ok, false);
  assert.equal(cfg.catalog.ok, false);
  const id = productIdentity(firstNdcRecord('ndc_prod_68180-721'), null);
  const d = evaluateExclusion(id, cfg.policy, cfg.catalog);
  assert.equal(d.decision, 'UNSUPPORTED');
  if (d.decision === 'UNSUPPORTED') assert.equal(d.reason, 'POLICY_INVALID');
});

// ---------------------------------------------------------------- invalid entries → actionable errors

const CASES: [string, (c: ReturnType<typeof CATALOG>) => void, RegExp][] = [
  ['duplicate drug id', (c) => c.drugs.push({ ...c.drugs[0] }), /duplicate drug id "atorvastatin"/],
  ['unknown ingredient reference', (c) => (c.drugs[0].ingredients = ['atorvastatinn']), /unknown ingredient id "atorvastatinn"/],
  ['malformed RxCUI', (c) => (c.ingredients[0].rxcui = 'RX83367'), /\$\.ingredients\[0\]\.rxcui.*invalid format/],
  ['missing provenance', (c) => delete c.drugs[3].provenance, /\$\.drugs\[3\]\.provenance: is required/],
  ['alias used by two ingredients', (c) => (c.ingredients[1].aliases = ['atorvastatin']), /"atorvastatin" is also used by ingredient/],
  ['RxCUI under two ingredients', (c) => c.ingredients[1].precise_ingredients.push({ rxcui: '83366', name: 'x' }), /RxCUI 83366 is also listed/],
  ['deny-list RxCUI not a listed precise ingredient', (c) => (c.drugs.find((d: { id: string }) => d.id === 'gabapentin').restrictions.precise_ingredients.gabapentin.deny = ['999']), /RxCUI 999 is not a precise ingredient listed for "gabapentin"/],
  ['two active drugs for the same formulation', (c) => c.drugs.push({ ...c.drugs.find((d: { id: string }) => d.id === 'metformin'), id: 'metformin_copy' }), /same ingredient set and overlapping formulations/],
  ['invalid strength restriction', (c) => (c.drugs[0].restrictions = { strengths: { atorvastatin: ['forty'] } }), /"forty" is not a strength/],
  ['unknown restriction key', (c) => (c.drugs[0].restrictions = { colours: ['blue'] }), /unknown restriction "colours"/],
  ['unsupported schema version', (c) => (c.schema_version = 3), /unsupported schema_version 3/],
  ['requires a newer rule set', (c) => (c.compatibility.min_ruleset_version = '9.0.0'), /requires rule set 9\.0\.0.*needs an application update/s],
  ['retired file', (c) => (c.status = 'RETIRED'), /RETIRED file cannot be used/],
  ['invalid drug id format', (c) => (c.drugs[0].id = 'Atorvastatin 10'), /\$\.drugs\[0\]\.id.*invalid format/],
];

for (const [name, mutate, expected] of CASES) {
  test(`catalog: ${name} is rejected with a located, actionable error`, () => {
    const c = CATALOG();
    mutate(c);
    const r = validateCatalog(c, DEV);
    assert.equal(r.catalog, null);
    const text = errorsOf(r).map((p) => `${p.path}: ${p.message} ${p.hint ?? ''}`).join('\n');
    assert.match(text, expected);
  });
}

const POLICY_CASES: [string, (p: ReturnType<typeof POLICY>) => void, RegExp][] = [
  ['rule with unknown class', (p) => (p.ingredient_rules[0].class = 'BLOOD_THINNER'), /unknown class "BLOOD_THINNER"/],
  ['rule without verification date', (p) => delete p.ingredient_rules[0].verified_on, /verified_on: must be a non-empty string.*unverified data fails closed/s],
  ['duplicate rule id', (p) => (p.ingredient_rules[1].id = p.ingredient_rules[0].id), /duplicate rule id "EXCL-WARFARIN"/],
  ['one RxCUI in two rules', (p) => p.ingredient_rules[1].rxcuis.push('11289'), /RxCUI 11289 is also listed in rule EXCL-WARFARIN/],
  ['invalid decision', (p) => (p.ingredient_rules[0].decision = 'WARN'), /decision: must be one of EXCLUDED, NEEDS_CLARIFICATION/],
  ['review interval over six months', (p) => (p.next_review_due = '2028-01-01'), /at most six months/],
  ['approved without effective date', (p) => (p.status = 'APPROVED'), /APPROVED file needs an effective_date/],
  ['missing change log', (p) => (p.change_log = []), /change_log: must record at least one change/],
];
for (const [name, mutate, expected] of POLICY_CASES) {
  test(`policy: ${name} is rejected with a located, actionable error`, () => {
    const p = POLICY();
    mutate(p);
    const r = validatePolicy(p, DEV);
    assert.equal(r.policy, null);
    assert.match(errorsOf(r).map((x) => `${x.path}: ${x.message} ${x.hint ?? ''}`).join('\n'), expected);
  });
}

test('invalid JSON syntax and schema violations are reported by the validation command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rxcfg-'));
  const bad = join(dir, 'catalog.json');
  writeFileSync(bad, '{ "schema_version": 2, }');
  const r1 = checkConfig(ROOT, { which: 'catalog', catalogPath: bad });
  assert.match(r1.problems[0]?.message ?? '', /invalid JSON/);
  const c = CATALOG();
  c.drugs[0].colour = 'blue';
  const extra = join(dir, 'catalog2.json');
  writeFileSync(extra, JSON.stringify(c));
  const r2 = checkConfig(ROOT, { which: 'catalog', catalogPath: extra });
  assert.ok(r2.problems.some((p) => /schema: must NOT have additional properties \("colour"\)/.test(p.message)), JSON.stringify(r2.problems));
});

test('every catalog mutation above is also caught by either the JSON Schema or the runtime validator (both run in config:validate)', () => {
  // The runtime validator is the authority; this guards that the schema does not accept a shape the app rejects silently.
  for (const [, mutate] of CASES) {
    const c = CATALOG();
    mutate(c);
    assert.equal(validateCatalog(c, DEV).catalog, null);
  }
});

test('an invalid policy cannot authorize an assessment: every identity becomes UNSUPPORTED', () => {
  const p = POLICY();
  p.ingredient_rules[0].rxcuis = [];
  for (const ings of [[{ name: 'metformin', salt: null, rxcui: '6809' }], [{ name: 'warfarin', salt: null, rxcui: '11289' }]]) {
    const d = decide(CATALOG(), p, oral(ings));
    assert.equal(d.decision, 'UNSUPPORTED');
    if (d.decision === 'UNSUPPORTED') assert.equal(d.reason, 'POLICY_INVALID');
  }
});

test('an incompatible configuration (needs a newer app) fails closed with CONFIG_INCOMPATIBLE', () => {
  const p = POLICY();
  p.compatibility.min_ruleset_version = '1.0.0';
  const d = decide(CATALOG(), p, oral([{ name: 'metformin', salt: null, rxcui: '6809' }]));
  assert.ok(d.decision === 'UNSUPPORTED' && d.reason === 'CONFIG_INCOMPATIBLE');
  assert.ok(compareVersions('0.3.0', '0.10.0') < 0, 'numeric, not lexical, version comparison');
});

// ---------------------------------------------------------------- data-driven changes

test('disabling a drug keeps its record and stops assessment (DRUG_DISABLED)', () => {
  const c = CATALOG();
  c.drugs.find((d: { id: string }) => d.id === 'losartan').status = 'INACTIVE';
  const v = validateCatalog(c, DEV);
  assert.ok(v.catalog?.drugs.some((d) => d.id === 'losartan' && d.status === 'INACTIVE'), 'record retained');
  const d = decide(c, POLICY(), oral([{ name: 'losartan', salt: 'potassium', rxcui: null }]));
  assert.ok(d.decision === 'UNSUPPORTED' && d.reason === 'DRUG_DISABLED');
});

test('adding an alias is a data change: a new alias resolves to the ingredient', () => {
  const c = CATALOG();
  const before = decide(c, POLICY(), oral([{ name: 'levothyroxin', salt: null, rxcui: null }]));
  assert.equal(before.decision, 'UNSUPPORTED');
  c.ingredients.find((i: { id: string }) => i.id === 'levothyroxine').aliases.push('levothyroxin'); // synthetic misspelling alias
  const after = decide(c, POLICY(), oral([{ name: 'levothyroxin', salt: null, rxcui: null }]));
  assert.ok(after.decision === 'ELIGIBLE' && after.catalogDrugId === 'levothyroxine');
});

test('a combination product is an explicit entry: the pair is eligible, each ingredient alone stays its own drug', () => {
  const ok = decide(CATALOG(), POLICY(), oral([{ name: 'hydrocodone', salt: 'bitartrate', rxcui: null }, { name: 'acetaminophen', salt: null, rxcui: null }]));
  assert.ok(ok.decision === 'ELIGIBLE' && ok.catalogDrugId === 'hydrocodone_acetaminophen');
  const alone = decide(CATALOG(), POLICY(), oral([{ name: 'hydrocodone', salt: 'bitartrate', rxcui: null }]));
  assert.ok(alone.decision === 'UNSUPPORTED' && alone.reason === 'NOT_IN_CATALOG');
});

test('dose-form, release and strength restrictions are configurable and unknown values need clarification', () => {
  const c = CATALOG();
  const met = c.drugs.find((d: { id: string }) => d.id === 'metformin');
  met.restrictions = { dose_forms: ['TABLET'], release_types: ['ER'], strengths: { metformin: ['500 mg', '750 mg'] } };
  const P = POLICY();
  const ing = (s: string | null) => [{ name: 'metformin', salt: 'hydrochloride', rxcui: null, strength: s ? normalizeStrength(s) : null }];
  const r = (input: ExclusionInput) => {
    const d = decide(c, P, input);
    return d.decision === 'ELIGIBLE' ? 'ELIGIBLE' : `${d.decision}:${d.reason}`;
  };
  assert.equal(r(oral(ing('500 mg/1'), { release: 'ER' })), 'ELIGIBLE');
  assert.equal(r(oral(ing('1000 mg/1'), { release: 'ER' })), 'UNSUPPORTED:STRENGTH_NOT_IN_SCOPE');
  assert.equal(r(oral(ing(null), { release: 'ER' })), 'NEEDS_CLARIFICATION:STRENGTH_UNKNOWN');
  assert.equal(r(oral(ing('500 mg/1'), { release: 'IR' })), 'UNSUPPORTED:RELEASE_NOT_IN_SCOPE');
  assert.equal(r(oral(ing('500 mg/1'), { release: 'UNSPECIFIED' })), 'NEEDS_CLARIFICATION:RELEASE_UNKNOWN');
  assert.equal(r(oral(ing('500 mg/1'), { release: 'ER', doseForm: 'SUSPENSION' })), 'UNSUPPORTED:DOSE_FORM_NOT_IN_SCOPE');
});

test('IR and ER as two catalog entries with disjoint release types are both reachable', () => {
  const c = CATALOG();
  const met = c.drugs.find((d: { id: string }) => d.id === 'metformin');
  met.restrictions = { release_types: ['IR'] };
  c.drugs.push({ ...met, id: 'metformin_er', display_name: 'Metformin ER', restrictions: { release_types: ['ER'] } });
  assert.deepEqual(errorsOf(validateCatalog(c, DEV)), []);
  const ir = decide(c, POLICY(), oral([{ name: 'metformin', salt: null, rxcui: null }], { release: 'IR' }));
  const er = decide(c, POLICY(), oral([{ name: 'metformin', salt: null, rxcui: null }], { release: 'ER' }));
  assert.ok(ir.decision === 'ELIGIBLE' && ir.catalogDrugId === 'metformin');
  assert.ok(er.decision === 'ELIGIBLE' && er.catalogDrugId === 'metformin_er');
});

test('a catalog change cannot bypass an exclusion: adding warfarin to the catalog still yields EXCLUDED', () => {
  const c = CATALOG();
  // Synthetic attempt: warfarin IN 11289 (from the policy) added as a supported drug.
  c.ingredients.push({ id: 'warfarin', name: 'warfarin', rxcui: '11289', aliases: [], precise_ingredients: [], provenance: { source: 'test', verified_on: '2026-11-12' } });
  c.drugs.push({ id: 'warfarin', display_name: 'Warfarin', status: 'ACTIVE', ingredients: ['warfarin'], provenance: { source: 'test', verified_on: '2026-11-12' } });
  const cfg = loadRxConfig(c, POLICY(), DEV);
  assert.ok(cfg.problems.some((p) => p.severity === 'warning' && /covered by policy rule EXCL-WARFARIN/.test(p.message)), 'the validator warns');
  const d = evaluateExclusion(oral([{ name: 'warfarin', salt: 'sodium', rxcui: null }]), cfg.policy, cfg.catalog);
  assert.ok(d.decision === 'EXCLUDED' && d.ruleId === 'EXCL-WARFARIN');
});

test('a therapeutic-class signal alone does not exclude unless the policy says so', () => {
  const p = POLICY();
  const input = oral([{ name: 'syntheticoxaban', salt: null, rxcui: null }], { pharmClassEpc: ['Factor Xa Inhibitor [EPC]'] });
  assert.equal(decide(CATALOG(), p, input).decision, 'NEEDS_CLARIFICATION');
  p.classes.find((c: { id: string }) => c.id === 'ANTICOAGULANT').unlisted_signal_behavior = 'EXCLUDED';
  assert.equal(decide(CATALOG(), p, input).decision, 'EXCLUDED');
  p.classes.find((c: { id: string }) => c.id === 'ANTICOAGULANT').unlisted_signal_behavior = 'IGNORE';
  assert.equal(decide(CATALOG(), p, input).decision, 'UNSUPPORTED', 'not in catalog, but not excluded');
});

test('formulation-specific exclusion: a rule limited to SOLUTION does not exclude tablets', () => {
  const p = POLICY();
  // Synthetic rule for an existing catalog ingredient (format-only).
  p.classes.push({ id: 'EXAMPLE', criterion: 'x', rationale: 'x', explanation: 'x', fda_epc_signals: [], unlisted_signal_behavior: 'IGNORE' });
  p.ingredient_rules.push({ id: 'EXCL-FUROSEMIDE-SOLUTION', ingredient: 'furosemide', rxcuis: ['4603'], names: [], class: 'EXAMPLE', decision: 'EXCLUDED', applies_to: { dose_forms: ['SOLUTION'] }, include_combinations: true, source: 'test', verified_on: '2026-11-12' });
  const tab = decide(CATALOG(), p, oral([{ name: 'furosemide', salt: null, rxcui: null }]));
  const sol = decide(CATALOG(), p, oral([{ name: 'furosemide', salt: null, rxcui: null }], { doseForm: 'SOLUTION' }));
  assert.equal(tab.decision, 'ELIGIBLE');
  assert.ok(sol.decision === 'EXCLUDED' && sol.ruleId === 'EXCL-FUROSEMIDE-SOLUTION');
});

test('an approved administration-route rule excludes; while open it stays an interim UNSUPPORTED', () => {
  const p = POLICY();
  const topical = oral([{ name: 'tacrolimus', salt: null, rxcui: null }], { routes: ['TOPICAL'], doseForm: 'OTHER' });
  const open = decide(CATALOG(), p, topical);
  assert.ok(open.decision === 'UNSUPPORTED' && open.reason === 'ADMINISTRATION_RULE_PENDING');
  const r = p.route_rules[0];
  r.status = 'APPROVED';
  r.decision = 'EXCLUDED';
  const approved = decide(CATALOG(), p, topical);
  assert.ok(approved.decision === 'EXCLUDED' && approved.reason === 'POLICY_ROUTE_EXCLUDED');
});

test('conflicting policy matches resolve to the most restrictive decision, never ELIGIBLE', () => {
  // Synthetic combination of an EXCLUDED and a NEEDS_CLARIFICATION ingredient.
  const d = decide(CATALOG(), POLICY(), oral([{ name: 'everolimus', salt: null, rxcui: null }, { name: 'warfarin', salt: null, rxcui: null }]));
  assert.ok(d.decision === 'EXCLUDED' && d.ruleId === 'EXCL-WARFARIN');
});

test('combinations: include_combinations=false limits a rule to single-ingredient products', () => {
  const p = POLICY();
  p.ingredient_rules.find((r: { id: string }) => r.id === 'EXCL-WARFARIN').include_combinations = false;
  const combo = decide(CATALOG(), p, oral([{ name: 'warfarin', salt: null, rxcui: null }, { name: 'metformin', salt: null, rxcui: null }]));
  assert.notEqual(combo.decision, 'EXCLUDED');
  assert.notEqual(combo.decision, 'ELIGIBLE', 'and still not assessed: not a catalog combination');
});
