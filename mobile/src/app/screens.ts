/**
 * Screen models: a pure, platform-independent mapping from workflow state to what a screen shows.
 * The React Native screens (mobile/app/) render these models and send events back; they contain no
 * evidence logic. Android and iOS share this file unchanged.
 *
 * Every result goes through presentation/present.ts, so nothing a screen shows can be stronger
 * than the evidence (docs/EVIDENCE_AND_CLAIMS_POLICY.md).
 */
import { COPY } from '../copy/en.ts';
import type { FieldValue, LabelExtraction, ReleaseMechanism } from '../models/identity.ts';
import { identityFields, isoMinute, presentNotAssessed, presentResult, type DateFormatter, type FieldView, type NotAssessedView, type ResultView } from '../presentation/present.ts';
import type { WorkflowState } from '../state/machine.ts';

export interface ManualEntry {
  ndc: string;
  drugName: string;
  strength: string;
  form: string;
  lot: string;
}

const typed = (value: string): FieldValue<string> => ({ value, origin: 'USER', confidence: null, confirmedByUser: false });

/** Manual entry → extraction. Empty fields are absent. The lot is kept on the phone (never sent). */
export function manualExtraction(e: ManualEntry): LabelExtraction {
  const t = (s: string) => s.trim();
  return {
    ndcTexts: t(e.ndc) ? [typed(t(e.ndc))] : [],
    drugName: t(e.drugName) ? typed(t(e.drugName)) : null,
    strength: t(e.strength) ? typed(t(e.strength)) : null,
    doseForm: t(e.form) ? typed(t(e.form)) : null,
    labelerText: null,
    lot: t(e.lot) ? typed(t(e.lot)) : null,
    expiry: null,
    containerType: 'UNKNOWN',
  };
}

/** Prefill the manual form from a scan, so the user can correct what was read (Task 4C fallback). */
export function entryFromExtraction(x: LabelExtraction): ManualEntry {
  const ocrNdc = x.ndcTexts.find((n) => n.origin === 'OCR') ?? x.ndcTexts[0];
  return { ndc: ocrNdc?.value ?? '', drugName: x.drugName?.value ?? '', strength: x.strength?.value ?? '', form: x.doseForm?.value ?? '', lot: x.lot?.value ?? '' };
}

/** Confirmation items the user must tick one by one (no "select all"). */
export interface ConfirmItem {
  key: string;
  text: string;
}

const CONFIRM_TEXT: Record<string, string> = {
  identity: 'The product details above match my label.',
  drugName: 'The drug name matches my label.',
  strength: 'The strength matches my label.',
  doseForm: 'The form matches my label.',
  ndc: 'The NDC matches my label.',
  lot: COPY.confirm.lotConfirm,
  release: 'I answered the release-type question from my label.',
};

export type LotChoice = 'USE' | 'NOT_USED';
/** The release answer: a mechanism, or 'UNKNOWN' when the patient cannot tell (never a guess). */
export type ReleaseChoice = ReleaseMechanism | 'UNKNOWN';
export interface ConfirmSelection {
  ticked: string[];
  lotChoice: LotChoice | null;
  release: ReleaseChoice | null;
}

export type ScreenModel =
  | { kind: 'WORKING'; text: string }
  | { kind: 'ENTRY_PROBLEM'; text: string; missing: string[] }
  | { kind: 'CHOOSE_PRODUCT'; text: string; options: { index: number; title: string; fields: FieldView[] }[] }
  | {
      kind: 'CONFIRM';
      fields: FieldView[];
      items: ConfirmItem[];
      askRelease: boolean;
      lot: string | null;
      notice: string | null;
      /** No NDC was read or typed: explain what can and cannot be checked from name, strength and form. */
      noNdc: boolean;
      /** Every confirmation the engine requires (review item 10): the screen's readiness follows it. */
      required: string[];
      /** A lot was read or typed: the patient must choose to use it or continue without it. */
      lotChoiceRequired: boolean;
      /** Shown when the patient says they cannot tell the release mechanism (review item 11). */
      releaseUnknownHelp: string[];
      /** True when the choices satisfy every engine requirement. */
      ready(sel: ConfirmSelection): boolean;
      /** What is still needed, in plain words, when not ready. */
      stillNeeded(sel: ConfirmSelection): string[];
    }
  | { kind: 'RESULT'; view: ResultView; fields: FieldView[]; canSave: boolean; saved: boolean; saveError: string | null }
  | { kind: 'NOT_ASSESSED'; view: NotAssessedView }
  | { kind: 'SOURCE_PROBLEM'; headline: string; body: string; canRetry: boolean };

export interface ScreenOptions {
  now: string;
  persistHistory: boolean;
  format?: DateFormatter;
}

const WORKING_TEXT: Partial<Record<WorkflowState['name'], string>> = {
  SCAN: 'Starting…',
  EXTRACT: 'Reading your entry…',
  IDENTIFY: 'Looking up the product in the FDA NDC Directory…',
  CHECK_EXCLUSION: 'Checking whether this app covers this medication…',
  FETCH_EVIDENCE: 'Searching FDA recall records…',
  EVALUATE: 'Comparing recall records with your medication…',
  RETRY: 'Trying again…',
  SAVE: 'Saving on this phone…',
};

export function screenFor(s: WorkflowState, o: ScreenOptions): ScreenModel {
  const fmt = o.format ?? isoMinute;
  const c = s.ctx;
  switch (s.name) {
    case 'SCAN':
    case 'EXTRACT':
    case 'IDENTIFY':
    case 'CHECK_EXCLUSION':
    case 'FETCH_EVIDENCE':
    case 'EVALUATE':
    case 'RETRY':
    case 'SAVE':
      return { kind: 'WORKING', text: WORKING_TEXT[s.name] ?? 'Working…' };
    case 'MISSING_INFORMATION':
    case 'USER_CORRECTION':
      return { kind: 'ENTRY_PROBLEM', text: c.lastFailure && /not.?found|NOT_FOUND/i.test(c.lastFailure) ? COPY.errors.notFound : COPY.errors.missing, missing: c.missing };
    case 'AMBIGUOUS_IDENTITY':
      return {
        kind: 'CHOOSE_PRODUCT',
        text: COPY.errors.ambiguous,
        options: c.identityOptions.map((id, index) => ({ index, title: [id.productNdc, id.labelerName].filter(Boolean).join(' — '), fields: identityFields(id, c.extraction) })),
      };
    case 'CONFIRM': {
      if (!c.identity) return { kind: 'SOURCE_PROBLEM', headline: COPY.errors.generic, body: '', canRetry: false };
      const keys = c.requiredConfirmations.length > 0 ? c.requiredConfirmations : ['identity'];
      const lot = c.extraction?.lot?.value ?? null;
      // Lot and release are answered by their own choices, not by a tick (review items 10, 11).
      const items = keys.filter((k) => k !== 'release' && k !== 'lot').map((k) => ({ key: k, text: CONFIRM_TEXT[k] ?? `I checked: ${k}` }));
      const askRelease = keys.includes('release');
      const lotChoiceRequired = lot !== null;
      const stillNeeded = (sel: ConfirmSelection): string[] => [
        ...items.filter((i) => !sel.ticked.includes(i.key)).map((i) => i.text),
        ...(lotChoiceRequired && sel.lotChoice === null ? [COPY.confirm.needLotChoice] : []),
        ...(askRelease && (sel.release === null || sel.release === 'UNKNOWN' || sel.release === 'UNSPECIFIED') ? [COPY.confirm.needRelease] : []),
      ];
      // An NDC was typed but no FDA listing was used: say so (OD-23), instead of only "Not identified".
      const ndcTyped = (c.extraction?.ndcTexts.length ?? 0) > 0;
      const notice = ndcTyped && c.identity.productNdc === null ? COPY.confirm.ndcNotFound : null;
      return {
        kind: 'CONFIRM',
        fields: identityFields(c.identity, c.extraction),
        items,
        askRelease,
        lot,
        notice,
        noNdc: !ndcTyped && c.identity.productNdc === null,
        required: [...keys],
        lotChoiceRequired,
        releaseUnknownHelp: [...COPY.confirm.releaseUnknownHelp],
        ready: (sel) => stillNeeded(sel).length === 0,
        stillNeeded,
      };
    }
    case 'EXPLAIN':
    case 'SAVED':
    case 'OFFLINE_CACHED_RESULT': {
      const offline = s.name === 'OFFLINE_CACHED_RESULT';
      const identity = offline ? c.cached?.identity : c.identity;
      const finding = offline ? c.cached?.finding : c.finding;
      if (!identity || !finding) return { kind: 'SOURCE_PROBLEM', headline: COPY.errors.generic, body: '', canRetry: true };
      const view = presentResult({ identity, finding, now: o.now, format: fmt, origin: offline ? 'SAVED' : 'LIVE' });
      if (offline) view.qualifiers.unshift(COPY.errors.offline(fmt(finding.evaluatedAt)));
      return { kind: 'RESULT', view, fields: identityFields(identity, c.extraction), canSave: o.persistHistory && s.name === 'EXPLAIN', saved: s.name === 'SAVED', saveError: c.saveError };
    }
    case 'EXCLUDED':
    case 'UNSUPPORTED':
    case 'NEEDS_CLARIFICATION': {
      const d = c.exclusion;
      if (!d || d.decision === 'ELIGIBLE') return { kind: 'SOURCE_PROBLEM', headline: COPY.errors.generic, body: COPY.errors.generic, canRetry: false };
      return { kind: 'NOT_ASSESSED', view: presentNotAssessed(d) };
    }
    case 'SOURCE_UNAVAILABLE':
      return { kind: 'SOURCE_PROBLEM', ...COPY.errors.sourceUnavailable, canRetry: true };
    case 'RATE_LIMITED':
      return { kind: 'SOURCE_PROBLEM', ...COPY.errors.rateLimited, canRetry: true };
    default: {
      const never: never = s.name;
      return never;
    }
  }
}

/**
 * Build the USER_CONFIRMED event from the patient's choices. The lot is used only with an explicit
 * "use this lot"; "continue without the lot" sends none. A release of 'UNKNOWN' is not sent, so the
 * engine keeps the release unconfirmed and no check starts (review items 10, 11).
 */
export function confirmationEvent(ticked: string[], lot: string | null, release: ReleaseChoice | null, lotChoice?: LotChoice | null) {
  const choice: LotChoice | null = lotChoice ?? (ticked.includes('lot') ? 'USE' : null);
  const stated = release !== null && release !== 'UNKNOWN' && release !== 'UNSPECIFIED' ? release : null;
  const fields = [...new Set([...ticked.filter((t) => t !== 'lot'), ...(choice === 'USE' ? ['lot'] : []), ...(stated ? ['release'] : [])])].sort();
  return {
    type: 'USER_CONFIRMED' as const,
    confirmedFields: fields,
    lot: choice === 'USE' ? lot : null,
    ...(choice ? { lotChoice: choice } : {}),
    ...(stated ? { release: stated } : {}),
  };
}
