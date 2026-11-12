/**
 * Evidence-backed claims (docs/EVIDENCE_AND_CLAIMS_POLICY.md): the presentation layer never shows a
 * statement stronger than the evidence, downgrades unsupported classifications, separates verified
 * from user-entered information, and patient-facing text contains no prohibited claims. Findings
 * come from the production engine on real fixtures; mutations are labeled.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { COPY, REVIEWED_NEGATED_STATEMENTS, allCopyStrings } from '../../mobile/src/copy/en.ts';
import { FRESHNESS, identityFields, presentNotAssessed, presentResult, type PresentInput } from '../../mobile/src/presentation/present.ts';
import { evaluateRecallEvidence, planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import { identityFromPrintedFields } from '../../mobile/src/rules/identity.ts';
import { LEGAL_DOCUMENTS } from '../../mobile/src/legal/documents.ts';
import { acknowledge, documentsNeedingAcknowledgement } from '../../mobile/src/legal/consent.ts';
import { parseBuildProfile, pilotBlockers, profileFor, REQUIRED_SIGNOFFS } from '../../mobile/src/app/buildProfile.ts';
import { buildLegalBundle } from '../../scripts/bundle_legal_docs.ts';
import type { RecallFinding } from '../../mobile/src/models/evidence.ts';
import type { MedicationIdentity } from '../../mobile/src/models/identity.ts';
import { ROOT, apiNdcRecord, bundle, control, enf, firstNdcRecord, productIdentity, realNoMatch, realServerError } from '../helpers/fixtures.ts';

const EVAL_AT = '2026-11-12T12:00:00.000Z';
const NOW = '2026-11-12T13:00:00.000Z';

const sunEr = (lot: string | null = null) => productIdentity(firstNdcRecord('ndc_pkg_62756-142-02'), '62756-142-02', lot);
const tamsulosin = () => ({ ...productIdentity(apiNdcRecord('ndc_tamsulosin'), '71610-910-30'), sourceProductStatus: 'NOT_APPLICABLE' as const });
const evaluate = (id: MedicationIdentity, pages: Parameters<typeof bundle>[1]) => evaluateRecallEvidence(id, bundle(planRecallQueries(id), pages));
const METFORMIN = () => ({ ingredient_text: [enf('enf_text_metformin')], product_ndc: [enf('enf_pndc_62756-142')], control: [control()] });
const TAMSULOSIN = () => ({ ingredient_text: [enf('enf_text_tamsulosin')], product_ndc: [realNoMatch()], control: [control()] });
const show = (identity: MedicationIdentity, finding: RecallFinding, over: Partial<PresentInput> = {}) =>
  presentResult({ identity, finding: { ...finding, evaluatedAt: EVAL_AT }, now: NOW, ...over });

// ---------------------------------------------------------------- the four categories, evidence-supported

test('confirmed: only with a product NDC match and a listed (confirmed) lot; tone ALERT; pharmacist + official record', () => {
  const v = show(sunEr('JKU4639A'), evaluate(sunEr('JKU4639A'), METFORMIN()));
  assert.equal(v.category, 'CONFIRMED');
  assert.equal(v.headline, COPY.result.CONFIRMED.headline);
  assert.equal(v.tone, 'ALERT');
  assert.deepEqual(v.nextSteps, [COPY.result.nextSteps.contactProfessional, COPY.result.nextSteps.readNotice, COPY.result.nextSteps.doNotChange]);
  const rec = v.records.find((r) => r.recallNumber === 'D-0325-2021');
  assert.equal(rec?.group, 'matches');
  assert.match(rec?.officialRecordUrl ?? '', /^https:\/\/api\.fda\.gov\/drug\/enforcement\.json\?search=recall_number:%22D-0325-2021%22$/);
  assert.equal(v.downgrade, null);
});

test('unknown lot: potential, with the lot qualifier — never confirmed', () => {
  const v = show(sunEr(), evaluate(sunEr(), METFORMIN()));
  assert.equal(v.category, 'POTENTIAL');
  assert.equal(v.tone, 'CAUTION');
  assert.ok(v.qualifiers.includes(COPY.result.qualifiers.lotNotProvided));
  assert.ok(v.records.filter((r) => r.group === 'possible').some((r) => r.lotNote === COPY.result.record.lotUnknown));
});

test('no match: only with complete coverage, a passed control and fresh data; tone NEUTRAL; date in the headline', () => {
  const v = show(tamsulosin(), evaluate(tamsulosin(), TAMSULOSIN()));
  assert.equal(v.category, 'NO_MATCH');
  assert.equal(v.tone, 'NEUTRAL');
  assert.equal(v.headline, COPY.result.NO_MATCH.headline('2026-11-12 12:00 UTC'));
  assert.match(v.headline, /does not establish that the medication is free from recalls/);
  assert.ok(v.sources.some((s) => s.includes('2026-11-04')), 'dataset date shown');
  assert.ok(v.sources.includes(COPY.result.sources.refresh) && v.sources.includes(COPY.result.sources.perMedication));
  assert.ok(v.limitations.length >= 4);
  assert.equal(v.disclaimer, COPY.disclaimer.standing);
});

// ---------------------------------------------------------------- negative tests: uncertainty never becomes reassurance

const noMatchFinding = () => evaluate(tamsulosin(), TAMSULOSIN());

test('false reassurance blocked: a NO_MATCH_FOUND with incomplete coverage (mutated) is shown as UNABLE and flagged', () => {
  const f = noMatchFinding();
  const mutated: RecallFinding = { ...f, coverage: { ...f.coverage, complete: false, queries: f.coverage.queries.map((q, i) => (i === 0 ? { ...q, status: 'INCOMPLETE_PAGINATION' } : q)) } };
  const v = show(tamsulosin(), mutated);
  assert.equal(v.category, 'UNABLE');
  assert.equal(v.downgrade?.from, 'NO_MATCH');
  assert.equal(v.downgrade?.investigate, true);
});

test('false reassurance blocked: failed positive control, unreadable records or lingering potential records → UNABLE', () => {
  const f = noMatchFinding();
  const cases: RecallFinding[] = [
    { ...f, coverage: { ...f.coverage, positiveControl: { status: 'FAILED', detail: 'x' } } },
    { ...f, unresolved: [{ ...f.notApplicable[0]!, classification: 'UNRESOLVED', relevance: 'UNPARSEABLE' }] },
    { ...f, potential: [{ ...f.notApplicable[0]!, classification: 'POTENTIAL_MATCH' }] },
    { ...f, coverage: { ...f.coverage, datasetLastUpdated: null } },
  ];
  for (const c of cases) assert.equal(show(tamsulosin(), c).category, 'UNABLE');
});

test('stale result: a no-match older than the acceptance window is not shown as no-match', () => {
  const f = noMatchFinding();
  const later = new Date(Date.parse(EVAL_AT) + (FRESHNESS.maxResultAgeHours + 1) * 3_600_000).toISOString();
  const v = presentResult({ identity: tamsulosin(), finding: { ...f, evaluatedAt: EVAL_AT }, now: later, origin: 'SAVED' });
  assert.equal(v.category, 'UNABLE');
  assert.ok(v.downgrade?.reasons.some((r) => r.includes('too old')));
  assert.equal(v.downgrade?.investigate, false, 'staleness is expected, not an inconsistency');
});

test('stale source data: FDA dataset older than the acceptance window → UNABLE', () => {
  const f = noMatchFinding();
  const v = show(tamsulosin(), { ...f, coverage: { ...f.coverage, datasetLastUpdated: '2026-08-01' } });
  assert.equal(v.category, 'UNABLE');
});

test('network failure / incomplete pagination from the engine are UNABLE, never reassuring', () => {
  const failed = evaluate(tamsulosin(), { ...TAMSULOSIN(), ingredient_text: [realServerError()] });
  assert.equal(show(tamsulosin(), failed).category, 'UNABLE');
  const incomplete = evaluate(tamsulosin(), { ...TAMSULOSIN(), ingredient_text: [enf('enf_text_amlodipine_p1')] });
  assert.equal(show(tamsulosin(), incomplete).category, 'UNABLE');
});

test('missing FDA records: no recall records at all and a query not run → UNABLE', () => {
  const f = evaluate(tamsulosin(), { product_ndc: [realNoMatch()], control: [control()] });
  assert.equal(show(tamsulosin(), f).category, 'UNABLE');
});

test('confirmed without the evidence (mutated: lot not listed / no confirmed lot / name-only identity) is downgraded and flagged', () => {
  const f = evaluate(sunEr('JKU4639A'), METFORMIN());
  const noLot = show(sunEr(), f);
  assert.equal(noLot.category, 'POTENTIAL');
  assert.equal(noLot.downgrade?.investigate, true);
  const lotCriteria = { ...f, confirmed: f.confirmed.map((r) => ({ ...r, lot: 'LOT_NOT_FOUND_IN_LISTING' as const })) };
  assert.equal(show(sunEr('JKU4639A'), lotCriteria).category, 'POTENTIAL');
  const nameOnly = identityFromPrintedFields({ drugName: 'METFORMIN ER', strength: '500 MG', doseForm: 'TABLET' }, ['metformin'], 'JKU4639A');
  assert.ok(nameOnly.ok);
  if (nameOnly.ok) assert.notEqual(show(nameOnly.identity, f).category, 'CONFIRMED');
});

test('unknown repackager source (OD-17): no unqualified no-match', () => {
  const f = noMatchFinding();
  const id = { ...tamsulosin(), sourceProductStatus: 'NOT_ESTABLISHED' as const };
  const v = show(id, { ...f, limitations: [...f.limitations, 'SOURCE_PRODUCT_NOT_ESTABLISHED'] });
  assert.equal(v.category, 'NO_MATCH');
  assert.ok(v.qualifiers.includes(COPY.result.qualifiers.sourceNotEstablished));
  assert.ok(v.limitations.includes(COPY.result.qualifiers.sourceNotEstablished));
  const unavailable = show({ ...tamsulosin(), sourceProductStatus: 'UNAVAILABLE' }, f);
  assert.ok(unavailable.qualifiers.includes(COPY.result.qualifiers.sourceUnavailable));
});

test('user-entered identity: a no-match is qualified as not identified to an FDA product listing', () => {
  const r = identityFromPrintedFields({ drugName: 'TAMSULOSIN HCL', strength: '0.4 MG', doseForm: 'CAPSULE' }, ['tamsulosin'], null);
  assert.ok(r.ok);
  if (!r.ok) return;
  const id = { ...r.identity, release: 'IR' as const };
  const f = evaluate(id, { ingredient_text: [enf('enf_text_tamsulosin')], control: [control()] });
  const v = show(id, f);
  assert.ok(v.qualifiers.includes(COPY.result.qualifiers.userEnteredIdentity));
});

test('property: across 2,000 random mutations, a NO_MATCH presentation appears only when every evidence condition holds', () => {
  const base = noMatchFinding();
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let shownNoMatch = 0;
  for (let i = 0; i < 2000; i++) {
    const f: RecallFinding = structuredClone(base);
    if (rnd() < 0.2) f.coverage.complete = false;
    if (rnd() < 0.2) f.coverage.positiveControl.status = 'FAILED';
    if (rnd() < 0.2) f.coverage.queries[0]!.status = 'SOURCE_UNAVAILABLE';
    if (rnd() < 0.15) f.unresolved.push({ ...f.notApplicable[0]!, classification: 'UNRESOLVED' });
    if (rnd() < 0.15) f.potential.push({ ...f.notApplicable[1]!, classification: 'POTENTIAL_MATCH' });
    if (rnd() < 0.15) f.coverage.datasetLastUpdated = rnd() < 0.5 ? null : '2025-01-01';
    const ageH = rnd() < 0.2 ? 30 : 1;
    const now = new Date(Date.parse(EVAL_AT) + ageH * 3_600_000).toISOString();
    const v = presentResult({ identity: tamsulosin(), finding: { ...f, evaluatedAt: EVAL_AT }, now });
    const ok =
      f.coverage.complete && f.coverage.positiveControl.status === 'PASSED' && f.coverage.queries.every((q) => q.status === 'COMPLETE') &&
      f.unresolved.length === 0 && f.potential.length === 0 && f.confirmed.length === 0 && f.coverage.datasetLastUpdated === '2026-11-04' && ageH <= 24;
    if (v.category === 'NO_MATCH') {
      shownNoMatch++;
      assert.ok(ok, `iteration ${i}`);
    }
    assert.notEqual(v.tone === 'NEUTRAL' && v.category === 'CONFIRMED', true);
  }
  assert.ok(shownNoMatch > 0, 'the property was exercised');
});

// ---------------------------------------------------------------- not assessed: never presented as passing a check

test('excluded / unsupported / needs clarification / invalid config: neutral, says no recall check was done', () => {
  const excluded = presentNotAssessed({ decision: 'EXCLUDED', reason: 'POLICY_LISTED_EXCLUDED', ingredient: 'warfarin', classId: 'ANTICOAGULANT', rationale: 'r', policyVersion: '0.2.0-draft', ruleId: 'EXCL-WARFARIN', explanation: 'Blood thinners are not assessed.' });
  assert.equal(excluded.kind, 'EXCLUDED');
  assert.ok(excluded.body.some((b) => /No recall check was done/.test(b)));
  assert.ok(excluded.body.includes(COPY.disclaimer.exclusionNotSafety));
  assert.equal(excluded.ruleId, 'EXCL-WARFARIN');
  const unsupported = presentNotAssessed({ decision: 'UNSUPPORTED', reason: 'NOT_IN_CATALOG', detail: 'x', policyVersion: 'p', catalogVersion: 'c' });
  assert.ok(unsupported.body.some((b) => /No recall check was done/.test(b)));
  const blocked = presentNotAssessed({ decision: 'UNSUPPORTED', reason: 'POLICY_INVALID', detail: 'status is not APPROVED', policyVersion: null, catalogVersion: null });
  assert.equal(blocked.kind, 'CONFIG_BLOCKED');
  for (const v of [excluded, unsupported, blocked]) {
    assert.equal(v.tone, 'NEUTRAL');
    for (const t of [v.headline, ...v.body]) assert.doesNotMatch(t, /no matching recall|passed|cleared/i);
  }
});

// ---------------------------------------------------------------- identity fields: verified vs user-entered

test('directory-confirmed identity: NDC, ingredients and form are FDA-sourced; lot is user-confirmed, never FDA-verified', () => {
  const fields = identityFields(sunEr('JKU4639A'), null);
  const by = (k: string) => fields.find((f) => f.key === k)!;
  assert.equal(by('product').evidence, 'VERIFIED_SOURCE');
  assert.equal(by('product').note, COPY.fields.ndcListingNote, 'listing is not approval');
  assert.match(COPY.fields.ndcListingNote, /not FDA approval/);
  assert.equal(by('ingredients').evidence, 'VERIFIED_SOURCE');
  assert.equal(by('lot').evidence, 'USER_CONFIRMED');
  assert.equal(by('labeler').label, 'Labeler (as listed by FDA)');
  assert.match(by('labeler').note ?? '', /may not be the company that made/);
});

test('name-only identity: every field is user-entered or unavailable, never FDA-sourced', () => {
  const r = identityFromPrintedFields({ drugName: 'METFORMIN', strength: '500 MG', doseForm: 'TABLET' }, ['metformin'], null);
  assert.ok(r.ok);
  if (!r.ok) return;
  for (const f of identityFields(r.identity, null)) assert.notEqual(f.evidence, 'VERIFIED_SOURCE', f.key);
});

test('conflicting FDA records are shown as a conflict, not resolved', () => {
  const id = productIdentity(apiNdcRecord('ndc_metoprolol_succinate'), null);
  const ing = identityFields(id, null).find((f) => f.key === 'ingredients')!;
  assert.equal(ing.evidence, 'CONFLICTING');
  assert.equal(ing.note, COPY.fields.conflict);
});

test('misleading manufacturer attribution: no field, copy or record line calls the labeler or recalling firm the manufacturer', () => {
  for (const s of allCopyStrings()) assert.doesNotMatch(s, /\bmanufacturer:|manufactured by your|made by the labeler/i);
  const v = show(sunEr('JKU4639A'), evaluate(sunEr('JKU4639A'), METFORMIN()));
  for (const r of v.records) for (const l of r.lines) assert.doesNotMatch(l.label, /manufacturer/i);
  for (const f of identityFields(sunEr(), null)) assert.doesNotMatch(f.label, /manufacturer/i);
});

// ---------------------------------------------------------------- prohibited wording

const PROHIBITED: RegExp[] = [
  /\bsafe\b/i,
  /no recalls? exists?/i,
  /recall[- ]free/i,
  /fda[- ]verified|verified by (the )?fda|fda verified your/i,
  /fda[- ]approved this app|approved by (the )?fda/i,
  /manufacturer verified/i,
  /guaranteed?/i,
  /100\s?%/,
  /you can continue taking/i,
  /\bstop taking (this|your)/i,
  /\bswitch to (another|a different)/i,
  /\b(all clear|no issues|clean result|good news|great news)\b/i,
  /[✓✔✅🎉]/u,
];

function check(text: string, where: string) {
  let t = text;
  for (const s of REVIEWED_NEGATED_STATEMENTS) t = t.split(s).join('');
  for (const re of PROHIBITED) assert.doesNotMatch(t, re, `${where}: ${text}`);
}

test('prohibited wording: none in the central copy (outside the reviewed negated disclaimers)', () => {
  for (const s of allCopyStrings()) check(s, 'copy');
});

test('prohibited wording: none in screens and components', () => {
  const dir = join(ROOT, 'mobile', 'app');
  if (!existsSync(dir)) return;
  const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : /\.(tsx?|js)$/.test(f) ? [join(d, f)] : []));
  for (const f of files(dir)) {
    const literals = [...readFileSync(f, 'utf8').matchAll(/(['"`])((?:(?!\1).){8,})\1/g)].map((m) => m[2] as string);
    for (const l of literals) if (/[a-z] [a-z]/i.test(l)) check(l, f);
  }
});

test('presented results never contain prohibited wording (all real scenarios)', () => {
  const views = [
    show(sunEr('JKU4639A'), evaluate(sunEr('JKU4639A'), METFORMIN())),
    show(sunEr(), evaluate(sunEr(), METFORMIN())),
    show(tamsulosin(), noMatchFinding()),
    show(tamsulosin(), evaluate(tamsulosin(), { ...TAMSULOSIN(), control: [realServerError()] })),
  ];
  for (const v of views) for (const t of [v.headline, ...v.qualifiers, ...v.nextSteps, ...v.sources, ...v.limitations]) check(t, v.category);
});

test('every result keeps sources, retrieval date, limitations and the "do not change medication" warning next to it', () => {
  for (const v of [show(tamsulosin(), noMatchFinding()), show(sunEr(), evaluate(sunEr(), METFORMIN()))]) {
    assert.ok(v.sources.some((s) => s.startsWith('Retrieved on this phone')));
    assert.ok(v.limitations.length > 0);
    assert.ok(v.nextSteps.includes(COPY.result.nextSteps.doNotChange));
  }
});

test('no success tone exists: categories map only to ALERT, CAUTION or NEUTRAL', () => {
  for (const c of ['CONFIRMED', 'POTENTIAL', 'NO_MATCH', 'UNABLE']) assert.ok(c);
  const tones = new Set([show(tamsulosin(), noMatchFinding()).tone, show(sunEr(), evaluate(sunEr(), METFORMIN())).tone]);
  for (const t of tones) assert.ok(['ALERT', 'CAUTION', 'NEUTRAL'].includes(t));
});

// ---------------------------------------------------------------- legal documents, consent and build profiles

test('legal documents: bundled text is identical to docs/legal and every document is a marked draft', () => {
  assert.equal(readFileSync(join(ROOT, 'mobile', 'src', 'legal', 'documents.ts'), 'utf8'), buildLegalBundle(), 'run `npm run legal:bundle`');
  assert.deepEqual(LEGAL_DOCUMENTS.map((d) => d.id), ['terms', 'privacy', 'medical', 'sources', 'pilot']);
  for (const d of LEGAL_DOCUMENTS) {
    assert.equal(d.status, 'DRAFT');
    assert.match(d.text, /DRAFT — LEGAL REVIEW REQUIRED/);
    assert.doesNotMatch(d.text, /guaranteed accurate|100%|recall-free|fda verified your medication|you can continue taking/i);
  }
});

test('consent: acknowledgement records versions; a new document version must be shown again', () => {
  assert.deepEqual(documentsNeedingAcknowledgement({}), ['terms', 'privacy', 'medical']);
  const a = acknowledge({}, NOW);
  assert.deepEqual(documentsNeedingAcknowledgement(a), []);
  assert.deepEqual(documentsNeedingAcknowledgement({ ...a, terms: { version: '0.0.1-old', at: NOW } }), ['terms']);
});

test('build profiles: development never persists history and is labeled; pilot never accepts draft configuration', () => {
  const dev = profileFor('development', true);
  assert.equal(dev.persistHistory, false);
  assert.equal(dev.label, 'DEVELOPMENT BUILD');
  const pilot = profileFor('pilot', false);
  assert.equal(pilot.allowUnapprovedConfig, false);
  assert.equal(pilot.persistHistory, false, 'no persistence without verified encryption');
  assert.equal(profileFor('pilot', true).persistHistory, true);
  assert.equal(parseBuildProfile({ profile: 'something-else' }).kind, 'development');
  assert.equal(parseBuildProfile(JSON.parse(readFileSync(join(ROOT, 'mobile', 'config', 'build_profile.json'), 'utf8'))).kind, 'development', 'the committed profile is development');
});

test('release gate: the current repository is blocked; all prerequisites met (synthetic) → no blockers', () => {
  const blocked = pilotBlockers({ catalogStatus: 'DRAFT_PENDING_APPROVAL', policyStatus: 'PROPOSED_PENDING_APPROVAL', legalDocuments: LEGAL_DOCUMENTS.map((d) => ({ id: d.id, status: d.status })), signoffs: {}, encryptionVerifiedOnDevice: false });
  assert.ok(blocked.length >= 3 + LEGAL_DOCUMENTS.length + REQUIRED_SIGNOFFS.length);
  const signed = Object.fromEntries(REQUIRED_SIGNOFFS.map((s) => [s, { signed: true, by: 'Synthetic Reviewer', date: '2026-12-01' }]));
  assert.deepEqual(pilotBlockers({ catalogStatus: 'APPROVED', policyStatus: 'APPROVED', legalDocuments: [{ id: 'terms', status: 'APPROVED' }], signoffs: signed, encryptionVerifiedOnDevice: true }), []);
  const unsignedName = { ...signed, legal_review: { signed: true, by: null, date: '2026-12-01' } };
  assert.ok(pilotBlockers({ catalogStatus: 'APPROVED', policyStatus: 'APPROVED', legalDocuments: [], signoffs: unsignedName, encryptionVerifiedOnDevice: true }).some((b) => b.includes('legal_review')));
});
