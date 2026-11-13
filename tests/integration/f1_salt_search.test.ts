/**
 * App fix F1, end to end on REAL recorded FDA responses (tests/fixtures/f1/cassette.json, openFDA
 * 2026-11-13): recall retrieval and classification through the app's own evidence path, before F1
 * (pre-F1 name reader) and after. Also the RxNorm-wide conflation check on recorded RxNorm names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runF1Comparison } from '../../scripts/catalog/f1_before_after.ts';
import { splitIngredientName } from '../../mobile/src/rules/ingredients.ts';
import { splitIngredientName as beforeF1 } from '../fixtures/f1/ingredients_before_f1.ts';
import { ROOT } from '../helpers/fixtures.ts';

const rows = await runF1Comparison();
const row = (id: string) => rows.find((r) => r.case === id)!;
const affected = rows.filter((r) => !r.case.startsWith('CONTROL'));

test('F1 never loses a recall record that was found before (no new false negatives in retrieval)', () => {
  for (const r of rows) assert.deepEqual(r.lost, [], r.case);
});

test('F1 recall search uses the plain ingredient name and retrieves at least as many records', () => {
  for (const r of affected) {
    assert.ok(r.after.retrieved >= r.before.retrieved, r.case);
    assert.doesNotMatch(r.after.search, /bisulfate|oxalate|hydrobromide|hyclate|mononitrate|propanediol|phosphate|gluconate|palmitate|tromethamine|pamoate|dihydrochloride/, `${r.case}: ${r.after.search}`);
  }
  assert.equal(row('hydroxyzine hydrochloride tablet').before.retrieved, 0);
  assert.equal(row('hydroxyzine hydrochloride tablet').after.retrieved, 24);
  assert.equal(row('clindamycin palmitate oral solution').before.retrieved, 2);
  assert.equal(row('clindamycin palmitate oral solution').after.retrieved, 50);
});

test('false negatives fixed: five products went from a no-match to a possible match because relevant records are now found', () => {
  const fixed = rows.filter((r) => r.before.finding === 'NO_MATCH_FOUND' && r.after.finding !== 'NO_MATCH_FOUND').map((r) => r.case).sort();
  assert.deepEqual(fixed, ['citalopram hydrobromide tablet', 'clindamycin palmitate oral solution', 'doxycycline hyclate capsule', 'hydroxyzine hydrochloride tablet', 'hydroxyzine pamoate capsule']);
  for (const r of rows) assert.ok(!(r.before.finding !== 'NO_MATCH_FOUND' && r.after.finding === 'NO_MATCH_FOUND'), `${r.case} must not become a no-match`);
});

test('false positives controlled: newly found records are never confirmed; other salts, forms and strengths are ruled out', () => {
  for (const r of affected) for (const n of r.newly_retrieved) {
    assert.doesNotMatch(n.after, /^CONFIRMED/, `${r.case} ${n.recall}`);
    if (n.after.startsWith('POTENTIAL')) assert.match(n.after, /STRENGTH_NOT_STATED/, `${r.case} ${n.recall}: a new possible match only when the record states no comparable strength`);
  }
  const pamoate = row('hydroxyzine pamoate capsule').newly_retrieved.filter((n) => /DIFFERENT_SALT/.test(n.after));
  assert.equal(pamoate.length, 16, 'hydrochloride recalls are ruled out for a pamoate capsule');
  const palmitate = row('clindamycin palmitate oral solution').newly_retrieved.filter((n) => /DIFFERENT_SALT/.test(n.after));
  assert.equal(palmitate.length, 19, 'hydrochloride/phosphate recalls are ruled out for the palmitate solution');
});

test('controls unchanged: a current drug and a mineral product retrieve and classify exactly as before', () => {
  for (const id of ['CONTROL metformin ER tablet (current drug)', 'CONTROL potassium chloride ER tablet']) {
    const r = row(id);
    assert.equal(r.after.search, r.before.search, id);
    assert.equal(r.after.retrieved, r.before.retrieved, id);
    assert.equal(r.after.finding, r.before.finding, id);
    assert.deepEqual(r.changed, [], id);
  }
});

test('documented classification changes (reviewed by hand): kits and skin swabs ruled out; the IV infusion record ruled out by F2', () => {
  const chg = row('chlorhexidine gluconate oral rinse').changed;
  const toNa = chg.filter((c) => (c.after ?? '').startsWith('NOT_APPLICABLE')).map((c) => c.recall).sort();
  // D-0402..0405-2018: Sage Q.Care oral-care kits (toothbrushes, swabs, solutions); D-0570..0572-2022:
  // Prevantics chlorhexidine gluconate + isopropyl alcohol skin swabs. Before F1 the reader did not see
  // "chlorhexidine" in these notices and kept them as possible matches.
  assert.deepEqual(toNa, ['D-0402-2018', 'D-0403-2018', 'D-0404-2018', 'D-0405-2018', 'D-0570-2022', 'D-0571-2022', 'D-0572-2022']);
  for (const c of chg.filter((x) => !(x.after ?? '').startsWith('NOT_APPLICABLE'))) {
    assert.ok((c.before ?? '').startsWith('POTENTIAL') && (c.after ?? '').startsWith('POTENTIAL'), c.recall);
    assert.doesNotMatch(c.after ?? '', /INGREDIENT_NOT_IN_TEXT/, 'the change is only that the ingredient is now read in the notice');
  }
  const iv = row('clindamycin palmitate oral solution').newly_retrieved.find((n) => n.recall === 'D-0639-2016');
  // F2: infusion wording ("in NS", "Homepumps") is now read as non-oral, so this IV infusion is ruled out.
  assert.match(iv?.after ?? '', /^NOT_APPLICABLE .*NON_ORAL_OR_NOT_FINISHED_PRODUCT/);
});

test('RxNorm-wide: F1 reads no ingredient name as an ingredient the app checks or excludes (recorded RxNorm 02-Nov-2026)', () => {
  const rx = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'f1', 'rxnorm_ingredient_names.json'), 'utf8')) as { IN: [string, string][] };
  const cat = JSON.parse(readFileSync(join(ROOT, 'data', 'proposals', 'drug_catalog_0.3.0-proposed.json'), 'utf8')) as { ingredients: { name: string; aliases: string[] }[] };
  const pol = JSON.parse(readFileSync(join(ROOT, 'data', 'exclusion_policy.json'), 'utf8')) as { ingredient_rules: { ingredient: string; names: string[] }[] };
  const app = new Set([...cat.ingredients.flatMap((i) => [i.name, ...i.aliases]), ...pol.ingredient_rules.flatMap((r) => [r.ingredient, ...r.names])].map((n) => n.toLowerCase()));
  const bad = rx.IN.filter(([, n]) => { const a = splitIngredientName(n).name; return a !== beforeF1(n).name && a !== n.toLowerCase() && app.has(a); });
  assert.deepEqual(bad, []);
  assert.equal(rx.IN.length, 14718);
});
