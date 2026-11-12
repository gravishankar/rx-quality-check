/**
 * Pure reducer tests: every transition of docs/ARCHITECTURE.md §4.3, retry and rate-limit budgets,
 * user-confirmation gating, and seeded property tests over random event sequences.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKOFF_MS,
  emptyContext,
  exclusionKeyOf,
  initialState,
  reduce,
  type Effect,
  type StateName,
  type WorkflowContext,
  type WorkflowEvent,
  type WorkflowState,
} from '../../mobile/src/state/machine.ts';
import type { ExclusionDecision } from '../../mobile/src/models/policy.ts';
import type { LabelExtraction, MedicationIdentity } from '../../mobile/src/models/identity.ts';
import type { RecallEvidenceBundle, RecallFinding } from '../../mobile/src/models/evidence.ts';
import { apiNdcRecord, productIdentity } from '../helpers/fixtures.ts';

// ---------------------------------------------------------------- builders (format-only values)

const X: LabelExtraction = {
  ndcTexts: [{ value: '68180-455-01', origin: 'OCR', confidence: 0.97, confirmedByUser: false }],
  drugName: { value: 'AMLODIPINE BESYLATE', origin: 'OCR', confidence: 0.95, confirmedByUser: false },
  strength: { value: '5 MG', origin: 'OCR', confidence: 0.95, confirmedByUser: false },
  doseForm: null,
  labelerText: null,
  lot: { value: 'G304799', origin: 'OCR', confidence: 0.8, confirmedByUser: false },
  expiry: null,
  containerType: 'PHARMACY_VIAL',
};
const ID: MedicationIdentity = productIdentity(apiNdcRecord('ndc_amlodipine'), '68180-455-01');
const ID2: MedicationIdentity = { ...ID, productNdc: '68180-751', packageNdc: null };
const ELIGIBLE: ExclusionDecision = { decision: 'ELIGIBLE', catalogDrugId: 'amlodipine', matchedBy: 'NAME', policyVersion: 'p', catalogVersion: 'c' };
const EXCLUDED: ExclusionDecision = { decision: 'EXCLUDED', reason: 'POLICY_LISTED_EXCLUDED', ingredient: 'warfarin', classId: 'ANTICOAGULANT', rationale: 'r', policyVersion: 'p' };
const UNSUPPORTED: ExclusionDecision = { decision: 'UNSUPPORTED', reason: 'NOT_IN_CATALOG', detail: 'd', policyVersion: 'p', catalogVersion: 'c' };
const CLARIFY: ExclusionDecision = { decision: 'NEEDS_CLARIFICATION', reason: 'POLICY_INDICATION_DEPENDENT', ingredient: 'everolimus', classId: 'T', policyVersion: 'p' };
const BUNDLE: RecallEvidenceBundle = { plan: { queries: [], positiveControl: { query: { id: 'control', kind: 'POSITIVE_CONTROL', search: 's', pageLimit: 1 }, recallNumber: 'D', expectedProductNdc: '1-1' } }, results: [], evaluatedAt: 't' };
const OK_META = { source: 'OPENFDA' as const, url: 'u', httpStatus: 200, retrievedAt: 't', elapsedMs: 0, headers: {} };
const PARTIAL: RecallEvidenceBundle = {
  ...BUNDLE,
  results: [{ queryId: 'product_ndc', pages: [{ kind: 'OK', data: { meta: { last_updated: 'x', results: { skip: 0, limit: 1, total: 0 } }, results: [] }, meta: OK_META }] }],
};
const FINDING = { finding: 'POTENTIAL_MATCH' } as unknown as RecallFinding;

// States after CHECK_EXCLUSION carry the decision for this identity; states after CONFIRM also carry
// the user's confirmation and the retrieved evidence — exactly what the real flow records, and what
// the mandatory safety gates require (RX_SAFETY_GATES).
const KEY = exclusionKeyOf(ID);
const DECIDED: Partial<WorkflowContext> = { exclusion: ELIGIBLE, exclusionKey: KEY };
const CONFIRMED: Partial<WorkflowContext> = {
  ...DECIDED,
  requiredConfirmations: ['identity'],
  confirmation: { fields: ['identity'], exclusionKey: KEY },
  bundle: BUNDLE,
};
const AFTER_CONFIRM = new Set<StateName>(['FETCH_EVIDENCE', 'RETRY', 'RATE_LIMITED', 'SOURCE_UNAVAILABLE', 'OFFLINE_CACHED_RESULT', 'EVALUATE', 'EXPLAIN', 'SAVE', 'SAVED']);
const at = (name: StateName, over: Partial<WorkflowContext> = {}): WorkflowState => ({
  name,
  ctx: {
    ...emptyContext(),
    extraction: X,
    identity: ID,
    ...(name === 'CONFIRM' ? DECIDED : {}),
    ...(AFTER_CONFIRM.has(name) ? CONFIRMED : {}),
    ...over,
  },
});
const types = (effects: Effect[]) => effects.map((e) => e.type);

// ---------------------------------------------------------------- transition table (§4.3)

const TABLE: [string, WorkflowState, WorkflowEvent, StateName, string[]][] = [
  ['SCAN + CAPTURED', initialState(), { type: 'CAPTURED', capture: { kind: 'IMAGE', imageRef: 'mem://1' } }, 'EXTRACT', ['RUN_EXTRACTION']],
  ['SCAN + manual entry', initialState(), { type: 'CAPTURED', capture: { kind: 'MANUAL', extraction: X } }, 'EXTRACT', ['RUN_EXTRACTION']],
  ['EXTRACT + EXTRACTED', at('EXTRACT'), { type: 'EXTRACTED', extraction: X }, 'IDENTIFY', ['RESOLVE_IDENTITY']],
  ['EXTRACT + EXTRACTION_EMPTY', at('EXTRACT'), { type: 'EXTRACTION_EMPTY' }, 'MISSING_INFORMATION', []],
  ['IDENTIFY + IDENTITY_RESOLVED', at('IDENTIFY'), { type: 'IDENTITY_RESOLVED', identity: ID }, 'CHECK_EXCLUSION', ['CHECK_EXCLUSION']],
  ['IDENTIFY + IDENTITY_PARTIAL', at('IDENTIFY'), { type: 'IDENTITY_PARTIAL', identity: { ...ID, level: 'CLINICAL_DRUG', productNdc: null } }, 'CHECK_EXCLUSION', ['CHECK_EXCLUSION']],
  ['IDENTIFY + IDENTITY_AMBIGUOUS', at('IDENTIFY'), { type: 'IDENTITY_AMBIGUOUS', options: [ID, ID2] }, 'AMBIGUOUS_IDENTITY', []],
  ['IDENTIFY + CROSS_VALIDATION_FAILED (first)', at('IDENTIFY'), { type: 'CROSS_VALIDATION_FAILED', detail: 'STRENGTH_MISMATCH' }, 'IDENTIFY', ['RESOLVE_IDENTITY']],
  ['IDENTIFY + CROSS_VALIDATION_FAILED (after discard)', at('IDENTIFY', { ndcDiscarded: true }), { type: 'CROSS_VALIDATION_FAILED', detail: 'x' }, 'MISSING_INFORMATION', []],
  ['IDENTIFY + NDC_REJECTED (first)', at('IDENTIFY'), { type: 'NDC_REJECTED' }, 'IDENTIFY', ['RESOLVE_IDENTITY']],
  ['IDENTIFY + IDENTITY_INCOMPLETE', at('IDENTIFY'), { type: 'IDENTITY_INCOMPLETE', missing: ['strength'] }, 'MISSING_INFORMATION', []],
  ['IDENTIFY + LOOKUP_UNAVAILABLE', at('IDENTIFY'), { type: 'LOOKUP_UNAVAILABLE', detail: 'HTTP_5XX' }, 'RETRY', ['SCHEDULE_RETRY']],
  ['IDENTIFY + LOOKUP_RATE_LIMITED', at('IDENTIFY'), { type: 'LOOKUP_RATE_LIMITED', retryAfterSeconds: 5 }, 'RATE_LIMITED', ['SCHEDULE_RETRY']],
  ['AMBIGUOUS + CANDIDATE_CHOSEN', at('AMBIGUOUS_IDENTITY', { identityOptions: [ID, ID2] }), { type: 'CANDIDATE_CHOSEN', index: 1 }, 'CHECK_EXCLUSION', ['CHECK_EXCLUSION']],
  ['AMBIGUOUS + EDIT_REQUESTED', at('AMBIGUOUS_IDENTITY', { identityOptions: [ID, ID2] }), { type: 'EDIT_REQUESTED' }, 'USER_CORRECTION', []],
  ['CHECK_EXCLUSION → EXCLUDED', at('CHECK_EXCLUSION'), { type: 'EXCLUSION_DECIDED', decision: EXCLUDED, requiredConfirmations: [] }, 'EXCLUDED', []],
  ['CHECK_EXCLUSION → UNSUPPORTED', at('CHECK_EXCLUSION'), { type: 'EXCLUSION_DECIDED', decision: UNSUPPORTED, requiredConfirmations: [] }, 'UNSUPPORTED', []],
  ['CHECK_EXCLUSION → NEEDS_CLARIFICATION', at('CHECK_EXCLUSION'), { type: 'EXCLUSION_DECIDED', decision: CLARIFY, requiredConfirmations: [] }, 'NEEDS_CLARIFICATION', []],
  ['CHECK_EXCLUSION → CONFIRM', at('CHECK_EXCLUSION'), { type: 'EXCLUSION_DECIDED', decision: ELIGIBLE, requiredConfirmations: ['identity'] }, 'CONFIRM', []],
  ['CONFIRM + USER_CONFIRMED', at('CONFIRM', { exclusion: ELIGIBLE, requiredConfirmations: ['identity'] }), { type: 'USER_CONFIRMED', confirmedFields: ['identity'], lot: null }, 'FETCH_EVIDENCE', ['FETCH_RECALL_EVIDENCE']],
  ['CONFIRM + EDIT_REQUESTED', at('CONFIRM'), { type: 'EDIT_REQUESTED' }, 'USER_CORRECTION', []],
  ['USER_CORRECTION + FIELDS_UPDATED', at('USER_CORRECTION'), { type: 'FIELDS_UPDATED', extraction: X }, 'IDENTIFY', ['RESOLVE_IDENTITY']],
  ['MISSING_INFORMATION + FIELDS_UPDATED', at('MISSING_INFORMATION'), { type: 'FIELDS_UPDATED', extraction: X }, 'IDENTIFY', ['RESOLVE_IDENTITY']],
  ['FETCH + EVIDENCE_READY', at('FETCH_EVIDENCE'), { type: 'EVIDENCE_READY', bundle: BUNDLE }, 'EVALUATE', ['EVALUATE_EVIDENCE']],
  ['FETCH + SOURCE_FAILED', at('FETCH_EVIDENCE'), { type: 'SOURCE_FAILED', detail: 'x', partial: null }, 'RETRY', ['SCHEDULE_RETRY']],
  ['FETCH + RATE_LIMITED', at('FETCH_EVIDENCE'), { type: 'RATE_LIMITED', retryAfterSeconds: null, partial: null }, 'RATE_LIMITED', ['SCHEDULE_RETRY']],
  ['RETRY + RETRY_DUE (fetch)', at('RETRY', { failedStep: 'FETCH_EVIDENCE', attempts: 1, retryPending: true }), { type: 'RETRY_DUE' }, 'FETCH_EVIDENCE', ['FETCH_RECALL_EVIDENCE']],
  ['RETRY + RETRY_DUE (identify)', at('RETRY', { failedStep: 'IDENTIFY', attempts: 1, retryPending: true }), { type: 'RETRY_DUE' }, 'IDENTIFY', ['RESOLVE_IDENTITY']],
  ['SOURCE_UNAVAILABLE + CACHE_AVAILABLE', at('SOURCE_UNAVAILABLE', { failedStep: 'FETCH_EVIDENCE' }), { type: 'CACHE_AVAILABLE', cached: { identity: ID, finding: FINDING, evaluatedAt: 't' } }, 'OFFLINE_CACHED_RESULT', []],
  ['RATE_LIMITED + CACHE_AVAILABLE', at('RATE_LIMITED', { failedStep: 'FETCH_EVIDENCE' }), { type: 'CACHE_AVAILABLE', cached: { identity: ID, finding: FINDING, evaluatedAt: 't' } }, 'OFFLINE_CACHED_RESULT', []],
  ['SOURCE_UNAVAILABLE + USER_RETRY', at('SOURCE_UNAVAILABLE', { failedStep: 'FETCH_EVIDENCE', attempts: 3 }), { type: 'USER_RETRY' }, 'FETCH_EVIDENCE', ['FETCH_RECALL_EVIDENCE']],
  ['OFFLINE_CACHED_RESULT + USER_RETRY', at('OFFLINE_CACHED_RESULT', { failedStep: 'FETCH_EVIDENCE' }), { type: 'USER_RETRY' }, 'FETCH_EVIDENCE', ['FETCH_RECALL_EVIDENCE']],
  ['EVALUATE + ASSESSED', at('EVALUATE'), { type: 'ASSESSED', finding: FINDING, explanation: { headline: 'RESULT_POTENTIAL_MATCH', sections: [] } }, 'EXPLAIN', []],
  ['EXPLAIN + SAVE_REQUESTED', at('EXPLAIN', { finding: FINDING }), { type: 'SAVE_REQUESTED' }, 'SAVE', ['PERSIST_ASSESSMENT']],
  ['SAVE + PERSISTED', at('SAVE', { finding: FINDING }), { type: 'PERSISTED' }, 'SAVED', []],
  ['SAVE + PERSIST_FAILED', at('SAVE', { finding: FINDING }), { type: 'PERSIST_FAILED', detail: 'disk full' }, 'EXPLAIN', []],
  ['EXPLAIN + DONE', at('EXPLAIN'), { type: 'DONE' }, 'SCAN', []],
  ['EXCLUDED + RESTART', at('EXCLUDED'), { type: 'RESTART' }, 'SCAN', []],
  ['NEEDS_CLARIFICATION + EDIT_REQUESTED', at('NEEDS_CLARIFICATION'), { type: 'EDIT_REQUESTED' }, 'USER_CORRECTION', []],
];

for (const [label, from, event, to, effects] of TABLE) {
  test(`transition: ${label} → ${to}`, () => {
    const t = reduce(from, event);
    assert.equal(t.state.name, to);
    assert.deepEqual(types(t.effects), effects);
    assert.equal(t.ignored, false);
  });
}

test('unknown events leave the state unchanged and are flagged', () => {
  const s = at('CONFIRM', { exclusion: ELIGIBLE });
  for (const e of [{ type: 'EVIDENCE_READY', bundle: BUNDLE }, { type: 'RETRY_DUE' }, { type: 'PERSISTED' }] as WorkflowEvent[]) {
    const t = reduce(s, e);
    assert.equal(t.state, s);
    assert.equal(t.ignored, true);
    assert.deepEqual(t.effects, []);
  }
});

// ---------------------------------------------------------------- confirmation gating

test('CONFIRM: evidence is fetched only after every required field is confirmed', () => {
  const s = at('CONFIRM', { exclusion: ELIGIBLE, requiredConfirmations: ['identity', 'lot', 'strength'] });
  const partial = reduce(s, { type: 'USER_CONFIRMED', confirmedFields: ['identity'], lot: 'G304799' });
  assert.equal(partial.state.name, 'CONFIRM');
  assert.deepEqual(partial.state.ctx.unconfirmed, ['lot', 'strength']);
  assert.deepEqual(partial.effects, []);
  const full = reduce(s, { type: 'USER_CONFIRMED', confirmedFields: ['identity', 'lot', 'strength'], lot: 'G304799' });
  assert.equal(full.state.name, 'FETCH_EVIDENCE');
  const fetch = full.effects[0];
  assert.ok(fetch?.type === 'FETCH_RECALL_EVIDENCE' && fetch.identity.lot === 'G304799');
});

test('CONFIRM: an unprinted release mechanism must be stated by the user', () => {
  const s = at('CONFIRM', { exclusion: ELIGIBLE, identity: { ...ID, release: 'UNSPECIFIED' }, requiredConfirmations: ['identity', 'release'] });
  const without = reduce(s, { type: 'USER_CONFIRMED', confirmedFields: ['identity', 'release'], lot: null });
  assert.equal(without.state.name, 'CONFIRM');
  const withRelease = reduce(s, { type: 'USER_CONFIRMED', confirmedFields: ['identity', 'release'], lot: null, release: 'ER' });
  assert.equal(withRelease.state.name, 'FETCH_EVIDENCE');
  assert.equal(withRelease.state.ctx.identity?.release, 'ER');
});

test('CONFIRM: an empty lot is treated as "no lot"', () => {
  const s = at('CONFIRM', { exclusion: ELIGIBLE, requiredConfirmations: [] });
  const t = reduce(s, { type: 'USER_CONFIRMED', confirmedFields: [], lot: '   ' });
  assert.equal(t.state.ctx.identity?.lot, null);
});

test('a RETRY_DUE with no outstanding retry (late timer) is ignored', () => {
  assert.equal(reduce(at('RETRY', { failedStep: 'FETCH_EVIDENCE', attempts: 1, retryPending: false }), { type: 'RETRY_DUE' }).ignored, true);
});

test('IDENTIFY: an ambiguity "with one option" is not accepted as ambiguous', () => {
  const t = reduce(at('IDENTIFY'), { type: 'IDENTITY_AMBIGUOUS', options: [ID] });
  assert.equal(t.ignored, true);
});

// ---------------------------------------------------------------- retry and rate limits

test('retry budget: 3 attempts with 2 s / 4 s backoff, then SOURCE_UNAVAILABLE and a cache lookup', () => {
  let s = at('FETCH_EVIDENCE', { exclusion: ELIGIBLE });
  const delays: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = reduce(s, { type: 'SOURCE_FAILED', detail: 'HTTP_5XX', partial: null });
    s = t.state;
    for (const e of t.effects) if (e.type === 'SCHEDULE_RETRY') delays.push(e.delayMs);
    if (s.name === 'RETRY') s = reduce(s, { type: 'RETRY_DUE' }).state;
  }
  assert.deepEqual(delays, [BACKOFF_MS[0], BACKOFF_MS[1]]);
  assert.equal(s.name, 'SOURCE_UNAVAILABLE');
  assert.equal(reduce(s, { type: 'CACHE_MISSING' }).state.name, 'SOURCE_UNAVAILABLE');
});

test('retry exhausted with evidence already retrieved → EVALUATE (a known recall is never hidden by a later failure)', () => {
  const s = at('FETCH_EVIDENCE', { exclusion: ELIGIBLE, attempts: 2 });
  const t = reduce(s, { type: 'SOURCE_FAILED', detail: 'x', partial: PARTIAL });
  assert.equal(t.state.name, 'EVALUATE');
  assert.deepEqual(types(t.effects), ['EVALUATE_EVIDENCE']);
});

test('rate limit: one automatic retry honoring Retry-After, then user-initiated only', () => {
  const s0 = at('FETCH_EVIDENCE', { exclusion: ELIGIBLE });
  const t1 = reduce(s0, { type: 'RATE_LIMITED', retryAfterSeconds: 30, partial: null });
  assert.equal(t1.state.name, 'RATE_LIMITED');
  assert.deepEqual(t1.effects, [{ type: 'SCHEDULE_RETRY', delayMs: 30_000 }]);
  const t2 = reduce(t1.state, { type: 'RETRY_DUE' });
  assert.equal(t2.state.name, 'FETCH_EVIDENCE');
  const t3 = reduce(t2.state, { type: 'RATE_LIMITED', retryAfterSeconds: 30, partial: null });
  assert.equal(t3.state.name, 'RATE_LIMITED');
  assert.deepEqual(types(t3.effects), ['LOAD_CACHED_RESULT'], 'no second automatic retry');
  assert.equal(reduce(t3.state, { type: 'RETRY_DUE' }).ignored, true);
  assert.equal(reduce(t3.state, { type: 'USER_RETRY' }).state.name, 'FETCH_EVIDENCE');
});

// ---------------------------------------------------------------- seeded property tests

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EVENT_POOL: WorkflowEvent[] = [
  { type: 'CAPTURED', capture: { kind: 'MANUAL', extraction: X } },
  { type: 'EXTRACTED', extraction: X },
  { type: 'EXTRACTION_EMPTY' },
  { type: 'IDENTITY_RESOLVED', identity: ID },
  { type: 'IDENTITY_PARTIAL', identity: { ...ID, level: 'CLINICAL_DRUG', productNdc: null } },
  { type: 'IDENTITY_AMBIGUOUS', options: [ID, ID2] },
  { type: 'CROSS_VALIDATION_FAILED', detail: 'x' },
  { type: 'NDC_REJECTED' },
  { type: 'IDENTITY_INCOMPLETE', missing: ['strength'] },
  { type: 'LOOKUP_UNAVAILABLE', detail: 'x' },
  { type: 'LOOKUP_RATE_LIMITED', retryAfterSeconds: 1 },
  { type: 'CANDIDATE_CHOSEN', index: 0 },
  { type: 'EDIT_REQUESTED' },
  { type: 'FIELDS_UPDATED', extraction: X },
  { type: 'EXCLUSION_DECIDED', decision: EXCLUDED, requiredConfirmations: [] },
  { type: 'EXCLUSION_DECIDED', decision: UNSUPPORTED, requiredConfirmations: [] },
  { type: 'EXCLUSION_DECIDED', decision: CLARIFY, requiredConfirmations: [] },
  { type: 'EXCLUSION_DECIDED', decision: ELIGIBLE, requiredConfirmations: ['identity', 'lot'] },
  { type: 'USER_CONFIRMED', confirmedFields: ['identity'], lot: null },
  { type: 'USER_CONFIRMED', confirmedFields: ['identity', 'lot'], lot: 'G304799' },
  { type: 'EVIDENCE_READY', bundle: BUNDLE },
  { type: 'SOURCE_FAILED', detail: 'x', partial: null },
  { type: 'SOURCE_FAILED', detail: 'x', partial: PARTIAL },
  { type: 'RATE_LIMITED', retryAfterSeconds: 2, partial: null },
  { type: 'RETRY_DUE' },
  { type: 'USER_RETRY' },
  { type: 'CACHE_AVAILABLE', cached: { identity: ID, finding: FINDING, evaluatedAt: 't' } },
  { type: 'CACHE_MISSING' },
  { type: 'ASSESSED', finding: FINDING, explanation: { headline: 'RESULT_POTENTIAL_MATCH', sections: [] } },
  { type: 'SAVE_REQUESTED' },
  { type: 'PERSISTED' },
  { type: 'PERSIST_FAILED', detail: 'x' },
  { type: 'DONE' },
  { type: 'RESTART' },
];

test('property (RG-3): a recall fetch is emitted only for an ELIGIBLE, fully confirmed identity', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const rnd = prng(seed);
    let s = initialState();
    for (let step = 0; step < 120; step++) {
      const e = EVENT_POOL[Math.floor(rnd() * EVENT_POOL.length)] as WorkflowEvent;
      const t = reduce(s, e);
      for (const eff of t.effects) {
        if (eff.type === 'FETCH_RECALL_EVIDENCE') {
          assert.equal(t.state.ctx.exclusion?.decision, 'ELIGIBLE', `seed ${seed} step ${step}`);
          assert.deepEqual(t.state.ctx.unconfirmed, [], `seed ${seed} step ${step}`);
          assert.ok(['CONFIRM', 'RETRY', 'RATE_LIMITED', 'SOURCE_UNAVAILABLE', 'OFFLINE_CACHED_RESULT'].includes(s.name), `from ${s.name}`);
        }
      }
      // Excluded / unsupported / needs-clarification never emit any effect at all.
      if (['EXCLUDED', 'UNSUPPORTED', 'NEEDS_CLARIFICATION'].includes(s.name)) assert.deepEqual(t.effects, []);
      s = t.state;
    }
  }
});

test('property: automatic retries are bounded (≤ 2 backoff retries per failure streak, ≤ 1 rate-limit retry per fetch)', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const rnd = prng(seed);
    let s = initialState();
    let backoffStreak = 0;
    let rlRetries = 0;
    for (let step = 0; step < 150; step++) {
      const e = EVENT_POOL[Math.floor(rnd() * EVENT_POOL.length)] as WorkflowEvent;
      const t = reduce(s, e);
      // A user action or a fresh confirmation starts a new budget.
      if (e.type === 'USER_RETRY' || e.type === 'USER_CONFIRMED' || t.state.ctx.attempts === 0) backoffStreak = 0;
      if (t.state.name === 'FETCH_EVIDENCE' && s.name === 'CONFIRM') rlRetries = 0;
      if (e.type === 'USER_RETRY' || (t.state.name === 'SCAN' && s.name !== 'SCAN')) rlRetries = 0;
      for (const eff of t.effects) {
        if (eff.type === 'SCHEDULE_RETRY' && t.state.name === 'RETRY') backoffStreak++;
        if (eff.type === 'SCHEDULE_RETRY' && t.state.name === 'RATE_LIMITED') rlRetries++;
      }
      assert.ok(backoffStreak <= 2, `seed ${seed}: ${backoffStreak} backoff retries`);
      assert.ok(rlRetries <= 1, `seed ${seed}: ${rlRetries} automatic rate-limit retries`);
      s = t.state;
    }
  }
});

test('property: the reducer is deterministic and never throws', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const run = () => {
      const rnd = prng(seed);
      let s = initialState();
      const names: string[] = [];
      for (let i = 0; i < 80; i++) {
        s = reduce(s, EVENT_POOL[Math.floor(rnd() * EVENT_POOL.length)] as WorkflowEvent).state;
        names.push(s.name);
      }
      return names;
    };
    assert.deepEqual(run(), run());
  }
});
