import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeStrength, rxNavStrengths, sameStrength } from '../../scripts/lib/strength.ts';
import { summarizeSplEstablishments } from '../../scripts/lib/spl.ts';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spl');

test('openFDA leading-dot strength ".175 mg/1" equals RxNav "0.175 MG" (real levothyroxine pair)', () => {
  const a = normalizeStrength('.175 mg/1');
  const [b] = rxNavStrengths('levothyroxine sodium 0.175 MG Oral Tablet');
  assert.ok(a && b);
  assert.ok(sameStrength(a, b));
});

test('openFDA "40 mg/4mL" equals RxNav "10 MG/ML" after per-unit normalization (real furosemide pair)', () => {
  const a = normalizeStrength('40 mg/4mL');
  const [b] = rxNavStrengths('furosemide 10 MG/ML Oral Solution');
  assert.ok(a && b);
  assert.ok(sameStrength(a, b));
});

test('different strengths are never equal', () => {
  const a = normalizeStrength('25 mg/1')!;
  const b = normalizeStrength('50 mg/1')!;
  assert.equal(sameStrength(a, b), false);
});

test('mg and mcg are not silently equated', () => {
  const a = normalizeStrength('75 ug/1') ?? normalizeStrength('75 mcg/1')!;
  const [b] = rxNavStrengths('levothyroxine sodium 0.075 MG Oral Tablet');
  assert.equal(sameStrength(a, b!), false);
});

test('unparseable strength returns null rather than a guess', () => {
  assert.equal(normalizeStrength('see label'), null);
});

test('repackager SPL (real PD-Rx lisinopril) has REPACK, no MANUFACTURE, and a source NDC', () => {
  const s = summarizeSplEstablishments(readFileSync(join(FIX, 'repackager_pdrx_lisinopril_bf59ff89.xml'), 'utf8'));
  assert.equal(s.hasRepackOrRelabel, true);
  assert.equal(s.hasManufacture, false);
  assert.deepEqual(s.equivalentSourceNdcs, ['43547-352']);
  assert.equal(s.establishments[0]!.name, 'PD-Rx Pharmaceuticals, Inc.');
});

test('manufacturer SPL (real Aurolife hydrocodone/APAP) has a MANUFACTURE establishment coded C43360', () => {
  const s = summarizeSplEstablishments(
    readFileSync(join(FIX, 'manufacturer_aurolife_hydrocodone_apap_392a846e.xml'), 'utf8'),
  );
  assert.equal(s.hasManufacture, true);
  assert.ok(s.establishments.some((e) => e.operations.includes('C43360')));
  assert.equal(s.operationCounts.C43215, undefined, 'Document A code C43215 not present in live data');
});

test('SPL with no establishment section (real furosemide repackager) is flagged, not treated as verified', () => {
  const s = summarizeSplEstablishments(
    readFileSync(join(FIX, 'repackager_no_establishments_furosemide_4a746634.xml'), 'utf8'),
  );
  assert.equal(s.noEstablishmentSection, true);
  assert.equal(s.hasManufacture, false);
  assert.deepEqual(s.equivalentSourceNdcs, ['0054-3294']);
});
