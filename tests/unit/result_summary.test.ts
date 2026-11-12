/**
 * Task 4C build 7: summary-first result. Findings come from the production engine on REAL recorded
 * openFDA responses (tests/helpers/fixtures.ts); mutations used to create rare cases are labeled.
 * The four categories and all matching logic are unchanged; these tests check what is summarized,
 * what is collapsed, and that the exclusion counts never overlap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY, allCopyStrings } from '../../mobile/src/copy/en.ts';
import { EXCLUSION_ORDER, exclusionReasons, presentResult, recordDate, type PresentInput, type ResultView } from '../../mobile/src/presentation/present.ts';
import { evaluateRecallEvidence, planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import type { RecallFinding, RecordAssessment } from '../../mobile/src/models/evidence.ts';
import type { MedicationIdentity } from '../../mobile/src/models/identity.ts';
import { apiNdcRecord, bundle, control, enf, firstNdcRecord, productIdentity, realNoMatch } from '../helpers/fixtures.ts';

const EVAL_AT = '2026-11-12T12:00:00.000Z';
const NOW = '2026-11-12T13:00:00.000Z';
const sunEr = (lot: string | null = null) => productIdentity(firstNdcRecord('ndc_pkg_62756-142-02'), '62756-142-02', lot);
const tamsulosin = () => ({ ...productIdentity(apiNdcRecord('ndc_tamsulosin'), '71610-910-30'), sourceProductStatus: 'NOT_APPLICABLE' as const });
const evaluate = (id: MedicationIdentity, pages: Parameters<typeof bundle>[1]) => evaluateRecallEvidence(id, bundle(planRecallQueries(id), pages));
const METFORMIN = () => ({ ingredient_text: [enf('enf_text_metformin')], product_ndc: [enf('enf_pndc_62756-142')], control: [control()] });
const TAMSULOSIN = () => ({ ingredient_text: [enf('enf_text_tamsulosin')], product_ndc: [realNoMatch()], control: [control()] });
const show = (identity: MedicationIdentity, finding: RecallFinding, over: Partial<PresentInput> = {}) =>
  presentResult({ identity, finding: { ...finding, evaluatedAt: EVAL_AT }, now: NOW, ...over });

/** Invariants that hold for every result. */
function checkInvariants(v: ResultView, f: RecallFinding) {
  const count = (g: string) => v.records.filter((r) => r.group === g).length;
  assert.equal(v.records.length, f.confirmed.length + f.potential.length + f.unresolved.length + f.notApplicable.length, 'every record is kept');
  // Only records the engine conclusively excluded are collapsed/counted as "different product".
  assert.equal(count('notApplicable'), f.notApplicable.length);
  for (const r of v.records) assert.equal(r.excluded !== null, r.group === 'notApplicable', `${r.recallNumber}: excluded flag only on NOT_APPLICABLE`);
  // Non-overlapping counts that add up.
  assert.equal(v.exclusions.total, f.notApplicable.length);
  assert.equal(v.exclusions.reasons.reduce((a, x) => a + x.count, 0), v.exclusions.total, 'reason counts add up to the excluded total');
  assert.deepEqual(v.exclusions.reasons.map((x) => x.reason), EXCLUSION_ORDER.filter((x) => v.exclusions.reasons.some((y) => y.reason === x)), 'fixed order');
  // The summary sentence counts every group.
  if (v.records.length > 0) assert.ok(v.summary.startsWith(COPY.result.summary.intro(v.records.length, v.summary.split(' for ')[1]!.split(':')[0]!)), v.summary);
  if (count('matches') > 0) assert.ok(v.summary.includes(COPY.result.summary.matches(count('matches'))));
  if (count('possible') > 0) assert.ok(v.summary.includes(COPY.result.summary.possible(count('possible'))));
  if (count('unreadable') > 0) assert.ok(v.summary.includes(COPY.result.summary.unreadable(count('unreadable'))));
  if (count('notApplicable') > 0) assert.ok(v.summary.includes(COPY.result.summary.excluded(count('notApplicable'))));
  // Limitations and the standing disclaimer are always present.
  assert.ok(v.limitations.length > 0);
  assert.equal(v.disclaimer, COPY.disclaimer.standing);
  assert.doesNotMatch(`${v.headline} ${v.summary}`, /\bactive\b/i, 'never "active": the search does not establish active status');
}

test('confirmed (real data): category unchanged; matching recall shown with plain-language details; excluded records counted', () => {
  const f = evaluate(sunEr('JKU4639A'), METFORMIN());
  const v = show(sunEr('JKU4639A'), f);
  assert.equal(v.category, 'CONFIRMED');
  checkInvariants(v, f);
  const m = v.records.find((r) => r.recallNumber === 'D-0325-2021')!;
  assert.equal(m.group, 'matches');
  const R = COPY.result.record;
  const label = (l: string) => m.lines.find((x) => x.label === l)?.value;
  const p = f.confirmed.find((r) => r.recallNumber === 'D-0325-2021')!.published!;
  assert.equal(label(R.recallStarted), recordDate(p.recallInitiationDate));
  assert.equal(label(R.firm), p.recallingFirm);
  assert.equal(label(R.reason), p.reasonForRecall);
  assert.equal(label(R.classification), R.classExplanation[p.classification]);
  assert.equal(label(R.status), R.statusExplanation[p.status]);
  assert.equal(label(R.recallNumber), 'D-0325-2021');
  assert.match(m.officialRecordUrl, /^https:\/\/api\.fda\.gov\/drug\/enforcement\.json\?search=recall_number:%22D-0325-2021%22$/);
  assert.ok(m.more.some((x) => x.label === R.lots && x.value === p.codeInfo));
  assert.equal(m.lotNote, R.lotListed);
});

test('potential, missing lot (real data): lot qualifier; possible records are never counted as excluded', () => {
  const f = evaluate(sunEr(), METFORMIN());
  const v = show(sunEr(), f);
  assert.equal(v.category, 'POTENTIAL');
  checkInvariants(v, f);
  assert.ok(v.qualifiers.includes(COPY.result.qualifiers.lotNotProvided));
  const possible = v.records.filter((r) => r.group === 'possible');
  assert.ok(possible.length > 0);
  assert.ok(possible.every((r) => r.excluded === null));
  assert.ok(possible.some((r) => r.lotNote === COPY.result.record.lotUnknown));
});

test('no match (real data): required label wording; every record excluded and counted once; nothing reassuring', () => {
  const f = evaluate(tamsulosin(), TAMSULOSIN());
  const v = show(tamsulosin(), f);
  assert.equal(v.category, 'NO_MATCH');
  assert.equal(COPY.result.categoryLabel.NO_MATCH, 'No matching recall found in the FDA records checked');
  checkInvariants(v, f);
  assert.match(v.headline, /does not establish that the medication is free from recalls/);
  if (f.notApplicable.length > 0) assert.ok(v.summary.endsWith(`${COPY.result.summary.excluded(f.notApplicable.length)}.`));
});

test('no records returned: summary says so plainly, still with limits and disclaimer', () => {
  const f = evaluate(tamsulosin(), TAMSULOSIN());
  const empty: RecallFinding = { ...f, notApplicable: [] }; // MUTATION: no records
  const v = show(tamsulosin(), empty);
  assert.equal(v.summary, COPY.result.summary.none('tamsulosin'));
  checkInvariants(v, empty);
});

test('unresolved (MUTATION: one record unreadable): shown under "could not be read", never collapsed or counted as excluded; never no-match', () => {
  const f = evaluate(tamsulosin(), TAMSULOSIN());
  assert.ok(f.notApplicable.length > 1);
  const bad: RecordAssessment = { ...f.notApplicable[0]!, classification: 'UNRESOLVED', relevance: 'UNPARSEABLE', reasons: ['RECORD_SCHEMA_INVALID'], published: null };
  const mutated: RecallFinding = { ...f, unresolved: [bad], notApplicable: f.notApplicable.slice(1) };
  const v = show(tamsulosin(), mutated);
  assert.equal(v.category, 'UNABLE', 'an unreadable record never allows a no-match');
  checkInvariants(v, mutated);
  const u = v.records.find((r) => r.group === 'unreadable')!;
  assert.equal(u.recallNumber, bad.recallNumber);
  assert.equal(u.excluded, null);
  assert.ok(v.summary.includes(COPY.result.summary.unreadable(1)));
});

test('offline (saved result shown without network): offline qualifier added; summary and counts unchanged', () => {
  const f = evaluate(tamsulosin(), TAMSULOSIN());
  const live = show(tamsulosin(), f);
  const saved = show(tamsulosin(), f, { origin: 'SAVED' });
  assert.ok(saved.qualifiers.some((q) => q === COPY.errors.offline(saved.asOf)));
  assert.equal(saved.summary, live.summary);
  assert.deepEqual(saved.exclusions, live.exclusions);
  checkInvariants(saved, f);
});

test('overlapping exclusions (MUTATION: records with several differences): each counted once under its first difference; overlap reported', () => {
  const f = evaluate(tamsulosin(), TAMSULOSIN());
  const base = f.notApplicable[0]!;
  const rec = (n: string, reasons: RecordAssessment['reasons']): RecordAssessment => ({ ...base, recallNumber: n, reasons });
  const mutated: RecallFinding = {
    ...f,
    notApplicable: [
      rec('X-1', ['STRENGTH_DIFFERS', 'DOSE_FORM_DIFFERS']), // primary: dose form (earlier in the order)
      rec('X-2', ['STRENGTH_DIFFERS']),
      rec('X-3', ['TEXT_NDC_NAMES_OTHER_PRODUCTS']),
      rec('X-4', ['RELEASE_DIFFERS', 'STRENGTH_DIFFERS', 'COMBINATION_PRODUCT']), // primary: combination
      rec('X-5', ['INGREDIENT_NOT_IN_TEXT']), // no recorded difference → "OTHER", still counted once
    ],
  };
  const v = show(tamsulosin(), mutated);
  checkInvariants(v, mutated);
  const c = Object.fromEntries(v.exclusions.reasons.map((x) => [x.reason, x.count]));
  assert.deepEqual(c, { COMBINATION_PRODUCT: 1, DOSE_FORM_DIFFERS: 1, STRENGTH_DIFFERS: 1, TEXT_NDC_NAMES_OTHER_PRODUCTS: 1, OTHER: 1 });
  assert.equal(v.exclusions.multipleDifferences, 2);
  const x1 = v.records.find((r) => r.recallNumber === 'X-1')!.excluded!;
  assert.equal(x1.primary, 'DOSE_FORM_DIFFERS');
  assert.deepEqual(x1.others, [COPY.result.excluded.reasons.STRENGTH_DIFFERS]);
  assert.deepEqual(exclusionReasons(rec('X-4', ['RELEASE_DIFFERS', 'STRENGTH_DIFFERS', 'COMBINATION_PRODUCT'])), ['COMBINATION_PRODUCT', 'RELEASE_DIFFERS', 'STRENGTH_DIFFERS']);
});

test('exclusion counts add up for any combination of differences (exhaustive over the 8 reasons)', () => {
  const f = evaluate(tamsulosin(), TAMSULOSIN());
  const base = f.notApplicable[0]!;
  const reasons = EXCLUSION_ORDER.filter((x) => x !== 'OTHER') as RecordAssessment['reasons'];
  const all: RecordAssessment[] = [];
  for (let mask = 0; mask < 1 << reasons.length; mask++) all.push({ ...base, recallNumber: `M-${mask}`, reasons: reasons.filter((_, i) => mask & (1 << i)) });
  const mutated: RecallFinding = { ...f, notApplicable: all };
  const v = show(tamsulosin(), mutated);
  checkInvariants(v, mutated);
  assert.equal(v.exclusions.multipleDifferences, all.filter((r) => r.reasons.length > 1).length);
});

test('dates from FDA records are shown as ISO dates; unusual values are kept as published', () => {
  assert.equal(recordDate('20150925'), '2015-09-25');
  assert.equal(recordDate(null), null);
  assert.equal(recordDate(''), null);
  assert.equal(recordDate('2015-09'), '2015-09');
});

test('status wording: no copy implies a completed or terminated recall means safety, and no copy claims "active" status', () => {
  for (const t of allCopyStrings()) {
    assert.doesNotMatch(t, /\b(no|without) active recalls?\b/i, t);
    // Any sentence linking a finished recall to safety must be negated ("does not mean ... safe").
    for (const sentence of t.split(/(?<=\.)\s/)) if (/(completed|terminated|closed)/i.test(sentence) && /\bsafe\b/i.test(sentence)) assert.match(sentence, /does not mean/, sentence);
  }
  assert.match(COPY.result.record.statusNote, /does not mean the product is safe/);
});
