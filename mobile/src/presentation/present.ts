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

/** Acceptance policy for freshness (EVIDENCE_AND_CLAIMS_POLICY.md §5). */
export const FRESHNESS = {
  /** A "no matching recall" statement is shown only for results evaluated within this window. */
  maxResultAgeHours: 24,
  /** openFDA enforcement data is normally updated weekly; older than this is treated as stale. */
  maxDatasetAgeDays: 45,
} as const;

export type EvidenceLevel = 'VERIFIED_SOURCE' | 'USER_CONFIRMED' | 'USER_ENTERED' | 'INFERRED' | 'CONFLICTING' | 'UNVERIFIED' | 'UNAVAILABLE';

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
  lines: { label: string; value: string }[];
  lotNote: string | null;
  officialRecordUrl: string;
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
  const factLevel: EvidenceLevel = product ? 'VERIFIED_SOURCE' : 'USER_ENTERED';
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
      : f('release', COPY.fields.release, COPY.fields.releaseValues[identity.release], product ? 'VERIFIED_SOURCE' : userGaveRelease ? 'USER_CONFIRMED' : 'USER_ENTERED'),
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
        ? f('lot', COPY.fields.lot, typedLot, 'USER_ENTERED', COPY.fields.lotUnconfirmedNote)
        : f('lot', COPY.fields.lot, 'Not entered', 'UNAVAILABLE'),
  );
  switch (identity.sourceProductStatus) {
    case 'VERIFIED':
      out.push(f('source', COPY.fields.source, identity.relatedSourceProductNdcs.join(', '), 'VERIFIED_SOURCE', COPY.fields.sourceVerified));
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
  if (f.coverage.positiveControl.status !== 'PASSED') inconsistent.push(COPY.result.downgrade.controlFailed);
  if (f.coverage.queries.some((q) => q.status !== 'COMPLETE')) inconsistent.push(COPY.result.downgrade.incomplete);
  if (f.confirmed.length + f.potential.length > 0) inconsistent.push('records that match or might match were present');
  if (f.unresolved.length > 0) inconsistent.push(COPY.result.downgrade.unreadable);
  if (identity.ingredients.length === 0) inconsistent.push('no identity');
  const ageH = (Date.parse(now) - Date.parse(evaluatedAt)) / 3_600_000;
  if (!(ageH >= 0 && ageH <= FRESHNESS.maxResultAgeHours)) stale.push(COPY.result.downgrade.staleResult(isoMinute(evaluatedAt)));
  const ds = f.coverage.datasetLastUpdated;
  if (ds === null) inconsistent.push('FDA dataset date unknown');
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

function recordView(r: RecordAssessment, group: RecordView['group']): RecordView {
  const p = r.published;
  const R = COPY.result.record;
  const lines = p
    ? [
        { label: R.recallNumber, value: r.recallNumber },
        { label: R.classification, value: `${p.classification}${R.classExplanation[p.classification] ? ` — ${R.classExplanation[p.classification]}` : ''}` },
        { label: R.status, value: `${p.status}. ${R.statusNote}` },
        { label: R.reportDate, value: p.reportDate },
        { label: R.firm, value: p.recallingFirm },
        { label: R.reason, value: p.reasonForRecall },
      ]
    : [{ label: R.recallNumber, value: r.recallNumber }];
  return { recallNumber: r.recallNumber, group, lines, lotNote: group === 'notApplicable' ? null : lotNote(r), officialRecordUrl: officialRecordUrl(r.recallNumber) };
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
