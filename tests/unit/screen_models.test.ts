/**
 * Screen-model branches not reached by the recorded end-to-end scenarios. States are built from the
 * real initial state with the state name and context fields set directly (SYNTHETIC states; no
 * evidence is invented — results come from the engine on real fixtures).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmationEvent, screenFor } from '../../mobile/src/app/screens.ts';
import { initialState } from '../../mobile/src/engine/runner.ts';
import { COPY } from '../../mobile/src/copy/en.ts';
import type { StateName, WorkflowState } from '../../mobile/src/state/machine.ts';
import { evaluateRecallEvidence, planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import { apiNdcRecord, bundle, control, enf, productIdentity, realNoMatch } from '../helpers/fixtures.ts';

const O = { now: '2026-11-12T13:00:00.000Z', persistHistory: false };
const at = (name: StateName, ctx: Partial<WorkflowState['ctx']> = {}): WorkflowState => {
  const s = initialState();
  return { name, ctx: { ...s.ctx, ...ctx } };
};

test('working states show progress text only', () => {
  for (const n of ['SCAN', 'EXTRACT', 'IDENTIFY', 'CHECK_EXCLUSION', 'FETCH_EVIDENCE', 'EVALUATE', 'RETRY', 'SAVE'] as const) {
    assert.equal(screenFor(at(n), O).kind, 'WORKING');
  }
});

test('missing information and NDC not found map to entry problems', () => {
  const m = screenFor(at('MISSING_INFORMATION', { missing: ['strength'] }), O);
  assert.ok(m.kind === 'ENTRY_PROBLEM' && m.text === COPY.errors.missing && m.missing[0] === 'strength');
  const nf = screenFor(at('USER_CORRECTION', { lastFailure: 'NOT_FOUND' }), O);
  assert.ok(nf.kind === 'ENTRY_PROBLEM' && nf.text === COPY.errors.notFound);
});

test('ambiguous identity lists every option for the user to choose; nothing is pre-selected', () => {
  const a = productIdentity(apiNdcRecord('ndc_tamsulosin'), null);
  const m = screenFor(at('AMBIGUOUS_IDENTITY', { identityOptions: [a, { ...a, productNdc: '00000-000' }] }), O);
  assert.ok(m.kind === 'CHOOSE_PRODUCT' && m.options.length === 2 && m.options[0]!.fields.length > 0);
});

test('rate limited and source unavailable offer retry and say nothing was checked', () => {
  for (const n of ['RATE_LIMITED', 'SOURCE_UNAVAILABLE'] as const) {
    const m = screenFor(at(n), O);
    assert.ok(m.kind === 'SOURCE_PROBLEM' && m.canRetry && /Nothing was checked/.test(m.body));
  }
});

test('states missing their data never render a result', () => {
  assert.equal(screenFor(at('EXPLAIN'), O).kind, 'SOURCE_PROBLEM');
  assert.equal(screenFor(at('CONFIRM'), O).kind, 'SOURCE_PROBLEM');
  assert.equal(screenFor(at('EXCLUDED'), O).kind, 'SOURCE_PROBLEM');
});

test('offline cached result: labeled as saved, and stale data is not shown as a no-match', () => {
  const id = { ...productIdentity(apiNdcRecord('ndc_tamsulosin'), '71610-910-30'), sourceProductStatus: 'NOT_APPLICABLE' as const };
  const f = { ...evaluateRecallEvidence(id, bundle(planRecallQueries(id), { ingredient_text: [enf('enf_text_tamsulosin')], product_ndc: [realNoMatch()], control: [control()] })), evaluatedAt: '2026-11-10T12:00:00.000Z' };
  const m = screenFor(at('OFFLINE_CACHED_RESULT', { cached: { identity: id, finding: f, evaluatedAt: f.evaluatedAt } }), O);
  assert.ok(m.kind === 'RESULT');
  if (m.kind !== 'RESULT') return;
  assert.equal(m.view.category, 'UNABLE', 'two days old');
  assert.ok(m.view.qualifiers[0]?.startsWith('You are seeing a saved result'));
  assert.equal(m.canSave, false);
});

test('saving is offered only when the build persists history', () => {
  const id = { ...productIdentity(apiNdcRecord('ndc_tamsulosin'), '71610-910-30'), sourceProductStatus: 'NOT_APPLICABLE' as const };
  const f = evaluateRecallEvidence(id, bundle(planRecallQueries(id), { ingredient_text: [enf('enf_text_tamsulosin')], product_ndc: [realNoMatch()], control: [control()] }));
  const s = at('EXPLAIN', { identity: id, finding: { ...f, evaluatedAt: '2026-11-12T12:00:00.000Z' } });
  const off = screenFor(s, O);
  const on = screenFor(s, { ...O, persistHistory: true });
  assert.ok(off.kind === 'RESULT' && !off.canSave);
  assert.ok(on.kind === 'RESULT' && on.canSave);
});

test('confirmation event: lot sent only if its item was ticked; release recorded when answered', () => {
  assert.deepEqual(confirmationEvent(['identity'], 'ABC123', null), { type: 'USER_CONFIRMED', confirmedFields: ['identity'], lot: null });
  assert.deepEqual(confirmationEvent(['lot', 'identity'], 'ABC123', 'ER'), { type: 'USER_CONFIRMED', confirmedFields: ['identity', 'lot', 'release'], lot: 'ABC123', release: 'ER' });
});

test('confirmation: an NDC that is not in the FDA directory is reported (OD-23); typed lot shown as entered, not confirmed', async () => {
  const { identityFromPrintedFields } = await import('../../mobile/src/rules/identity.ts');
  const r = identityFromPrintedFields({ drugName: 'METFORMIN', strength: '500 MG', doseForm: 'TABLET' }, ['metformin'], null);
  assert.ok(r.ok);
  if (!r.ok) return;
  const extraction = { ndcTexts: [{ value: '00000-0000-00', origin: 'USER' as const, confidence: null, confirmedByUser: false }], drugName: null, strength: null, doseForm: null, labelerText: null, lot: { value: 'ABC123', origin: 'USER' as const, confidence: null, confirmedByUser: false }, expiry: null, containerType: 'UNKNOWN' as const };
  const m = screenFor(at('CONFIRM', { identity: r.identity, extraction, requiredConfirmations: ['identity'] }), O);
  assert.ok(m.kind === 'CONFIRM');
  if (m.kind !== 'CONFIRM') return;
  assert.equal(m.notice, COPY.confirm.ndcNotFound);
  const lot = m.fields.find((f) => f.key === 'lot')!;
  assert.equal(lot.value, 'ABC123');
  assert.equal(lot.evidence, 'USER_ENTERED', 'a typed lot is not "confirmed" until the user confirms it');
  const noNdc = screenFor(at('CONFIRM', { identity: r.identity, extraction: { ...extraction, ndcTexts: [] }, requiredConfirmations: ['identity'] }), O);
  assert.ok(noNdc.kind === 'CONFIRM' && noNdc.notice === null);
});

test('each result category has its own label; none is reassuring', () => {
  const l = COPY.result.categoryLabel;
  assert.equal(new Set([l.CONFIRMED, l.POTENTIAL, l.NO_MATCH, l.UNABLE]).size, 4);
  for (const x of Object.values(l)) assert.doesNotMatch(x, /\bsafe\b|clear|no recall\b|ok\b|passed/i);
});
