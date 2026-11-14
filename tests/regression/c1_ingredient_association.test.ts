/**
 * Correctness finding C1 (review against b9c5989): each ingredient must keep its own salt and
 * strength through identification, recall comparison and refill comparison. Label and recall texts
 * marked SYNTHETIC are format-only examples; ingredient names and strengths are real products.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityFromPrintedFields } from '../../mobile/src/rules/identity.ts';
import { compareAttributes } from '../../mobile/src/rules/recallRecord.ts';
import { diffFills } from '../../mobile/src/rules/refill.ts';
import type { MedicationIdentity, IdentityIngredient } from '../../mobile/src/models/identity.ts';

const known = ['acetaminophen', 'codeine', 'hydrocodone', 'amlodipine', 'atorvastatin', 'doxycycline'];
const aliases = { apap: 'acetaminophen' };
const strengthOf = (id: MedicationIdentity, n: string) => id.ingredients.find((i) => i.name === n)?.strength?.value;
const ing = (name: string, value: number, salt: string | null = null): IdentityIngredient => ({ name, salt, rxcui: null, strength: { value, unit: 'MG', per: '1' } });
const identity = (ingredients: IdentityIngredient[], over: Partial<MedicationIdentity> = {}): MedicationIdentity => ({
  level: 'CLINICAL_DRUG', productNdc: null, packageNdc: null, labelerName: null, ingredients, doseForm: 'TABLET', release: 'IR',
  routes: [], productType: null, pharmClassEpc: [], relatedSourceProductNdcs: [], lot: null, ...over,
});

test('C1 identification: an abbreviated ingredient keeps its own strength (SYNTHETIC label "APAP/CODEINE 300-30MG")', () => {
  const r = identityFromPrintedFields({ drugName: 'APAP/CODEINE', strength: '300-30MG', doseForm: 'TABLET' } as never, known, null, aliases);
  assert.ok(r.ok);
  assert.equal(strengthOf(r.identity, 'acetaminophen'), 300);
  assert.equal(strengthOf(r.identity, 'codeine'), 30);
});

test('C1 identification: guard — the usual order still pairs correctly ("HYDROCODONE/APAP 10-325MG")', () => {
  const r = identityFromPrintedFields({ drugName: 'HYDROCODONE/APAP', strength: '10-325MG', doseForm: 'TABLET' } as never, known, null, aliases);
  assert.ok(r.ok);
  assert.equal(strengthOf(r.identity, 'hydrocodone'), 10);
  assert.equal(strengthOf(r.identity, 'acetaminophen'), 325);
});

test('C1 recall comparison: strengths are compared per ingredient, not as an unordered set (SYNTHETIC recall text)', () => {
  const id = identity([ing('amlodipine', 10), ing('atorvastatin', 20)]);
  const swapped = compareAttributes(id, 'Amlodipine and Atorvastatin Tablets, 20 mg/10 mg, 30 count bottle');
  assert.ok(swapped.differences.includes('STRENGTH_DIFFERS'), 'amlodipine 20 mg / atorvastatin 10 mg is a different strength');
  const reordered = compareAttributes(id, 'Atorvastatin and Amlodipine Tablets, 20 mg/10 mg, 30 count bottle');
  assert.ok(!reordered.differences.includes('STRENGTH_DIFFERS'), 'the same product written in the other order still matches');
  const same = compareAttributes(id, 'Amlodipine and Atorvastatin Tablets, 10 mg/20 mg, 30 count bottle');
  assert.ok(!same.differences.includes('STRENGTH_DIFFERS'));
});

test('C1 refill: a salt change at the same strength is reported (doxycycline hyclate 100 mg -> monohydrate 100 mg)', () => {
  const prev = identity([ing('doxycycline', 100, 'hyclate')], { doseForm: 'CAPSULE' });
  const cur = identity([ing('doxycycline', 100, 'monohydrate')], { doseForm: 'CAPSULE' });
  const d = diffFills(prev, cur);
  assert.ok(d.changes.some((c) => c.kind === 'SALT_CHANGED'), JSON.stringify(d.changes));
  assert.equal(d.reevaluate, true);
});

test('C1 refill: swapped combination strengths are a strength change', () => {
  const d = diffFills(identity([ing('amlodipine', 10), ing('atorvastatin', 20)]), identity([ing('amlodipine', 20), ing('atorvastatin', 10)]));
  assert.ok(d.changes.some((c) => c.kind === 'STRENGTH_CHANGED'));
});

test('C1 refill: guard — the same product with ingredients listed in another order is no change', () => {
  const d = diffFills(identity([ing('amlodipine', 10), ing('atorvastatin', 20)]), identity([ing('atorvastatin', 20), ing('amlodipine', 10)]));
  assert.deepEqual(d.changes, []);
});
