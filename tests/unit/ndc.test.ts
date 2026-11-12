import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNdcInput,
  toNdc11,
  candidatesFromNdc11,
  gs1CheckDigitValid,
  extractNdcsFromText,
  productNdcOf,
} from '../../scripts/lib/ndc.ts';

// Real identifiers below come from live API responses captured in tests/fixtures/api
// (openFDA NDC Directory / Enforcement, RxNav ndcstatus) on 2026-11-12.
// Identifiers marked "format-only" are synthetic digit strings used solely to exercise layout
// arithmetic; they make no claim that such a product exists.

test('hyphenated 5-3-2 NDC converts to 11-digit form (real: Sun metformin ER, RxNav ndc11 62756014202)', () => {
  assert.equal(toNdc11('62756-142-02'), '62756014202');
});

test('hyphenated 4-4-2 NDC converts to 11-digit form (real: 0310-6280-30 from recall D-0435-2021)', () => {
  assert.equal(toNdc11('0310-6280-30'), '00310628030');
});

test('format-only: hyphenated 5-4-1 NDC pads the package segment', () => {
  assert.equal(toNdc11('12345-6789-1'), '12345678901');
});

test('11-digit input yields only candidates whose padding position is zero', () => {
  const c = candidatesFromNdc11('62756014202').map((x) => x.packageNdc);
  // L1 = 6 (no 4-4-2), P1 = 0 (5-3-2), K1 = 0 (5-4-1)
  assert.deepEqual(c, ['62756-142-02', '62756-0142-2']);
});

test('11-digit input with an ambiguous padding is flagged ambiguous, never auto-resolved', () => {
  const r = parseNdcInput('62756014202');
  assert.equal(r.kind, 'DIGITS_11');
  assert.equal(r.ambiguous, true);
  assert.equal(r.candidates.length, 2);
});

test('11-digit input with no zero padding is invalid', () => {
  const r = parseNdcInput('12345678912'); // format-only
  assert.equal(r.kind, 'INVALID');
  assert.equal(r.candidates.length, 0);
});

test('hyphenated 10-digit input is unambiguous and preserves the published layout', () => {
  const r = parseNdcInput('NDC: 0310-6280-30');
  assert.equal(r.kind, 'HYPHENATED_10');
  assert.equal(r.ambiguous, false);
  assert.equal(r.candidates[0]!.productNdc, '0310-6280');
  assert.equal(r.candidates[0]!.layout, '4-4-2');
});

test('hyphenated 11-digit (5-4-2) input expands to candidates', () => {
  const r = parseNdcInput('00093-1075-01'); // NDC format example quoted in Document A §UC-2
  assert.equal(r.kind, 'HYPHENATED_11');
  assert.ok(r.candidates.some((c) => c.packageNdc === '0093-1075-01'));
});

test('unhyphenated 10-digit input is always ambiguous across the three layouts', () => {
  const r = parseNdcInput('6275614202');
  assert.equal(r.kind, 'DIGITS_10');
  assert.equal(r.ambiguous, true);
  assert.deepEqual(
    r.candidates.map((c) => c.layout),
    ['4-4-2', '5-3-2', '5-4-1'],
  );
});

test('real UPC-A from openFDA (316729047159) passes GS1 check and yields the printed NDC as a candidate', () => {
  assert.equal(gs1CheckDigitValid('316729047159'), true);
  const r = parseNdcInput('316729047159');
  assert.equal(r.kind, 'UPC_A');
  assert.ok(r.candidates.some((c) => c.packageNdc === '16729-047-15'));
});

test('real 13-digit UPC (0362756142015, recall D-0325-2021) yields 62756-142-01 as a candidate', () => {
  const r = parseNdcInput('0362756142015');
  assert.equal(r.kind, 'EAN_13');
  assert.ok(r.candidates.some((c) => c.packageNdc === '62756-142-01'));
});

test('a single corrupted digit in a barcode fails the check digit instead of producing a wrong drug', () => {
  const r = parseNdcInput('316729047158');
  assert.equal(r.kind, 'INVALID');
  assert.match(r.error ?? '', /check digit/);
});

test('non-NDC numbers commonly printed on pharmacy labels are rejected', () => {
  for (const s of ['0123456', '2026-11-12', '1-800-555-0100', 'RX#']) {
    assert.equal(parseNdcInput(s).kind, 'INVALID', s);
  }
});

test('extractNdcsFromText finds NDCs in real recall product_description text', () => {
  const text =
    'Atorvastatin Calcium Tablets USP, 80 mg, Rx Only, a). 90-count(NDC 67877-514-90), b). 500-count';
  assert.deepEqual(extractNdcsFromText(text), ['67877-514-90']);
});

test('extractNdcsFromText ignores ZIP codes, dates and phone numbers', () => {
  const text = 'Distributed by X, Cranbury, NJ 08512; Exp 10/2022; call 1-800-555-0100; Lot 12345-678';
  assert.deepEqual(extractNdcsFromText(text), []);
});

test('productNdcOf strips the package segment', () => {
  assert.equal(productNdcOf('62756-142-02'), '62756-142');
});
