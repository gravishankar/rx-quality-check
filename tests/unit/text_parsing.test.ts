/**
 * Conservative free-text parsing: strengths, dose form / release markers, ingredient sets and lots,
 * on strings copied verbatim from real FDA enforcement records (recall numbers cited).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStrengthExpressions, parsePrintedStrength } from '../../mobile/src/rules/strength.ts';
import { compareRelease, formEvidenceFromText, productSegment } from '../../mobile/src/rules/doseForm.ts';
import { readIngredientsFromText, splitIngredientName } from '../../mobile/src/rules/ingredients.ts';
import { compareLot, normalizeLot, parseLotScope } from '../../mobile/src/rules/lot.ts';

const comps = (t: string) => extractStrengthExpressions(t).map((e) => e.components.map((c) => `${c.value}${c.unit}/${c.per}`).join('+'));

// ---------------------------------------------------------------- strengths

test('strengths: single, combination, shared-unit combination, thousands separators', () => {
  assert.deepEqual(comps('Metformin HCl Extended-Release Tablets, USP, 500 mg, Rx Only, 500-count bottle'), ['500MG/1']); // D-0325-2021
  assert.deepEqual(comps('Hydrocodone Bitartrate and Acetaminophen Tablets USP, CIII, 10 mg/ 660 mg, 100 count'), ['10MG/1+660MG/1']); // D-1053-2014
  assert.deepEqual(comps('Exforge HCT (amlodipine, valsartan, hydrochlorothiazide) 5/160/25 mg, Rx only'), ['5MG/1+160MG/1+25MG/1']); // D-332-2014
  assert.deepEqual(comps('Invokamet (canagliflozin and metformin HCl) tablets, 150 mg/1,000 mg, 60-count'), ['150MG/1+1000MG/1']); // D-0115-2017
  assert.deepEqual(comps('Levothyroxine Sodium Tablets USP, 150 mcg, packaged in'), ['0.15MG/1']); // D-0120-2025
});

test('strengths: liquids normalize to per-mL; package volumes are not strengths', () => {
  assert.deepEqual(comps('Furosemide Injection, USP, 40 mg/4mL (10 mg/mL), 4 ml Single-Dose Vial'), ['10MG/ML', '10MG/ML']); // D-314-2013
  assert.deepEqual(comps('Riomet (metformin hydrochloride) Oral Solution Cherry Flavored 500 mg /5 mL, 4 fl. oz.'), ['100MG/ML']); // D-0109-2018
  assert.deepEqual(comps('RIOMET ER (...), 500 mg per 5 mL 16 oz.'), ['100MG/ML']); // D-0002-2021
});

test('strengths: bare fractions are not strengths; pharmacy hyphen shorthand only on labels', () => {
  assert.deepEqual(comps('METOPROLOL TARTRATE Tablet, 12.5 mg (1/2 of 25 mg)'), ['12.5MG/1', '25MG/1']); // D-678-2014
  assert.deepEqual(parsePrintedStrength('10-325MG')?.map((s) => s.value), [10, 325]);
  assert.equal(parsePrintedStrength('see label'), null);
});

// ---------------------------------------------------------------- form and release

test('release markers: ER / DR / IR variants, absent → UNSPECIFIED, contradictory → CONFLICTING', () => {
  const rel = (t: string) => formEvidenceFromText(productSegment(t)).release;
  assert.equal(rel('Metformin Hydrochloride Extended - Release Tablets, USP, 500 mg'), 'ER'); // D-1331-2020
  assert.equal(rel('Metformin HCL E/R 500 mg, 90 Tabs'), 'ER'); // D-0058-2021
  assert.equal(rel('PANTOPRAZOLE SODIUM DR Tablet, 20 mg'), 'DR'); // D-689-2014
  assert.equal(rel('Omeprazole Delayed-release Capsules, USP, 20mg'), 'DR'); // D-0525-2025
  assert.equal(rel('Metformin Hydrochloride Tablets, USP 1000 mg, 500-count'), 'UNSPECIFIED'); // D-0427-2018
  assert.equal(rel('metFORMIN ER Tablets, 500 mg, Rx, Packaged and labeled as metFORMIN Immediate Release (IR), Repackaged By: Shamrock'), 'CONFLICTING'); // D-1448-2014
  // "Dr. Reddy's" in the firm clause is not a delayed-release marker.
  assert.equal(rel("Omeprazole 20 mg capsules, Manufactured by: Dr. Reddy's Laboratories Limited"), 'UNSPECIFIED');
});

test('release comparison is conservative: silence never proves ER/DR', () => {
  assert.equal(compareRelease('ER', 'ER'), 'SAME');
  assert.equal(compareRelease('IR', 'ER'), 'DIFFERENT');
  assert.equal(compareRelease('ER', 'UNSPECIFIED'), 'UNKNOWN');
  assert.equal(compareRelease('IR', 'UNSPECIFIED'), 'COMPATIBLE');
  assert.equal(compareRelease('ER', 'CONFLICTING'), 'UNKNOWN');
});

test('non-oral and non-finished signals; bulk tablets in a drum are still tablets', () => {
  assert.deepEqual(formEvidenceFromText('Furosemide Injection, USP, 40 mg/4mL').nonOral, ['INJECTION']);
  assert.deepEqual(formEvidenceFromText('Levothyroxine Sodium (T4) active pharmaceutical ingredient packaged in varying grams').nonOral, ['ACTIVE_PHARMACEUTICAL_INGREDIENT']);
  assert.deepEqual(formEvidenceFromText('Furosemide 20 mg/mL svn Sol, Rx').nonOral, ['INHALATION']); // D-0405-2016
  const drum = formEvidenceFromText('PIO&METFORMIN 15/1000 mg Tab 1 (...) tablets, packaged in a fiber drum'); // D-0102-2019
  assert.deepEqual(drum.nonOral, []);
  assert.ok(drum.forms.includes('TABLET'));
});

// ---------------------------------------------------------------- ingredient sets

test('salts are split from base names; synonyms map to the RxNorm moiety', () => {
  assert.deepEqual(splitIngredientName('ATORVASTATIN CALCIUM TRIHYDRATE'), { name: 'atorvastatin', salt: 'calcium' });
  assert.deepEqual(splitIngredientName('METOPROLOL SUCCINATE'), { name: 'metoprolol', salt: 'succinate' });
  assert.deepEqual(splitIngredientName('MYCOPHENOLIC ACID'), { name: 'mycophenolate', salt: null });
});

test('combination partners are detected only through explicit connectors (real descriptions)', () => {
  const p = (t: string, n: string[]) => readIngredientsFromText(productSegment(t), n).partners;
  assert.deepEqual(p('Amlodipine and Benazepril HCl Capsules USP 2.5 mg/10 mg', ['amlodipine']), ['benazepril']); // D-0542-2025
  assert.deepEqual(p('xigduo XR (dapgliflozin/metformin HCl extended-release) tablets 10 mg/1000 mg', ['metformin']), ['dapgliflozin']); // D-0435-2021
  assert.deepEqual(p('Exforge HCT (amlodipine, valsartan, hydrochlorothiazide) 5/160/25 mg', ['amlodipine']), ['valsartan']);
  assert.deepEqual(p('Olmesartan Medoxomil, Amlodipine, and Hydrochlorothiazide Tablets 40 mg/10 mg/12.5mg', ['amlodipine']).sort(), ['hydrochlorothiazide', 'olmesartan']); // D-0077-2027
  assert.deepEqual(p('PIO&METFORMIN 15/1000 mg Tab', ['metformin']), ['pio']);
  assert.deepEqual(p('Lupin Hydrocodone Bitartrate and Homatropine Methylbromide Tablets', ['hydrocodone', 'acetaminophen']), ['homatropine']); // D-0599-2018
  // The exact catalog combination is not a partner of itself; single-ingredient text has none.
  assert.deepEqual(p('Hydrocodone Bitartrate and Acetaminophen Tablets, USP 10 mg/325 mg', ['hydrocodone', 'acetaminophen']), []);
  assert.deepEqual(p('Preferred Pharmaceuticals Inc., Metformin HCl, Extended Release Tab. USP 500 mg', ['metformin']), []); // D-0385-2021
  assert.deepEqual(p('Tamsulosin Hydrochloride Capsules, USP 0.4 mg Rx only', ['tamsulosin']), []);
});

test('text salt is read for salt-specific identities (metoprolol tartrate vs succinate)', () => {
  const r = readIngredientsFromText('METOPROLOL TARTRATE Tablet, 12.5 mg', ['metoprolol']); // D-678-2014
  assert.equal(r.salts.metoprolol, 'tartrate');
});

// ---------------------------------------------------------------- lots (LOT-1…4)

test('LOT-1: real code_info formats → listed lots found', () => {
  assert.equal(compareLot('JKU4639A', 'Lot #JKU4639A, Exp 10/2022'), 'LOT_LISTED'); // D-0325-2021
  assert.equal(compareLot('R2100288', 'Batches: a)R2100283, R2100288, R2100289, Exp. Date 2/28/2023'), 'LOT_LISTED'); // D-0374-2023
  assert.equal(compareLot('JKX2953A', 'Lots #: JKX2749A, JKX2803A, JKX2952A, JKX2953A, JKX2954A & JKX3224A, Exp 6/2032'), 'LOT_LISTED'); // D-0372-2021
  assert.equal(compareLot('17240390', 'Lot #  17240389, exp. date Feb-26 17240390, exp. date Feb-26'), 'LOT_LISTED'); // D-0339-2025
});

test('LOT-2: a lot absent from the listing is LOT_NOT_FOUND_IN_LISTING (never "not affected")', () => {
  assert.equal(compareLot('JKU9999Z', 'Lot #JKU4639A, Exp 10/2022'), 'LOT_NOT_FOUND_IN_LISTING');
});

test('LOT-3: no lot provided → LOT_UNKNOWN', () => {
  assert.equal(compareLot(null, 'Lot #JKU4639A'), 'LOT_UNKNOWN');
  assert.equal(compareLot('   ', 'Lot #JKU4639A'), 'LOT_UNKNOWN');
});

test('LOT-4: normalization of case, spaces and a leading "Lot" label, without fuzzy matching', () => {
  assert.equal(normalizeLot('lot # jku 4639a'), 'JKU4639A');
  assert.equal(compareLot('lot: jku4639a', 'Lot #JKU4639A'), 'LOT_LISTED');
  assert.equal(compareLot('JKU4639B', 'Lot #JKU4639A'), 'LOT_NOT_FOUND_IN_LISTING', 'one character off is not a match');
  // Hyphen differences and partial codes are only "possibly listed".
  assert.equal(compareLot('15617VP02', 'Lot #: 15617VP03, 15617VP01, 15617VP-02, Exp 7/31/2019'), 'LOT_POSSIBLY_LISTED'); // D-1178-2018
  assert.equal(compareLot('J0668398', 'Lot #: J0668398-121422, Exp. Date 12/31/2023'), 'LOT_POSSIBLY_LISTED'); // D-0495-2023
});

test('lot scope: all lots, conditional all lots, patterns, unknown', () => {
  assert.deepEqual(parseLotScope('all lots'), { kind: 'ALL_LOTS' }); // D-0405-2016
  assert.deepEqual(parseLotScope('All lots remaining within expiry'), { kind: 'ALL_LOTS' }); // D-1303-2020
  assert.equal(parseLotScope('All lots repackaged and distributed between 01/05/12 to 02/12/15').kind, 'ALL_LOTS_CONDITIONAL'); // D-761-2015
  const pat = parseLotScope('Lot #: All that begin with the letter "C" a) C1160712C, Exp'); // D-138-2013
  assert.equal(pat.kind, 'LOT_SPECIFIC');
  if (pat.kind === 'LOT_SPECIFIC') assert.equal(pat.hasPatterns, true);
  assert.deepEqual(parseLotScope(''), { kind: 'UNKNOWN' });
  const spec = parseLotScope('Lot #JKU4639A, Exp 10/2022');
  assert.ok(spec.kind === 'LOT_SPECIFIC' && spec.lots.includes('JKU4639A') && !spec.lots.includes('2022'));
});
