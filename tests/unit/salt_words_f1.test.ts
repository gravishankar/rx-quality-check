/**
 * App fix F1 (extended drug list): salt words that kept the recall search from using the plain
 * ingredient name. Real FDA NDC Directory active-ingredient names (openFDA, 2026-11-13); the guard
 * cases are real RxNorm ingredient names that must stay distinct drugs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSalt, readIngredientsFromText, splitIngredientName } from '../../mobile/src/rules/ingredients.ts';

const split = (s: string) => splitIngredientName(s);

test('F1: salt words now split from the ingredient name (real FDA active-ingredient names)', () => {
  assert.deepEqual(split('CLOPIDOGREL BISULFATE'), { name: 'clopidogrel', salt: 'bisulfate' });
  assert.deepEqual(split('ESCITALOPRAM OXALATE'), { name: 'escitalopram', salt: 'oxalate' });
  assert.deepEqual(split('CITALOPRAM HYDROBROMIDE'), { name: 'citalopram', salt: 'hydrobromide' });
  assert.deepEqual(split('DOXYCYCLINE HYCLATE'), { name: 'doxycycline', salt: 'hyclate' });
  assert.deepEqual(split('ISOSORBIDE MONONITRATE'), { name: 'isosorbide', salt: 'mononitrate' });
  assert.deepEqual(split('DAPAGLIFLOZIN PROPANEDIOL'), { name: 'dapagliflozin', salt: 'propanediol' });
  assert.deepEqual(split('SITAGLIPTIN PHOSPHATE'), { name: 'sitagliptin', salt: 'phosphate' });
  assert.deepEqual(split('CHLORHEXIDINE GLUCONATE'), { name: 'chlorhexidine', salt: 'gluconate' });
  assert.deepEqual(split('CLINDAMYCIN PALMITATE HYDROCHLORIDE'), { name: 'clindamycin', salt: 'palmitate' });
  assert.deepEqual(split('KETOROLAC TROMETHAMINE'), { name: 'ketorolac', salt: 'tromethamine' });
  assert.deepEqual(split('HYDROXYZINE PAMOATE'), { name: 'hydroxyzine', salt: 'pamoate' });
});

test('F1: dihydrochloride is read as hydrochloride (same products under two names), so no false "different salt"', () => {
  assert.deepEqual(split('HYDROXYZINE DIHYDROCHLORIDE'), { name: 'hydroxyzine', salt: 'hydrochloride' });
  assert.deepEqual(split('PRAMIPEXOLE DIHYDROCHLORIDE MONOHYDRATE'), { name: 'pramipexole', salt: 'hydrochloride' });
  assert.deepEqual(split('LEVOCETIRIZINE DIHYDROCHLORIDE'), { name: 'levocetirizine', salt: 'hydrochloride' });
  const r = readIngredientsFromText('Hydroxyzine HCl Tablets, USP 25 mg', ['hydroxyzine']);
  assert.equal(r.salts.hydroxyzine, 'hydrochloride');
});

test('F1 guard: a salt word never splits off a mineral or metal, so distinct drugs stay distinct', () => {
  for (const n of ['SODIUM PHOSPHATE', 'POTASSIUM PHOSPHATE', 'CALCIUM GLUCONATE', 'POTASSIUM GLUCONATE', 'FERROUS GLUCONATE',
    'FERROUS SULFATE', 'ZINC SULFATE', 'MAGNESIUM SULFATE', 'CALCIUM ACETATE', 'POTASSIUM CITRATE', 'SODIUM BICARBONATE', 'POTASSIUM CHLORIDE']) {
    assert.equal(split(n).name, n.toLowerCase(), `${n} must keep its full name`);
  }
});

test('F1 guard: words that name a different drug are not salt words', () => {
  assert.equal(split('ISOSORBIDE DINITRATE').name, 'isosorbide dinitrate', 'dinitrate is a different ingredient (RxNorm IN 6058)');
  assert.notEqual(split('ISOSORBIDE DINITRATE').name, split('ISOSORBIDE MONONITRATE').name);
  assert.equal(canonicalSalt('chloride'), null, 'chloride would turn potassium chloride into potassium');
  assert.equal(canonicalSalt('aspartate'), null, 'mixed-salt amphetamine products need their own handling');
  assert.equal(canonicalSalt('saccharate'), null);
});

test('F1: existing behaviour unchanged for the 14 current drugs', () => {
  assert.deepEqual(split('ATORVASTATIN CALCIUM TRIHYDRATE'), { name: 'atorvastatin', salt: 'calcium' });
  assert.deepEqual(split('METOPROLOL SUCCINATE'), { name: 'metoprolol', salt: 'succinate' });
  assert.deepEqual(split('METOPROLOL TARTRATE'), { name: 'metoprolol', salt: 'tartrate' });
  assert.deepEqual(split('LEVOTHYROXINE SODIUM'), { name: 'levothyroxine', salt: 'sodium' });
  assert.deepEqual(split('HYDROCODONE BITARTRATE'), { name: 'hydrocodone', salt: 'bitartrate' });
  assert.deepEqual(split('MYCOPHENOLIC ACID'), { name: 'mycophenolate', salt: null });
});
