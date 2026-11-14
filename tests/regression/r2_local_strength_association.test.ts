/**
 * Review round 2, issue 1 (reopens finding 1): strengths in a recall notice must be paired with the
 * ingredient names that belong to *that* strength expression, not with the first place each name
 * appears anywhere in the text. When the pairing cannot be established, the record is kept with an
 * explicit uncertainty — never "same", never "different" unless the numbers prove it.
 * Ingredients and strengths are a real product (amlodipine 10 mg / atorvastatin 20 mg); the notice
 * texts are SYNTHETIC (format-only).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareAttributes } from '../../mobile/src/rules/recallRecord.ts';
import type { IdentityIngredient, MedicationIdentity } from '../../mobile/src/models/identity.ts';

const ing = (name: string, value: number): IdentityIngredient => ({ name, salt: null, rxcui: null, strength: { value, unit: 'MG', per: '1' } });
const id: MedicationIdentity = {
  level: 'CLINICAL_DRUG', productNdc: null, packageNdc: null, labelerName: null, ingredients: [ing('amlodipine', 10), ing('atorvastatin', 20)],
  doseForm: 'TABLET', release: 'IR', routes: [], productType: null, pharmClassEpc: [], relatedSourceProductNdcs: [], lot: null,
};
const cmp = (t: string) => compareAttributes(id, t);
const differs = (t: string) => cmp(t).differences.includes('STRENGTH_DIFFERS');

test('R2-1 reproduced: title in one order, strength block in the other — paired locally, not ruled out', () => {
  assert.equal(differs('Amlodipine and Atorvastatin Tablets (Atorvastatin/Amlodipine 20 mg/10 mg), 30 count bottle'), false);
});

test('R2-1: the same local block with swapped values is a proven difference', () => {
  assert.equal(differs('Amlodipine and Atorvastatin Tablets (Atorvastatin/Amlodipine 10 mg/20 mg), 30 count bottle'), true);
});

test('R2-1 guard: names directly before the strengths still pair in their order', () => {
  assert.equal(differs('Amlodipine and Atorvastatin Tablets, 10 mg/20 mg, 30 count bottle'), false);
  assert.equal(differs('Amlodipine and Atorvastatin Tablets, 20 mg/10 mg, 30 count bottle'), true);
});

test('R2-1: strengths before the names — pairing not established → kept with explicit uncertainty', () => {
  const c = cmp('10 mg/20 mg Amlodipine and Atorvastatin Tablets, 30 count bottle');
  assert.ok(!c.differences.includes('STRENGTH_DIFFERS'));
  assert.ok(c.unknowns.includes('STRENGTH_ASSOCIATION_UNCLEAR'), JSON.stringify(c));
  const swapped = cmp('20 mg/10 mg Amlodipine and Atorvastatin Tablets, 30 count bottle');
  assert.ok(!swapped.differences.includes('STRENGTH_DIFFERS'), 'swapped values with unknown pairing: kept, not ruled out');
  assert.ok(swapped.unknowns.includes('STRENGTH_ASSOCIATION_UNCLEAR'));
});

test('R2-1: pairing unknown but the numbers cannot match under any pairing → proven difference', () => {
  assert.equal(differs('5 mg/20 mg Amlodipine and Atorvastatin Tablets, 30 count bottle'), true);
});

test('R2-1: names repeated earlier — the block nearest the strengths decides (kept)', () => {
  const c = cmp('Atorvastatin; Amlodipine/Atorvastatin/Amlodipine 20 mg/10 mg tablets');
  assert.ok(!c.differences.includes('STRENGTH_DIFFERS'));
});
