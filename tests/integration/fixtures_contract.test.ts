/**
 * Offline contract tests against sanitized fixtures captured from the live public APIs by
 * `npm run feasibility:fixtures`. They verify the validators and normalizers accept real
 * responses, and document the recall-matching hazards observed in real data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateOpenFdaNdc,
  validateOpenFdaEnforcement,
  validateRxNavNdcStatus,
  type OpenFdaEnforcement,
  type OpenFdaEnvelope,
  type OpenFdaNdcProduct,
} from '../../scripts/lib/schemas.ts';
import { toNdc11, extractNdcsFromText, productNdcOf } from '../../scripts/lib/ndc.ts';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'api');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const load = (f: string) => (JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { data: unknown }).data;

test('fixtures exist for all 14 drugs', () => {
  assert.equal(files.filter((f) => f.startsWith('ndc_')).length, 14);
  assert.equal(files.filter((f) => f.startsWith('rxnav_ndcstatus_')).length, 14);
});

test('every NDC Directory fixture passes schema validation', () => {
  for (const f of files.filter((x) => x.startsWith('ndc_'))) assert.equal(validateOpenFdaNdc(load(f)), null, f);
});

test('every enforcement fixture passes schema validation', () => {
  for (const f of files.filter((x) => x.startsWith('enforcement_'))) {
    assert.equal(validateOpenFdaEnforcement(load(f)), null, f);
  }
});

test('NDC Directory package NDC and RxNav ndc11 agree for every drug', () => {
  for (const f of files.filter((x) => x.startsWith('ndc_'))) {
    const drug = f.slice(4, -5);
    const ndc = load(f) as OpenFdaEnvelope<OpenFdaNdcProduct>;
    const rx = load(`rxnav_ndcstatus_${drug}.json`);
    assert.equal(validateRxNavNdcStatus(rx), null);
    const pkg = ndc.results[0]!.packaging![0]!.package_ndc;
    assert.equal(toNdc11(pkg), (rx as { ndcStatus: { ndc11: string } }).ndcStatus.ndc11, drug);
  }
});

test('HAZARD (documented): openfda.product_ndc over-includes every strength on the same label', () => {
  // Real record D-0374-2023 recalls only atorvastatin 80 mg (NDC 16729-047-15/-16 in the text),
  // but its openfda block lists all four product NDCs on that SPL (16729-044/045/046/047).
  // Structured fields alone would wrongly flag the 10/20/40 mg products as recalled.
  const rec = (load('enforcement_atorvastatin.json') as OpenFdaEnvelope<OpenFdaEnforcement>).results.find(
    (r) => r.recall_number === 'D-0374-2023',
  );
  assert.ok(rec, 'fixture record present');
  const textProducts = new Set(extractNdcsFromText(rec.product_description).map(productNdcOf));
  const structuredProducts = new Set(rec.openfda?.product_ndc ?? []);
  assert.deepEqual([...textProducts], ['16729-047']);
  assert.ok(structuredProducts.size > textProducts.size);
  for (const p of textProducts) assert.ok(structuredProducts.has(p));
});

test('HAZARD (documented): single-ingredient keyword search returns combination products', () => {
  const recs = (load('enforcement_amlodipine.json') as OpenFdaEnvelope<OpenFdaEnforcement>).results;
  assert.ok(recs.some((r) => /benazepril|valsartan/i.test(r.product_description)));
});

test('HAZARD (documented): many recall records have no openfda block, so text parsing is required', () => {
  const all = files
    .filter((x) => x.startsWith('enforcement_'))
    .flatMap((f) => (load(f) as OpenFdaEnvelope<OpenFdaEnforcement>).results);
  const without = all.filter((r) => !r.openfda || Object.keys(r.openfda).length === 0);
  assert.ok(without.length > 0);
  // Every such record must still yield either an NDC from text or be routed to INSUFFICIENT_DATA;
  // here we only assert the text is non-empty so a matcher has something to inspect.
  for (const r of without) assert.ok(r.product_description.length > 0);
});
