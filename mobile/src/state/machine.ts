/**
 * Deterministic workflow state machine (ARCHITECTURE §4).
 *
 *   SCAN → EXTRACT → IDENTIFY → CHECK_EXCLUSION → CONFIRM → FETCH_EVIDENCE → EVALUATE → EXPLAIN → SAVE
 *
 * Alternative states: AMBIGUOUS_IDENTITY, MISSING_INFORMATION, USER_CORRECTION, EXCLUDED,
 * UNSUPPORTED, NEEDS_CLARIFICATION, SOURCE_UNAVAILABLE, RATE_LIMITED, RETRY, OFFLINE_CACHED_RESULT,
 * SAVED.
 *
 * The reducer is pure: (state, event) → { state, effects }. It never performs I/O and never calls
 * rules; effects are descriptors executed by the effect runner (engine/runner.ts), which reports
 * results back as events. Unknown events leave the state unchanged (`ignored: true`).
 *
 * Structure (since the Task 2 refinement): transitions are an ordered, declarative rule table
 * (`RX_RULES`) run by the generic core in `fsm/core.ts`. Mandatory safety gates (`RX_SAFETY_GATES`)
 * are applied to every transition of every workflow variant built with `createRxWorkflow`, so
 * reordering, adding or removing rules cannot bypass the exclusion check, patient confirmation or
 * evidence evaluation. See docs/STATE_MACHINE_GUIDE.md.
 *
 * Safety properties (tested):
 *  - FETCH_RECALL_EVIDENCE is emitted only from CONFIRM after an ELIGIBLE exclusion decision and a
 *    complete user confirmation, or when retrying that same fetch. EXCLUDED, UNSUPPORTED and
 *    NEEDS_CLARIFICATION never lead to a recall request (RG-3).
 *  - Uncertain OCR fields and the lot must be confirmed before evidence is fetched.
 *  - Retries are bounded (3 attempts, 2/4/8 s); a rate-limited request is retried automatically at
 *    most once.
 */
import type { RecallEvidenceBundle, RecallFinding } from '../models/evidence.ts';
import type { Explanation } from '../models/explanation.ts';
import type { LabelExtraction, MedicationIdentity, ReleaseMechanism } from '../models/identity.ts';
import type { ExclusionDecision } from '../models/policy.ts';
import {
  createMachine,
  insertAfter,
  insertBefore,
  removeRule,
  replaceRule,
  type FsmEvent,
  type Gate,
  type Machine,
  type Outcome,
  type StepResult,
  type TransitionRule,
} from '../fsm/core.ts';

export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = [2000, 4000, 8000] as const;
export const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

export type StateName =
  | 'SCAN'
  | 'EXTRACT'
  | 'IDENTIFY'
  | 'CHECK_EXCLUSION'
  | 'CONFIRM'
  | 'FETCH_EVIDENCE'
  | 'EVALUATE'
  | 'EXPLAIN'
  | 'SAVE'
  | 'SAVED'
  | 'AMBIGUOUS_IDENTITY'
  | 'MISSING_INFORMATION'
  | 'USER_CORRECTION'
  | 'EXCLUDED'
  | 'UNSUPPORTED'
  | 'NEEDS_CLARIFICATION'
  | 'SOURCE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'RETRY'
  | 'OFFLINE_CACHED_RESULT';

export type RetryableStep = 'IDENTIFY' | 'FETCH_EVIDENCE';

export type Capture = { kind: 'IMAGE'; imageRef: string } | { kind: 'MANUAL'; extraction: LabelExtraction };

export interface CachedResult {
  identity: MedicationIdentity;
  finding: RecallFinding;
  /** When the cached assessment was evaluated (ISO-8601). */
  evaluatedAt: string;
}

export interface WorkflowContext {
  capture: Capture | null;
  extraction: LabelExtraction | null;
  identity: MedicationIdentity | null;
  identityOptions: MedicationIdentity[];
  ndcDiscarded: boolean;
  exclusion: ExclusionDecision | null;
  /** Exclusion-relevant fingerprint of the identity the decision was made for (see exclusionKeyOf). */
  exclusionKey: string | null;
  requiredConfirmations: string[];
  /**
   * Recorded only by a USER_CONFIRMED event: the fields the user confirmed, for the identity with
   * this exclusion key. Required by the safety gates before any evidence effect.
   */
  confirmation: { fields: string[]; exclusionKey: string } | null;
  unconfirmed: string[];
  missing: string[];
  bundle: RecallEvidenceBundle | null;
  finding: RecallFinding | null;
  explanation: Explanation | null;
  cached: CachedResult | null;
  failedStep: RetryableStep | null;
  attempts: number;
  rateLimitAutoRetried: boolean;
  /** True only while a SCHEDULE_RETRY is outstanding; a RETRY_DUE without one is ignored. */
  retryPending: boolean;
  lastFailure: string | null;
  saveError: string | null;
}

export interface WorkflowState {
  name: StateName;
  ctx: WorkflowContext;
}

export type WorkflowEvent =
  | { type: 'CAPTURED'; capture: Capture }
  | { type: 'EXTRACTED'; extraction: LabelExtraction }
  | { type: 'EXTRACTION_EMPTY' }
  | { type: 'IDENTITY_RESOLVED'; identity: MedicationIdentity }
  | { type: 'IDENTITY_PARTIAL'; identity: MedicationIdentity }
  | { type: 'IDENTITY_AMBIGUOUS'; options: MedicationIdentity[] }
  | { type: 'CROSS_VALIDATION_FAILED'; detail: string }
  | { type: 'NDC_REJECTED' }
  | { type: 'IDENTITY_INCOMPLETE'; missing: string[] }
  | { type: 'LOOKUP_UNAVAILABLE'; detail: string }
  | { type: 'LOOKUP_RATE_LIMITED'; retryAfterSeconds: number | null }
  | { type: 'CANDIDATE_CHOSEN'; index: number }
  | { type: 'EDIT_REQUESTED' }
  | { type: 'FIELDS_UPDATED'; extraction: LabelExtraction }
  /** `identity`: the identity the decision was made for, when enrichment changed it (Task 4A, OD-19). */
  | { type: 'EXCLUSION_DECIDED'; decision: ExclusionDecision; requiredConfirmations: string[]; identity?: MedicationIdentity }
  /**
   * The user reviewed the identity. `lot` is the lot the user confirmed (or null). `release` is
   * required when the identity's release mechanism was not printed (field 'release').
   */
  | { type: 'USER_CONFIRMED'; confirmedFields: string[]; lot: string | null; release?: ReleaseMechanism }
  | { type: 'EVIDENCE_READY'; bundle: RecallEvidenceBundle }
  | { type: 'SOURCE_FAILED'; detail: string; partial: RecallEvidenceBundle | null }
  | { type: 'RATE_LIMITED'; retryAfterSeconds: number | null; partial: RecallEvidenceBundle | null }
  | { type: 'RETRY_DUE' }
  | { type: 'USER_RETRY' }
  | { type: 'CACHE_AVAILABLE'; cached: CachedResult }
  | { type: 'CACHE_MISSING' }
  | { type: 'ASSESSED'; finding: RecallFinding; explanation: Explanation }
  | { type: 'SAVE_REQUESTED' }
  | { type: 'PERSISTED' }
  | { type: 'PERSIST_FAILED'; detail: string }
  | { type: 'DONE' }
  | { type: 'RESTART' };

export type Effect =
  | { type: 'RUN_EXTRACTION'; capture: Capture }
  | { type: 'RESOLVE_IDENTITY'; extraction: LabelExtraction; discardNdc: boolean }
  | { type: 'CHECK_EXCLUSION'; identity: MedicationIdentity; extraction: LabelExtraction | null; ndcDiscarded: boolean }
  | { type: 'FETCH_RECALL_EVIDENCE'; identity: MedicationIdentity }
  | { type: 'EVALUATE_EVIDENCE'; identity: MedicationIdentity; bundle: RecallEvidenceBundle }
  | { type: 'PERSIST_ASSESSMENT'; identity: MedicationIdentity; finding: RecallFinding }
  | { type: 'LOAD_CACHED_RESULT'; identity: MedicationIdentity | null }
  | { type: 'SCHEDULE_RETRY'; delayMs: number };

export interface Transition {
  state: WorkflowState;
  effects: Effect[];
  ignored: boolean;
  /** Rule that handled the event (null when ignored). */
  ruleId: string | null;
  /** Gate that vetoed the transition (state unchanged), or null. */
  rejectedBy: string | null;
}

export function emptyContext(): WorkflowContext {
  return {
    capture: null,
    extraction: null,
    identity: null,
    identityOptions: [],
    ndcDiscarded: false,
    exclusion: null,
    exclusionKey: null,
    requiredConfirmations: [],
    confirmation: null,
    unconfirmed: [],
    missing: [],
    bundle: null,
    finding: null,
    explanation: null,
    cached: null,
    failedStep: null,
    attempts: 0,
    rateLimitAutoRetried: false,
    retryPending: false,
    lastFailure: null,
    saveError: null,
  };
}

export function initialState(): WorkflowState {
  return { name: 'SCAN', ctx: emptyContext() };
}

type Out = Outcome<StateName, WorkflowContext, Effect>;

const go = (name: StateName, ctx: WorkflowContext, effects: Effect[] = []): Out => ({ name, ctx, effects });

/** Whether a partial bundle holds any retrieved page (so a known recall can still be shown). */
function hasRetrievedData(b: RecallEvidenceBundle | null): boolean {
  return b !== null && b.results.some((r) => r.pages.some((p) => p.kind === 'OK'));
}

function resolveEffect(ctx: WorkflowContext): Effect[] {
  return ctx.extraction ? [{ type: 'RESOLVE_IDENTITY', extraction: ctx.extraction, discardNdc: ctx.ndcDiscarded }] : [];
}

function effectFor(step: RetryableStep, ctx: WorkflowContext): Effect[] {
  switch (step) {
    case 'IDENTIFY':
      return resolveEffect(ctx);
    case 'FETCH_EVIDENCE':
      return ctx.identity ? [{ type: 'FETCH_RECALL_EVIDENCE', identity: ctx.identity }] : [];
  }
}

/** A step failed: retry with backoff while attempts remain, otherwise give up to `onExhausted`. */
function failed(
  s: WorkflowState,
  step: RetryableStep,
  detail: string,
  partial: RecallEvidenceBundle | null,
): Out {
  const attempts = s.ctx.attempts + 1;
  const ctx: WorkflowContext = { ...s.ctx, failedStep: step, attempts, lastFailure: detail, bundle: partial ?? s.ctx.bundle };
  if (attempts < MAX_ATTEMPTS) {
    return go('RETRY', { ...ctx, retryPending: true }, [{ type: 'SCHEDULE_RETRY', delayMs: BACKOFF_MS[attempts - 1] ?? 8000 }]);
  }
  return giveUp({ ...ctx, retryPending: false }, 'SOURCE_UNAVAILABLE');
}

function giveUp(ctx: WorkflowContext, name: 'SOURCE_UNAVAILABLE' | 'RATE_LIMITED'): Out {
  // Evidence already retrieved is still evaluated, so a known recall is never hidden by a later
  // failure; the evaluation reports the incomplete coverage (UNRESOLVED at best).
  if (ctx.failedStep === 'FETCH_EVIDENCE' && ctx.identity && hasRetrievedData(ctx.bundle)) {
    return go('EVALUATE', ctx, [{ type: 'EVALUATE_EVIDENCE', identity: ctx.identity, bundle: ctx.bundle as RecallEvidenceBundle }]);
  }
  return go(name, ctx, [{ type: 'LOAD_CACHED_RESULT', identity: ctx.identity }]);
}

function rateLimited(s: WorkflowState, step: RetryableStep, retryAfterSeconds: number | null, partial: RecallEvidenceBundle | null): Out {
  const ctx: WorkflowContext = {
    ...s.ctx,
    failedStep: step,
    lastFailure: 'rate limited',
    bundle: partial ?? s.ctx.bundle,
  };
  if (!s.ctx.rateLimitAutoRetried) {
    const delayMs = retryAfterSeconds !== null ? retryAfterSeconds * 1000 : DEFAULT_RATE_LIMIT_WAIT_MS;
    return go('RATE_LIMITED', { ...ctx, rateLimitAutoRetried: true, retryPending: true }, [{ type: 'SCHEDULE_RETRY', delayMs }]);
  }
  return giveUp({ ...ctx, retryPending: false }, 'RATE_LIMITED');
}

function toIdentify(ctx: WorkflowContext, extraction: LabelExtraction): Out {
  const next: WorkflowContext = {
    ...emptyContext(),
    capture: ctx.capture,
    extraction,
  };
  return go('IDENTIFY', next, [{ type: 'RESOLVE_IDENTITY', extraction, discardNdc: false }]);
}

function toCheckExclusion(ctx: WorkflowContext, identity: MedicationIdentity): Out {
  // A new identity always gets a fresh exclusion decision and a fresh confirmation.
  const next: WorkflowContext = {
    ...ctx,
    identity,
    identityOptions: [],
    exclusion: null,
    exclusionKey: null,
    confirmation: null,
    attempts: 0,
    failedStep: null,
    lastFailure: null,
  };
  return go('CHECK_EXCLUSION', next, [
    { type: 'CHECK_EXCLUSION', identity, extraction: ctx.extraction, ndcDiscarded: ctx.ndcDiscarded },
  ]);
}

// ---------------------------------------------------------------------------------------------
// Confirmation and exclusion fingerprints (used by rules and gates)
// ---------------------------------------------------------------------------------------------

/**
 * Fingerprint of the identity fields the exclusion decision depends on. A decision is valid only for
 * the identity it was made for: any change to ingredients, salts, RxCUIs, routes, product type,
 * pharmacologic class or dose form requires a new decision. (Lot and release do not affect it.)
 */
export function exclusionKeyOf(identity: MedicationIdentity): string {
  return JSON.stringify({
    ingredients: identity.ingredients.map((i) => [i.name, i.salt, i.rxcui]).sort(),
    routes: [...identity.routes].sort(),
    productType: identity.productType,
    pharmClassEpc: [...identity.pharmClassEpc].sort(),
    doseForm: identity.doseForm,
    level: identity.level,
    productNdc: identity.productNdc,
  });
}

function sameProduct(a: MedicationIdentity, b: MedicationIdentity): boolean {
  const names = (i: MedicationIdentity) => i.ingredients.map((x) => x.name).sort().join('+');
  return a.level === b.level && a.productNdc === b.productNdc && a.packageNdc === b.packageNdc && names(a) === names(b);
}

export interface ConfirmationResult {
  /** True when every required field (and an unprinted release) was confirmed. */
  complete: boolean;
  ctx: WorkflowContext;
}

/**
 * Apply a USER_CONFIRMED event to the context: record unconfirmed fields, or — when complete — the
 * confirmed identity (with the user's lot and release) and the confirmation record the safety
 * gates require. Exposed so workflow variants can move or extend the confirmation step.
 */
export function applyUserConfirmation(ctx: WorkflowContext, e: Extract<WorkflowEvent, { type: 'USER_CONFIRMED' }>): ConfirmationResult {
  const unconfirmed = ctx.requiredConfirmations.filter((f) => !e.confirmedFields.includes(f));
  const current = ctx.identity;
  // An unprinted release mechanism must be stated by the user, not assumed.
  const releaseMissing = current !== null && current.release === 'UNSPECIFIED' && (e.release === undefined || e.release === 'UNSPECIFIED');
  if (releaseMissing && !unconfirmed.includes('release')) unconfirmed.push('release');
  if (unconfirmed.length > 0 || current === null) return { complete: false, ctx: { ...ctx, unconfirmed } };
  // The lot is used only when the user confirmed it in this step.
  const identity: MedicationIdentity = {
    ...current,
    release: current.release === 'UNSPECIFIED' && e.release !== undefined ? e.release : current.release,
    lot: e.lot !== null && e.lot.trim() !== '' ? e.lot : null,
  };
  return {
    complete: true,
    ctx: {
      ...ctx,
      identity,
      unconfirmed: [],
      confirmation: { fields: [...e.confirmedFields], exclusionKey: exclusionKeyOf(identity) },
      attempts: 0,
      failedStep: null,
      rateLimitAutoRetried: false,
    },
  };
}

/** Enter FETCH_EVIDENCE and request the recall evidence for the confirmed identity. */
export function startEvidenceFetch(ctx: WorkflowContext): Out {
  return ctx.identity ? go('FETCH_EVIDENCE', ctx, [{ type: 'FETCH_RECALL_EVIDENCE', identity: ctx.identity }]) : go('FETCH_EVIDENCE', ctx);
}

// ---------------------------------------------------------------------------------------------
// Default transition table (ARCHITECTURE §4.3). Order matters: the first matching rule wins.
// ---------------------------------------------------------------------------------------------

export const RX_STATES: readonly StateName[] = [
  'SCAN', 'EXTRACT', 'IDENTIFY', 'CHECK_EXCLUSION', 'CONFIRM', 'FETCH_EVIDENCE', 'EVALUATE', 'EXPLAIN', 'SAVE', 'SAVED',
  'AMBIGUOUS_IDENTITY', 'MISSING_INFORMATION', 'USER_CORRECTION', 'EXCLUDED', 'UNSUPPORTED', 'NEEDS_CLARIFICATION',
  'SOURCE_UNAVAILABLE', 'RATE_LIMITED', 'RETRY', 'OFFLINE_CACHED_RESULT',
];

/** A rule of an Rx workflow, optionally with extra states (XS) and events (XE). */
export type RxRule<XS extends string = never, XE extends FsmEvent = never> = TransitionRule<StateName | XS, WorkflowContext, WorkflowEvent | XE, Effect>;
type R = RxRule;

export const RESTARTABLE_STATES: readonly StateName[] = [
  'EXPLAIN', 'SAVED', 'EXCLUDED', 'UNSUPPORTED', 'NEEDS_CLARIFICATION', 'SOURCE_UNAVAILABLE', 'RATE_LIMITED',
  'OFFLINE_CACHED_RESULT', 'MISSING_INFORMATION', 'USER_CORRECTION', 'AMBIGUOUS_IDENTITY', 'CONFIRM',
];

const RETRY_TARGETS: readonly StateName[] = ['IDENTIFY', 'FETCH_EVIDENCE'];
const RETRY_EFFECTS: readonly Effect['type'][] = ['RESOLVE_IDENTITY', 'FETCH_RECALL_EVIDENCE'];

export const RX_RULES: readonly R[] = [
  {
    id: 'any.restart',
    description: 'Start over from a result, terminal or waiting state',
    from: RESTARTABLE_STATES, on: ['RESTART', 'DONE'], to: ['SCAN'],
    apply: () => go('SCAN', emptyContext()),
  },
  {
    id: 'scan.captured',
    from: ['SCAN'], on: ['CAPTURED'], to: ['EXTRACT'], emits: ['RUN_EXTRACTION'],
    apply: (_s, e) => (e.type === 'CAPTURED' ? go('EXTRACT', { ...emptyContext(), capture: e.capture }, [{ type: 'RUN_EXTRACTION', capture: e.capture }]) : null),
  },
  {
    id: 'extract.extracted',
    from: ['EXTRACT'], on: ['EXTRACTED'], to: ['IDENTIFY'], emits: ['RESOLVE_IDENTITY'],
    apply: (s, e) => (e.type === 'EXTRACTED' ? toIdentify(s.ctx, e.extraction) : null),
  },
  {
    id: 'extract.empty',
    from: ['EXTRACT'], on: ['EXTRACTION_EMPTY'], to: ['MISSING_INFORMATION'],
    apply: (s) => go('MISSING_INFORMATION', { ...s.ctx, missing: ['drugName', 'strength', 'doseForm'] }),
  },
  {
    id: 'identify.resolved',
    from: ['IDENTIFY'], on: ['IDENTITY_RESOLVED', 'IDENTITY_PARTIAL'], to: ['CHECK_EXCLUSION'], emits: ['CHECK_EXCLUSION'],
    apply: (s, e) => (e.type === 'IDENTITY_RESOLVED' || e.type === 'IDENTITY_PARTIAL' ? toCheckExclusion(s.ctx, e.identity) : null),
  },
  {
    id: 'identify.ambiguous',
    description: 'Never auto-pick: at least two options are required',
    from: ['IDENTIFY'], on: ['IDENTITY_AMBIGUOUS'], to: ['AMBIGUOUS_IDENTITY'],
    guard: (_s, e) => e.type === 'IDENTITY_AMBIGUOUS' && e.options.length >= 2,
    apply: (s, e) => (e.type === 'IDENTITY_AMBIGUOUS' ? go('AMBIGUOUS_IDENTITY', { ...s.ctx, identityOptions: e.options, attempts: 0, failedStep: null }) : null),
  },
  {
    id: 'identify.ndc-discarded',
    description: 'Discard a contradicted or unknown NDC once and continue on the printed-name path (J1 → J2)',
    from: ['IDENTIFY'], on: ['CROSS_VALIDATION_FAILED', 'NDC_REJECTED'], to: ['IDENTIFY', 'MISSING_INFORMATION'], emits: ['RESOLVE_IDENTITY'],
    apply: (s) => {
      if (!s.ctx.ndcDiscarded && s.ctx.extraction) {
        const ctx = { ...s.ctx, ndcDiscarded: true, attempts: 0, failedStep: null };
        return go('IDENTIFY', ctx, [{ type: 'RESOLVE_IDENTITY', extraction: s.ctx.extraction, discardNdc: true }]);
      }
      return go('MISSING_INFORMATION', { ...s.ctx, missing: ['ndc'] });
    },
  },
  {
    id: 'identify.incomplete',
    from: ['IDENTIFY'], on: ['IDENTITY_INCOMPLETE'], to: ['MISSING_INFORMATION'],
    apply: (s, e) => (e.type === 'IDENTITY_INCOMPLETE' ? go('MISSING_INFORMATION', { ...s.ctx, missing: e.missing, attempts: 0, failedStep: null }) : null),
  },
  {
    id: 'identify.lookup-unavailable',
    from: ['IDENTIFY'], on: ['LOOKUP_UNAVAILABLE'], to: ['RETRY', 'SOURCE_UNAVAILABLE'], emits: ['SCHEDULE_RETRY', 'LOAD_CACHED_RESULT'],
    apply: (s, e) => (e.type === 'LOOKUP_UNAVAILABLE' ? failed(s, 'IDENTIFY', e.detail, null) : null),
  },
  {
    id: 'identify.lookup-rate-limited',
    from: ['IDENTIFY'], on: ['LOOKUP_RATE_LIMITED'], to: ['RATE_LIMITED'], emits: ['SCHEDULE_RETRY', 'LOAD_CACHED_RESULT'],
    apply: (s, e) => (e.type === 'LOOKUP_RATE_LIMITED' ? rateLimited(s, 'IDENTIFY', e.retryAfterSeconds, null) : null),
  },
  {
    id: 'ambiguous.choose',
    from: ['AMBIGUOUS_IDENTITY'], on: ['CANDIDATE_CHOSEN'], to: ['CHECK_EXCLUSION'], emits: ['CHECK_EXCLUSION'],
    apply: (s, e) => {
      const chosen = e.type === 'CANDIDATE_CHOSEN' ? s.ctx.identityOptions[e.index] : undefined;
      return chosen ? toCheckExclusion(s.ctx, chosen) : null;
    },
  },
  {
    id: 'ambiguous.edit',
    from: ['AMBIGUOUS_IDENTITY'], on: ['EDIT_REQUESTED'], to: ['USER_CORRECTION'],
    apply: (s) => go('USER_CORRECTION', s.ctx),
  },
  {
    id: 'correction.fields-updated',
    from: ['MISSING_INFORMATION', 'USER_CORRECTION'], on: ['FIELDS_UPDATED'], to: ['IDENTIFY'], emits: ['RESOLVE_IDENTITY'],
    apply: (s, e) => (e.type === 'FIELDS_UPDATED' ? toIdentify(s.ctx, e.extraction) : null),
  },
  {
    id: 'exclusion.decided',
    description: 'Route on the exclusion decision; only ELIGIBLE continues toward evidence',
    from: ['CHECK_EXCLUSION'], on: ['EXCLUSION_DECIDED'], to: ['EXCLUDED', 'UNSUPPORTED', 'NEEDS_CLARIFICATION', 'CONFIRM'],
    apply: (s, e) => {
      if (e.type !== 'EXCLUSION_DECIDED') return null;
      // An enriched identity (RxCUIs, verified source products) replaces the current one only if it
      // describes the same product and ingredient set; the decision is then bound to it.
      const identity = e.identity && s.ctx.identity && sameProduct(e.identity, s.ctx.identity) ? e.identity : s.ctx.identity;
      const exclusionKey = identity ? exclusionKeyOf(identity) : null;
      const ctx = { ...s.ctx, identity, exclusion: e.decision, exclusionKey };
      switch (e.decision.decision) {
        case 'EXCLUDED':
        case 'UNSUPPORTED':
        case 'NEEDS_CLARIFICATION':
          return go(e.decision.decision, ctx);
        case 'ELIGIBLE':
          return go('CONFIRM', { ...ctx, requiredConfirmations: [...e.requiredConfirmations], unconfirmed: [...e.requiredConfirmations] });
        default: {
          const never: never = e.decision;
          return never;
        }
      }
    },
  },
  {
    id: 'confirm.edit',
    from: ['CONFIRM'], on: ['EDIT_REQUESTED'], to: ['USER_CORRECTION'],
    apply: (s) => go('USER_CORRECTION', s.ctx),
  },
  {
    id: 'confirm.user-confirmed',
    description: 'Fetch evidence only after every required field is confirmed',
    from: ['CONFIRM'], on: ['USER_CONFIRMED'], to: ['CONFIRM', 'FETCH_EVIDENCE'], emits: ['FETCH_RECALL_EVIDENCE'],
    apply: (s, e) => {
      if (e.type !== 'USER_CONFIRMED') return null;
      const r = applyUserConfirmation(s.ctx, e);
      return r.complete ? startEvidenceFetch(r.ctx) : go('CONFIRM', r.ctx);
    },
  },
  {
    id: 'fetch.evidence-ready',
    from: ['FETCH_EVIDENCE'], on: ['EVIDENCE_READY'], to: ['EVALUATE'], emits: ['EVALUATE_EVIDENCE'],
    guard: (s) => s.ctx.identity !== null,
    apply: (s, e) => {
      if (e.type !== 'EVIDENCE_READY' || !s.ctx.identity) return null;
      const ctx = { ...s.ctx, bundle: e.bundle, attempts: 0, failedStep: null };
      return go('EVALUATE', ctx, [{ type: 'EVALUATE_EVIDENCE', identity: s.ctx.identity, bundle: e.bundle }]);
    },
  },
  {
    id: 'fetch.source-failed',
    description: 'Bounded retry; then evaluate partial evidence, or report the source unavailable',
    from: ['FETCH_EVIDENCE'], on: ['SOURCE_FAILED'], to: ['RETRY', 'EVALUATE', 'SOURCE_UNAVAILABLE'],
    emits: ['SCHEDULE_RETRY', 'EVALUATE_EVIDENCE', 'LOAD_CACHED_RESULT'],
    apply: (s, e) => (e.type === 'SOURCE_FAILED' ? failed(s, 'FETCH_EVIDENCE', e.detail, e.partial) : null),
  },
  {
    id: 'fetch.rate-limited',
    from: ['FETCH_EVIDENCE'], on: ['RATE_LIMITED'], to: ['RATE_LIMITED', 'EVALUATE'],
    emits: ['SCHEDULE_RETRY', 'EVALUATE_EVIDENCE', 'LOAD_CACHED_RESULT'],
    apply: (s, e) => (e.type === 'RATE_LIMITED' ? rateLimited(s, 'FETCH_EVIDENCE', e.retryAfterSeconds, e.partial) : null),
  },
  {
    id: 'retry.due',
    description: 'Only a retry that is actually pending is honored (late timers are ignored)',
    from: ['RETRY'], on: ['RETRY_DUE'], to: RETRY_TARGETS, emits: RETRY_EFFECTS,
    guard: (s) => s.ctx.failedStep !== null && s.ctx.retryPending,
    apply: (s) => {
      const step = s.ctx.failedStep as RetryableStep;
      const ctx = { ...s.ctx, retryPending: false };
      return go(step, ctx, effectFor(step, ctx));
    },
  },
  {
    id: 'rate-limited.auto-retry',
    description: 'The single automatic retry scheduled on entering RATE_LIMITED',
    from: ['RATE_LIMITED'], on: ['RETRY_DUE'], to: RETRY_TARGETS, emits: RETRY_EFFECTS,
    guard: (s) => s.ctx.failedStep !== null && s.ctx.retryPending,
    apply: (s) => {
      const step = s.ctx.failedStep as RetryableStep;
      const ctx = { ...s.ctx, retryPending: false };
      return go(step, ctx, effectFor(step, ctx));
    },
  },
  {
    id: 'unavailable.user-retry',
    from: ['RATE_LIMITED', 'SOURCE_UNAVAILABLE'], on: ['USER_RETRY'], to: RETRY_TARGETS, emits: RETRY_EFFECTS,
    guard: (s) => s.ctx.failedStep !== null,
    apply: (s) => {
      const step = s.ctx.failedStep as RetryableStep;
      return go(step, { ...s.ctx, attempts: 0, retryPending: false }, effectFor(step, s.ctx));
    },
  },
  {
    id: 'unavailable.cache-available',
    from: ['RATE_LIMITED', 'SOURCE_UNAVAILABLE'], on: ['CACHE_AVAILABLE'], to: ['OFFLINE_CACHED_RESULT'],
    apply: (s, e) => (e.type === 'CACHE_AVAILABLE' ? go('OFFLINE_CACHED_RESULT', { ...s.ctx, cached: e.cached }) : null),
  },
  {
    id: 'unavailable.cache-missing',
    from: ['RATE_LIMITED', 'SOURCE_UNAVAILABLE'], on: ['CACHE_MISSING'], to: ['RATE_LIMITED', 'SOURCE_UNAVAILABLE'],
    apply: (s) => go(s.name as StateName, s.ctx),
  },
  {
    id: 'offline.user-retry',
    from: ['OFFLINE_CACHED_RESULT'], on: ['USER_RETRY'], to: RETRY_TARGETS, emits: RETRY_EFFECTS,
    guard: (s) => s.ctx.failedStep !== null,
    apply: (s) => {
      const step = s.ctx.failedStep as RetryableStep;
      return go(step, { ...s.ctx, attempts: 0, rateLimitAutoRetried: false, retryPending: false }, effectFor(step, s.ctx));
    },
  },
  {
    id: 'evaluate.assessed',
    from: ['EVALUATE'], on: ['ASSESSED'], to: ['EXPLAIN'],
    apply: (s, e) => (e.type === 'ASSESSED' ? go('EXPLAIN', { ...s.ctx, finding: e.finding, explanation: e.explanation }) : null),
  },
  {
    id: 'explain.save',
    from: ['EXPLAIN'], on: ['SAVE_REQUESTED'], to: ['SAVE'], emits: ['PERSIST_ASSESSMENT'],
    guard: (s) => s.ctx.identity !== null && s.ctx.finding !== null,
    apply: (s) =>
      s.ctx.identity && s.ctx.finding
        ? go('SAVE', { ...s.ctx, saveError: null }, [{ type: 'PERSIST_ASSESSMENT', identity: s.ctx.identity, finding: s.ctx.finding }])
        : null,
  },
  {
    id: 'save.persisted',
    from: ['SAVE'], on: ['PERSISTED'], to: ['SAVED'],
    apply: (s) => go('SAVED', s.ctx),
  },
  {
    id: 'save.failed',
    from: ['SAVE'], on: ['PERSIST_FAILED'], to: ['EXPLAIN'],
    apply: (s, e) => (e.type === 'PERSIST_FAILED' ? go('EXPLAIN', { ...s.ctx, saveError: e.detail }) : null),
  },
  {
    id: 'policy-result.edit',
    from: ['EXCLUDED', 'UNSUPPORTED', 'NEEDS_CLARIFICATION'], on: ['EDIT_REQUESTED'], to: ['USER_CORRECTION'],
    apply: (s) => go('USER_CORRECTION', s.ctx),
  },
];

// ---------------------------------------------------------------------------------------------
// Mandatory safety gates. Applied to every Rx workflow; not part of the editable rule table.
// ---------------------------------------------------------------------------------------------

type RxGate = Gate<string, WorkflowContext, FsmEvent, Effect>;
const EVIDENCE_EFFECTS: ReadonlySet<Effect['type']> = new Set(['FETCH_RECALL_EVIDENCE', 'EVALUATE_EVIDENCE', 'PERSIST_ASSESSMENT']);
const POLICY_STATES: ReadonlySet<string> = new Set(['EXCLUDED', 'UNSUPPORTED', 'NEEDS_CLARIFICATION']);

export const RX_SAFETY_GATES: readonly RxGate[] = [
  {
    id: 'exclusion-provenance',
    description: 'An exclusion decision enters the context only from an EXCLUSION_DECIDED event (the policy evaluation).',
    check: ({ from, event, to }) => {
      if (to.ctx.exclusion === null || to.ctx.exclusion === from.ctx.exclusion) return null;
      const e = event as WorkflowEvent;
      return e.type === 'EXCLUSION_DECIDED' && e.decision === to.ctx.exclusion ? null : `exclusion decision set by "${event.type}"`;
    },
  },
  {
    id: 'confirmation-provenance',
    description: 'A patient confirmation enters the context only from a USER_CONFIRMED event, with fields the user actually confirmed.',
    check: ({ from, event, to }) => {
      const c = to.ctx.confirmation;
      if (c === null || c === from.ctx.confirmation) return null;
      const e = event as WorkflowEvent;
      if (e.type !== 'USER_CONFIRMED') return `confirmation set by "${event.type}"`;
      return c.fields.every((f) => e.confirmedFields.includes(f)) ? null : 'confirmation lists fields the user did not confirm';
    },
  },
  {
    id: 'exclusion-before-evidence',
    description: 'Recall fetch, evaluation and saving require an ELIGIBLE decision made for the current identity.',
    check: ({ to, effects }) => {
      if (!effects.some((f) => EVIDENCE_EFFECTS.has(f.type))) return null;
      const { identity, exclusion, exclusionKey } = to.ctx;
      if (identity === null) return 'no identity';
      if (exclusion === null || exclusion.decision !== 'ELIGIBLE') return 'no ELIGIBLE exclusion decision';
      return exclusionKey === exclusionKeyOf(identity) ? null : 'exclusion decision was made for a different identity';
    },
  },
  {
    id: 'confirmation-before-evidence',
    description: 'Recall fetch, evaluation and saving require the patient to have confirmed the identity and every required field.',
    check: ({ to, effects }) => {
      if (!effects.some((f) => EVIDENCE_EFFECTS.has(f.type))) return null;
      const c = to.ctx.confirmation;
      if (c === null) return 'identity not confirmed by the user';
      if (!c.fields.includes('identity')) return 'the identity itself was not confirmed';
      const missing = to.ctx.requiredConfirmations.filter((f) => !c.fields.includes(f));
      if (missing.length > 0) return `unconfirmed: ${missing.join(', ')}`;
      if (to.ctx.identity === null || c.exclusionKey !== exclusionKeyOf(to.ctx.identity)) return 'confirmation was for a different identity';
      if (to.ctx.identity.release === 'UNSPECIFIED') return 'release mechanism not confirmed';
      return null;
    },
  },
  {
    id: 'evidence-integrity',
    description: 'Evaluation runs on the retrieved evidence held in the context; a finding comes only from that evaluation.',
    check: ({ from, event, to, effects }) => {
      for (const f of effects) {
        if (f.type === 'EVALUATE_EVIDENCE' && (to.ctx.bundle === null || f.bundle !== to.ctx.bundle)) return 'evaluating evidence that is not the retrieved bundle';
        if (f.type === 'PERSIST_ASSESSMENT' && (to.ctx.finding === null || f.finding !== to.ctx.finding)) return 'saving a finding that is not the evaluated one';
      }
      if (to.ctx.finding !== null && to.ctx.finding !== from.ctx.finding) {
        const e = event as WorkflowEvent;
        if (e.type !== 'ASSESSED' || e.finding !== to.ctx.finding) return `finding set by "${event.type}"`;
        if (from.ctx.bundle === null) return 'finding without retrieved evidence';
      }
      return null;
    },
  },
  {
    id: 'policy-routing',
    description: 'EXCLUDED / UNSUPPORTED / NEEDS_CLARIFICATION states match the decision, and a non-eligible decision can only end the flow or return to correction.',
    check: ({ to }) => {
      const x = to.ctx.exclusion;
      if (POLICY_STATES.has(to.name) && x?.decision !== to.name) return `"${to.name}" without a matching decision`;
      if (x !== null && x.decision !== 'ELIGIBLE' && to.name !== x.decision && to.name !== 'SCAN' && to.name !== 'USER_CORRECTION') {
        return `${x.decision} decision routed to "${to.name}"`;
      }
      return null;
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Building workflows
// ---------------------------------------------------------------------------------------------

/** Helpers handed to `customize`, so variants reuse the default building blocks. */
export const rxRuleKit = {
  replaceRule,
  removeRule,
  insertBefore,
  insertAfter,
  go,
  applyUserConfirmation,
  startEvidenceFetch,
  emptyContext,
};

export interface RxWorkflowOptions<XS extends string, XE extends FsmEvent> {
  /** Identifier for the variant (appears in errors). */
  id?: string;
  /** Additional states used by the customized rules. */
  extraStates?: readonly XS[];
  /** Built-in states to drop. Any rule still referring to them makes construction fail. */
  removeStates?: readonly StateName[];
  /** Receives the default rule table and returns the variant's table. */
  customize?: (rules: RxRule<XS, XE>[], kit: typeof rxRuleKit) => RxRule<XS, XE>[];
}

export type RxMachine<XS extends string = never, XE extends FsmEvent = never> = Machine<StateName | XS, WorkflowContext, WorkflowEvent | XE, Effect>;

/**
 * Build an Rx workflow. The default table is used unless `customize` changes it. The safety gates
 * are always attached and cannot be configured away. Throws MachineDefinitionError for structural
 * problems (unknown states, duplicate rule ids, rules referring to removed states).
 */
export function createRxWorkflow<XS extends string = never, XE extends FsmEvent = never>(
  opts: RxWorkflowOptions<XS, XE> = {},
): RxMachine<XS, XE> {
  const removed = new Set<string>(opts.removeStates ?? []);
  const states = [...RX_STATES.filter((s) => !removed.has(s)), ...(opts.extraStates ?? [])] as (StateName | XS)[];
  const base = [...RX_RULES] as RxRule<XS, XE>[];
  const rules = opts.customize ? opts.customize(base, rxRuleKit) : base;
  return createMachine(
    { id: opts.id ?? 'rx-default', states, initial: initialState, rules },
    { gates: RX_SAFETY_GATES as unknown as readonly Gate<StateName | XS, WorkflowContext, WorkflowEvent | XE, Effect>[] },
  );
}

/** The default Rx workflow. */
export const rxWorkflow: RxMachine = createRxWorkflow();

/** Pure reducer for the default workflow (unchanged public API). */
export function reduce(s: WorkflowState, e: WorkflowEvent): Transition {
  const r: StepResult<StateName, WorkflowContext, Effect> = rxWorkflow.step(s, e);
  return { state: r.state, effects: r.effects, ignored: r.ignored, ruleId: r.ruleId, rejectedBy: r.rejectedBy };
}
