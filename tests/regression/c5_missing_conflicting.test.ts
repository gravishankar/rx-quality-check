/**
 * Correctness finding C5 (review against b9c5989): missing or conflicting label information must
 * never silently become a confirmed identity. Products are real openFDA NDC Directory records;
 * printed label texts and extractions are SYNTHETIC (format-only).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossValidate, directoryProductFrom } from '../../mobile/src/rules/identity.ts';
import { requiredConfirmations } from '../../mobile/src/engine/runner.ts';
import type { LabelExtraction, FieldValue } from '../../mobile/src/models/identity.ts';
import { firstNdcRecord, productIdentity } from '../helpers/fixtures.ts';

const aliases = { apap: 'acetaminophen' };
// Real listing: Camber hydrocodone bitartrate/acetaminophen 10/325 mg tablet (31722-997).
const camber = () => directoryProductFrom(firstNdcRecord('ndc_prod_31722-997'));
// Real listing with the ingredients' strengths swapped (SYNTHETIC perturbation of a real record).
const swappedCamber = () => {
  const p = camber();
  const [a, b] = p.ingredients;
  return { ...p, ingredients: [{ ...a!, strength: b!.strength }, { ...b!, strength: a!.strength }] };
};

test('C5 cross-validation: label strengths are paired with their own ingredient (swapped listing is a mismatch)', () => {
  const printed = { drugName: 'HYDROCODONE BITARTRATE AND ACETAMINOPHEN', strength: '10 MG/325 MG', doseForm: 'TABLET' };
  assert.notEqual(crossValidate(printed, camber()).status, 'MISMATCH');
  assert.equal(crossValidate(printed, swappedCamber()).status, 'MISMATCH');
  assert.ok(crossValidate(printed, swappedCamber()).mismatches.includes('STRENGTH_MISMATCH'));
});

test('C5 cross-validation: a label that uses an alias ("APAP") matches its own product and still pairs strengths', () => {
  const printed = { drugName: 'HYDROCODONE/APAP', strength: '10-325 MG', doseForm: 'TABLET' };
  assert.notEqual(crossValidate(printed, camber(), aliases).status, 'MISMATCH');
  assert.equal(crossValidate(printed, swappedCamber(), aliases).status, 'MISMATCH');
});

const fv = (value: string, origin: FieldValue<string>['origin'] = 'BARCODE'): FieldValue<string> => ({ value, origin, confidence: 1, confirmedByUser: false }) as FieldValue<string>;
const extraction = (ndcs: string[]): LabelExtraction => ({
  ndcTexts: ndcs.map((n) => fv(n)), drugName: fv('HYDROCODONE BITARTRATE AND ACETAMINOPHEN', 'OCR'), strength: fv('10 MG/325 MG', 'OCR'), doseForm: fv('TABLET', 'OCR'),
  labelerText: null, lot: null, expiry: null, containerType: 'ORIGINAL_PACKAGE',
});

test('C5 two different NDCs read from one label → the NDC must be confirmed by the patient', () => {
  const id = productIdentity(firstNdcRecord('ndc_prod_31722-997'), '31722-997-01');
  assert.ok(!requiredConfirmations(id, extraction(['31722-997-01']), false).includes('ndc'), 'guard: one NDC read');
  assert.ok(!requiredConfirmations(id, extraction(['31722-997-01', '31722099701']), false).includes('ndc'), 'guard: the same NDC in two formats');
  assert.ok(requiredConfirmations(id, extraction(['31722-997-01', '31722-998-01']), false).includes('ndc'));
});

test('C5 guard: an identity is always confirmed as a whole', () => {
  const id = productIdentity(firstNdcRecord('ndc_prod_31722-997'), '31722-997-01');
  assert.ok(requiredConfirmations(id, null, false).includes('identity'));
});

test('C5 known limitation (recorded, not fixed here): the pharmacy abbreviation "BIT" (bitartrate) is read as an extra ingredient → mismatch, never a pass', () => {
  // Conservative: the NDC is set aside and the product is checked by ingredient/strength/form.
  const r = crossValidate({ drugName: 'HYDROCODONE BIT/APAP', strength: '10-325 MG', doseForm: 'TABLET' }, camber(), aliases);
  assert.equal(r.status, 'MISMATCH');
});
