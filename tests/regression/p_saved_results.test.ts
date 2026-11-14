/**
 * Review items 5 and 6 (saved-result integrity, before persistence is enabled). Real products and
 * real recorded openFDA responses (tests/fixtures/task2): Sun metformin ER 500 mg 62756-142, recall
 * D-0325-2021 lists lot JKU4639A. Lots other than JKU4639A and the second package code are SYNTHETIC.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openNodeSqlite } from '../../mobile/src/storage/drivers/nodeSqlite.ts';
import { createAssessmentStore, openStorage } from '../../mobile/src/storage/repositories.ts';
import { evaluateRecallEvidence, planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import { RULESET_VERSION } from '../../mobile/src/rules/version.ts';
import type { MedicationIdentity } from '../../mobile/src/models/identity.ts';
import { bundle, control, enf, firstNdcRecord, productIdentity } from '../helpers/fixtures.ts';

let clock = Date.parse('2026-11-12T12:00:00Z');
const deps = { now: () => new Date((clock += 1000)).toISOString(), newId: () => randomUUID() };
const V1 = { rulesetVersion: RULESET_VERSION, policyVersion: '0.2.0-draft', catalogVersion: '0.2.0' };
const sunEr = (lot: string | null, pkg = '62756-142-02'): MedicationIdentity => productIdentity(firstNdcRecord('ndc_pkg_62756-142-02'), pkg, lot);
const findingFor = (id: MedicationIdentity) =>
  evaluateRecallEvidence(id, bundle(planRecallQueries(id), { ingredient_text: [enf('enf_text_metformin')], product_ndc: [enf('enf_pndc_62756-142')], control: [control()] }));
const fresh = async (versions = V1) => {
  const { repos } = await openStorage(openNodeSqlite(), deps);
  return { repos, store: createAssessmentStore(repos, versions, () => ({ displayName: 'Metformin ER', catalogDrugId: 'metformin_er' })) };
};

test('item 5: a lot-specific result is never reused offline for a bottle from a different lot', async () => {
  const { store } = await fresh();
  const a = sunEr('JKU4639A');
  const fa = findingFor(a);
  assert.equal(fa.finding, 'CONFIRMED_MATCH', 'real recall D-0325-2021 lists this lot');
  await store.save(a, fa);
  assert.equal((await store.latestFor(sunEr('ZZZ0000Z')))?.finding.finding ?? null, null, 'SYNTHETIC other lot');
  assert.equal((await store.latestFor(sunEr(null)))?.finding.finding ?? null, null, 'no lot given now');
  assert.equal((await store.latestFor(sunEr('JKU4639A')))?.finding.finding, 'CONFIRMED_MATCH', 'guard: same fill identity');
});

test('item 5: a different package code of the same product is not reused', async () => {
  const { store } = await fresh();
  const a = sunEr(null, '62756-142-02');
  await store.save(a, findingFor(a));
  assert.equal(await store.latestFor(sunEr(null, '62756-142-13')), null, 'SYNTHETIC package code');
});

test('item 5: a result made under other rules, policy or catalog versions is not reused', async () => {
  const db = await fresh();
  const a = sunEr(null);
  await db.store.save(a, findingFor(a));
  const later = createAssessmentStore(db.repos, { ...V1, policyVersion: '0.3.0' }, () => ({ displayName: 'Metformin ER', catalogDrugId: 'metformin_er' }));
  assert.equal(await later.latestFor(a), null);
});

test('item 5: different strength, salt, form or release never share a clinical-level result', async () => {
  const { store } = await fresh();
  const base: MedicationIdentity = { ...sunEr(null), level: 'CLINICAL_DRUG', productNdc: null, packageNdc: null };
  await store.save(base, findingFor(base));
  const ing = base.ingredients[0]!;
  for (const [label, v] of [
    ['strength', { ...base, ingredients: [{ ...ing, strength: { value: 1000, unit: 'MG', per: '1' } }] }],
    ['salt', { ...base, ingredients: [{ ...ing, salt: 'SYNTHETIC-salt' }] }],
    ['form', { ...base, doseForm: 'CAPSULE' }],
    ['release', { ...base, release: 'IR' }],
  ] as [string, MedicationIdentity][]) {
    assert.equal(await store.latestFor(v), null, label);
  }
});

test('item 6: each saved assessment is joined to its own fill, not the medication\'s first fill', async () => {
  const { repos, store } = await fresh();
  const first = sunEr(null);
  const second = sunEr('JKU4639A');
  await store.save(first, findingFor(first));
  await store.save(second, findingFor(second));
  const [med] = await repos.medications.list();
  const latest = await repos.assessments.latestWithFill(med!.id);
  assert.equal(latest?.assessment.finding.finding, 'CONFIRMED_MATCH');
  assert.equal(latest?.fill.identity.lot, 'JKU4639A', 'the newest assessment shows the bottle it was made for');
  assert.equal(latest?.fill.id, latest?.assessment.fillId);
});
