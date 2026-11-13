/**
 * Correctness finding C3 (review against b9c5989): a repackaged product's source chain must keep
 * partial, conflicting and unavailable branches visible through classification and the patient's
 * result screen.
 *
 * Base data is real (tests/fixtures/task3/cassette.json: furosemide oral solution 68094-756-62,
 * whose DailyMed SPL declares source 0054-3294, and the openFDA listing of 0054-3294). Each
 * perturbation is marked SYNTHETIC: extra source entries added to the real SPL, NDCs in labeler
 * 99999 (not a real labeler), minimal SPL documents, and changed packager flags.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createOpenFdaClient, ndcUrl, type OpenFdaClient } from '../../mobile/src/services/openfda.ts';
import { createDailyMedClient, type DailyMedClient } from '../../mobile/src/services/dailymed.ts';
import { createLivePorts, sameFormulation } from '../../mobile/src/services/ports.ts';
import { unavailable } from '../../mobile/src/services/request.ts';
import { directoryProductFrom } from '../../mobile/src/rules/identity.ts';
import { evaluateRecallEvidence, planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import { presentResult } from '../../mobile/src/presentation/present.ts';
import { COPY } from '../../mobile/src/copy/en.ts';
import type { MedicationIdentity } from '../../mobile/src/models/identity.ts';
import type { OpenFdaNdcProduct } from '../../mobile/src/models/openfda.ts';
import { loadCassette, replayTransport } from '../../scripts/lib/cassette.ts';
import { ROOT, RETRIEVED_AT, apiNdcRecord, bundle, control, enf, productIdentity, realNoMatch } from '../helpers/fixtures.ts';

const cassette = loadCassette(join(ROOT, 'tests', 'fixtures', 'task3', 'cassette.json'));
const now = () => RETRIEVED_AT;
const deps = { transport: replayTransport(cassette), now };
const realFda = createOpenFdaClient(deps);
const realDailyMed = createDailyMedClient(deps);
const FUROSEMIDE_SET = '4a746634-379b-4847-a965-7607d2a71bed';
const body = (url: string) => JSON.parse(cassette.entries[url]!.bodyText) as { results: OpenFdaNdcProduct[] };
const furosemideRecord = body(ndcUrl('packaging.package_ndc:"68094-756-62"')).results[0]!;
const sourceRecord = body(ndcUrl('product_ndc:"0054-3294"')).results[0]!;
const furosemide = (): MedicationIdentity => productIdentity(furosemideRecord, '68094-756-62');

// SYNTHETIC helpers ------------------------------------------------------------------------------
const NDC_SYS = '2.16.840.1.113883.6.69';
const equiv = (src: string) => `<asEquivalentEntity classCode="EQUIV"><definingMaterialKind><code code="${src}" codeSystem="${NDC_SYS}"/></definingMaterialKind></asEquivalentEntity>`;
/** Minimal SPL: product `p` repackaged from `sources`. */
const miniSpl = (p: string, sources: string[]) => `<document><manufacturedProduct><code code="${p}" codeSystem="${NDC_SYS}"/>${sources.map(equiv).join('')}</manufacturedProduct></document>`;
/** A copy of the real 0054-3294 listing under another NDC, packager flag and SPL set id. */
const listing = (productNdc: string, original: boolean, setId: string): OpenFdaNdcProduct => ({
  ...sourceRecord,
  product_ndc: productNdc,
  openfda: { ...sourceRecord.openfda, is_original_packager: [original], spl_set_id: [setId] },
});
const setId = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

interface Fakes {
  spl?: Record<string, string | 'UNAVAILABLE'>;
  products?: Record<string, OpenFdaNdcProduct | 'UNAVAILABLE'>;
}
function portsWith(f: Fakes) {
  const openfda: OpenFdaClient = {
    ...realFda,
    async ndcByProduct(ndc) {
      const p = f.products?.[ndc];
      if (p === undefined) return realFda.ndcByProduct(ndc);
      if (p === 'UNAVAILABLE') return unavailable('OPENFDA', 'synthetic', 'NETWORK_ERROR', 'SYNTHETIC outage', RETRIEVED_AT);
      if ((p as { kind?: string }).kind === 'NO_MATCH') return { kind: 'NO_MATCH', meta: { source: 'OPENFDA', url: 'synthetic', httpStatus: 404, retrievedAt: RETRIEVED_AT, elapsedMs: 0, headers: {} } } as never;
      return { kind: 'OK', data: { meta: { last_updated: '2026-11-04', results: { skip: 0, limit: 10, total: 1 } }, results: [p] }, meta: { source: 'OPENFDA', url: 'synthetic', httpStatus: 200, retrievedAt: RETRIEVED_AT, elapsedMs: 0, headers: {} } } as never;
    },
  };
  const dailymed: DailyMedClient = {
    async splXml(id) {
      const s = f.spl?.[id];
      if (s === undefined) return realDailyMed.splXml(id);
      if (s === 'UNAVAILABLE') return unavailable('DAILYMED', 'synthetic', 'NETWORK_ERROR', 'SYNTHETIC outage', RETRIEVED_AT);
      return { kind: 'OK', data: s, meta: { source: 'DAILYMED', url: 'synthetic', httpStatus: 200, retrievedAt: RETRIEVED_AT, elapsedMs: 0, headers: {} } } as never;
    },
  };
  return createLivePorts({ openfda, dailymed, now, sleep: async () => undefined });
}
const realSplWithExtraSource = async (extra: string) => {
  const r = await realDailyMed.splXml(FUROSEMIDE_SET);
  assert.equal(r.kind, 'OK');
  const xml = (r as { data: string }).data;
  const i = xml.indexOf('<asEquivalentEntity');
  return xml.slice(0, i) + equiv(extra) + xml.slice(i); // SYNTHETIC second source entry
};

test('C3 guard: the real single-source chain is verified', async () => {
  const e = await portsWith({}).enrichIdentity!(furosemide());
  assert.equal(e.sourceProductStatus, 'VERIFIED');
  assert.deepEqual(e.relatedSourceProductNdcs, ['0054-3294']);
});

test('C3 partial branch: one source verified, another unavailable → not reported as verified', async () => {
  const spl = await realSplWithExtraSource('99999-001');
  const e = await portsWith({ spl: { [FUROSEMIDE_SET]: spl }, products: { '99999-001': 'UNAVAILABLE' } }).enrichIdentity!(furosemide());
  assert.equal(e.sourceProductStatus, 'PARTIAL');
  assert.deepEqual(e.relatedSourceProductNdcs, ['0054-3294'], 'the verified branch is still used for matching');
});

test('C3 depth limit: a chain that continues past the limit is partial, not verified', async () => {
  const e = await portsWith({
    products: {
      '0054-3294': listing('0054-3294', false, setId(1)),
      '99999-001': listing('99999-001', false, setId(2)),
      '99999-002': listing('99999-002', false, setId(3)),
    },
    spl: { [setId(1)]: miniSpl('0054-3294', ['99999-001']), [setId(2)]: miniSpl('99999-001', ['99999-002']), [setId(3)]: miniSpl('99999-002', ['99999-003']) },
  }).enrichIdentity!(furosemide());
  assert.equal(e.sourceProductStatus, 'PARTIAL');
});

test('C3 cycle: a chain that leads back to the product itself never reaches an original packager → partial; the product is not its own source', async () => {
  const e = await portsWith({
    products: { '0054-3294': listing('0054-3294', false, setId(1)) },
    spl: { [setId(1)]: miniSpl('0054-3294', ['68094-756']) },
  }).enrichIdentity!(furosemide());
  assert.equal(e.sourceProductStatus, 'PARTIAL');
  assert.ok(!e.relatedSourceProductNdcs.includes('68094-756'));
});

test('C3 a source SPL that cannot be retrieved further down the chain → partial', async () => {
  const e = await portsWith({ products: { '0054-3294': listing('0054-3294', false, setId(1)) }, spl: { [setId(1)]: 'UNAVAILABLE' } }).enrichIdentity!(furosemide());
  assert.equal(e.sourceProductStatus, 'PARTIAL');
});

test('C3 unreadable SPL → unavailable, not "no source declared"', async () => {
  const e = await portsWith({ spl: { [FUROSEMIDE_SET]: '<document><unclosed>' } }).enrichIdentity!(furosemide());
  assert.equal(e.sourceProductStatus, 'UNAVAILABLE');
});

test('C3 source verification compares each ingredient\'s own strength (swapped combination strengths are not the same formulation)', () => {
  const amlo = (a: string, b: string) => directoryProductFrom({ ...sourceRecord, generic_name: 'amlodipine and atorvastatin', dosage_form: 'TABLET', active_ingredients: [{ name: 'AMLODIPINE BESYLATE', strength: a }, { name: 'ATORVASTATIN CALCIUM', strength: b }] });
  const id: MedicationIdentity = { ...furosemide(), doseForm: 'TABLET', release: 'IR', ingredients: amlo('10 mg/1', '20 mg/1').ingredients };
  assert.equal(sameFormulation(id, amlo('10 mg/1', '20 mg/1')), true);
  assert.equal(sameFormulation(id, amlo('20 mg/1', '10 mg/1')), false); // SYNTHETIC swapped listing
});

// Patient-visible result --------------------------------------------------------------------------
const tamsulosinNoMatch = (status: MedicationIdentity['sourceProductStatus'], original: boolean | null) => {
  const id: MedicationIdentity = { ...productIdentity(apiNdcRecord('ndc_tamsulosin'), '71610-910-30'), sourceProductStatus: status, isOriginalPackager: original };
  const f = evaluateRecallEvidence(id, bundle(planRecallQueries(id), { ingredient_text: [enf('enf_text_tamsulosin')], product_ndc: [realNoMatch()], control: [control()] }));
  return { f, view: presentResult({ identity: id, finding: f, now: '2026-11-12T13:00:00.000Z' }) };
};

test('C3 patient view: a partial source chain qualifies a no-match and is recorded as a limitation', () => {
  const { f, view } = tamsulosinNoMatch('PARTIAL', false);
  assert.ok(f.limitations.includes('SOURCE_PRODUCT_NOT_ESTABLISHED'));
  assert.ok(view.qualifiers.includes(COPY.result.qualifiers.sourcePartial), JSON.stringify(view.qualifiers));
});

test('C3 patient view: packager status unknown and the source not checked → the no-match is qualified', () => {
  const { f, view } = tamsulosinNoMatch('NOT_CHECKED', null);
  assert.ok(f.limitations.includes('SOURCE_PRODUCT_NOT_ESTABLISHED'));
  assert.ok(view.qualifiers.includes(COPY.result.qualifiers.sourceNotChecked), JSON.stringify(view.qualifiers));
});

test('C3 guard: an original packager carries no source qualifier', () => {
  const { f, view } = tamsulosinNoMatch('NOT_APPLICABLE', true);
  assert.ok(!f.limitations.includes('SOURCE_PRODUCT_NOT_ESTABLISHED'));
  assert.equal(view.qualifiers.filter((q) => /repackag/i.test(q)).length, 0);
});

test('C3 missing SPL identifier: a repackager without an SPL set id is never "verified"', async () => {
  const e = await portsWith({}).enrichIdentity!({ ...furosemide(), splSetId: null, isOriginalPackager: false });
  assert.equal(e.sourceProductStatus, 'NOT_ESTABLISHED');
  assert.ok(sourceQualified(e));
});

test('C3 source NDC not found in the directory: not verified; a second, found source makes the chain partial', async () => {
  const notFound = { kind: 'NO_MATCH' } as const;
  const only = await portsWith({ spl: { [FUROSEMIDE_SET]: miniSpl('68094-756', ['99999-009']) }, products: { '99999-009': notFound as never } }).enrichIdentity!(furosemide());
  assert.equal(only.sourceProductStatus, 'NOT_ESTABLISHED');
  const spl = await realSplWithExtraSource('99999-009');
  const both = await portsWith({ spl: { [FUROSEMIDE_SET]: spl }, products: { '99999-009': notFound as never } }).enrichIdentity!(furosemide());
  assert.equal(both.sourceProductStatus, 'PARTIAL');
});

function sourceQualified(id: MedicationIdentity) {
  const f = evaluateRecallEvidence(id, bundle(planRecallQueries(id), { ingredient_text: [enf('enf_text_tamsulosin')], product_ndc: [realNoMatch()], control: [control()] }));
  return f.limitations.includes('SOURCE_PRODUCT_NOT_ESTABLISHED');
}
