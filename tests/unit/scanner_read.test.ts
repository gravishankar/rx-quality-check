/**
 * Scanner field extraction (Task 4C). Inputs are the REAL outputs of the app's OCR core (PP-OCRv4 via
 * ONNX Runtime) and of ZXing-cpp on SYNTHETIC labels (tests/fixtures/scanner/ocr_lab.json; drug
 * codes real, personal details synthetic). Trap strings below are SYNTHETIC and labeled.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { interpretBarcode, parseGs1 } from '../../mobile/src/scanner/barcode.ts';
import { fixDigitConfusions, readLabelText, segmentWords } from '../../mobile/src/scanner/labelText.ts';
import { readScan } from '../../mobile/src/scanner/readScan.ts';
import { parseNdcInput } from '../../mobile/src/rules/ndc.ts';
import { ROOT } from '../helpers/fixtures.ts';

interface LabFixture {
  labels: {
    file: string;
    truth: { kind: string; name: string; strength: string; form: string; ndc10: string | null; mfr: string | null; lot: string | null; lot_is_synthetic?: boolean; rx_number: string | null; patient: string | null };
    ocr_lines: { text: string; score: number }[];
    barcodes: { format: string; text: string; symbology: string | null }[];
  }[];
}
const lab = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'scanner', 'ocr_lab.json'), 'utf8')) as LabFixture;
const VOCAB = ['METFORMIN', 'ROSUVASTATIN', 'WARFARIN', 'FUROSEMIDE', 'LEVOTHYROXINE', 'SERTRALINE', 'ATORVASTATIN', 'AMLODIPINE', 'LISINOPRIL', 'GABAPENTIN', 'LOSARTAN', 'METOPROLOL', 'OMEPRAZOLE', 'PANTOPRAZOLE', 'HYDROCODONE', 'ACETAMINOPHEN', 'TAMSULOSIN'];
const tenDigitOf = (v: string) => parseNdcInput(v).candidates.map((c) => c.packageNdc);

// ------------------------------------------------------------------ whole-set accuracy (real OCR output)

test('NDC: every printed NDC is read and maps to the true package NDC; no NDC is invented on labels without one', () => {
  let printed = 0;
  let correct = 0;
  for (const l of lab.labels) {
    const r = readScan({ lines: l.ocr_lines, barcodes: [] }, VOCAB);
    const ocrNdc = r.extraction.ndcTexts.find((n) => n.origin === 'OCR');
    if (l.truth.ndc10) {
      printed++;
      if (ocrNdc && tenDigitOf(ocrNdc.value).includes(l.truth.ndc10)) correct++;
    } else {
      assert.equal(ocrNdc, undefined, `${l.file}: an NDC was produced from a label that prints none`);
    }
  }
  assert.equal(correct, printed, `${correct}/${printed}`);
  assert.equal(printed, 28);
});

test('Rx numbers are never NDCs (text and barcodes), and they are kept as private text', () => {
  for (const l of lab.labels) {
    if (!l.truth.rx_number) continue;
    const r = readScan({ lines: l.ocr_lines, barcodes: l.barcodes }, VOCAB);
    for (const n of r.extraction.ndcTexts) assert.ok(!n.value.replace(/\D/g, '').includes(l.truth.rx_number), `${l.file}: Rx number used as NDC`);
    assert.ok(r.barcodes.every((b) => b.kind === 'NOT_A_DRUG_CODE'), `${l.file}: pharmacy barcode accepted as drug code`);
    assert.ok((r.extraction.privateText ?? []).some((t) => t.replace(/\D/g, '').includes(l.truth.rx_number!)), `${l.file}: Rx number not guarded`);
  }
});

test('patient names are never used as identity fields and are always guarded', () => {
  for (const l of lab.labels) {
    if (!l.truth.patient) continue;
    const r = readScan({ lines: l.ocr_lines, barcodes: [] }, VOCAB);
    const squash = (s: string) => s.replace(/[\s-]/g, '');
    const p = squash(l.truth.patient);
    for (const f of [r.extraction.drugName, r.extraction.strength, r.extraction.doseForm, r.extraction.labelerText]) assert.ok(!f || !squash(f.value).includes(p), l.file);
    assert.ok((r.extraction.privateText ?? []).some((t) => squash(t).includes(p)), `${l.file}: patient name not guarded`);
  }
});

test('drug name, strength and form: read correctly on at least 30 of 32 labels; misses are absent, never wrong', () => {
  let ok = 0;
  for (const l of lab.labels) {
    const r = readScan({ lines: l.ocr_lines, barcodes: [] }, VOCAB);
    const name = r.extraction.drugName?.value ?? '';
    const strength = (r.extraction.strength?.value ?? '').replace(/\s/g, '');
    const want = l.truth.strength.replace(/\s/g, '');
    const nameOk = name.includes(l.truth.name);
    const strengthOk = strength === want;
    if (nameOk && strengthOk && r.extraction.doseForm?.value === l.truth.form) ok++;
    // A strength that was read must be the true one, except where the OCR text itself was ambiguous
    // ("10OMG" = 10 or 100); such a value is rejected later by cross-validation (integration test).
    const ambiguousRaw = l.ocr_lines.some((x) => /\d0O(MG|MCG)|\dO0/.test(x.text.toUpperCase()));
    if (r.extraction.strength && l.truth.kind === 'pharmacy_label' && !ambiguousRaw) assert.equal(strength, want, `${l.file}: wrong strength ${strength}`);
  }
  assert.ok(ok >= 30, `${ok}/32`);
});

test('lot: read only when the label prints "LOT"; never on pharmacy labels; never invented', () => {
  // OCR can misread a printed lot (PP-OCRv4 read "JKU4639AB" on one hard label), so a scanned lot is
  // always shown as "read from your label" and must be confirmed by the user (presentation tests).
  let printed = 0;
  let exact = 0;
  for (const l of lab.labels) {
    const r = readScan({ lines: l.ocr_lines, barcodes: [] }, VOCAB);
    if (l.truth.kind === 'pharmacy_label') assert.equal(r.extraction.lot, null, l.file);
    if (l.truth.lot && !l.truth.lot_is_synthetic) {
      printed++;
      assert.ok(r.extraction.lot, `${l.file}: printed lot not read`);
      assert.ok(r.extraction.lot.value.startsWith(l.truth.lot.slice(0, 6)), `${l.file}: ${r.extraction.lot.value}`);
      assert.equal(r.extraction.lot.origin, 'OCR');
      if (r.extraction.lot.value === l.truth.lot) exact++;
    }
    if (!l.truth.lot) assert.equal(r.extraction.lot, null, l.file);
  }
  assert.ok(printed >= 4 && exact >= printed - 1, `lots read exactly: ${exact}/${printed}`);
});

test('manufacturer abbreviation is reported as printed (not mapped to a company)', () => {
  for (const l of lab.labels) {
    if (!l.truth.mfr) continue;
    const r = readScan({ lines: l.ocr_lines, barcodes: [] }, VOCAB);
    assert.ok((r.extraction.labelerText?.value ?? '').replace(/\s/g, '').startsWith(l.truth.mfr.replace(/\s/g, '')), `${l.file}: ${r.extraction.labelerText?.value}`);
    assert.equal(r.extraction.labelerText?.origin, 'OCR');
  }
});

test('barcodes: stock-bottle UPC and carton GS1 DataMatrix give the true NDC (and GS1 lot/expiry); serial numbers are dropped', () => {
  for (const l of lab.labels) {
    if (l.truth.kind === 'pharmacy_label' || l.barcodes.length === 0) continue;
    const r = readScan({ lines: [], barcodes: l.barcodes }, VOCAB);
    const bc = r.extraction.ndcTexts.find((n) => n.origin === 'BARCODE');
    assert.ok(bc, `${l.file}: no barcode NDC`);
    assert.ok(tenDigitOf(bc!.value).includes(l.truth.ndc10!), `${l.file}: ${bc!.value}`);
    if (l.truth.kind === 'carton') {
      assert.equal(r.extraction.lot?.value, l.truth.lot);
      assert.equal(r.extraction.lot?.origin, 'BARCODE');
      assert.match(r.extraction.expiry?.value ?? '', /^2027-08-/);
      assert.ok(!JSON.stringify(r.extraction).includes('SYN') || l.truth.lot_is_synthetic, 'serial number leaked');
    }
  }
});

// ------------------------------------------------------------------ targeted traps (SYNTHETIC strings)

test('SYNTHETIC traps: Rx numbers, phone numbers and dates that look like NDCs are rejected', () => {
  const lines = [
    { text: 'Rx# 6275-6142-02', score: 0.99 }, // SYNTHETIC: Rx number in an NDC layout
    { text: 'RX NO: 62756014202', score: 0.99 },
    { text: '(555) 627-5614', score: 0.99 },
    { text: 'REFILLS 2 BY 10/14/2027', score: 0.99 },
    { text: '62756014202', score: 0.99 }, // unlabeled 11-digit run
    { text: 'METFORMIN HCL ER 500 MG TAB', score: 0.99 },
  ];
  const r = readLabelText(lines, VOCAB);
  assert.equal(r.ndc, null, JSON.stringify(r.ndcCandidates));
  assert.ok(r.ndcCandidates.every((c) => !c.accepted));
  assert.equal(r.strength?.value, '500 MG');
});

test('SYNTHETIC: an NDC labeled "NDC" is accepted; a labeled one wins over an unlabeled hyphenated one', () => {
  const r = readLabelText([{ text: 'LOT 12345-678-90', score: 0.9 }, { text: 'NDC 62756-0142-02', score: 0.95 }], VOCAB);
  assert.equal(r.ndc?.value, '62756-0142-02');
  assert.equal(r.ndc?.anchored, true);
});

test('digit confusions are fixed only inside numbers', () => {
  assert.equal(fixDigitConfusions('ROSUVASTATIN CALCIUM 1OMG TAB'), 'ROSUVASTATIN CALCIUM 10MG TAB');
  assert.equal(fixDigitConfusions('SERTRALINE HCL 1O0 MG'), 'SERTRALINE HCL 100 MG');
  assert.equal(fixDigitConfusions('LOT JKU4639A OIL'), 'LOT JKU4639A OIL');
  assert.equal(segmentWords('METFORMINHCLER500MGTAB', VOCAB), 'METFORMIN HCL ER 500 MG TAB');
  assert.equal(segmentWords('ROSUVASTATINCALCIUM10MGTAB', VOCAB), 'ROSUVASTATIN CALCIUM 10 MG TAB');
});

test('SYNTHETIC: a lot is never inferred from an unlabeled code', () => {
  const r = readLabelText([{ text: 'METFORMIN HCL ER 500 MG TAB', score: 0.99 }, { text: 'JKU4639A', score: 0.99 }], VOCAB);
  assert.equal(r.lot, null);
});

test('barcode interpretation: GS1 parsing, UPC/EAN, and non-drug codes', () => {
  assert.deepEqual([...(parseGs1('0100362756142022172708311 0JKU4639A'.replace(' ', '')) ?? new Map())].slice(0, 1), [['01', '00362756142022']]);
  const gs1 = interpretBarcode({ format: 'DATA_MATRIX', text: '01003627561420221727083110JKU4639A\u001d21SYN000001', symbology: ']d2' });
  assert.ok(gs1.kind === 'NDC_CODE' && gs1.lot === 'JKU4639A' && gs1.expiry === '2027-08-31' && gs1.source === 'GS1');
  assert.ok(!JSON.stringify(gs1).includes('SYN000001'), 'serial must not be kept');
  assert.equal(interpretBarcode({ format: 'EAN_13', text: '0362756142022', symbology: ']E0' }).kind, 'NDC_CODE');
  assert.equal(interpretBarcode({ format: 'UPC_A', text: '362756142023', symbology: null }).kind, 'NOT_A_DRUG_CODE', 'bad check digit');
  assert.equal(interpretBarcode({ format: 'CODE_128', text: '62756014202', symbology: ']C0' }).kind, 'NOT_A_DRUG_CODE', 'plain Code 128 (pharmacy) is never a drug code');
  assert.equal(interpretBarcode({ format: 'EAN_13', text: '4006381333931', symbology: null }).kind, 'NOT_A_DRUG_CODE', 'retail EAN (non-drug)');
  assert.equal(interpretBarcode({ format: 'DATA_MATRIX', text: '0104006381333931', symbology: ']d2' }).kind, 'NOT_A_DRUG_CODE', 'GTIN without "03"');
});

test('a differing barcode and text NDC is reported, not resolved silently', () => {
  const r = readScan({ lines: [{ text: 'NDC 82009-018-10', score: 0.99 }], barcodes: [{ format: 'EAN_13', text: '0362756142022', symbology: ']E0' }] }, VOCAB);
  assert.ok(r.problems.includes('BARCODE_TEXT_NDC_DIFFER'));
  assert.equal(r.extraction.ndcTexts.length, 2, 'both go to the engine, which requires directory confirmation and cross-validation');
});

test('nothing read → NOTHING_READ; text without drug fields → NO_DRUG_FIELDS', () => {
  assert.deepEqual(readScan({ lines: [], barcodes: [] }, VOCAB).problems, ['NOTHING_READ']);
  assert.deepEqual(readScan({ lines: [{ text: 'SYNTHETIC PHARMACY', score: 0.9 }], barcodes: [] }, VOCAB).problems, ['NO_DRUG_FIELDS']);
});

// Drug lines as the app's OCR core read them from the a real pharmacy-vial photo taken by the team (Task 4C,
// build 5 investigation). Only the drug line is reproduced; the photo and its other lines (personal
// details) are not in the repository.
test('real-photo drug lines: "S" read for "5" between a known drug name and MG is corrected', () => {
  for (const t of ['AMLODIPINESMGT', "AMLODIPINE'SMGT", "AMLODIPINES'MGT", 'AMLODIPINE5MGTA']) {
    const r = readLabelText([{ text: t, score: 0.85 }], VOCAB);
    assert.equal(r.drugName?.value, 'AMLODIPINE', t);
    assert.equal(r.strength?.value, '5 MG', t);
  }
});

test('real-photo drug line without a readable strength: the known drug name is still read; strength is left empty', () => {
  const r = readScan({ lines: [{ text: 'AMLODIPINEMGTA', score: 0.84 }], barcodes: [] }, VOCAB);
  assert.equal(r.extraction.drugName?.value, 'AMLODIPINE');
  assert.equal(r.extraction.strength, null, 'a strength is never guessed');
  assert.deepEqual(r.problems, []);
});

test('SYNTHETIC: "S" is not turned into 5 without a known drug name before it, and words ending in S are kept', () => {
  assert.equal(readLabelText([{ text: 'TABS MG', score: 0.9 }], VOCAB).strength, null);
  assert.equal(readLabelText([{ text: 'XYZOLINES MG', score: 0.9 }], VOCAB).strength, null);
  assert.equal(readLabelText([{ text: 'TAKE 1 TABLET DAILY FOR METFORMIN', score: 0.9 }], VOCAB).drugName, null, 'directions are not a drug line');
});

test('SYNTHETIC: a name-only reading needs a whole known drug word, not a fragment', () => {
  assert.equal(readLabelText([{ text: 'AMLOD', score: 0.9 }], VOCAB).drugName, null);
  assert.equal(readLabelText([{ text: 'SYNTHETIC PHARMACY 123 MAIN ST', score: 0.9 }], VOCAB).drugName, null);
});
