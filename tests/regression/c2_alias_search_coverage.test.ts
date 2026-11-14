/**
 * Correctness finding C2 (review against b9c5989): recall searches must include each ingredient's
 * known aliases, and "every page was retrieved" (pagination complete) must not be mistaken for
 * "the search asked for everything it should have" (search adequate).
 *
 * Responses are real openFDA answers (tests/fixtures/task2). Aliases marked SYNTHETIC are format-only.
 * Live evidence for the defect (openFDA, 2026-11-13): 8 valsartan, 9 losartan and 1 lisinopril recall
 * notices name hydrochlorothiazide only as "HCTZ" (e.g. D-0886-2022 "Losartan HCTZ 100/25 mg");
 * the recorded end-to-end check is tests/integration/c2_alias_search.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRecallEvidence, planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import type { MedicationIdentity } from '../../mobile/src/models/identity.ts';
import type { RecallQueryPlan } from '../../mobile/src/models/evidence.ts';
import { apiNdcRecord, bundle, control, enf, firstNdcRecord, productIdentity, realNoMatch } from '../helpers/fixtures.ts';

const withAliases = (id: MedicationIdentity, aliases: Record<string, string[]>): MedicationIdentity => ({
  ...id,
  ingredients: id.ingredients.map((i) => (aliases[i.name] ? { ...i, aliases: aliases[i.name] } : i)),
});
const hydrocodoneApap = () => withAliases(productIdentity(firstNdcRecord('ndc_prod_31722-997'), '31722-997-01'), { acetaminophen: ['apap'] });
// Real product and real "no recall" answers; the alias "rsv" is SYNTHETIC (format-only).
const rosuvastatin = () => withAliases(productIdentity(apiNdcRecord('ndc_rosuvastatin'), '82009-018-10'), { rosuvastatin: ['rsv'] });
const ROSUVASTATIN_PAGES = () => ({ ingredient_text: [enf('enf_text_rosuvastatin')], product_ndc: [realNoMatch()], control: [control()] });

test('C2 plan: each ingredient is searched by its name OR any of its aliases', () => {
  const q = planRecallQueries(hydrocodoneApap()).queries.find((x) => x.kind === 'INGREDIENT_TEXT')!;
  assert.equal(q.search, '(product_description:"acetaminophen" OR product_description:"apap") AND product_description:"hydrocodone"');
});

test('C2 plan: guard — an ingredient without aliases is searched exactly as before', () => {
  const id = productIdentity(apiNdcRecord('ndc_rosuvastatin'), '82009-018-10');
  assert.equal(planRecallQueries(id).queries.find((x) => x.kind === 'INGREDIENT_TEXT')!.search, 'product_description:"rosuvastatin"');
});

test('C2 coverage: all pages retrieved, but the search left out an alias → not complete, never a no-match', () => {
  const id = rosuvastatin();
  // The plan as built before the fix: ingredient names only.
  const oldPlan: RecallQueryPlan = { ...planRecallQueries(id), queries: planRecallQueries(id).queries.map((q) => (q.kind === 'INGREDIENT_TEXT' ? { ...q, search: 'product_description:"rosuvastatin"' } : q)) };
  const f = evaluateRecallEvidence(id, bundle(oldPlan, ROSUVASTATIN_PAGES()));
  assert.ok(f.coverage.queries.every((q) => q.status === 'COMPLETE'), 'pagination itself was complete');
  assert.equal(f.coverage.searchAdequate, false);
  assert.equal(f.coverage.complete, false);
  assert.equal(f.finding, 'UNRESOLVED');
  assert.ok(f.limitations.includes('SEARCH_TERMS_INCOMPLETE'));
});

test('C2 coverage: a required product-NDC search missing from the plan is also inadequate', () => {
  const id = productIdentity(apiNdcRecord('ndc_rosuvastatin'), '82009-018-10');
  const plan = planRecallQueries(id);
  const noNdc: RecallQueryPlan = { ...plan, queries: plan.queries.filter((q) => q.kind !== 'PRODUCT_NDC_STRUCTURED') };
  const f = evaluateRecallEvidence(id, bundle(noNdc, { ingredient_text: [enf('enf_text_rosuvastatin')], control: [control()] }));
  assert.equal(f.coverage.searchAdequate, false);
  assert.notEqual(f.finding, 'NO_MATCH_FOUND');
});

test('C2 coverage: guard — the fixed plan with the same real answers is adequate and complete', () => {
  const id = productIdentity(apiNdcRecord('ndc_rosuvastatin'), '82009-018-10');
  const f = evaluateRecallEvidence(id, bundle(planRecallQueries(id), ROSUVASTATIN_PAGES()));
  assert.equal(f.coverage.searchAdequate, true);
  assert.equal(f.coverage.complete, true);
  assert.equal(f.finding, 'NO_MATCH_FOUND');
});

test('C2 (review item 2): the query-plan version is recorded with every plan and finding', async () => {
  const { QUERY_PLAN_VERSION } = await import('../../mobile/src/rules/recallEvidence.ts');
  const { RULESET_VERSION } = await import('../../mobile/src/rules/version.ts');
  const id = productIdentity(apiNdcRecord('ndc_rosuvastatin'), '82009-018-10');
  const plan = planRecallQueries(id);
  assert.equal(plan.version, QUERY_PLAN_VERSION);
  assert.equal(QUERY_PLAN_VERSION, '2', '1 = names only; 2 = each ingredient searched by name OR aliases');
  const f = evaluateRecallEvidence(id, bundle(plan, ROSUVASTATIN_PAGES()));
  assert.equal(f.coverage.queryPlanVersion, '2');
  assert.notEqual(RULESET_VERSION, '0.3.0', 'rules changed in Task 4H: saved results made under 0.3.0 are stale');
});
