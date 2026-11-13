/**
 * Correctness finding C4 (review against b9c5989): FDA dataset dates that are malformed, impossible
 * or in the future must never support "no matching recall found". Real openFDA responses
 * (tests/fixtures/task2) with only `meta.last_updated` changed — each such change is SYNTHETIC.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRecallEvidence, planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import { presentResult } from '../../mobile/src/presentation/present.ts';
import type { EnforcementPage, RecallFinding } from '../../mobile/src/models/evidence.ts';
import type { MedicationIdentity } from '../../mobile/src/models/identity.ts';
import { apiNdcRecord, bundle, control, enf, enforcementOutcome, rawOf, realNoMatch, syntheticNetworkError, productIdentity } from '../helpers/fixtures.ts';

const EVAL_AT = '2026-11-12T12:00:00.000Z'; // fixtures/helpers evaluation time
const NOW = '2026-11-12T13:00:00.000Z';
const tamsulosin = (): MedicationIdentity => ({ ...productIdentity(apiNdcRecord('ndc_tamsulosin'), '71610-910-30'), sourceProductStatus: 'NOT_APPLICABLE' });

/** SYNTHETIC: the real response with meta.last_updated replaced. */
function withDate(name: string, date: string): EnforcementPage {
  const raw = rawOf(name);
  const body = JSON.parse(raw.bodyText) as { meta: { last_updated: string } };
  body.meta.last_updated = date;
  return enforcementOutcome({ ...raw, bodyText: JSON.stringify(body) });
}
const evaluate = (text: EnforcementPage[]) => {
  const id = tamsulosin();
  const f = evaluateRecallEvidence(id, bundle(planRecallQueries(id), { ingredient_text: text, product_ndc: [realNoMatch()], control: [control()] }));
  return { f, view: presentResult({ identity: id, finding: f, now: NOW }) };
};

test('C4 guard: the real dataset date supports a no-match', () => {
  const { f, view } = evaluate([enf('enf_text_tamsulosin')]);
  assert.equal(f.finding, 'NO_MATCH_FOUND');
  assert.equal(view.category, 'NO_MATCH');
});

for (const [label, date] of [
  ['malformed (not a date)', 'last week'],
  ['impossible calendar date', '2026-13-45'],
  ['empty', ''],
  ['future (after the evaluation)', '2027-01-01'],
] as const) {
  test(`C4 dataset date ${label} → never a no-match`, () => {
    const { f, view } = evaluate([withDate('enf_text_tamsulosin', date)]);
    assert.notEqual(f.finding, 'NO_MATCH_FOUND');
    assert.equal(f.coverage.complete, false);
    assert.ok(f.limitations.includes('DATASET_DATE_INVALID'), JSON.stringify(f.limitations));
    assert.notEqual(view.category, 'NO_MATCH');
  });
}

test('C4 presentation re-checks a saved finding whose dataset date is malformed or in the future', () => {
  const { f } = evaluate([enf('enf_text_tamsulosin')]);
  for (const ds of ['2026-02-30', 'not-a-date', '2027-01-01', '2026-11-04T00:00:00Z']) {
    const saved: RecallFinding = { ...f, coverage: { ...f.coverage, datasetLastUpdated: ds } };
    const view = presentResult({ identity: tamsulosin(), finding: saved, now: NOW });
    assert.notEqual(view.category, 'NO_MATCH', ds);
  }
});

test('C4 the dataset changed between pages of one query (dates differ) → inconsistent, not complete', () => {
  const id = tamsulosin();
  const p1 = enf('enf_text_amlodipine_p1');
  const p2 = withDate('enf_text_amlodipine_p2', '2026-11-11'); // SYNTHETIC: a later dataset on page 2
  const amlo = { ...productIdentity(apiNdcRecord('ndc_amlodipine'), '68180-455-01'), sourceProductStatus: 'NOT_APPLICABLE' as const };
  const f = evaluateRecallEvidence(amlo, bundle(planRecallQueries(amlo), { ingredient_text: [p1, p2], product_ndc: [enf('enf_pndc_68180-455')], control: [control()] }));
  assert.equal(f.coverage.queries.find((q) => q.queryId === 'ingredient_text')?.status, 'INCONSISTENT_PAGINATION');
  assert.equal(f.coverage.complete, false);
  void id;
});

test('C4 guard: a later-page failure is never a no-match', () => {
  const amlo = { ...productIdentity(apiNdcRecord('ndc_amlodipine'), '68180-455-01'), sourceProductStatus: 'NOT_APPLICABLE' as const };
  const f = evaluateRecallEvidence(amlo, bundle(planRecallQueries(amlo), { ingredient_text: [enf('enf_text_amlodipine_p1'), syntheticNetworkError()], product_ndc: [enf('enf_pndc_68180-455')], control: [control()] }));
  assert.equal(f.coverage.complete, false);
  assert.notEqual(f.finding, 'NO_MATCH_FOUND');
});

test('C4 the evaluation time itself must be valid and not in the future', () => {
  const { f } = evaluate([enf('enf_text_tamsulosin')]);
  for (const at of ['garbage', '2026-11-13T12:00:00.000Z']) {
    assert.notEqual(presentResult({ identity: tamsulosin(), finding: { ...f, evaluatedAt: at }, now: NOW }).category, 'NO_MATCH', at);
  }
  void EVAL_AT;
});
