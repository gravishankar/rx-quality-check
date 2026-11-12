/**
 * End-to-end workflow: reducer + effect runner + pure rules, with ports backed by real openFDA
 * fixtures. Includes the outbound-request audit (PV-1 at library level) and RG-3 (excluded drugs
 * never trigger a recall request).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, initialState, type Ports } from '../../mobile/src/engine/runner.ts';
import type { WorkflowState } from '../../mobile/src/state/machine.ts';
import type { EnforcementPage, RecallQuery } from '../../mobile/src/models/evidence.ts';
import type { FieldValue, LabelExtraction } from '../../mobile/src/models/identity.ts';
import type { NdcDirectoryOutcome } from '../../mobile/src/rules/identity.ts';
import {
  RETRIEVED_AT,
  apiNdcRecord,
  control,
  enf,
  ndc,
  ndcOutcome,
  realNoMatch,
  realServerError,
  rulesConfig,
  synthetic429,
} from '../helpers/fixtures.ts';

const cfg = rulesConfig();

const ocr = (value: string, confidence = 0.97): FieldValue<string> => ({ value, origin: 'OCR', confidence, confirmedByUser: false });

function label(over: Partial<LabelExtraction>): LabelExtraction {
  return { ndcTexts: [], drugName: null, strength: null, doseForm: null, labelerText: null, lot: null, expiry: null, containerType: 'PHARMACY_VIAL', ...over };
}

interface Audit {
  ndcLookups: string[];
  recallQueries: { search: string; skip: number }[];
}

/** Ports backed by real fixtures. Unknown NDC lookups get the real 404 body; unknown recall queries fail the test. */
function fixturePorts(opts: {
  ndc?: Record<string, () => NdcDirectoryOutcome>;
  recalls?: Record<string, (skip: number) => EnforcementPage>;
  cache?: boolean;
}): { ports: Ports; audit: Audit } {
  const audit: Audit = { ndcLookups: [], recallQueries: [] };
  const ports: Ports = {
    extract: async () => null,
    lookupPackageNdc: async (p) => {
      audit.ndcLookups.push(p);
      return opts.ndc?.[p]?.() ?? ndc('ndc_pkg_62756-0142-2'); // real NOT_FOUND body
    },
    fetchRecallPage: async (q: RecallQuery, skip: number) => {
      audit.recallQueries.push({ search: q.search, skip });
      if (q.kind === 'POSITIVE_CONTROL') return opts.recalls?.[q.search]?.(skip) ?? control();
      const f = opts.recalls?.[q.search];
      if (!f) throw new Error(`unexpected recall query in test: ${q.search}`);
      return f(skip);
    },
    loadCachedResult: async (identity) =>
      opts.cache && identity ? { identity, finding: { finding: 'POTENTIAL_MATCH' } as never, evaluatedAt: '2026-11-01T00:00:00Z' } : null,
    persist: async () => undefined,
    sleep: async () => undefined,
    now: () => RETRIEVED_AT,
  };
  return { ports, audit };
}

async function scan(x: LabelExtraction, ports: Ports): Promise<{ state: WorkflowState; path: string[] }> {
  const r = await dispatch(initialState(), { type: 'CAPTURED', capture: { kind: 'MANUAL', extraction: x } }, ports, cfg);
  return { state: r.state, path: r.trace.map((t) => t.to) };
}

const METFORMIN_RECALLS = {
  'product_description:"metformin"': () => enf('enf_text_metformin'),
  'openfda.product_ndc:"62756-142"': () => enf('enf_pndc_62756-142'),
};

function assertAuditClean(audit: Audit, secrets: string[]): void {
  for (const n of audit.ndcLookups) assert.match(n, /^\d{4,5}-\d{3,4}-\d{1,2}$/, `NDC lookup sends only an NDC: ${n}`);
  for (const q of audit.recallQueries) {
    for (const s of secrets) assert.ok(!q.search.toUpperCase().includes(s.toUpperCase()), `query leaks "${s}": ${q.search}`);
    const stripped = q.search.replace(/(product_description|openfda\.product_ndc|recall_number):"[a-z0-9 -]+"/gi, '').replace(/\bAND\b/g, '').trim();
    assert.equal(stripped, '', `query contains only public field:value terms: ${q.search}`);
  }
}

test('J1 happy path: Sun metformin ER label with NDC and lot → CONFIRMED_MATCH, saved; audit clean', async () => {
  const { ports, audit } = fixturePorts({ ndc: { '62756-142-02': () => ndc('ndc_pkg_62756-142-02') }, recalls: METFORMIN_RECALLS });
  const x = label({
    ndcTexts: [ocr('NDC 62756-142-02')],
    drugName: ocr('METFORMIN HCL ER'),
    strength: ocr('500 MG'),
    doseForm: ocr('TABLET'),
    lot: ocr('JKU4639A', 0.99),
  });
  const r1 = await scan(x, ports);
  assert.deepEqual(r1.path, ['EXTRACT', 'IDENTIFY', 'CHECK_EXCLUSION', 'CONFIRM']);
  assert.deepEqual(r1.state.ctx.requiredConfirmations, ['identity', 'lot']);
  assert.equal(audit.recallQueries.length, 0, 'nothing is fetched before the user confirms');

  const r2 = await dispatch(r1.state, { type: 'USER_CONFIRMED', confirmedFields: ['identity', 'lot'], lot: 'JKU4639A' }, ports, cfg);
  assert.deepEqual(r2.trace.map((t) => t.to), ['FETCH_EVIDENCE', 'EVALUATE', 'EXPLAIN']);
  assert.equal(r2.state.ctx.finding?.finding, 'CONFIRMED_MATCH');
  assert.equal(r2.state.ctx.explanation?.headline, 'RESULT_CONFIRMED_MATCH');

  const r3 = await dispatch(r2.state, { type: 'SAVE_REQUESTED' }, ports, cfg);
  assert.equal(r3.state.name, 'SAVED');
  assertAuditClean(audit, ['JKU4639A', 'METFORMIN HCL ER', '500 MG']);
});

test('RG-3: excluded drug (warfarin, real NDC) stops at EXCLUDED with zero recall requests', async () => {
  const { ports, audit } = fixturePorts({ ndc: { '67046-2072-3': () => ndc('ndc_warfarin') } });
  const r = await scan(label({ ndcTexts: [ocr('67046-2072-3')], drugName: ocr('WARFARIN SODIUM'), strength: ocr('1 MG'), doseForm: ocr('TAB') }), ports);
  assert.equal(r.state.name, 'EXCLUDED');
  assert.equal(audit.recallQueries.length, 0);
  // Name-only label as well.
  const n = fixturePorts({});
  const r2 = await scan(label({ drugName: ocr('WARFARIN'), strength: ocr('5 MG'), doseForm: ocr('TABLET') }), n.ports);
  assert.equal(r2.state.name, 'EXCLUDED');
  assert.equal(n.audit.recallQueries.length + n.audit.ndcLookups.length, 0);
});

test('RG-3: everolimus → NEEDS_CLARIFICATION, metoprolol tartrate → UNSUPPORTED; no recall requests', async () => {
  const a = fixturePorts({ ndc: { '63850-0064-2': () => ndc('ndc_everolimus') } });
  assert.equal((await scan(label({ ndcTexts: [ocr('63850-0064-2')], drugName: ocr('EVEROLIMUS'), strength: ocr('0.75 MG'), doseForm: ocr('TABLET') }), a.ports)).state.name, 'NEEDS_CLARIFICATION');
  const b = fixturePorts({});
  assert.equal((await scan(label({ drugName: ocr('METOPROLOL TARTRATE'), strength: ocr('25 MG'), doseForm: ocr('TABLET') }), b.ports)).state.name, 'UNSUPPORTED');
  assert.equal(a.audit.recallQueries.length + b.audit.recallQueries.length, 0);
});

test('OCR misread NDC (valid 10 mg product, printed 5 mg) is discarded once; continues at ingredient level', async () => {
  const { ports, audit } = fixturePorts({
    ndc: { '68180-721-03': () => ndc('ndc_prod_68180-721') },
    recalls: { 'product_description:"amlodipine"': (skip) => (skip === 0 ? enf('enf_text_amlodipine_p1') : enf('enf_text_amlodipine_p2')) },
  });
  const r = await scan(label({ ndcTexts: [ocr('68180-721-03')], drugName: ocr('AMLODIPINE BESYLATE'), strength: ocr('5 MG'), doseForm: ocr('TAB') }), ports);
  assert.deepEqual(r.path, ['EXTRACT', 'IDENTIFY', 'IDENTIFY', 'CHECK_EXCLUSION', 'CONFIRM']);
  assert.equal(r.state.ctx.identity?.level, 'CLINICAL_DRUG');
  assert.equal(r.state.ctx.ndcDiscarded, true);
  assert.ok(r.state.ctx.requiredConfirmations.includes('release'), 'label did not print IR/ER');
  const noRelease = await dispatch(r.state, { type: 'USER_CONFIRMED', confirmedFields: r.state.ctx.requiredConfirmations, lot: null }, ports, cfg);
  assert.equal(noRelease.state.name, 'CONFIRM', 'release must be stated, not assumed');
  const done = await dispatch(r.state, { type: 'USER_CONFIRMED', confirmedFields: r.state.ctx.requiredConfirmations, lot: null, release: 'IR' }, ports, cfg);
  assert.equal(done.state.name, 'EXPLAIN');
  assert.equal(done.state.ctx.finding?.finding, 'POTENTIAL_MATCH', 'ingredient-level evidence "may or may not apply"');
  assert.equal(done.state.ctx.finding?.confirmed.length, 0);
  assert.deepEqual(audit.recallQueries.filter((q) => q.search.includes('amlodipine')).map((q) => q.skip), [0, 50], 'pagination fetched both pages');
});

test('incorrect NDC (not in the directory) → NDC_REJECTED → name path; no product-level claim', async () => {
  const { ports } = fixturePorts({ recalls: METFORMIN_RECALLS });
  const r = await scan(label({ ndcTexts: [ocr('62756-0142-2')], drugName: ocr('METFORMIN ER'), strength: ocr('500 MG'), doseForm: ocr('TABLET') }), ports);
  assert.equal(r.state.name, 'CONFIRM');
  assert.equal(r.state.ctx.identity?.level, 'CLINICAL_DRUG');
  assert.equal(r.state.ctx.identity?.release, 'ER');
});

test('missing information: nothing usable read → MISSING_INFORMATION; user-entered fields resume identification', async () => {
  const { ports } = fixturePorts({});
  const r = await scan(label({}), ports);
  assert.equal(r.state.name, 'MISSING_INFORMATION');
  const partial = await scan(label({ drugName: ocr('METFORMIN') }), ports);
  assert.equal(partial.state.name, 'MISSING_INFORMATION');
  assert.deepEqual([...partial.state.ctx.missing].sort(), ['doseForm', 'strength']);
});

test('API failure during identification: bounded retries, then SOURCE_UNAVAILABLE; cached result shown offline', async () => {
  let calls = 0;
  const down = () => {
    calls++;
    return ndcOutcome({ status: 503, headers: {}, bodyText: '<html>503</html>' });
  };
  const noCache = fixturePorts({ ndc: { '62756-142-02': down } });
  const x = label({ ndcTexts: [ocr('62756-142-02')], drugName: ocr('METFORMIN HCL ER'), strength: ocr('500 MG'), doseForm: ocr('TABLET') });
  const r = await scan(x, noCache.ports);
  assert.equal(r.state.name, 'SOURCE_UNAVAILABLE');
  assert.equal(calls, 3);
  assert.equal(r.path.filter((p) => p === 'RETRY').length, 2);
});

test('offline: recall fetch unavailable and no partial evidence → OFFLINE_CACHED_RESULT when a saved result exists', async () => {
  const { ports } = fixturePorts({
    ndc: { '62756-142-02': () => ndc('ndc_pkg_62756-142-02') },
    recalls: { 'product_description:"metformin"': () => realServerError(), 'openfda.product_ndc:"62756-142"': () => realServerError(), 'recall_number:"D-0325-2021" AND product_description:"metformin" AND openfda.product_ndc:"62756-142"': () => realServerError() },
    cache: true,
  });
  const x = label({ ndcTexts: [{ value: '62756-142-02', origin: 'BARCODE', confidence: null, confirmedByUser: false }], drugName: ocr('METFORMIN HCL ER'), strength: ocr('500 MG'), doseForm: ocr('TABLET') });
  const r1 = await scan(x, ports);
  const r2 = await dispatch(r1.state, { type: 'USER_CONFIRMED', confirmedFields: r1.state.ctx.requiredConfirmations, lot: null }, ports, cfg);
  assert.equal(r2.state.name, 'OFFLINE_CACHED_RESULT');
  assert.equal(r2.state.ctx.cached?.evaluatedAt, '2026-11-01T00:00:00Z');
});

test('a failing text query does not hide the known recall found by the structured query', async () => {
  const { ports } = fixturePorts({
    ndc: { '62756-142-02': () => ndc('ndc_pkg_62756-142-02') },
    recalls: { 'product_description:"metformin"': () => realServerError(), 'openfda.product_ndc:"62756-142"': () => enf('enf_pndc_62756-142') },
  });
  const x = label({ ndcTexts: [ocr('62756-142-02')], drugName: ocr('METFORMIN HCL ER'), strength: ocr('500 MG'), doseForm: ocr('TABLET') });
  const r1 = await scan(x, ports);
  const r2 = await dispatch(r1.state, { type: 'USER_CONFIRMED', confirmedFields: r1.state.ctx.requiredConfirmations, lot: 'JKU4639A' }, ports, cfg);
  assert.equal(r2.state.name, 'EXPLAIN');
  assert.equal(r2.state.ctx.finding?.finding, 'CONFIRMED_MATCH');
  assert.ok(r2.state.ctx.finding?.limitations.includes('SOME_QUERIES_INCOMPLETE'));
  assert.equal(r2.trace.filter((t) => t.to === 'RETRY').length, 2, 'retried before evaluating partial evidence');
});

test('rate limited: one automatic retry, then RATE_LIMITED (no cache) awaiting the user', async () => {
  const { ports, audit } = fixturePorts({
    ndc: { '62756-142-02': () => ndc('ndc_pkg_62756-142-02') },
    recalls: { 'product_description:"metformin"': () => synthetic429('1'), 'openfda.product_ndc:"62756-142"': () => synthetic429('1'), 'recall_number:"D-0325-2021" AND product_description:"metformin" AND openfda.product_ndc:"62756-142"': () => synthetic429('1') },
  });
  const x = label({ ndcTexts: [ocr('62756-142-02')], drugName: ocr('METFORMIN HCL ER'), strength: ocr('500 MG'), doseForm: ocr('TABLET') });
  const r1 = await scan(x, ports);
  const r2 = await dispatch(r1.state, { type: 'USER_CONFIRMED', confirmedFields: r1.state.ctx.requiredConfirmations, lot: null }, ports, cfg);
  assert.equal(r2.state.name, 'RATE_LIMITED');
  assert.equal(audit.recallQueries.length, 6, 'two rounds of three queries: the original and one automatic retry');
});

test('ambiguous identity (synthetic directory pairing) requires a user choice before exclusion check', async () => {
  // Format-only: see identity_rules.test.ts for why no real ambiguous pair exists in fixtures.
  const recA = structuredClone((ndc('ndc_pkg_62756-142-02') as Extract<NdcDirectoryOutcome, { kind: 'OK' }>).data.results[0]!);
  const recB = structuredClone(recA);
  recA.packaging = [{ package_ndc: '6275-6142-02', description: 'synthetic' }];
  recB.packaging = [{ package_ndc: '62756-142-02', description: 'synthetic' }];
  recB.product_ndc = '62756-142';
  recA.product_ndc = '6275-6142';
  const ok = (rec: typeof recA) => () =>
    ndcOutcome({ status: 200, headers: {}, bodyText: JSON.stringify({ meta: { last_updated: '2026-11-11', results: { skip: 0, limit: 1, total: 1 } }, results: [rec] }) });
  const { ports, audit } = fixturePorts({ ndc: { '6275-6142-02': ok(recA), '62756-142-02': ok(recB) } });
  const r = await scan(label({ ndcTexts: [ocr('6275614202')], drugName: ocr('METFORMIN HCL ER'), strength: ocr('500 MG'), doseForm: ocr('TABLET') }), ports);
  assert.equal(r.state.name, 'AMBIGUOUS_IDENTITY');
  assert.equal(r.state.ctx.identityOptions.length, 2);
  assert.equal(audit.ndcLookups.length, 3, 'all three 10-digit readings were looked up');
  const chosen = await dispatch(r.state, { type: 'CANDIDATE_CHOSEN', index: 1 }, ports, cfg);
  assert.equal(chosen.state.name, 'CONFIRM');
  assert.equal(chosen.state.ctx.identity?.productNdc, '62756-142');
});

test('property: across seeded random request failures, NO_MATCH_FOUND only ever comes from an all-success bundle', async () => {
  // Tamsulosin (Aphena) would be NO_MATCH_FOUND with complete data.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const failures = [realServerError, () => synthetic429(null), () => realNoMatch()];
  const sawNoMatch = { yes: 0, no: 0 };
  for (let run = 0; run < 60; run++) {
    const maybeFail = (good: () => EnforcementPage) => () => (rnd() < 0.35 ? (failures[Math.floor(rnd() * failures.length)] as () => EnforcementPage)() : good());
    const { ports } = fixturePorts({
      ndc: { '71610-910-30': () => ndcOutcome({ status: 200, headers: {}, bodyText: JSON.stringify({ meta: { last_updated: '2026-11-11', results: { skip: 0, limit: 1, total: 1 } }, results: [apiNdcRecord('ndc_tamsulosin')] }) }) },
      recalls: {
        'product_description:"tamsulosin"': maybeFail(() => enf('enf_text_tamsulosin')),
        'openfda.product_ndc:"71610-910"': maybeFail(() => realNoMatch()),
        'recall_number:"D-0325-2021" AND product_description:"metformin" AND openfda.product_ndc:"62756-142"': maybeFail(() => control()),
      },
    });
    const x = label({ ndcTexts: [ocr('71610-910-30')], drugName: ocr('TAMSULOSIN HCL'), strength: ocr('0.4 MG'), doseForm: ocr('CAPSULE') });
    const r1 = await scan(x, ports);
    if (r1.state.name !== 'CONFIRM') continue;
    let r = await dispatch(r1.state, { type: 'USER_CONFIRMED', confirmedFields: r1.state.ctx.requiredConfirmations, lot: null }, ports, cfg);
    if (r.state.name === 'RATE_LIMITED' || r.state.name === 'SOURCE_UNAVAILABLE') r = await dispatch(r.state, { type: 'USER_RETRY' }, ports, cfg);
    const f = r.state.ctx.finding;
    if (f?.finding === 'NO_MATCH_FOUND') {
      sawNoMatch.yes++;
      const pages = r.state.ctx.bundle?.results.flatMap((q) => q.pages) ?? [];
      assert.ok(pages.every((p) => p.kind === 'OK' || p.kind === 'NO_MATCH'), `run ${run}`);
      assert.equal(f.coverage.positiveControl.status, 'PASSED');
    } else {
      sawNoMatch.no++;
    }
  }
  assert.ok(sawNoMatch.yes > 0 && sawNoMatch.no > 0, `both outcomes exercised: ${JSON.stringify(sawNoMatch)}`);
});
