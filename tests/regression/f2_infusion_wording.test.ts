/**
 * F2 (scheduled after the shared accuracy fixes): recognise IV infusion wording as non-oral, so an
 * infusion recall is not kept as a possible match for an oral product. Real recall text from openFDA
 * (D-0639-2016, tests/fixtures/f1/cassette.json). Guard texts marked SYNTHETIC are format-only.
 * Errs toward keeping records: only explicit infusion wording counts; "syringe" alone does not
 * (oral syringes exist).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formEvidenceFromText } from '../../mobile/src/rules/doseForm.ts';

const nonOral = (t: string) => formEvidenceFromText(t).nonOral;

test('F2: the real infusion notice D-0639-2016 is read as non-oral', () => {
  assert.ok(nonOral('CLINDAMYCIN 120MG in NS, Package in 20ML Homepumps, Rx Only. SENTARA HOME HEALTH SENTARA RX, 535 Independence Pkwy ste.300, Chesapeake, VA 23320-5176.').includes('INJECTION'));
});

for (const t of ['Vancomycin 1 g in D5W 250 mL bag (SYNTHETIC)', 'Cefazolin 2 g in 0.9% Sodium Chloride 100 mL IVPB (SYNTHETIC)', 'TPN 2:1, 200 ml Bags (SYNTHETIC)', 'Clindamycin 900 mg/50 mL premixed infusion (SYNTHETIC)', 'Ampicillin in LR elastomeric pump (SYNTHETIC)']) {
  test(`F2: infusion wording is non-oral — ${t}`, () => assert.ok(nonOral(t).includes('INJECTION'), t));
}

for (const t of [
  'Clindamycin Palmitate Hydrochloride for Oral Solution, USP, 75 mg/5 mL, 100 mL bottle (SYNTHETIC)',
  'Amoxicillin Oral Suspension 250 mg/5 mL with oral syringe (SYNTHETIC)',
  'Metformin HCl Tablets 500 mg, in bottles of 100 (SYNTHETIC)',
  'Potassium Chloride Extended-Release Tablets 10 mEq, NSAID-free (SYNTHETIC)',
  'Lisinopril Tablets, 10 mg, Manufactured in India (SYNTHETIC)',
]) {
  test(`F2 guard: oral wording stays oral — ${t}`, () => assert.deepEqual(nonOral(t), [], t));
}
