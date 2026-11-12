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
  requiredConfirmations: string[];
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
  | { type: 'EXCLUSION_DECIDED'; decision: ExclusionDecision; requiredConfirmations: string[] }
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
}

export function emptyContext(): WorkflowContext {
  return {
    capture: null,
    extraction: null,
    identity: null,
    identityOptions: [],
    ndcDiscarded: false,
    exclusion: null,
    requiredConfirmations: [],
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

const go = (name: StateName, ctx: WorkflowContext, effects: Effect[] = []): Transition => ({
  state: { name, ctx },
  effects,
  ignored: false,
});

const stay = (s: WorkflowState): Transition => ({ state: s, effects: [], ignored: true });

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
): Transition {
  const attempts = s.ctx.attempts + 1;
  const ctx: WorkflowContext = { ...s.ctx, failedStep: step, attempts, lastFailure: detail, bundle: partial ?? s.ctx.bundle };
  if (attempts < MAX_ATTEMPTS) {
    return go('RETRY', { ...ctx, retryPending: true }, [{ type: 'SCHEDULE_RETRY', delayMs: BACKOFF_MS[attempts - 1] ?? 8000 }]);
  }
  return giveUp({ ...ctx, retryPending: false }, 'SOURCE_UNAVAILABLE');
}

function giveUp(ctx: WorkflowContext, name: 'SOURCE_UNAVAILABLE' | 'RATE_LIMITED'): Transition {
  // Evidence already retrieved is still evaluated, so a known recall is never hidden by a later
  // failure; the evaluation reports the incomplete coverage (UNRESOLVED at best).
  if (ctx.failedStep === 'FETCH_EVIDENCE' && ctx.identity && hasRetrievedData(ctx.bundle)) {
    return go('EVALUATE', ctx, [{ type: 'EVALUATE_EVIDENCE', identity: ctx.identity, bundle: ctx.bundle as RecallEvidenceBundle }]);
  }
  return go(name, ctx, [{ type: 'LOAD_CACHED_RESULT', identity: ctx.identity }]);
}

function rateLimited(s: WorkflowState, step: RetryableStep, retryAfterSeconds: number | null, partial: RecallEvidenceBundle | null): Transition {
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

function toIdentify(ctx: WorkflowContext, extraction: LabelExtraction): Transition {
  const next: WorkflowContext = {
    ...emptyContext(),
    capture: ctx.capture,
    extraction,
  };
  return go('IDENTIFY', next, [{ type: 'RESOLVE_IDENTITY', extraction, discardNdc: false }]);
}

function toCheckExclusion(ctx: WorkflowContext, identity: MedicationIdentity): Transition {
  const next: WorkflowContext = { ...ctx, identity, identityOptions: [], attempts: 0, failedStep: null, lastFailure: null };
  return go('CHECK_EXCLUSION', next, [
    { type: 'CHECK_EXCLUSION', identity, extraction: ctx.extraction, ndcDiscarded: ctx.ndcDiscarded },
  ]);
}

const RESTARTABLE: ReadonlySet<StateName> = new Set([
  'EXPLAIN',
  'SAVED',
  'EXCLUDED',
  'UNSUPPORTED',
  'NEEDS_CLARIFICATION',
  'SOURCE_UNAVAILABLE',
  'RATE_LIMITED',
  'OFFLINE_CACHED_RESULT',
  'MISSING_INFORMATION',
  'USER_CORRECTION',
  'AMBIGUOUS_IDENTITY',
  'CONFIRM',
]);

export function reduce(s: WorkflowState, e: WorkflowEvent): Transition {
  if ((e.type === 'RESTART' || e.type === 'DONE') && RESTARTABLE.has(s.name)) return go('SCAN', emptyContext());

  switch (s.name) {
    case 'SCAN':
      if (e.type === 'CAPTURED') {
        return go('EXTRACT', { ...emptyContext(), capture: e.capture }, [{ type: 'RUN_EXTRACTION', capture: e.capture }]);
      }
      return stay(s);

    case 'EXTRACT':
      if (e.type === 'EXTRACTED') return toIdentify(s.ctx, e.extraction);
      if (e.type === 'EXTRACTION_EMPTY') return go('MISSING_INFORMATION', { ...s.ctx, missing: ['drugName', 'strength', 'doseForm'] });
      return stay(s);

    case 'IDENTIFY':
      switch (e.type) {
        case 'IDENTITY_RESOLVED':
        case 'IDENTITY_PARTIAL':
          return toCheckExclusion(s.ctx, e.identity);
        case 'IDENTITY_AMBIGUOUS':
          if (e.options.length < 2) return stay(s);
          return go('AMBIGUOUS_IDENTITY', { ...s.ctx, identityOptions: e.options, attempts: 0, failedStep: null });
        case 'CROSS_VALIDATION_FAILED':
        case 'NDC_REJECTED': {
          // Discard the NDC once and continue on the printed name/strength path (J1 step 3 → J2).
          if (!s.ctx.ndcDiscarded && s.ctx.extraction) {
            const ctx = { ...s.ctx, ndcDiscarded: true, attempts: 0, failedStep: null };
            return go('IDENTIFY', ctx, [{ type: 'RESOLVE_IDENTITY', extraction: s.ctx.extraction, discardNdc: true }]);
          }
          return go('MISSING_INFORMATION', { ...s.ctx, missing: ['ndc'] });
        }
        case 'IDENTITY_INCOMPLETE':
          return go('MISSING_INFORMATION', { ...s.ctx, missing: e.missing, attempts: 0, failedStep: null });
        case 'LOOKUP_UNAVAILABLE':
          return failed(s, 'IDENTIFY', e.detail, null);
        case 'LOOKUP_RATE_LIMITED':
          return rateLimited(s, 'IDENTIFY', e.retryAfterSeconds, null);
        default:
          return stay(s);
      }

    case 'AMBIGUOUS_IDENTITY':
      if (e.type === 'CANDIDATE_CHOSEN') {
        const chosen = s.ctx.identityOptions[e.index];
        if (!chosen) return stay(s);
        return toCheckExclusion(s.ctx, chosen);
      }
      if (e.type === 'EDIT_REQUESTED') return go('USER_CORRECTION', s.ctx);
      return stay(s);

    case 'MISSING_INFORMATION':
    case 'USER_CORRECTION':
      if (e.type === 'FIELDS_UPDATED') return toIdentify(s.ctx, e.extraction);
      return stay(s);

    case 'CHECK_EXCLUSION':
      if (e.type !== 'EXCLUSION_DECIDED') return stay(s);
      switch (e.decision.decision) {
        case 'EXCLUDED':
          return go('EXCLUDED', { ...s.ctx, exclusion: e.decision });
        case 'UNSUPPORTED':
          return go('UNSUPPORTED', { ...s.ctx, exclusion: e.decision });
        case 'NEEDS_CLARIFICATION':
          return go('NEEDS_CLARIFICATION', { ...s.ctx, exclusion: e.decision });
        case 'ELIGIBLE':
          return go('CONFIRM', {
            ...s.ctx,
            exclusion: e.decision,
            requiredConfirmations: [...e.requiredConfirmations],
            unconfirmed: [...e.requiredConfirmations],
          });
        default: {
          const never: never = e.decision;
          return never;
        }
      }

    case 'CONFIRM':
      if (e.type === 'EDIT_REQUESTED') return go('USER_CORRECTION', s.ctx);
      if (e.type === 'USER_CONFIRMED') {
        const unconfirmed = s.ctx.requiredConfirmations.filter((f) => !e.confirmedFields.includes(f));
        const current = s.ctx.identity;
        // An unprinted release mechanism must be stated by the user, not assumed.
        const releaseMissing = current !== null && current.release === 'UNSPECIFIED' && (e.release === undefined || e.release === 'UNSPECIFIED');
        if (releaseMissing && !unconfirmed.includes('release')) unconfirmed.push('release');
        if (unconfirmed.length > 0 || current === null) {
          return { state: { name: 'CONFIRM', ctx: { ...s.ctx, unconfirmed } }, effects: [], ignored: false };
        }
        // The lot is used only when the user confirmed it in this step.
        const identity: MedicationIdentity = {
          ...current,
          release: current.release === 'UNSPECIFIED' && e.release !== undefined ? e.release : current.release,
          lot: e.lot !== null && e.lot.trim() !== '' ? e.lot : null,
        };
        const ctx = { ...s.ctx, identity, unconfirmed: [], attempts: 0, failedStep: null, rateLimitAutoRetried: false };
        return go('FETCH_EVIDENCE', ctx, [{ type: 'FETCH_RECALL_EVIDENCE', identity }]);
      }
      return stay(s);

    case 'FETCH_EVIDENCE':
      switch (e.type) {
        case 'EVIDENCE_READY': {
          if (!s.ctx.identity) return stay(s);
          const ctx = { ...s.ctx, bundle: e.bundle, attempts: 0, failedStep: null };
          return go('EVALUATE', ctx, [{ type: 'EVALUATE_EVIDENCE', identity: s.ctx.identity, bundle: e.bundle }]);
        }
        case 'SOURCE_FAILED':
          return failed(s, 'FETCH_EVIDENCE', e.detail, e.partial);
        case 'RATE_LIMITED':
          return rateLimited(s, 'FETCH_EVIDENCE', e.retryAfterSeconds, e.partial);
        default:
          return stay(s);
      }

    case 'RETRY':
      if (e.type === 'RETRY_DUE' && s.ctx.failedStep && s.ctx.retryPending) {
        const ctx = { ...s.ctx, retryPending: false };
        return go(s.ctx.failedStep, ctx, effectFor(s.ctx.failedStep, ctx));
      }
      return stay(s);

    case 'RATE_LIMITED':
    case 'SOURCE_UNAVAILABLE':
      switch (e.type) {
        case 'RETRY_DUE':
          // Only the single automatic retry scheduled on entering RATE_LIMITED.
          if (s.name === 'RATE_LIMITED' && s.ctx.failedStep && s.ctx.retryPending) {
            const ctx = { ...s.ctx, retryPending: false };
            return go(s.ctx.failedStep, ctx, effectFor(s.ctx.failedStep, ctx));
          }
          return stay(s);
        case 'USER_RETRY':
          if (!s.ctx.failedStep) return stay(s);
          return go(s.ctx.failedStep, { ...s.ctx, attempts: 0, retryPending: false }, effectFor(s.ctx.failedStep, s.ctx));
        case 'CACHE_AVAILABLE':
          return go('OFFLINE_CACHED_RESULT', { ...s.ctx, cached: e.cached });
        case 'CACHE_MISSING':
          return { state: s, effects: [], ignored: false };
        default:
          return stay(s);
      }

    case 'OFFLINE_CACHED_RESULT':
      if (e.type === 'USER_RETRY' && s.ctx.failedStep) {
        return go(s.ctx.failedStep, { ...s.ctx, attempts: 0, rateLimitAutoRetried: false, retryPending: false }, effectFor(s.ctx.failedStep, s.ctx));
      }
      return stay(s);

    case 'EVALUATE':
      if (e.type === 'ASSESSED') return go('EXPLAIN', { ...s.ctx, finding: e.finding, explanation: e.explanation });
      return stay(s);

    case 'EXPLAIN':
      if (e.type === 'SAVE_REQUESTED' && s.ctx.identity && s.ctx.finding) {
        return go('SAVE', { ...s.ctx, saveError: null }, [{ type: 'PERSIST_ASSESSMENT', identity: s.ctx.identity, finding: s.ctx.finding }]);
      }
      return stay(s);

    case 'SAVE':
      if (e.type === 'PERSISTED') return go('SAVED', s.ctx);
      if (e.type === 'PERSIST_FAILED') return go('EXPLAIN', { ...s.ctx, saveError: e.detail });
      return stay(s);

    case 'SAVED':
    case 'EXCLUDED':
    case 'UNSUPPORTED':
    case 'NEEDS_CLARIFICATION':
      if (e.type === 'EDIT_REQUESTED' && s.name !== 'SAVED') return go('USER_CORRECTION', s.ctx);
      return stay(s);

    default: {
      const never: never = s.name;
      return never;
    }
  }
}
