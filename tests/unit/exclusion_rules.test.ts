/**
 * Exclusion policy enforcement (EX-2…7, EX-9) with real NDC Directory records and the bundled
 * draft policy 0.1.0-draft. Order of rules: docs/ARCHITECTURE.md §5.2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateExclusion } from '../../mobile/src/rules/exclusion.ts';
import { parseCatalog, parsePolicy } from '../../mobile/src/rules/catalog.ts';
import { identityFromPrintedFields } from '../../mobile/src/rules/identity.ts';
import type { MedicationIdentity } from '../../mobile/src/models/identity.ts';
import { ROOT, apiNdcRecord, firstNdcRecord, productIdentity, rulesConfig } from '../helpers/fixtures.ts';

const cfg = rulesConfig();
const decide = (id: MedicationIdentity) => evaluateExclusion(id, cfg.policy, cfg.catalog);
const fromNdc = (name: string) => productIdentity(firstNdcRecord(name), null);

test('bundled catalog and policy parse', () => {
  assert.ok(cfg.catalog.ok && cfg.catalog.value.drugs.length === 14);
  assert.ok(cfg.policy.ok && cfg.policy.value.ingredientRules.length === 11);
});

test('13 of 14 supported representative products are ELIGIBLE (real NDC Directory records)', () => {
  const names = [
    'atorvastatin', 'amlodipine', 'levothyroxine', 'lisinopril', 'gabapentin', 'losartan', 'metformin',
    'omeprazole', 'rosuvastatin', 'pantoprazole', 'furosemide', 'hydrocodone_acetaminophen', 'tamsulosin',
  ];
  for (const n of names) {
    const d = decide(productIdentity(apiNdcRecord(`ndc_${n}`), null));
    assert.equal(d.decision, 'ELIGIBLE', n);
    if (d.decision === 'ELIGIBLE') assert.equal(d.catalogDrugId, n);
  }
});

test('real data conflict: "Metoprolol Succinate" ER record listing METOPROLOL TARTRATE → salt unknown → NEEDS_CLARIFICATION', () => {
  // openFDA product 50090-6448 (A-S Medication Solutions): generic_name "Metoprolol Succinate",
  // active_ingredients [{ name: "METOPROLOL TARTRATE" }]. Neither salt is trusted; the catalog
  // requires succinate, so eligibility depends on information the app does not have.
  const id = productIdentity(apiNdcRecord('ndc_metoprolol_succinate'), null);
  assert.equal(id.ingredients[0]?.salt, null);
  const d = decide(id);
  assert.equal(d.decision, 'NEEDS_CLARIFICATION');
  if (d.decision === 'NEEDS_CLARIFICATION') assert.equal(d.reason, 'SALT_UNKNOWN');
});

test('EX-2: warfarin and apixaban (oral) → EXCLUDED with class rationale and policy version', () => {
  for (const f of ['ndc_warfarin', 'ndc_apixaban']) {
    const d = decide(fromNdc(f));
    assert.equal(d.decision, 'EXCLUDED', f);
    if (d.decision === 'EXCLUDED') {
      assert.equal(d.classId, 'ANTICOAGULANT');
      assert.equal(d.policyVersion, '0.2.0-draft');
      assert.match(d.ruleId ?? '', /^EXCL-/);
      assert.ok((d.explanation ?? '').length > 0, 'human-readable explanation from the policy');
      assert.ok(d.rationale.length > 0);
    }
  }
});

test('EX-2: mycophenolic acid (published as "MYCOPHENOLATE SODIUM") → EXCLUDED', () => {
  const d = decide(fromNdc('ndc_mycophenolic_acid'));
  assert.equal(d.decision, 'EXCLUDED');
});

test('EX-2: every policy entry name is EXCLUDED or NEEDS_CLARIFICATION from a printed label alone', () => {
  if (!cfg.policy.ok) throw new Error('policy');
  const lex = cfg.policy.value.ingredientRules.map((e) => e.ingredient);
  for (const e of cfg.policy.value.ingredientRules) {
    const r = identityFromPrintedFields({ drugName: e.ingredient.toUpperCase(), strength: '1 MG', doseForm: 'TABLET' }, lex, null);
    assert.ok(r.ok, e.ingredient);
    if (r.ok) assert.equal(decide(r.identity).decision, e.decision, e.ingredient);
  }
});

test('EX-3: everolimus (oral) → NEEDS_CLARIFICATION (indication cannot be established)', () => {
  const d = decide(fromNdc('ndc_everolimus'));
  assert.equal(d.decision, 'NEEDS_CLARIFICATION');
  if (d.decision === 'NEEDS_CLARIFICATION') assert.equal(d.reason, 'POLICY_INDICATION_DEPENDENT');
});

test('EX-4: a combination containing an excluded ingredient → EXCLUDED', () => {
  const id = productIdentity(apiNdcRecord('ndc_amlodipine'), null);
  id.ingredients = [...id.ingredients, { name: 'warfarin', salt: 'sodium', rxcui: null, strength: null }];
  assert.equal(decide(id).decision, 'EXCLUDED');
});

test('EX-5: excluded ingredient with a non-oral route (tacrolimus ointment) → UNSUPPORTED / ADMINISTRATION_RULE_PENDING', () => {
  const d = decide(fromNdc('ndc_tacrolimus_topical'));
  assert.equal(d.decision, 'UNSUPPORTED');
  if (d.decision === 'UNSUPPORTED') assert.equal(d.reason, 'ADMINISTRATION_RULE_PENDING');
});

test('EX-6: an unlisted ingredient carrying an anticoagulant EPC → NEEDS_CLARIFICATION', () => {
  const id = productIdentity(apiNdcRecord('ndc_amlodipine'), null);
  id.ingredients = [{ name: 'newanticoagulantum', salt: null, rxcui: null, strength: null }]; // synthetic name
  id.pharmClassEpc = ['Factor Xa Inhibitor [EPC]'];
  const d = decide(id);
  assert.equal(d.decision, 'NEEDS_CLARIFICATION');
  if (d.decision === 'NEEDS_CLARIFICATION') assert.equal(d.reason, 'POLICY_CLASS_MATCH_UNLISTED');
});

test('EX-7: combinations with a supported ingredient → UNSUPPORTED (not EXCLUDED)', () => {
  for (const f of ['ndc_amlodipine_benazepril', 'ndc_metformin_er_other', 'ndc_metoprolol_tartrate']) {
    const d = decide(fromNdc(f));
    assert.equal(d.decision, 'UNSUPPORTED', f);
    if (d.decision === 'UNSUPPORTED') assert.equal(d.reason, 'COMBINATION_NOT_IN_CATALOG', f);
  }
});

test('EX-7: metoprolol tartrate (single ingredient) → UNSUPPORTED / SALT_NOT_IN_SCOPE; salt unknown → NEEDS_CLARIFICATION', () => {
  const lex = ['metoprolol'];
  const t = identityFromPrintedFields({ drugName: 'METOPROLOL TARTRATE', strength: '25 MG', doseForm: 'TABLET' }, lex, null);
  assert.ok(t.ok);
  if (t.ok) {
    const d = decide(t.identity);
    assert.equal(d.decision, 'UNSUPPORTED');
    if (d.decision === 'UNSUPPORTED') assert.equal(d.reason, 'SALT_NOT_IN_SCOPE');
  }
  const u = identityFromPrintedFields({ drugName: 'METOPROLOL ER', strength: '50 MG', doseForm: 'TABLET' }, lex, null);
  assert.ok(u.ok);
  if (u.ok) assert.equal(decide(u.identity).decision, 'NEEDS_CLARIFICATION');
  const s = identityFromPrintedFields({ drugName: 'METOPROLOL SUCC ER', strength: '50 MG', doseForm: 'TABLET' }, lex, null);
  assert.ok(s.ok);
  if (s.ok) assert.equal(decide(s.identity).decision, 'ELIGIBLE');
});

test('OTC products are EXCLUDED by policy rule OTC-MVP (product owner decision, Task 3; closes OD-3)', () => {
  // Task 2 returned UNSUPPORTED / OTC_PENDING_DECISION while OD-3 was open.
  const d = decide(fromNdc('ndc_omeprazole_otc'));
  assert.equal(d.decision, 'EXCLUDED');
  if (d.decision === 'EXCLUDED') {
    assert.equal(d.reason, 'PRODUCT_TYPE_EXCLUDED');
    assert.equal(d.ruleId, 'OTC-MVP');
  }
});

test('a liquid with no stated route is not assumed oral', () => {
  const r = identityFromPrintedFields({ drugName: 'FUROSEMIDE', strength: '10 MG/ML', doseForm: 'SOLUTION' }, ['furosemide'], null);
  assert.ok(r.ok);
  if (r.ok) {
    const d = decide(r.identity);
    assert.equal(d.decision, 'NEEDS_CLARIFICATION');
    if (d.decision === 'NEEDS_CLARIFICATION') assert.equal(d.reason, 'ROUTE_UNKNOWN');
  }
});

test('EX-9: an invalid or missing policy fails closed → UNSUPPORTED for every medication', () => {
  const policyJson = JSON.parse(readFileSync(join(ROOT, 'data', 'exclusion_policy.json'), 'utf8'));
  const broken = { ...policyJson, entries: [{ ingredient: 'warfarin' }] };
  for (const p of [parsePolicy(broken), parsePolicy(null), parsePolicy({ ...policyJson, schema_version: 99 })]) {
    assert.equal(p.ok, false);
    for (const f of ['ndc_warfarin', 'ndc_prod_68180-721']) {
      const d = evaluateExclusion(fromNdc(f), p, cfg.catalog);
      assert.equal(d.decision, 'UNSUPPORTED');
      if (d.decision === 'UNSUPPORTED') assert.equal(d.reason, 'POLICY_INVALID');
    }
  }
});

test('EX-9: an invalid catalog fails closed', () => {
  const d = evaluateExclusion(fromNdc('ndc_prod_68180-721'), cfg.policy, parseCatalog({ schema_version: 1 }));
  assert.equal(d.decision, 'UNSUPPORTED');
  if (d.decision === 'UNSUPPORTED') assert.equal(d.reason, 'CATALOG_INVALID');
});
