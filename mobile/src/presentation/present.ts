/**
 * Presentation layer: the only path from engine results to patient-facing statements
 * (docs/EVIDENCE_AND_CLAIMS_POLICY.md). Pure and deterministic; the clock is passed in.
 *
 * Overriding rule: never present a statement stronger than the verified evidence. Each internal
 * classification is re-checked against its evidence requirements before it is shown. If the
 * evidence does not support the reassuring or alarming statement, the presentation is downgraded
 * (CONFIRMED → POTENTIAL → UNABLE; NO_MATCH → UNABLE) and the inconsistency is flagged for
 * investigation. Downgrades only ever move toward uncertainty, never toward reassurance.
 */
import { COPY } from '../copy/en.ts';
import type { RecallFinding, RecordAssessment } from '../models/evidence.ts';
import type { LabelExtraction, MedicationIdentity } from '../models/identity.ts';
import type { ExclusionDecision } from '../models/policy.ts';
import { datasetDateUsable, sourceProductUncertain } from '../rules/recallEvidence.ts';

/** Acceptance policy for freshness (EVIDENCE_AND_CLAIMS_POLICY.md §5). */
export const FRESHNESS = {
  /** A "no matching recall" statement is shown only for results evaluated within this window. */
  maxResultAgeHours: 24,
  /** openFDA enforcement data is normally updated weekly; older than this is treated as stale. */
  maxDatasetAgeDays: 45,
} as const;

export type EvidenceLevel = 'VERIFIED_SOURCE' | 'USER_CONFIRMED' | 'SCANNED' | 'USER_ENTERED' | 'INFERRED' | 'CONFLICTING' | 'UNVERIFIED' | 'UNAVAILABLE';

/** Confirmation-screen groups (Task 4C): what FDA records confirm, what was read or typed, what needs the user. */
export type FieldClass = 'VERIFIED' | 'READ_OR_ENTERED' | 'NEEDS_INPUT';
export function fieldClass(e: EvidenceLevel): FieldClass {
  switch (e) {
    case 'VERIFIED_SOURCE':
      return 'VERIFIED';
    case 'USER_CONFIRMED':
    case 'SCANNED':
    case 'USER_ENTERED':
    case 'INFERRED':
      return 'READ_OR_ENTERED';
    case 'CONFLICTING':
    case 'UNVERIFIED':
    case 'UNAVAILABLE':
      return 'NEEDS_INPUT';
    default: {
      const never: never = e;
      return never;
    }
  }
}

export interface FieldView {
  key: 'product' | 'ingredients' | 'form' | 'release' | 'labeler' | 'lot' | 'source';
  label: string;
  value: string;
  evidence: EvidenceLevel;
  evidenceLabel: string;
  note: string | null;
}

export type Category = 'CONFIRMED' | 'POTENTIAL' | 'NO_MATCH' | 'UNABLE';
/** Visual tone. There is no "success" tone: a no-match result is NEUTRAL (never green, no checkmark). */
export type Tone = 'ALERT' | 'CAUTION' | 'NEUTRAL';

export interface RecordView {
  recallNumber: string;
  group: 'matches' | 'possible' | 'notApplicable' | 'unreadable';
  /** Plain-language key details, shown on the record card. */
  lines: { label: string; value: string }[];
  /** Longer published text (product description, lot codes), shown when the card is expanded. */
  more: { label: string; value: string }[];
  lotNote: string | null;
  officialRecordUrl: string;
  /** Only for records conclusively excluded by the engine (NOT_APPLICABLE). */
  excluded: { primary: ExclusionReason; primaryText: string; others: string[] } | null;
}

/**
 * Primary exclusion reasons in the fixed order used for counting (Task 4C build 7). A record that
 * differs in several ways is counted once, under the first of its differences in this order, so the
 * counts never overlap and always add up to the number of excluded records.
 */
export const EXCLUSION_ORDER = [
  'COMBINATION_PRODUCT',
  'DIFFERENT_SALT',
  'NON_ORAL_OR_NOT_FINISHED_PRODUCT',
  'DOSE_FORM_DIFFERS',
  'RELEASE_DIFFERS',
  'STRENGTH_DIFFERS',
  'TEXT_NDC_NAMES_OTHER_PRODUCTS',
  'STRUCTURED_NDC_EXCLUDES_PRODUCT',
  'OTHER',
] as const;
export type ExclusionReason = (typeof EXCLUSION_ORDER)[number];

export interface ExclusionSummary {
  total: number;
  /** Non-overlapping counts by primary reason, in EXCLUSION_ORDER; zero counts omitted. Sum = total. */
  reasons: { reason: ExclusionReason; text: string; count: number }[];
  /** Records with more than one difference (each still counted once). */
  multipleDifferences: number;
}

export interface ResultView {
  category: Category;
  /** The engine's own classification, for transparency and audit. */
  internalFinding: RecallFinding['finding'];
  tone: Tone;
  headline: string;
  qualifiers: string[];
  nextSteps: string[];
  records: RecordView[];
  /** One sentence counting every record the search returned, by group. */
  summary: string;
  exclusions: ExclusionSummary;
  sources: string[];
  limitations: string[];
  disclaimer: string;
  /** Set when the presentation was weakened; the reasons are shown and kept for review. */
  downgrade: { from: Category; reasons: string[]; investigate: boolean } | null;
  asOf: string;
}

export interface NotAssessedView {
  kind: 'EXCLUDED' | 'UNSUPPORTED' | 'NEEDS_CLARIFICATION' | 'CONFIG_BLOCKED';
  tone: 'NEUTRAL';
  headline: string;
  body: string[];
  policyVersion: string | null;
  ruleId: string | null;
  disclaimer: string;
}

const fmtStrength = (s: MedicationIdentity['ingredients'][number]['strength']) =>
  s ? `${s.value} ${s.unit.toLowerCase()}${s.per === '1' ? '' : `/${s.per.toLowerCase()}`}` : 'strength not known';

/** Formatting of instants for display. The UI passes a locale-aware formatter. */
export type DateFormatter = (iso: string) => string;
export const isoMinute: DateFormatter = (iso) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

// ---------------------------------------------------------------------------------------------
// Identity fields with their evidence
// ---------------------------------------------------------------------------------------------

export function identityFields(identity: MedicationIdentity, extraction: LabelExtraction | null): FieldView[] {
  const f = (key: FieldView['key'], label: string, value: string, evidence: EvidenceLevel, note: string | null = null): FieldView => ({
    key, label, value, evidence, evidenceLabel: COPY.evidence[evidence], note,
  });
  const product = identity.level === 'PRODUCT';
  // Facts from an FDA NDC Directory listing are VERIFIED_SOURCE; on the name-only path they are the user's entries.
  // Values read by the camera are SCANNED ("read from your label"), never presented as typed or verified.
  const scanned = (v: { origin: string } | null | undefined) => v !== null && v !== undefined && (v.origin === 'OCR' || v.origin === 'BARCODE');
  const factLevel: EvidenceLevel = product ? 'VERIFIED_SOURCE' : scanned(extraction?.drugName) ? 'SCANNED' : 'USER_ENTERED';
  const conflicts = identity.sourceConflicts ?? [];
  const out: FieldView[] = [];
  out.push(
    product && identity.productNdc
      ? f('product', COPY.fields.product, identity.packageNdc ?? identity.productNdc, 'VERIFIED_SOURCE', COPY.fields.ndcListingNote)
      : f('product', COPY.fields.product, 'Not identified', 'UNAVAILABLE'),
  );
  const ingredientText = identity.ingredients.map((i) => `${i.name}${i.salt ? ` ${i.salt}` : ''} ${fmtStrength(i.strength)}`).join(' + ');
  out.push(conflicts.some((c) => c.startsWith('SALT_CONFLICT')) ? f('ingredients', COPY.fields.ingredients, ingredientText, 'CONFLICTING', COPY.fields.conflict) : f('ingredients', COPY.fields.ingredients, ingredientText, factLevel));
  out.push(f('form', COPY.fields.form, identity.doseForm.toLowerCase(), factLevel));
  const userGaveRelease = !product && identity.release !== 'UNSPECIFIED' && extraction !== null && !/\b(ER|XR|XL|SR|DR|EC|extended|delayed)\b/i.test(extraction.drugName?.value ?? '');
  out.push(
    identity.release === 'UNSPECIFIED'
      ? f('release', COPY.fields.release, COPY.fields.releaseValues.UNSPECIFIED, 'UNAVAILABLE')
      : f('release', COPY.fields.release, COPY.fields.releaseValues[identity.release], product ? 'VERIFIED_SOURCE' : userGaveRelease ? 'USER_CONFIRMED' : factLevel),
  );
  out.push(
    product && identity.labelerName
      ? f('labeler', COPY.fields.labeler, identity.labelerName, 'VERIFIED_SOURCE', COPY.fields.labelerNote)
      : f('labeler', COPY.fields.labeler, 'Not identified', 'UNAVAILABLE'),
  );
  const typedLot = extraction?.lot?.value ?? null;
  out.push(
    identity.lot
      ? f('lot', COPY.fields.lot, identity.lot, 'USER_CONFIRMED', COPY.fields.lotNote)
      : typedLot
        ? f('lot', COPY.fields.lot, typedLot, scanned(extraction?.lot) ? 'SCANNED' : 'USER_ENTERED', COPY.fields.lotUnconfirmedNote)
        : f('lot', COPY.fields.lot, 'Not entered', 'UNAVAILABLE'),
  );
  switch (identity.sourceProductStatus) {
    case 'VERIFIED':
      out.push(f('source', COPY.fields.source, identity.relatedSourceProductNdcs.join(', '), 'VERIFIED_SOURCE', COPY.fields.sourceVerified));
      break;
    case 'PARTIAL':
      out.push(f('source', COPY.fields.source, identity.relatedSourceProductNdcs.join(', '), 'UNVERIFIED', COPY.fields.sourcePartial));
      break;
    case 'NOT_ESTABLISHED':
    case 'UNAVAILABLE':
      out.push(f('source', COPY.fields.source, 'Unknown', 'UNAVAILABLE', COPY.fields.sourceUnknown));
      break;
    case 'NOT_CHECKED':
      if (product) out.push(f('source', COPY.fields.source, 'Not checked', 'UNVERIFIED', COPY.fields.sourceNotChecked));
      break;
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Evidence checks for each category
// ---------------------------------------------------------------------------------------------

function confirmedIsSupported(identity: MedicationIdentity, f: RecallFinding): string[] {
  const why: string[] = [];
  if (identity.level !== 'PRODUCT' || identity.productNdc === null) why.push('confirmed match without a directory-confirmed product');
  if (f.confirmed.length === 0) why.push('confirmed finding without a confirmed record');
  for (const r of f.confirmed) {
    if (r.relevance !== 'PRODUCT_MATCH') why.push(`${r.recallNumber}: not a product match`);
    if (r.lot === 'LOT_LISTED' && identity.lot === null) why.push(`${r.recallNumber}: lot listed without a confirmed lot`);
    if (r.lot !== 'LOT_LISTED' && !(r.lot === 'LOT_NOT_REQUIRED' && r.lotScope.kind === 'ALL_LOTS')) why.push(`${r.recallNumber}: lot criteria not met`);
  }
  return why;
}

function noMatchIsSupported(identity: MedicationIdentity, f: RecallFinding, evaluatedAt: string, now: string): { inconsistent: string[]; stale: string[] } {
  const inconsistent: string[] = [];
  const stale: string[] = [];
  if (!f.coverage.complete) inconsistent.push(COPY.result.downgrade.incomplete);
  if (f.coverage.searchAdequate !== true) inconsistent.push(COPY.result.downgrade.searchIncomplete);
  if (f.coverage.positiveControl.status !== 'PASSED') inconsistent.push(COPY.result.downgrade.controlFailed);
  if (f.coverage.queries.some((q) => q.status !== 'COMPLETE')) inconsistent.push(COPY.result.downgrade.incomplete);
  if (f.confirmed.length + f.potential.length > 0) inconsistent.push('records that match or might match were present');
  if (f.unresolved.length > 0) inconsistent.push(COPY.result.downgrade.unreadable);
  if (identity.ingredients.length === 0) inconsistent.push('no identity');
  const ageH = (Date.parse(now) - Date.parse(evaluatedAt)) / 3_600_000;
  if (!(ageH >= 0 && ageH <= FRESHNESS.maxResultAgeHours)) stale.push(COPY.result.downgrade.staleResult(isoMinute(evaluatedAt)));
  const ds = f.coverage.datasetLastUpdated;
  if (ds === null) inconsistent.push(COPY.result.downgrade.datasetDateUnknown);
  else if (!datasetDateUsable(ds, evaluatedAt)) inconsistent.push(COPY.result.downgrade.datasetDateInvalid);
  else if ((Date.parse(evaluatedAt) - Date.parse(`${ds}T00:00:00Z`)) / 86_400_000 > FRESHNESS.maxDatasetAgeDays) stale.push(COPY.result.downgrade.staleSource(ds));
  return { inconsistent: [...new Set(inconsistent)], stale };
}

// ---------------------------------------------------------------------------------------------
// Records and sources
// ---------------------------------------------------------------------------------------------

/** FDA's official Enforcement Reports page (verified 2026-11-12). */
export const FDA_ENFORCEMENT_REPORTS_URL = 'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/enforcement-reports';

/** The public openFDA record for one recall number (the exact data the app used). */
export const officialRecordUrl = (recallNumber: string) =>
  `https://api.fda.gov/drug/enforcement.json?search=recall_number:%22${encodeURIComponent(recallNumber)}%22`;

function lotNote(r: RecordAssessment): string | null {
  switch (r.lot) {
    case 'LOT_LISTED':
      return COPY.result.record.lotListed;
    case 'LOT_POSSIBLY_LISTED':
      return COPY.result.record.lotPossiblyListed;
    case 'LOT_NOT_FOUND_IN_LISTING':
      return COPY.result.record.lotNotFound;
    case 'LOT_NOT_REQUIRED':
      return r.lotScope.kind === 'ALL_LOTS' ? COPY.result.record.allLots : null;
    case 'LOT_UNKNOWN':
      return r.lotScope.kind === 'LOT_SPECIFIC' ? COPY.result.record.lotUnknown : null;
  }
}

/** openFDA dates are YYYYMMDD; shown as ISO dates (unambiguous in every locale). */
export function recordDate(d: string | null): string | null {
  if (d === null || !/^\d{8}$/.test(d)) return d && d.trim() !== '' ? d : null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** Differences the engine recorded for an excluded record, in counting order. */
export function exclusionReasons(r: RecordAssessment): ExclusionReason[] {
  const found = EXCLUSION_ORDER.filter((x) => x !== 'OTHER' && r.reasons.includes(x as RecordAssessment['reasons'][number]));
  return found.length > 0 ? found : ['OTHER'];
}

function recordView(r: RecordAssessment, group: RecordView['group']): RecordView {
  const p = r.published;
  const R = COPY.result.record;
  const X = COPY.result.excluded.reasons;
  let lines: RecordView['lines'] = [{ label: R.recallNumber, value: r.recallNumber }];
  let more: RecordView['more'] = [];
  if (p) {
    const statusText = R.statusExplanation[p.status] ?? p.status;
    const closed = recordDate(p.terminationDate);
    lines = [
      { label: R.recallStarted, value: recordDate(p.recallInitiationDate) ?? R.notStated },
      { label: R.firm, value: p.recallingFirm },
      { label: R.reason, value: p.reasonForRecall },
      { label: R.classification, value: R.classExplanation[p.classification] ?? p.classification },
      // The status note ("a completed or terminated recall does not mean the product is safe") is
      // shown once at the top of every record section (Result screen).
      { label: R.status, value: statusText },
      ...(closed ? [{ label: R.closedOn, value: closed }] : []),
      { label: R.recallNumber, value: r.recallNumber },
    ];
    more = [
      { label: R.fdaReportDate, value: recordDate(p.reportDate) ?? R.notStated },
      { label: R.product, value: p.productDescription },
      { label: R.lots, value: p.codeInfo.trim() === '' ? R.notStated : p.codeInfo },
    ];
  }
  let excluded: RecordView['excluded'] = null;
  if (group === 'notApplicable') {
    const all = exclusionReasons(r);
    const primary = all[0] as ExclusionReason;
    excluded = { primary, primaryText: X[primary] ?? X.OTHER!, others: all.slice(1).map((x) => X[x] ?? X.OTHER!) };
  }
  return { recallNumber: r.recallNumber, group, lines, more, lotNote: group === 'notApplicable' ? null : lotNote(r), officialRecordUrl: officialRecordUrl(r.recallNumber), excluded };
}

function summarizeExclusions(records: RecordView[]): ExclusionSummary {
  const ex = records.filter((r) => r.excluded !== null);
  const reasons = EXCLUSION_ORDER.map((reason) => ({
    reason,
    text: COPY.result.excluded.reasons[reason] ?? reason,
    count: ex.filter((r) => r.excluded?.primary === reason).length,
  })).filter((x) => x.count > 0);
  return { total: ex.length, reasons, multipleDifferences: ex.filter((r) => (r.excluded?.others.length ?? 0) > 0).length };
}

function summarySentence(identity: MedicationIdentity, records: RecordView[]): string {
  const S = COPY.result.summary;
  const drug = identity.ingredients.map((i) => i.name).join(' and ') || 'this medication';
  if (records.length === 0) return S.none(drug);
  const n = (g: RecordView['group']) => records.filter((r) => r.group === g).length;
  const parts = [
    n('matches') > 0 ? S.matches(n('matches')) : null,
    n('possible') > 0 ? S.possible(n('possible')) : null,
    n('unreadable') > 0 ? S.unreadable(n('unreadable')) : null,
    n('notApplicable') > 0 ? S.excluded(n('notApplicable')) : null,
  ].filter((x): x is string => x !== null);
  return `${S.intro(records.length, drug)} ${parts.join('; ')}.`;
}

const LIMITATION_TEXT: Partial<Record<RecallFinding['limitations'][number], string>> = {
  ABSENCE_IS_NOT_SAFETY: 'Not finding a recall is not evidence that a medication is free of problems.',
  FDA_DATA_MAY_BE_INCOMPLETE_OR_DELAYED: 'FDA recall data can be incomplete or delayed.',
  FREE_TEXT_PARSED_CONSERVATIVELY: 'Recall notices are free text; when we could not read them exactly, we treat them as possible matches.',
  REPACKAGED_PRODUCTS_MAY_NOT_NAME_YOUR_NDC: 'A recall of the original product may not name the NDC of a repackaged product.',
  TEXT_QUERY_MAY_MISS_ABBREVIATIONS: 'Recall notices that use unusual abbreviations may not be found.',
  PRODUCT_NOT_IDENTIFIED: COPY.result.qualifiers.productNotIdentified,
  LOT_NOT_PROVIDED: COPY.result.qualifiers.lotNotProvided,
  SOME_QUERIES_INCOMPLETE: COPY.result.downgrade.incomplete,
  SEARCH_TERMS_INCOMPLETE: COPY.result.downgrade.searchIncomplete,
  DATASET_DATE_INVALID: COPY.result.downgrade.datasetDateInvalid,
  POSITIVE_CONTROL_NOT_PASSED: COPY.result.downgrade.controlFailed,
  SOME_RECORDS_UNPARSEABLE: COPY.result.downgrade.unreadable,
  SOURCE_PRODUCT_NOT_ESTABLISHED: COPY.result.qualifiers.sourceNotEstablished,
};

// ---------------------------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------------------------

export interface PresentInput {
  identity: MedicationIdentity;
  finding: RecallFinding;
  /** Device time now (ISO-8601). */
  now: string;
  format?: DateFormatter;
  /** 'SAVED' for results reopened from history or shown offline. */
  origin?: 'LIVE' | 'SAVED';
}

export function presentResult(input: PresentInput): ResultView {
  const { identity, finding: f, now } = input;
  const fmt = input.format ?? isoMinute;
  const asOf = fmt(f.evaluatedAt);
  const engine: Category =
    f.finding === 'CONFIRMED_MATCH' ? 'CONFIRMED' : f.finding === 'POTENTIAL_MATCH' ? 'POTENTIAL' : f.finding === 'NO_MATCH_FOUND' ? 'NO_MATCH' : 'UNABLE';

  let category = engine;
  const reasons: string[] = [];
  let investigate = false;
  if (category === 'CONFIRMED') {
    const why = confirmedIsSupported(identity, f);
    if (why.length > 0) {
      reasons.push(COPY.result.downgrade.inconsistent, ...why);
      investigate = true;
      category = f.potential.length + f.confirmed.length > 0 ? 'POTENTIAL' : 'UNABLE';
    }
  }
  if (category === 'POTENTIAL' && f.potential.length + f.confirmed.length === 0) {
    reasons.push(COPY.result.downgrade.inconsistent);
    investigate = true;
    category = 'UNABLE';
  }
  if (category === 'NO_MATCH') {
    const { inconsistent, stale } = noMatchIsSupported(identity, f, f.evaluatedAt, now);
    if (inconsistent.length > 0) {
      reasons.push(COPY.result.downgrade.inconsistent, ...inconsistent);
      investigate = true;
      category = 'UNABLE';
    } else if (stale.length > 0) {
      reasons.push(...stale);
      category = 'UNABLE';
    }
  }

  const qualifiers: string[] = [];
  if (category === 'NO_MATCH' || category === 'POTENTIAL') {
    if (identity.level !== 'PRODUCT') qualifiers.push(COPY.result.qualifiers.productNotIdentified, COPY.result.qualifiers.userEnteredIdentity);
    if (identity.sourceProductStatus === 'NOT_ESTABLISHED') qualifiers.push(COPY.result.qualifiers.sourceNotEstablished);
    if (identity.sourceProductStatus === 'UNAVAILABLE') qualifiers.push(COPY.result.qualifiers.sourceUnavailable);
    if (identity.sourceProductStatus === 'PARTIAL') qualifiers.push(COPY.result.qualifiers.sourcePartial);
    if ((identity.sourceProductStatus ?? 'NOT_CHECKED') === 'NOT_CHECKED' && sourceProductUncertain(identity)) qualifiers.push(COPY.result.qualifiers.sourceNotChecked);
    if (identity.lot === null && f.potential.concat(f.confirmed).some((r) => r.reasons.includes('LOT_REQUIRED'))) qualifiers.push(COPY.result.qualifiers.lotNotProvided);
  }
  if (input.origin === 'SAVED') qualifiers.push(COPY.errors.offline(asOf));

  const headline =
    category === 'CONFIRMED' ? COPY.result.CONFIRMED.headline : category === 'POTENTIAL' ? COPY.result.POTENTIAL.headline : category === 'NO_MATCH' ? COPY.result.NO_MATCH.headline(asOf) : COPY.result.UNABLE.headline;
  const tone: Tone = category === 'CONFIRMED' ? 'ALERT' : category === 'POTENTIAL' ? 'CAUTION' : 'NEUTRAL';

  const N = COPY.result.nextSteps;
  const nextSteps =
    category === 'CONFIRMED' || category === 'POTENTIAL' ? [N.contactProfessional, N.readNotice, N.doNotChange] : category === 'UNABLE' ? [N.checkAgain, N.doNotChange] : [N.doNotChange];

  const records: RecordView[] = [
    ...f.confirmed.map((r) => recordView(r, category === 'CONFIRMED' ? 'matches' : 'possible')),
    ...f.potential.map((r) => recordView(r, 'possible')),
    ...f.unresolved.map((r) => recordView(r, 'unreadable')),
    ...f.notApplicable.map((r) => recordView(r, 'notApplicable')),
  ];

  const S = COPY.result.sources;
  const complete = f.coverage.queries.filter((q) => q.status === 'COMPLETE').length;
  const retrieved = f.coverage.queries.map((q) => q.retrievedAt).filter((x): x is string => x !== null).sort()[0] ?? f.evaluatedAt;
  const sources = [
    'U.S. Food and Drug Administration — Enforcement Reports (openFDA)',
    S.retrieved(fmt(retrieved)),
    ...(f.coverage.datasetLastUpdated ? [S.datasetUpdated(f.coverage.datasetLastUpdated)] : []),
    S.queries(f.coverage.queries.length, complete),
    S.control(f.coverage.positiveControl.status === 'PASSED'),
    S.perMedication,
    S.refresh,
  ];
  const limitations = [...new Set(f.limitations.map((l) => LIMITATION_TEXT[l]).filter((x): x is string => x !== undefined))];

  return {
    category,
    internalFinding: f.finding,
    tone,
    headline,
    qualifiers: [...new Set(qualifiers)],
    nextSteps,
    records,
    summary: summarySentence(identity, records),
    exclusions: summarizeExclusions(records),
    sources,
    limitations,
    disclaimer: COPY.disclaimer.standing,
    downgrade: category !== engine || reasons.length > 0 ? { from: engine, reasons, investigate } : null,
    asOf,
  };
}

export function presentNotAssessed(decision: Exclude<ExclusionDecision, { decision: 'ELIGIBLE' }>): NotAssessedView {
  const blocked = decision.decision === 'UNSUPPORTED' && ['POLICY_INVALID', 'CATALOG_INVALID', 'CONFIG_INCOMPATIBLE'].includes(decision.reason);
  const kind: NotAssessedView['kind'] = blocked ? 'CONFIG_BLOCKED' : decision.decision;
  const c = blocked ? COPY.notAssessed.configBlocked : COPY.notAssessed[decision.decision];
  const explanation = 'explanation' in decision && decision.explanation ? [decision.explanation] : [];
  return {
    kind,
    tone: 'NEUTRAL',
    headline: c.headline,
    body: [c.body, ...explanation, ...(decision.decision === 'EXCLUDED' ? [COPY.disclaimer.exclusionNotSafety] : [])],
    policyVersion: decision.policyVersion,
    ruleId: decision.ruleId ?? null,
    disclaimer: COPY.disclaimer.standing,
  };
}
