/**
 * Task 2 identity rules: NDC keys and text extraction, directory confirmation (NDC-8),
 * cross-validation (OCR-1…5), IR/ER distinctions, user confirmation of uncertain OCR fields,
 * name-only identities (ID-3). Real fixtures unless a test says "synthetic".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNdcsWithKeys, parseNdcInput, productKey, productKeyOfProductNdc, packageKey } from '../../mobile/src/rules/ndc.ts';
import {
  confirmNdcCandidates,
  confirmedLot,
  crossValidate,
  directoryProductFrom,
  fieldsNeedingConfirmation,
  identityFromPrintedFields,
  type NdcDirectoryOutcome,
} from '../../mobile/src/rules/identity.ts';
import type { FieldValue, LabelExtraction } from '../../mobile/src/models/identity.ts';
import { apiNdcRecord, firstNdcRecord, ndc, ndcOutcome, rawOf } from '../helpers/fixtures.ts';

// ---------------------------------------------------------------- NDC keys and text extraction

test('product keys are layout-independent (4-4-2, 5-3-2, 5-4-1, hyphenated 11-digit, bare 11-digit)', () => {
  assert.equal(productKey('0591-0540-05'), '005910540');
  assert.equal(productKey('00591-0540-05'), '005910540'); // hyphenated 5-4-2 as printed in D-058-2013
  assert.equal(productKey('00591054005'), '005910540');
  assert.equal(productKey('62756-142-02'), '627560142');
  assert.equal(productKey('68788-7971-3'), '687887971');
  assert.equal(productKeyOfProductNdc('62756-142'), '627560142');
  assert.equal(productKeyOfProductNdc('65862-0560'), productKey('65862-560-90'));
  assert.equal(packageKey('62756-142-02'), '62756014202');
  assert.equal(productKey('6275614202'), null, 'bare 10 digits are ambiguous and never keyed');
});

test('NDC extraction reads 5-4-2 hyphenated and labeled 11-digit forms from real recall text', () => {
  const a = extractNdcsWithKeys('Hydrocodone Bitartrate and Acetaminophen Tablets USP, 10 mg/500 mg, ... NDC 00591-0540-05.');
  assert.deepEqual(a.ndcs.map((n) => n.productKey), ['005910540']);
  assert.equal(a.unparsedMentions, 0);
  const b = extractNdcsWithKeys('amLODIPine BESYLATE, Tablet, 10 mg, Rx only, Distributed by: AidaPak Service, LLC, NDC 68382012316');
  assert.deepEqual(b.ndcs.map((n) => n.packageKey), ['68382012316']);
});

test('an NDC mention that cannot be parsed is counted, so the list is never treated as complete', () => {
  const r = extractNdcsWithKeys('amneal Metformin Hydrochloride Extended-Release Tablets, USP, Bulk, Distributed by: Amneal ... NDC 53746-0178-BULK');
  assert.equal(r.ndcs.length, 0);
  assert.equal(r.unparsedMentions, 1);
});

test('code_info extraction accepts only labeled NDCs (lot numbers look like NDCs)', () => {
  const r = extractNdcsWithKeys('Lot#: a) 8255-3012, Exp 08/31/2024; NDC 0615-8255-39', { requireLabel: true });
  assert.deepEqual(r.ndcs.map((n) => n.text), ['0615-8255-39']);
});

// ---------------------------------------------------------------- directory confirmation (NDC-8)

const metforminPkgCandidates = () => parseNdcInput('62756014202'); // 11-digit: 5-3-2 and 5-4-1 candidates

test('NDC-8: exactly one candidate confirmed by the directory → RESOLVED (real 200 + real 404)', () => {
  const p = metforminPkgCandidates();
  assert.deepEqual(p.candidates.map((c) => c.packageNdc).sort(), ['62756-0142-2', '62756-142-02']);
  const outcomes = new Map<string, NdcDirectoryOutcome>([
    ['62756-142-02', ndc('ndc_pkg_62756-142-02')],
    ['62756-0142-2', ndc('ndc_pkg_62756-0142-2')],
  ]);
  const r = confirmNdcCandidates(p, outcomes);
  assert.equal(r.kind, 'RESOLVED');
  if (r.kind === 'RESOLVED') {
    assert.equal(r.product.productNdc, '62756-142');
    assert.equal(r.product.release, 'ER');
    assert.equal(r.packageNdc, '62756-142-02');
  }
});

test('NDC-8: all candidates answered "no match" → REJECTED (incorrect NDC)', () => {
  const p = metforminPkgCandidates();
  const nm = ndc('ndc_pkg_62756-0142-2');
  const r = confirmNdcCandidates(p, new Map([['62756-142-02', nm], ['62756-0142-2', nm]]));
  assert.equal(r.kind, 'REJECTED');
});

test('NDC-8: a confirmed candidate plus an unanswered one is UNAVAILABLE, never a silent pick', () => {
  const p = metforminPkgCandidates();
  const down = ndcOutcome({ status: 503, headers: {}, bodyText: '<html>Service Unavailable</html>' });
  const r = confirmNdcCandidates(p, new Map([['62756-142-02', ndc('ndc_pkg_62756-142-02')], ['62756-0142-2', down]]));
  assert.equal(r.kind, 'UNAVAILABLE');
});

test('NDC-8: HTTP 429 on any candidate → RATE_LIMITED', () => {
  const p = metforminPkgCandidates();
  const limited = ndcOutcome({ status: 429, headers: { 'retry-after': '20' }, bodyText: '{}' });
  const r = confirmNdcCandidates(p, new Map([['62756-142-02', limited], ['62756-0142-2', ndc('ndc_pkg_62756-0142-2')]]));
  assert.deepEqual(r, { kind: 'RATE_LIMITED', retryAfterSeconds: 20 });
});

test('NDC-8 / ID-1: two confirmed candidates → AMBIGUOUS, never the first (synthetic pairing)', () => {
  // Synthetic, format-only: no real NDC pair whose 10-digit readings both exist was found in a scan
  // of ~1,500 candidates on 2026-11-12. Two real directory records are attached to the two
  // candidates of an unhyphenated input by rewriting only their package_ndc values.
  const p = parseNdcInput('6275614202'); // 10 digits: three layouts, always ambiguous
  const [c1, c2] = p.candidates;
  const recA = structuredClone(firstNdcRecord('ndc_pkg_62756-142-02'));
  const recB = structuredClone(firstNdcRecord('ndc_prod_68180-721'));
  recA.packaging = [{ package_ndc: c1!.packageNdc, description: 'synthetic' }];
  recB.packaging = [{ package_ndc: c2!.packageNdc, description: 'synthetic' }];
  const ok = (rec: typeof recA): NdcDirectoryOutcome =>
    ndcOutcome({ status: 200, headers: {}, bodyText: JSON.stringify({ meta: { last_updated: '2026-11-11', results: { skip: 0, limit: 1, total: 1 } }, results: [rec] }) });
  const nm = ndc('ndc_pkg_62756-0142-2');
  const r = confirmNdcCandidates(p, new Map(p.candidates.map((c, i) => [c.packageNdc, i === 0 ? ok(recA) : i === 1 ? ok(recB) : nm])));
  assert.equal(r.kind, 'AMBIGUOUS');
  if (r.kind === 'AMBIGUOUS') assert.equal(r.options.length, 2);
});

test('invalid NDC input (store number, date) is INVALID before any lookup', () => {
  assert.equal(confirmNdcCandidates(parseNdcInput('Rx# 1234567'), new Map()).kind, 'INVALID');
  assert.equal(confirmNdcCandidates(parseNdcInput('11/12/2026'), new Map()).kind, 'INVALID');
});

// ---------------------------------------------------------------- cross-validation (OCR-1…5)

const sunMetforminEr = () => directoryProductFrom(firstNdcRecord('ndc_pkg_62756-142-02'));
const aphenaMetforminIr = () => directoryProductFrom(apiNdcRecord('ndc_metformin'));
const lupinAmlodipine10 = () => directoryProductFrom(firstNdcRecord('ndc_prod_68180-721'));
const lupinAmlodipine5 = () => directoryProductFrom(apiNdcRecord('ndc_amlodipine'));

test('directory dosage forms map to release mechanisms (IR / ER / DR) and keep salts', () => {
  assert.equal(sunMetforminEr().release, 'ER');
  assert.equal(aphenaMetforminIr().release, 'IR');
  assert.equal(directoryProductFrom(apiNdcRecord('ndc_omeprazole')).release, 'DR');
  assert.equal(directoryProductFrom(apiNdcRecord('ndc_pantoprazole')).release, 'DR');
  assert.equal(directoryProductFrom(apiNdcRecord('ndc_metoprolol_succinate')).release, 'ER');
  assert.deepEqual(sunMetforminEr().ingredients.map((i) => [i.name, i.salt]), [['metformin', 'hydrochloride']]);
});

test('OCR-1: printed name and strength agree with the confirmed NDC → PASS', () => {
  const cv = crossValidate({ drugName: 'METFORMIN HCL ER', strength: '500 MG', doseForm: 'TABLET' }, sunMetforminEr());
  assert.equal(cv.status, 'PASS');
});

test('OCR-2: a misread NDC that is a valid but different strength (amlodipine 10 vs printed 5) → MISMATCH', () => {
  const cv = crossValidate({ drugName: 'AMLODIPINE BESYLATE', strength: '5 MG', doseForm: 'TAB' }, lupinAmlodipine10());
  assert.equal(cv.status, 'MISMATCH');
  assert.ok(cv.mismatches.includes('STRENGTH_MISMATCH'));
});

test('OCR-2: a misread NDC that is a different drug → MISMATCH', () => {
  const cv = crossValidate({ drugName: 'LISINOPRIL', strength: '10 MG', doseForm: 'TABLET' }, lupinAmlodipine10());
  assert.ok(cv.mismatches.includes('INGREDIENT_MISMATCH'));
});

test('OCR-4: "METFORMIN ER 500" printed but the NDC is immediate-release → MISMATCH (and vice versa)', () => {
  const a = crossValidate({ drugName: 'METFORMIN ER', strength: '500MG', doseForm: null }, aphenaMetforminIr());
  assert.ok(a.mismatches.includes('RELEASE_MISMATCH'));
  const b = crossValidate({ drugName: 'METFORMIN HCL', strength: '500MG', doseForm: 'TABLET' }, sunMetforminEr());
  assert.equal(b.status, 'NEEDS_CONFIRMATION', 'ER product, label silent on release: user must confirm');
  assert.ok(b.confirmations.includes('RELEASE_NOT_PRINTED'));
});

test('OCR-5: levothyroxine "175 MCG" equals FDA ".175 mg/1"; "175 MG" does not', () => {
  const levo = directoryProductFrom(apiNdcRecord('ndc_levothyroxine'));
  assert.equal(crossValidate({ drugName: 'LEVOTHYROXINE SODIUM', strength: '175 MCG', doseForm: 'TABLET' }, levo).status, 'PASS');
  assert.ok(crossValidate({ drugName: 'LEVOTHYROXINE SODIUM', strength: '175 MG', doseForm: 'TABLET' }, levo).mismatches.includes('STRENGTH_MISMATCH'));
});

test('combination product cross-validation needs both ingredients and both strengths', () => {
  const camber = directoryProductFrom(firstNdcRecord('ndc_prod_31722-997'));
  assert.equal(crossValidate({ drugName: 'HYDROCODONE/APAP', strength: '10-325MG', doseForm: 'TAB' }, camber).status, 'PASS');
  assert.ok(crossValidate({ drugName: 'HYDROCODONE/APAP', strength: '10-500MG', doseForm: 'TAB' }, camber).mismatches.includes('STRENGTH_MISMATCH'));
  assert.ok(crossValidate({ drugName: 'HYDROCODONE BITARTRATE', strength: '10 MG', doseForm: 'TAB' }, camber).mismatches.includes('COMBINATION_MISMATCH'));
});

test('dose form mismatch (capsule printed, tablet NDC) → MISMATCH', () => {
  const cv = crossValidate({ drugName: 'AMLODIPINE', strength: '5 MG', doseForm: 'CAPSULE' }, lupinAmlodipine5());
  assert.ok(cv.mismatches.includes('DOSE_FORM_MISMATCH'));
});

// ---------------------------------------------------------------- user confirmation of OCR fields

const fv = (value: string, origin: FieldValue<string>['origin'], confidence: number | null, confirmedByUser = false): FieldValue<string> => ({
  value,
  origin,
  confidence,
  confirmedByUser,
});

function extraction(over: Partial<LabelExtraction> = {}): LabelExtraction {
  return {
    ndcTexts: [],
    drugName: null,
    strength: null,
    doseForm: null,
    labelerText: null,
    lot: null,
    expiry: null,
    containerType: 'PHARMACY_VIAL',
    ...over,
  };
}

test('low-confidence OCR fields and any unconfirmed lot require user confirmation', () => {
  const x = extraction({
    ndcTexts: [fv('62756-142-02', 'OCR', 0.97)],
    drugName: fv('METFORMIN HCL ER', 'OCR', 0.95),
    strength: fv('500 MG', 'OCR', 0.62),
    lot: fv('JKU4639A', 'OCR', 0.99),
  });
  assert.deepEqual(fieldsNeedingConfirmation(x, { ndcCrossValidated: true }).sort(), ['lot', 'strength']);
  assert.deepEqual(fieldsNeedingConfirmation(x, { ndcCrossValidated: false }).sort(), ['lot', 'ndc', 'strength']);
});

test('barcode-read NDCs and user-entered fields need no OCR confirmation', () => {
  const x = extraction({ ndcTexts: [fv('62756-142-02', 'BARCODE', null)], drugName: fv('metformin er', 'USER', null) });
  assert.deepEqual(fieldsNeedingConfirmation(x, { ndcCrossValidated: false }), []);
});

test('an OCR lot is used for matching only after explicit user confirmation', () => {
  assert.equal(confirmedLot(extraction({ lot: fv('JKU4639A', 'OCR', 0.99) })), null);
  assert.equal(confirmedLot(extraction({ lot: fv('JKU4639A', 'OCR', 0.99, true) })), 'JKU4639A');
});

// ---------------------------------------------------------------- name-only identity (ID-3)

const LEX = ['metformin', 'amlodipine', 'hydrocodone', 'acetaminophen', 'warfarin', 'metoprolol'];

test('ID-3: name, strength and form only → CLINICAL_DRUG identity (never product level)', () => {
  const r = identityFromPrintedFields({ drugName: 'METFORMIN ER', strength: '500 MG', doseForm: 'TABLET' }, LEX, null);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.identity.level, 'CLINICAL_DRUG');
    assert.equal(r.identity.productNdc, null);
    assert.equal(r.identity.release, 'ER');
  }
});

test('ID-3: unprinted release stays UNSPECIFIED (not assumed IR)', () => {
  const r = identityFromPrintedFields({ drugName: 'METFORMIN HCL', strength: '500 MG', doseForm: 'TABLET' }, LEX, null);
  assert.ok(r.ok && r.identity.release === 'UNSPECIFIED');
});

test('combination label in pharmacy shorthand yields both ingredients with their strengths', () => {
  const r = identityFromPrintedFields({ drugName: 'HYDROCODONE/APAP', strength: '10-325MG', doseForm: 'TABLET' }, LEX, null);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.identity.ingredients.map((i) => [i.name, i.strength?.value]), [['hydrocodone', 10], ['acetaminophen', 325]]);
  }
});

test('missing information is reported per field', () => {
  const r = identityFromPrintedFields({ drugName: 'METFORMIN', strength: null, doseForm: null }, LEX, null);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.missing.sort(), ['doseForm', 'strength']);
});

test('fixture sanity: the stored 404 body is a real openFDA NOT_FOUND', () => {
  assert.equal(rawOf('ndc_pkg_62756-0142-2').status, 404);
});
