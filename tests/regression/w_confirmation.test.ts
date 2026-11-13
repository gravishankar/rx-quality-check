/**
 * Review items 10 and 11: the confirmation step. Engine requirements, the screen model and the event
 * built from the patient's choices must agree; a scanned lot is used only when the patient confirms
 * it, and the patient can continue without it; an unknown release mechanism is never a guess.
 * Product is real (Lupin amlodipine 68180-455); the scanned label fields are SYNTHETIC.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyContext, exclusionKeyOf, reduce, type WorkflowState } from '../../mobile/src/state/machine.ts';
import { confirmationEvent, screenFor } from '../../mobile/src/app/screens.ts';
import type { LabelExtraction, MedicationIdentity } from '../../mobile/src/models/identity.ts';
import type { ExclusionDecision } from '../../mobile/src/models/policy.ts';
import { apiNdcRecord, productIdentity } from '../helpers/fixtures.ts';

const X: LabelExtraction = {
  ndcTexts: [{ value: '68180-455-01', origin: 'BARCODE', confidence: 1, confirmedByUser: false }],
  drugName: { value: 'AMLODIPINE BESYLATE', origin: 'OCR', confidence: 0.95, confirmedByUser: false },
  strength: { value: '5 MG', origin: 'OCR', confidence: 0.95, confirmedByUser: false },
  doseForm: null, labelerText: null,
  lot: { value: 'SYNTH123', origin: 'OCR', confidence: 0.8, confirmedByUser: false },
  expiry: null, containerType: 'PHARMACY_VIAL',
};
const ID: MedicationIdentity = productIdentity(apiNdcRecord('ndc_amlodipine'), '68180-455-01');
const ELIGIBLE: ExclusionDecision = { decision: 'ELIGIBLE', catalogDrugId: 'amlodipine', matchedBy: 'NAME', policyVersion: 'p', catalogVersion: 'c' };
const confirmState = (required: string[], identity = ID): WorkflowState => ({
  name: 'CONFIRM',
  ctx: { ...emptyContext(), extraction: X, identity, exclusion: ELIGIBLE, exclusionKey: exclusionKeyOf(identity), requiredConfirmations: required, unconfirmed: required },
});
const model = (s: WorkflowState) => {
  const m = screenFor(s, { now: '2026-11-12T12:00:00.000Z', persistHistory: false });
  assert.equal(m.kind, 'CONFIRM');
  return m as Extract<typeof m, { kind: 'CONFIRM' }>;
};

test('item 10: the screen model states every requirement the engine has, including the lot', () => {
  const m = model(confirmState(['identity', 'lot']));
  assert.deepEqual([...m.required].sort(), ['identity', 'lot']);
  assert.equal(m.lotChoiceRequired, true);
});

test('item 10: confirming the identity without deciding about a scanned lot does not start a check (and the screen says why)', () => {
  const s = confirmState(['identity', 'lot']);
  assert.equal(model(s).ready({ ticked: ['identity'], lotChoice: null, release: null }), false);
});

test('item 10: "continue without the lot" starts the check with no lot', () => {
  const s = confirmState(['identity', 'lot']);
  assert.equal(model(s).ready({ ticked: ['identity'], lotChoice: 'NOT_USED', release: null }), true);
  const t = reduce(s, confirmationEvent(['identity'], 'SYNTH123', null, 'NOT_USED'));
  assert.equal(t.state.name, 'FETCH_EVIDENCE', JSON.stringify(t.rejectedBy));
  assert.equal(t.state.ctx.identity?.lot, null);
});

test('item 10: "use this lot" uses the confirmed lot', () => {
  const s = confirmState(['identity', 'lot']);
  const t = reduce(s, confirmationEvent(['identity'], 'SYNTH123', null, 'USE'));
  assert.equal(t.state.name, 'FETCH_EVIDENCE');
  assert.equal(t.state.ctx.identity?.lot, 'SYNTH123');
});

test('item 10: an unconfirmed scanned lot is never used', () => {
  const s = confirmState(['identity']);
  const t = reduce(s, confirmationEvent(['identity'], 'SYNTH123', null, null));
  assert.equal(t.state.ctx.identity?.lot ?? null, null);
});

test('item 11: "I can\'t tell" for the release mechanism never becomes a confirmed identity', () => {
  const unspecified: MedicationIdentity = { ...ID, release: 'UNSPECIFIED' };
  const s = confirmState(['identity', 'release'], unspecified);
  const m = model(s);
  assert.equal(m.askRelease, true);
  assert.equal(m.ready({ ticked: ['identity'], lotChoice: 'NOT_USED', release: 'UNKNOWN' }), false);
  assert.ok(m.releaseUnknownHelp.length > 0, 'guidance on where to find it and to ask a pharmacist');
  const t = reduce(s, confirmationEvent(['identity'], null, 'UNKNOWN', 'NOT_USED'));
  assert.notEqual(t.state.name, 'FETCH_EVIDENCE');
});
