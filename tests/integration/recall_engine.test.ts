/**
 * Recall evidence engine on real, sanitized openFDA responses (tests/fixtures/task2, captured
 * 2026-11-12 by scripts/capture_task2_fixtures.ts). Covers RC-1…5, LOT-1…3, RP-4, ID-2/3/4, RG-1,
 * RG-2 and refill changes. Every "modified real" record is labeled at its point of use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRecord } from '../../mobile/src/rules/recallRecord.ts';
import { evaluateRecallEvidence, planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import { identityFromPrintedFields } from '../../mobile/src/rules/identity.ts';
import { diffFills } from '../../mobile/src/rules/refill.ts';
import { selectExplanation } from '../../mobile/src/rules/explanation.ts';
import type { EnforcementPage, RecallFinding } from '../../mobile/src/models/evidence.ts';
import type { MedicationIdentity } from '../../mobile/src/models/identity.ts';
import type { OpenFdaEnforcement } from '../../mobile/src/models/openfda.ts';
import {
  apiEnforcement,
  apiNdcRecord,
  bundle,
  control,
  controlDrifted,
  enf,
  firstNdcRecord,
  firstRecordsOnly,
  productIdentity,
  realNoMatch,
  realServerError,
  schemaChanged,
  synthetic429,
  syntheticNetworkError,
  syntheticTimeout,
  truncated,
} from '../helpers/fixtures.ts';

// ---------------------------------------------------------------- identities from real records

const sunMetforminEr = (lot: string | null = null) => productIdentity(firstNdcRecord('ndc_pkg_62756-142-02'), '62756-142-02', lot);
const aphenaMetforminIr = () => productIdentity(apiNdcRecord('ndc_metformin'), '43353-982-30');
const lupinAmlodipine5 = () => productIdentity(apiNdcRecord('ndc_amlodipine'), '68180-455-01');
const lupinAmlodipine10 = () => productIdentity(firstNdcRecord('ndc_prod_68180-721'), '68180-721-03');
const accordAtorvastatin40 = () => productIdentity(firstNdcRecord('ndc_prod_16729-046'), '16729-046-15');
const accordAtorvastatin80 = () => productIdentity(firstNdcRecord('ndc_prod_16729-047'), '16729-047-15');
const ascendAtorvastatin80 = () => productIdentity(firstNdcRecord('ndc_prod_67877-514'), '67877-514-90');
const camberHydrocodoneApap = (lot: string | null = null) => productIdentity(firstNdcRecord('ndc_prod_31722-997'), '31722-997-01', lot);
const aphenaTamsulosin = () => productIdentity(apiNdcRecord('ndc_tamsulosin'), '71610-910-30');
const quallentRosuvastatin10 = () => productIdentity(apiNdcRecord('ndc_rosuvastatin'), '82009-018-10');

// Complete, real query results per identity.
const METFORMIN = () => ({ ingredient_text: [enf('enf_text_metformin')], product_ndc: [enf('enf_pndc_62756-142')], control: [control()] });
const AMLODIPINE_455 = () => ({
  ingredient_text: [enf('enf_text_amlodipine_p1'), enf('enf_text_amlodipine_p2')],
  product_ndc: [enf('enf_pndc_68180-455')],
  control: [control()],
});
const TAMSULOSIN = () => ({ ingredient_text: [enf('enf_text_tamsulosin')], product_ndc: [realNoMatch()], control: [control()] });
const HYDROCODONE_CAMBER = () => ({ ingredient_text: [enf('enf_text_hydrocodone_acetaminophen')], product_ndc: [enf('enf_pndc_31722-997')], control: [control()] });

const evaluate = (id: MedicationIdentity, pages: Record<string, EnforcementPage[]>): RecallFinding =>
  evaluateRecallEvidence(id, bundle(planRecallQueries(id), pages));

const numbers = (rs: { recallNumber: string }[]) => rs.map((r) => r.recallNumber).sort();

function recordFrom(page: EnforcementPage, recallNumber: string): OpenFdaEnforcement {
  if (page.kind !== 'OK') throw new Error('not OK');
  const r = page.data.results.find((x) => x.recall_number === recallNumber);
  if (!r) throw new Error(recallNumber);
  return r;
}

// ---------------------------------------------------------------- query plan and privacy

test('query plan uses only public identifiers; the lot never appears in a query', () => {
  const plan = planRecallQueries(sunMetforminEr('JKU4639A'));
  const searches = [...plan.queries, plan.positiveControl.query].map((q) => q.search);
  assert.deepEqual(searches.slice(0, 2), ['product_description:"metformin"', 'openfda.product_ndc:"62756-142"']);
  for (const s of searches) assert.ok(!s.includes('JKU4639A'));
  const clinical = identityFromPrintedFields({ drugName: 'HYDROCODONE/APAP', strength: '10-325MG', doseForm: 'TAB' }, ['hydrocodone', 'acetaminophen'], 'LOT123');
  assert.ok(clinical.ok);
  if (clinical.ok) {
    const p = planRecallQueries(clinical.identity);
    assert.deepEqual(p.queries.map((q) => q.search), ['product_description:"acetaminophen" AND product_description:"hydrocodone"']);
  }
});

// ---------------------------------------------------------------- known recalled product, lot-specific

test('RC-1 + lot-specific: Sun metformin ER 500 mg without a lot → POTENTIAL_MATCH, four product matches need the lot', () => {
  const f = evaluate(sunMetforminEr(), METFORMIN());
  assert.equal(f.finding, 'POTENTIAL_MATCH');
  assert.equal(f.confirmed.length, 0, 'a product-level NDC match alone never confirms a lot-specific recall');
  const productMatches = f.potential.filter((r) => r.relevance === 'PRODUCT_MATCH');
  assert.deepEqual(numbers(productMatches), ['D-0325-2021', 'D-0372-2021', 'D-0924-2018', 'D-1089-2014']);
  for (const r of productMatches) assert.ok(r.reasons.includes('LOT_REQUIRED'));
  assert.ok(f.coverage.complete);
  assert.ok(f.limitations.includes('LOT_NOT_PROVIDED'));
});

test('RC-1 + LOT-1: with the user-confirmed lot JKU4639A → CONFIRMED_MATCH on D-0325-2021 only', () => {
  const f = evaluate(sunMetforminEr('JKU4639A'), METFORMIN());
  assert.equal(f.finding, 'CONFIRMED_MATCH');
  assert.deepEqual(numbers(f.confirmed), ['D-0325-2021']);
  assert.equal(f.confirmed[0]?.lot, 'LOT_LISTED');
  // The same product's other lot-specific recalls stay potential: the lot is not in their listings.
  for (const n of ['D-0372-2021', 'D-0924-2018', 'D-1089-2014']) {
    const r = f.potential.find((x) => x.recallNumber === n);
    assert.equal(r?.lot, 'LOT_NOT_FOUND_IN_LISTING', n);
  }
});

test('LOT-2: a lot missing from every listing never clears the product → POTENTIAL_MATCH, not NO_MATCH_FOUND', () => {
  const f = evaluate(sunMetforminEr('ZZZ0000'), METFORMIN());
  assert.equal(f.finding, 'POTENTIAL_MATCH');
  assert.ok(f.potential.filter((r) => r.relevance === 'PRODUCT_MATCH').every((r) => r.reasons.includes('LOT_NOT_FOUND_IN_LISTING')));
});

test('package-level: same product, different package than the one listed → potential, not confirmed', () => {
  // Real records list only package 62756-142-02; the user's bottle is 62756-142-01.
  const id = productIdentity(firstNdcRecord('ndc_pkg_62756-142-02'), '62756-142-01', 'JKU4639A');
  const f = evaluate(id, METFORMIN());
  assert.equal(f.finding, 'POTENTIAL_MATCH');
  assert.ok(f.potential.find((r) => r.recallNumber === 'D-0325-2021')?.reasons.includes('PACKAGE_NOT_LISTED'));
});

test('all-lots recall on a product match is confirmed without a lot (modified real record)', () => {
  // Modified real record: D-0325-2021 with code_info replaced by "all lots" (wording from D-0405-2016).
  const rec = { ...recordFrom(enf('enf_pndc_62756-142'), 'D-0325-2021'), code_info: 'all lots' };
  const a = assessRecord(sunMetforminEr(), rec, ['product_ndc']);
  assert.equal(a.classification, 'CONFIRMED_MATCH');
  assert.ok(a.reasons.includes('ALL_LOTS'));
  const cond = assessRecord(sunMetforminEr(), { ...rec, code_info: 'All lots repackaged and distributed between 01/05/12 to 02/12/15' }, ['x']);
  assert.equal(cond.classification, 'POTENTIAL_MATCH', 'conditional "all lots" cannot be confirmed');
});

// ---------------------------------------------------------------- multiple strengths under one label

test('multiple strengths under one label: openfda.product_ndc over-includes, text decides (Lupin amlodipine)', () => {
  // openfda.product_ndc:"68180-455" (5 mg) returns three recalls for 2.5 mg and 10 mg products.
  const five = evaluate(lupinAmlodipine5(), AMLODIPINE_455());
  for (const n of ['D-0899-2023', 'D-1492-2016', 'D-1493-2016']) {
    const r = five.notApplicable.find((x) => x.recallNumber === n);
    assert.ok(r, n);
    assert.ok(r.reasons.includes('STRENGTH_DIFFERS'), n);
  }
  assert.equal(five.finding, 'NO_MATCH_FOUND');
  // The same label's 10 mg product NDC is named in D-0899-2023's text.
  const ten = assessRecord(lupinAmlodipine10(), recordFrom(enf('enf_pndc_68180-455'), 'D-0899-2023'), ['product_ndc']);
  assert.equal(ten.relevance, 'PRODUCT_MATCH');
  assert.equal(ten.classification, 'POTENTIAL_MATCH');
});

test('RC-2: D-0374-2023 (80 mg) is not applicable to the 40 mg product even though openfda lists 16729-046', () => {
  const page = enf('enf_pndc_16729-046');
  const r = assessRecord(accordAtorvastatin40(), recordFrom(page, 'D-0374-2023'), ['product_ndc']);
  assert.equal(r.relevance, 'OTHER_PRODUCT');
  assert.ok(r.reasons.includes('STRENGTH_DIFFERS'));
  // ...while D-0373-2023 names 16729-046 in its text.
  const m = assessRecord(accordAtorvastatin40(), recordFrom(page, 'D-0373-2023'), ['product_ndc']);
  assert.equal(m.relevance, 'PRODUCT_MATCH');
  // And D-0374-2023 is a product match for the 80 mg product.
  assert.equal(assessRecord(accordAtorvastatin80(), recordFrom(enf('enf_pndc_16729-047'), 'D-0374-2023'), ['p']).relevance, 'PRODUCT_MATCH');
});

test('RC-2 structured-only: openfda lists the product but the text has no NDC → POSSIBLE_MATCH, never confirmed', () => {
  // Modified real record: D-0325-2021 with the NDC removed from product_description.
  const rec = recordFrom(enf('enf_pndc_62756-142'), 'D-0325-2021');
  const stripped = { ...rec, product_description: rec.product_description.replace(/,?\s*NDC 62756-142-02\.?/, '') };
  const a = assessRecord(sunMetforminEr('JKU4639A'), stripped, ['product_ndc']);
  assert.equal(a.relevance, 'POSSIBLE_MATCH');
  assert.equal(a.classification, 'POTENTIAL_MATCH');
  assert.ok(a.reasons.includes('STRUCTURED_NDC_ONLY'));
});

// ---------------------------------------------------------------- RC-3 / RC-5 conservative parsing

test('RC-3: an NDC list that cannot be fully read never rules the product out (real D-1350-2020, "NDC 53746-0178-BULK")', () => {
  const r = assessRecord(sunMetforminEr(), recordFrom(enf('enf_text_metformin'), 'D-1350-2020'), ['ingredient_text']);
  assert.equal(r.relevance, 'POSSIBLE_MATCH');
  assert.ok(r.reasons.includes('TEXT_NDC_LIST_INCOMPLETE'));
});

test('RC-3: no NDC and no openfda block, same ingredient/strength/form → POSSIBLE_MATCH (modified real record)', () => {
  const rec = recordFrom(enf('enf_pndc_62756-142'), 'D-0325-2021');
  const { openfda: _drop, ...noOpenfda } = rec;
  const bare = { ...noOpenfda, product_description: rec.product_description.replace(/,?\s*NDC 62756-142-02\.?/, '') };
  const r = assessRecord(sunMetforminEr(), bare, ['ingredient_text']);
  assert.equal(r.relevance, 'POSSIBLE_MATCH');
  assert.ok(r.reasons.includes('NO_PRODUCT_LEVEL_EVIDENCE'));
});

test('RC-5: a record missing a required field is UNRESOLVED, never "other product"; alone it makes the finding UNRESOLVED', () => {
  const rec = recordFrom(enf('enf_text_tamsulosin'), 'D-1844-2019');
  const { product_description: _d, ...broken } = rec;
  const r = assessRecord(aphenaTamsulosin(), broken, ['ingredient_text']);
  assert.equal(r.classification, 'UNRESOLVED');
  // Inject it into an otherwise complete OK page (cached data path; the live service would reject the page).
  const page = enf('enf_text_tamsulosin');
  assert.equal(page.kind, 'OK');
  if (page.kind === 'OK') {
    const injected: EnforcementPage = { ...page, data: { ...page.data, results: [...page.data.results.filter((x) => x.recall_number !== 'D-1844-2019'), broken as unknown as OpenFdaEnforcement] } };
    const f = evaluate(aphenaTamsulosin(), { ...TAMSULOSIN(), ingredient_text: [injected] });
    assert.equal(f.finding, 'UNRESOLVED');
    assert.ok(f.limitations.includes('SOME_RECORDS_UNPARSEABLE'));
  }
});

test('a text NDC match whose text contradicts the strength is downgraded to POTENTIAL (modified real record)', () => {
  const rec = recordFrom(enf('enf_pndc_62756-142'), 'D-0325-2021');
  const r = assessRecord(sunMetforminEr('JKU4639A'), { ...rec, product_description: rec.product_description.replace('500 mg', '750 mg') }, ['p']);
  assert.equal(r.classification, 'POTENTIAL_MATCH');
  assert.ok(r.reasons.includes('TEXT_NDC_STRENGTH_CONFLICT'));
});

// ---------------------------------------------------------------- IR vs ER

test('IR product: ER recalls for the same ingredient and strength are not applicable (release differs)', () => {
  const f = evaluate(aphenaMetforminIr(), { ingredient_text: [enf('enf_text_metformin')], product_ndc: [realNoMatch()], control: [control()] });
  const d0325 = f.notApplicable.find((r) => r.recallNumber === 'D-0325-2021');
  assert.ok(d0325);
  assert.ok(d0325.reasons.includes('RELEASE_DIFFERS') || d0325.reasons.includes('TEXT_NDC_NAMES_OTHER_PRODUCTS'));
  // A record labeled both ER and IR (real D-1448-2014) is never read as explicit evidence about release.
  const mixed = assessRecord(aphenaMetforminIr(), recordFrom(enf('enf_text_metformin'), 'D-1448-2014'), ['t']);
  assert.ok(!mixed.reasons.includes('RELEASE_DIFFERS'));
});

// ---------------------------------------------------------------- combination products

test('RC-4: combination records are not applicable to a single-ingredient product', () => {
  const f = evaluate(lupinAmlodipine5(), AMLODIPINE_455());
  const combo = f.notApplicable.find((r) => r.recallNumber === 'D-0542-2025'); // amlodipine/benazepril
  assert.ok(combo?.reasons.includes('COMBINATION_PRODUCT'));
  const met = evaluate(sunMetforminEr(), METFORMIN());
  for (const n of ['D-0435-2021', 'D-0456-2021', 'D-0838-2020']) {
    assert.ok(met.notApplicable.find((r) => r.recallNumber === n)?.reasons.includes('COMBINATION_PRODUCT'), n);
  }
});

test('combination product identity (hydrocodone/APAP 10/325, Camber): its own recall matches; other strengths and partners do not', () => {
  const f = evaluate(camberHydrocodoneApap(), HYDROCODONE_CAMBER());
  assert.equal(f.finding, 'POTENTIAL_MATCH');
  assert.deepEqual(numbers(f.potential), ['D-0276-2022']);
  const na = (n: string) => f.notApplicable.find((r) => r.recallNumber === n)?.reasons ?? [];
  assert.ok(na('D-058-2013').includes('STRENGTH_DIFFERS')); // 10/500
  assert.ok(na('D-1139-2017').includes('DOSE_FORM_DIFFERS')); // oral solution
  const withLot = evaluate(camberHydrocodoneApap('21070817'), HYDROCODONE_CAMBER());
  assert.equal(withLot.finding, 'CONFIRMED_MATCH');
  assert.deepEqual(numbers(withLot.confirmed), ['D-0276-2022']);
});

test('ID-3: name-only combination identity can only reach POTENTIAL_MATCH, labeled "product not identified"', () => {
  const r = identityFromPrintedFields({ drugName: 'HYDROCODONE BITARTRATE AND ACETAMINOPHEN', strength: '10 MG/325 MG', doseForm: 'TABLET' }, ['hydrocodone', 'acetaminophen'], '21070817');
  assert.ok(r.ok);
  if (!r.ok) return;
  const f = evaluate({ ...r.identity, release: 'IR' }, { ingredient_text: [enf('enf_text_hydrocodone_acetaminophen')], control: [control()] });
  assert.equal(f.finding, 'POTENTIAL_MATCH');
  assert.equal(f.confirmed.length, 0, 'even a listed lot cannot confirm without product identity');
  assert.deepEqual(numbers(f.potential), ['D-0097-2021', 'D-0276-2022', 'D-0413-2018']);
  assert.ok(f.potential.every((p) => p.reasons.includes('PRODUCT_NOT_IDENTIFIED')));
  assert.ok(f.limitations.includes('PRODUCT_NOT_IDENTIFIED'));
});

// ---------------------------------------------------------------- incorrect / unmatched NDC, NO_MATCH_FOUND

test('NO_MATCH_FOUND only with complete coverage, and always with coverage, dates and limitations', () => {
  const f = evaluate(aphenaTamsulosin(), TAMSULOSIN());
  assert.equal(f.finding, 'NO_MATCH_FOUND');
  assert.ok(f.coverage.complete);
  assert.equal(f.coverage.positiveControl.status, 'PASSED');
  assert.equal(f.coverage.datasetLastUpdated, '2026-11-04');
  assert.deepEqual(f.coverage.queries.map((q) => [q.queryId, q.status, q.recordsRetrieved, q.totalReported]), [
    ['ingredient_text', 'COMPLETE', 5, 5],
    ['product_ndc', 'COMPLETE', 0, 0],
    ['control', 'COMPLETE', 1, 1],
  ]);
  for (const l of ['ABSENCE_IS_NOT_SAFETY', 'FDA_DATA_MAY_BE_INCOMPLETE_OR_DELAYED', 'REPACKAGED_PRODUCTS_MAY_NOT_NAME_YOUR_NDC'] as const) {
    assert.ok(f.limitations.includes(l), l);
  }
  assert.equal(f.notApplicable.length, 5, 'every evaluated record stays visible');
  const ex = selectExplanation(aphenaTamsulosin(), f);
  assert.equal(ex.headline, 'RESULT_NO_MATCH_FOUND');
  assert.deepEqual(ex.sections.slice(-2), ['SOURCES_AND_DATES', 'STANDING_DISCLAIMER']);
});

test('rosuvastatin 10 mg (Quallent): other labelers\' 10 mg recalls name other NDCs → NO_MATCH_FOUND', () => {
  const f = evaluate(quallentRosuvastatin10(), { ingredient_text: [enf('enf_text_rosuvastatin')], product_ndc: [realNoMatch()], control: [control()] });
  assert.equal(f.finding, 'NO_MATCH_FOUND');
  assert.ok(f.notApplicable.find((r) => r.recallNumber === 'D-0292-2026')?.reasons.includes('TEXT_NDC_NAMES_OTHER_PRODUCTS'));
});

test('RP-4: a recall naming the product this one was repackaged from is surfaced as POTENTIAL_MATCH', () => {
  // Assumption for the test: the Aphena tamsulosin product is a repackage of Macleods 33342-159
  // (the traversal that would establish this is Task 3). The recall D-1844-2019 names 33342-159.
  const id = { ...aphenaTamsulosin(), relatedSourceProductNdcs: ['33342-159'] };
  const r = assessRecord(id, recordFrom(enf('enf_text_tamsulosin'), 'D-1844-2019'), ['ingredient_text']);
  assert.equal(r.classification, 'POTENTIAL_MATCH');
  assert.ok(r.reasons.includes('TEXT_NDC_MATCHES_RELATED_SOURCE_PRODUCT'));
});

// ---------------------------------------------------------------- RG-1: failures never become NO_MATCH_FOUND

const FAILURES: [string, () => EnforcementPage][] = [
  ['HTTP 500 (real)', realServerError],
  ['truncated JSON (real body)', () => truncated('enf_text_tamsulosin')],
  ['schema change: product_description removed (real body)', () => schemaChanged('enf_text_tamsulosin', 'product_description')],
  ['HTTP 429 (synthetic)', () => synthetic429()],
  ['network error (synthetic)', syntheticNetworkError],
  ['timeout (synthetic)', syntheticTimeout],
];

test('RG-1: every injected failure on every query turns a would-be NO_MATCH_FOUND into UNRESOLVED', () => {
  assert.equal(evaluate(aphenaTamsulosin(), TAMSULOSIN()).finding, 'NO_MATCH_FOUND', 'baseline');
  for (const q of ['ingredient_text', 'product_ndc', 'control']) {
    for (const [label, fail] of FAILURES) {
      const f = evaluate(aphenaTamsulosin(), { ...TAMSULOSIN(), [q]: [fail()] });
      assert.equal(f.finding, 'UNRESOLVED', `${q}: ${label}`);
      assert.equal(f.coverage.complete, false, `${q}: ${label}`);
    }
  }
});

test('RG-1: a known recall is never NO_MATCH_FOUND under any single or double query failure', () => {
  for (const [label, fail] of FAILURES) {
    const one = evaluate(sunMetforminEr('JKU4639A'), { ...METFORMIN(), ingredient_text: [fail()] });
    assert.equal(one.finding, 'CONFIRMED_MATCH', `text query ${label}: structured query still names the product`);
    const other = evaluate(sunMetforminEr('JKU4639A'), { ...METFORMIN(), product_ndc: [fail()] });
    assert.equal(other.finding, 'CONFIRMED_MATCH', `structured query ${label}`);
    const both = evaluate(sunMetforminEr('JKU4639A'), { ...METFORMIN(), ingredient_text: [fail()], product_ndc: [fail()] });
    assert.equal(both.finding, 'UNRESOLVED', `both ${label}`);
  }
});

test('RG-2: misspelled/renamed field answers "no matches" — the multi-field positive control catches it', () => {
  // The structured query's real 404 for a drifted field looks exactly like "no recalls"...
  const drifted = enf('enf_misspelled_field');
  assert.equal(drifted.kind, 'NO_MATCH');
  // ...so only the control, which uses the same fields, can expose it.
  const f = evaluate(aphenaTamsulosin(), { ...TAMSULOSIN(), control: [controlDrifted()] });
  assert.equal(f.finding, 'UNRESOLVED');
  assert.equal(f.coverage.positiveControl.status, 'FAILED');
  assert.ok(f.limitations.includes('POSITIVE_CONTROL_NOT_PASSED'));
});

test('RG-2: a control that returns the record but whose NDC the parser cannot read fails (parser self-check)', () => {
  const c = control();
  assert.equal(c.kind, 'OK');
  if (c.kind !== 'OK') return;
  const broken: EnforcementPage = {
    ...c,
    data: { ...c.data, results: c.data.results.map((r) => ({ ...r, product_description: r.product_description.replace('62756-142-02', '62756 142 02') })) },
  };
  const f = evaluate(aphenaTamsulosin(), { ...TAMSULOSIN(), control: [broken] });
  assert.equal(f.coverage.positiveControl.status, 'FAILED');
  assert.equal(f.finding, 'UNRESOLVED');
});

test('a query that was never run blocks NO_MATCH_FOUND', () => {
  const { product_ndc: _skip, ...rest } = TAMSULOSIN();
  const f = evaluate(aphenaTamsulosin(), rest);
  assert.equal(f.finding, 'UNRESOLVED');
  assert.equal(f.coverage.queries.find((q) => q.queryId === 'product_ndc')?.status, 'NOT_RUN');
});

// ---------------------------------------------------------------- pagination

test('pagination: two real pages (98 records) are complete; page 1 alone is INCOMPLETE → UNRESOLVED', () => {
  const full = evaluate(lupinAmlodipine5(), AMLODIPINE_455());
  const q = full.coverage.queries.find((x) => x.queryId === 'ingredient_text');
  assert.deepEqual([q?.status, q?.recordsRetrieved, q?.totalReported], ['COMPLETE', 98, 98]);
  assert.equal(full.finding, 'NO_MATCH_FOUND');
  const partial = evaluate(lupinAmlodipine5(), { ...AMLODIPINE_455(), ingredient_text: [enf('enf_text_amlodipine_p1')] });
  assert.equal(partial.coverage.queries.find((x) => x.queryId === 'ingredient_text')?.status, 'INCOMPLETE_PAGINATION');
  assert.equal(partial.finding, 'UNRESOLVED');
});

test('pagination: pages out of order, a failed second page, or a trimmed page are never complete', () => {
  const swapped = evaluate(lupinAmlodipine5(), { ...AMLODIPINE_455(), ingredient_text: [enf('enf_text_amlodipine_p2'), enf('enf_text_amlodipine_p1')] });
  assert.equal(swapped.coverage.queries[0]?.status, 'INCONSISTENT_PAGINATION');
  assert.equal(swapped.finding, 'UNRESOLVED');
  const failedP2 = evaluate(lupinAmlodipine5(), { ...AMLODIPINE_455(), ingredient_text: [enf('enf_text_amlodipine_p1'), realServerError()] });
  assert.equal(failedP2.coverage.queries[0]?.status, 'SOURCE_UNAVAILABLE');
  assert.equal(failedP2.finding, 'UNRESOLVED');
  const trimmed = evaluate(aphenaTamsulosin(), { ...TAMSULOSIN(), ingredient_text: [firstRecordsOnly(enf('enf_text_tamsulosin'), 3)] });
  assert.equal(trimmed.finding, 'UNRESOLVED');
  // Task 1 fixtures were trimmed to 3 of N records: also incomplete.
  const t1 = evaluate(accordAtorvastatin40(), { ingredient_text: [apiEnforcement('enforcement_atorvastatin')], product_ndc: [enf('enf_pndc_16729-046')], control: [control()] });
  assert.ok(t1.limitations.includes('SOME_QUERIES_INCOMPLETE'));
  assert.equal(t1.finding, 'POTENTIAL_MATCH', 'a product match found in the complete structured query is still reported');
  assert.deepEqual(numbers(t1.potential.filter((r) => r.relevance === 'PRODUCT_MATCH')), ['D-0373-2023']);
});

// ---------------------------------------------------------------- determinism

test('evaluation is deterministic and independent of record and query order', () => {
  const a = evaluate(sunMetforminEr('JKU4639A'), METFORMIN());
  const b = evaluate(sunMetforminEr('JKU4639A'), METFORMIN());
  assert.deepEqual(a, b);
  const p = enf('enf_text_metformin');
  if (p.kind !== 'OK') throw new Error('fixture');
  const reversed: EnforcementPage = { ...p, data: { ...p.data, results: [...p.data.results].reverse() } };
  const id = sunMetforminEr('JKU4639A');
  const plan = planRecallQueries(id);
  const c = evaluateRecallEvidence(id, { plan, evaluatedAt: a.evaluatedAt, results: [
    { queryId: 'control', pages: [control()] },
    { queryId: 'product_ndc', pages: [enf('enf_pndc_62756-142')] },
    { queryId: 'ingredient_text', pages: [reversed] },
  ] });
  assert.equal(c.finding, a.finding);
  assert.deepEqual(numbers(c.confirmed), numbers(a.confirmed));
  assert.deepEqual(numbers(c.potential), numbers(a.potential));
  assert.deepEqual(numbers(c.notApplicable), numbers(a.notApplicable));
});

// ---------------------------------------------------------------- refill product changes (J5, RG-7)

test('refill: ER → IR change is flagged for the pharmacist, and the old ER recall no longer applies', () => {
  const diff = diffFills(sunMetforminEr(), aphenaMetforminIr());
  assert.deepEqual(diff.changes.map((c) => c.kind).sort(), ['LABELER_CHANGED', 'PRODUCT_NDC_CHANGED', 'RELEASE_CHANGED']);
  assert.equal(diff.checkWithPharmacist, true);
  assert.equal(diff.reevaluate, true);
  const before = evaluate(sunMetforminEr('JKU4639A'), METFORMIN());
  assert.equal(before.finding, 'CONFIRMED_MATCH');
  const after = evaluate({ ...aphenaMetforminIr(), lot: 'JKU4639A' }, { ingredient_text: [enf('enf_text_metformin')], product_ndc: [realNoMatch()], control: [control()] });
  assert.ok(after.notApplicable.some((r) => r.recallNumber === 'D-0325-2021'));
  assert.equal(after.confirmed.length, 0);
});

test('refill: same strength from a different labeler is neutral (no pharmacist flag); strength change is flagged', () => {
  const labeler = diffFills(accordAtorvastatin80(), ascendAtorvastatin80());
  assert.deepEqual(labeler.changes.map((c) => c.kind).sort(), ['LABELER_CHANGED', 'PRODUCT_NDC_CHANGED']);
  assert.equal(labeler.checkWithPharmacist, false);
  const strength = diffFills(lupinAmlodipine5(), lupinAmlodipine10());
  assert.ok(strength.changes.some((c) => c.kind === 'STRENGTH_CHANGED' && c.checkWithPharmacist));
  assert.equal(diffFills(lupinAmlodipine5(), lupinAmlodipine5()).changes.length, 0);
});

test('refill: the new product\'s recall is found after the change (Accord → Ascend atorvastatin 80 mg)', () => {
  const ascend = assessRecord(ascendAtorvastatin80(), recordFrom(apiEnforcement('enforcement_atorvastatin'), 'D-0020-2026'), ['t']);
  assert.equal(ascend.relevance, 'PRODUCT_MATCH');
  const accord = assessRecord(accordAtorvastatin80(), recordFrom(apiEnforcement('enforcement_atorvastatin'), 'D-0020-2026'), ['t']);
  assert.equal(accord.relevance, 'OTHER_PRODUCT');
});
