/**
 * Task 4C success path, end to end without typing: real OCR/barcode output (SYNTHETIC labels) →
 * readScan → production composition root (state machine, safety gates, recall engine) →
 * confirmation → result, against REAL recorded openFDA/RxNav/DailyMed responses
 * (tests/fixtures/scanner/cassette.json; an unrecorded request fails the test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCassette, replayTransport } from '../../scripts/lib/cassette.ts';
import { SCAN_CASSETTE, runLabelFlow } from '../../scripts/scanner_lab/scan_flow.ts';
import { ROOT } from '../helpers/fixtures.ts';

const lab = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'scanner', 'ocr_lab.json'), 'utf8')) as {
  labels: (Parameters<typeof runLabelFlow>[0] & { truth: { drug_id: string; kind: string; ndc10: string | null; lot: string | null; rx_number: string | null; patient: string | null } })[];
};
const cassette = loadCassette(SCAN_CASSETTE);

// Expected outcomes (recorded FDA data of 2026-11-12). "possible" for metformin pharmacy labels because
// the lot is not printed; "confirmed" only where the lot JKU4639A is read from the stock bottle/carton.
const EXPECTED: Record<string, (kind: string, hasNdc: boolean) => string> = {
  metformin_er: (k) => (k === 'pharmacy_label' ? 'EXPLAIN:POTENTIAL' : 'EXPLAIN:CONFIRMED'),
  rosuvastatin: (_k, hasNdc) => (hasNdc ? 'EXPLAIN:NO_MATCH' : 'EXPLAIN:POTENTIAL'),
  warfarin: () => 'EXCLUDED',
  levothyroxine: () => 'EXPLAIN:POTENTIAL',
  sertraline: () => 'UNSUPPORTED',
};

for (const useBarcodes of [false, true]) {
  test(`scanned labels reach the expected recall-check outcome without typing (barcodes ${useBarcodes ? 'on' : 'off'})`, async () => {
    for (const l of lab.labels) {
      const f = await runLabelFlow(l, replayTransport(cassette), { useBarcodes });
      const got = f.category ? `${f.finalState}:${f.category}` : f.finalState;
      if (l.truth.drug_id === 'furosemide_sol') {
        // A label whose strength is read ambiguously ("10OMG" with PP-OCRv3) must never give a result
        // for a wrong strength; PP-OCRv4 reads all three cleanly.
        assert.ok(got === 'EXPLAIN:NO_MATCH' || (l.file.includes('hard') && f.finalState === 'NEEDS_CLARIFICATION'), `${l.file}: ${got}`);
        continue;
      }
      let want = EXPECTED[l.truth.drug_id]!(l.truth.kind, l.truth.ndc10 !== null);
      // A misread lot (one hard label: "JKU4639AB") is not in the recall's lot list, so the honest
      // outcome is "possible", never "confirmed" and never "no match".
      const lotLine = l.ocr_lines.find((x) => /LOT/i.test(x.text))?.text ?? '';
      if (want === 'EXPLAIN:CONFIRMED' && !(useBarcodes && l.truth.kind === 'carton') && l.truth.lot && !new RegExp(`${l.truth.lot}(?![A-Z0-9])`).test(lotLine)) want = 'EXPLAIN:POTENTIAL';
      assert.equal(got, want, `${l.file}: ${got}`);
    }
  });
}

test('when the NDC is legible, the product is matched in FDA records (no NDC typed)', async () => {
  for (const l of lab.labels) {
    if (!l.truth.ndc10 || l.truth.drug_id === 'warfarin' || l.truth.drug_id === 'sertraline') continue;
    if (l.file.includes('furosemide_sol_hard')) continue;
    const f = await runLabelFlow(l, replayTransport(cassette), { useBarcodes: false });
    const product = f.confirmScreen?.fields.find((x) => x.key === 'product');
    assert.equal(product?.evidence, 'VERIFIED_SOURCE', l.file);
    assert.equal(product?.value, l.truth.ndc10, l.file);
    assert.equal(f.confirmScreen?.notice, null, l.file);
  }
});

test('without a legible NDC, fields are shown as read from the label (never as FDA-verified or typed)', async () => {
  for (const l of lab.labels.filter((x) => x.truth.ndc10 === null)) {
    const f = await runLabelFlow(l, replayTransport(cassette), { useBarcodes: false });
    const fields = f.confirmScreen?.fields ?? [];
    assert.equal(fields.find((x) => x.key === 'product')?.evidence, 'UNAVAILABLE', l.file);
    assert.equal(fields.find((x) => x.key === 'ingredients')?.evidence, 'SCANNED', l.file);
  }
});

test('privacy: no Rx number, patient name or lot appears in any request', async () => {
  for (const l of lab.labels)
    for (const useBarcodes of [false, true]) {
      const f = await runLabelFlow(l, replayTransport(cassette), { useBarcodes });
      const all = f.requests.join('\n').toUpperCase();
      if (l.truth.rx_number) assert.ok(!all.includes(l.truth.rx_number), `${l.file}: Rx number sent`);
      if (l.truth.patient) for (const part of l.truth.patient.split(/[\s-]+/).filter((p) => p.length >= 4)) assert.ok(!all.includes(part), `${l.file}: patient name part sent`);
      assert.ok(!all.includes('JKU4639A'), `${l.file}: lot sent`);
    }
});
