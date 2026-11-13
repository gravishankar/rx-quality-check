/**
 * OD-33 (approved 2026-11-13), review item 3: when an unresolved source-product relationship is the
 * only thing that would rule out an otherwise compatible recall, the recall stays a POSSIBLE match.
 * Exclusions supported by independent evidence (different ingredient set, salt, strength, route,
 * form or release) are kept.
 *
 * Real data: Quallent rosuvastatin 10 mg (82009-018) and the recorded openFDA rosuvastatin notices
 * (tests/fixtures/task2/enf_text_rosuvastatin). D-0292-2026 is a 10 mg rosuvastatin recall naming
 * other labelers' NDCs. The source-product statuses are SYNTHETIC settings of a real identity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRecallEvidence, planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import { presentResult } from '../../mobile/src/presentation/present.ts';
import { COPY } from '../../mobile/src/copy/en.ts';
import type { MedicationIdentity } from '../../mobile/src/models/identity.ts';
import { apiNdcRecord, bundle, control, enf, productIdentity, realNoMatch } from '../helpers/fixtures.ts';

const NOW = '2026-11-12T13:00:00.000Z';
const rosu = (status: MedicationIdentity['sourceProductStatus'], original: boolean | null, related: string[] = []): MedicationIdentity => ({
  ...productIdentity(apiNdcRecord('ndc_rosuvastatin'), '82009-018-10'),
  sourceProductStatus: status,
  isOriginalPackager: original,
  relatedSourceProductNdcs: related,
});
const run = (id: MedicationIdentity) => {
  const related = Object.fromEntries(id.relatedSourceProductNdcs.map((_, i) => [`related_ndc_${i}`, [realNoMatch()]]));
  const f = evaluateRecallEvidence(id, bundle(planRecallQueries(id), { ingredient_text: [enf('enf_text_rosuvastatin')], product_ndc: [realNoMatch()], control: [control()], ...related }));
  return { f, view: presentResult({ identity: id, finding: f, now: NOW }) };
};
const rec = (f: ReturnType<typeof run>['f'], n: string) => [...f.confirmed, ...f.potential, ...f.unresolved, ...f.notApplicable].find((r) => r.recallNumber === n);

const UNRESOLVED: [string, MedicationIdentity][] = [
  ['not established (repackager, no source declared)', rosu('NOT_ESTABLISHED', false)],
  ['unchecked (packager status unknown, never checked)', rosu('NOT_CHECKED', null)],
  ['partially verified chain', rosu('PARTIAL', false, ['99999-001'])], // SYNTHETIC verified branch
  ['unavailable (lookup failed)', rosu('UNAVAILABLE', null)],
];

for (const [label, id] of UNRESOLVED) {
  test(`OD-33 ${label}: a compatible recall naming other NDCs stays a possible match, and the patient sees it`, () => {
    const { f, view } = run(id);
    const r = rec(f, 'D-0292-2026');
    assert.equal(r?.classification, 'POTENTIAL_MATCH', JSON.stringify(r?.reasons));
    assert.ok(r?.reasons.includes('SOURCE_PRODUCT_UNRESOLVED'));
    assert.equal(f.finding, 'POTENTIAL_MATCH');
    assert.equal(view.category, 'POTENTIAL');
    assert.ok(view.qualifiers.includes(COPY.result.qualifiers.sourceUnresolvedPossible), JSON.stringify(view.qualifiers));
  });

  test(`OD-33 ${label}: records with independent evidence of a different product stay ruled out`, () => {
    const { f } = run(id);
    const other = f.notApplicable.filter((x) => x.reasons.some((y) => ['STRENGTH_DIFFERS', 'COMBINATION_PRODUCT', 'DIFFERENT_SALT', 'DOSE_FORM_DIFFERS', 'NON_ORAL_OR_NOT_FINISHED_PRODUCT', 'RELEASE_DIFFERS'].includes(y)));
    assert.ok(other.length > 0, 'the fixture has notices for other strengths');
    for (const x of [...f.potential, ...f.confirmed]) {
      assert.ok(!x.reasons.some((y) => ['STRENGTH_DIFFERS', 'COMBINATION_PRODUCT', 'DIFFERENT_SALT', 'DOSE_FORM_DIFFERS', 'NON_ORAL_OR_NOT_FINISHED_PRODUCT', 'RELEASE_DIFFERS'].includes(y)), `${x.recallNumber} ${x.reasons}`);
    }
  });
}

for (const [label, id] of [
  ['original packager', rosu('NOT_APPLICABLE', true)],
  ['verified source chain', rosu('VERIFIED', false, ['99999-001'])], // SYNTHETIC verified source
  ['original packager, enrichment not run', rosu('NOT_CHECKED', true)],
] as [string, MedicationIdentity][]) {
  test(`OD-33 guard (${label}): a notice naming only other NDCs is still ruled out → no match`, () => {
    const { f, view } = run(id);
    assert.equal(rec(f, 'D-0292-2026')?.classification, 'NOT_APPLICABLE');
    assert.equal(f.finding, 'NO_MATCH_FOUND');
    assert.equal(view.category, 'NO_MATCH');
  });
}

test('OD-33 on 18 recorded exemplars (real openFDA data, no enrichment): only additions of possible matches; original packagers unchanged; never toward a no-match', async () => {
  const { runOd33Comparison } = await import('../../scripts/catalog/f1_before_after.ts');
  const rows = await runOd33Comparison();
  for (const r of rows) {
    assert.deepEqual(r.otherChanges, [], `${r.case}: OD-33 only turns NDC-only exclusions into possible matches`);
    if (r.isOriginalPackager === true) assert.deepEqual(r.keptByOd33, [], `${r.case}: original packager unchanged`);
    assert.ok(!(r.resolved !== 'NO_MATCH_FOUND' && r.unresolved === 'NO_MATCH_FOUND'), `${r.case}: never toward a no-match`);
  }
  const moved = rows.filter((r) => r.resolved === 'NO_MATCH_FOUND' && r.unresolved === 'POTENTIAL_MATCH').map((r) => r.case).sort();
  assert.deepEqual(moved, ['escitalopram oxalate tablet', 'isosorbide mononitrate ER tablet', 'ketorolac tromethamine tablet', 'levocetirizine tablet']);
});
