/**
 * Public-API layer (Task 3): transport guard and audit, timeouts and cancellation, client input
 * validation, outcome classification for every failure kind, SPL source-product reading, cache
 * rules and source-product verification. Real responses come from the recorded cassette
 * (tests/fixtures/task3/cassette.json, `npm run e2e:record`) and Task 1/2 fixtures; synthetic
 * failures are labeled.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fetchTransport, guardedTransport, NO_SENSITIVE_VALUES, type HttpTransport } from '../../mobile/src/services/transport.ts';
import { createOpenFdaClient, enforcementUrl, ndcUrl } from '../../mobile/src/services/openfda.ts';
import { createRxNavClient, conceptsOf, ndcStatusUrl, relatedUrl } from '../../mobile/src/services/rxnav.ts';
import { createDailyMedClient, sourceProductsFromSpl, splXmlUrl } from '../../mobile/src/services/dailymed.ts';
import { parseXml, XmlError } from '../../mobile/src/services/xml.ts';
import { createLivePorts } from '../../mobile/src/services/ports.ts';
import { planRecallQueries, POSITIVE_CONTROL } from '../../mobile/src/rules/recallEvidence.ts';
import { openNodeSqlite } from '../../mobile/src/storage/drivers/nodeSqlite.ts';
import { openStorage } from '../../mobile/src/storage/repositories.ts';
import { loadCassette, replayTransport, NotRecordedError } from '../../scripts/lib/cassette.ts';
import { ROOT, firstNdcRecord, productIdentity, RETRIEVED_AT } from '../helpers/fixtures.ts';

const cassette = loadCassette(join(ROOT, 'tests', 'fixtures', 'task3', 'cassette.json'));
const now = () => RETRIEVED_AT;
const replay = () => replayTransport(cassette);
const deps = (transport: HttpTransport) => ({ transport, now });

/** SYNTHETIC transports for failure kinds. */
const throwing = (e: Error): HttpTransport => ({ get: async () => { throw e; } });
const status = (s: number, body = '', headers: Record<string, string> = {}): HttpTransport => ({ get: async () => ({ status: s, headers, bodyText: body }) });

// ---------------------------------------------------------------- transport guard

test('guard: only HTTPS to the three allowlisted hosts; violations are never sent and are audited', async () => {
  let sent = 0;
  const inner: HttpTransport = { get: async () => ((sent += 1), { status: 200, headers: {}, bodyText: '{}' }) };
  const t = guardedTransport(inner, NO_SENSITIVE_VALUES);
  await assert.rejects(t.get('http://api.fda.gov/drug/ndc.json'), /only HTTPS/);
  await assert.rejects(t.get('https://example.com/x'), /not allowlisted/);
  await assert.rejects(t.get('https://user:pw@api.fda.gov/drug/ndc.json'), /credentials/);
  await t.get('https://rxnav.nlm.nih.gov/REST/version.json');
  assert.equal(sent, 1);
  assert.deepEqual(t.audit.entries.map((e) => e.outcome), ['BLOCKED', 'BLOCKED', 'BLOCKED', 'SENT']);
});

test('guard: a request containing a patient-specific value is refused before it leaves the device', async () => {
  const t = guardedTransport(status(200, '{}'), { sensitiveValues: () => ['JKU4639A', 'SYNTHETIC PATIENT NAME', 'ab'] });
  await assert.rejects(t.get('https://api.fda.gov/drug/enforcement.json?search=code_info:%22jku4639a%22'), /patient-specific/);
  await assert.rejects(t.get('https://api.fda.gov/drug/ndc.json?search=Synthetic+Patient+Name'.replace(/\+/g, '%20')), /patient-specific/);
  await t.get('https://api.fda.gov/drug/ndc.json?search=tablets'); // "ab" is ignored as too short to be meaningful
  assert.equal(t.audit.entries.at(-1)?.outcome, 'SENT');
});

test('client: a blocked request is SOURCE_UNAVAILABLE (REQUEST_BLOCKED), never NO_MATCH', async () => {
  const t = guardedTransport(replay(), { sensitiveValues: () => ['metformin'] });
  const r = await createOpenFdaClient(deps(t)).enforcementPage(planRecallQueries(productIdentity(firstNdcRecord('ndc_pkg_62756-142-02'), '62756-142-02')).queries[0]!, 0);
  assert.ok(r.kind === 'SOURCE_UNAVAILABLE' && r.reason === 'REQUEST_BLOCKED');
});

// ---------------------------------------------------------------- timeouts and cancellation

test('fetch transport: timeout and caller cancellation abort the request and are classified distinctly', async () => {
  const hanging = fetchTransport((_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
  const timed = await createRxNavClient({ transport: hanging, now, timeoutMs: 20 }).version();
  assert.ok(timed.kind === 'SOURCE_UNAVAILABLE' && timed.reason === 'TIMEOUT', JSON.stringify(timed));
  const ctl = new AbortController();
  const p = createRxNavClient({ transport: hanging, now, timeoutMs: 10_000, signal: ctl.signal }).version();
  ctl.abort();
  const cancelled = await p;
  assert.ok(cancelled.kind === 'SOURCE_UNAVAILABLE' && cancelled.reason === 'CANCELLED', JSON.stringify(cancelled));
});

test('fetch transport: sends GET with a generic User-Agent, no credentials, no redirects', async () => {
  let seen: unknown;
  const t = fetchTransport(async (_url, init) => ((seen = init), { status: 200, headers: { get: () => null }, text: async () => '{}' }));
  await t.get('https://rxnav.nlm.nih.gov/REST/version.json');
  const init = seen as { method: string; headers: Record<string, string>; credentials: string; redirect: string };
  assert.equal(init.method, 'GET');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
  assert.deepEqual(Object.keys(init.headers).sort(), ['Accept', 'User-Agent']);
  assert.match(init.headers['User-Agent']!, /^rx-recall-check\/\d/);
});

// ---------------------------------------------------------------- outcome classification (RG-1 at client level)

test('every failure kind is distinct and none is NO_MATCH', async () => {
  const q = POSITIVE_CONTROL.query;
  const cases: [string, HttpTransport, string][] = [
    ['network error', throwing(new TypeError('fetch failed')), 'NETWORK_ERROR'],
    ['timeout', throwing(Object.assign(new Error('t'), { name: 'TimeoutError' })), 'TIMEOUT'],
    ['HTTP 503', status(503, '<html/>'), 'HTTP_5XX'],
    ['HTTP 403', status(403, '{"error":{"code":"FORBIDDEN"}}'), 'HTTP_UNEXPECTED_STATUS'],
    ['truncated JSON', status(200, '{"meta":{"results":'), 'INVALID_JSON'],
    ['schema change', status(200, JSON.stringify({ meta: { last_updated: 'x', results: { skip: 0, limit: 1, total: 1 } }, results: [{ recall_number: 'D-1' }] })), 'SCHEMA_VIOLATION'],
  ];
  for (const [name, t, reason] of cases) {
    const r = await createOpenFdaClient(deps(t)).enforcementPage(q, 0);
    assert.ok(r.kind === 'SOURCE_UNAVAILABLE' && r.reason === reason, `${name}: ${JSON.stringify(r).slice(0, 120)}`);
  }
  const limited = await createOpenFdaClient(deps(status(429, '{}', { 'retry-after': '7' }))).enforcementPage(q, 0);
  assert.deepEqual([limited.kind, limited.kind === 'RATE_LIMITED' ? limited.retryAfterSeconds : null], ['RATE_LIMITED', 7]);
});

test('clients refuse to build queries from anything but public identifiers', async () => {
  const fda = createOpenFdaClient(deps(replay()));
  for (const bad of ['JKU4639A', '62756-142-02 OR 1', '"; drop']) {
    const r = await fda.ndcByPackage(bad);
    assert.ok(r.kind === 'SOURCE_UNAVAILABLE' && r.reason === 'REQUEST_BLOCKED', bad);
  }
  const weird = await fda.enforcementPage({ ...POSITIVE_CONTROL.query, search: 'code_info:"lot#1"&x=1' }, 0);
  assert.ok(weird.kind === 'SOURCE_UNAVAILABLE' && weird.reason === 'REQUEST_BLOCKED');
  const rx = createRxNavClient(deps(replay()));
  assert.equal((await rx.ndcStatus('62756-142-02')).kind, 'SOURCE_UNAVAILABLE');
  assert.equal((await createDailyMedClient(deps(replay())).splXml('../etc/passwd')).kind, 'SOURCE_UNAVAILABLE');
});

test('pagination never exceeds the openFDA skip ceiling', async () => {
  const r = await createOpenFdaClient(deps(replay())).enforcementPage(POSITIVE_CONTROL.query, 25_001);
  assert.equal(r.kind, 'SOURCE_UNAVAILABLE');
});

// ---------------------------------------------------------------- real recorded responses

test('recorded real responses: NDC Directory, enforcement, RxNav and DailyMed classify as OK', async () => {
  const t = replay();
  const fda = createOpenFdaClient(deps(t));
  const ndc = await fda.ndcByPackage('62756-142-02');
  assert.ok(ndc.kind === 'OK' && ndc.data.results[0]?.product_ndc === '62756-142');
  const control = await fda.enforcementPage(POSITIVE_CONTROL.query, 0);
  assert.ok(control.kind === 'OK' && control.data.results[0]?.recall_number === 'D-0325-2021');
  const rx = createRxNavClient(deps(t));
  const st = await rx.ndcStatus('62756014202');
  assert.ok(st.kind === 'OK' && st.data.ndcStatus.status === 'ACTIVE');
  const rel = st.kind === 'OK' ? await rx.ingredientsOf(st.data.ndcStatus.rxcui) : null;
  assert.ok(rel?.kind === 'OK' && conceptsOf(rel.data).some((c) => c.tty === 'IN' && c.rxcui === '6809' && c.name === 'metformin'));
  const spl = await createDailyMedClient(deps(t)).splXml('4a746634-379b-4847-a965-7607d2a71bed');
  assert.ok(spl.kind === 'OK' && spl.data.includes('<document'));
  assert.deepEqual(sourceProductsFromSpl(spl.kind === 'OK' ? spl.data : '', '68094-756'), { kind: 'SOURCES', sourceProductNdcs: ['0054-3294'] });
});

test('recorded mode never mocks: an unrecorded request throws NotRecordedError', async () => {
  await assert.rejects(replay().get('https://api.fda.gov/drug/ndc.json?search=product_ndc:%2200000-000%22&limit=10'), NotRecordedError);
});

test('URL builders are the single source of request shapes (and match the cassette)', () => {
  assert.equal(ndcUrl('packaging.package_ndc:"62756-142-02"'), 'https://api.fda.gov/drug/ndc.json?search=packaging.package_ndc%3A%2262756-142-02%22&limit=10');
  assert.ok(cassette.entries[enforcementUrl(POSITIVE_CONTROL.query, 0)]);
  assert.ok(cassette.entries[ndcStatusUrl('62756014202')]);
  assert.match(relatedUrl('861004'), /related\.json\?tty=IN\+PIN$/);
  assert.ok(cassette.entries[splXmlUrl('4a746634-379b-4847-a965-7607d2a71bed')]);
});

// ---------------------------------------------------------------- XML / SPL

test('XML reader: entities, CDATA, comments, self-closing tags; malformed input throws', () => {
  const doc = parseXml('<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><b/><c><![CDATA[<raw>]]>&lt;t&gt;&#65;</c></a>');
  const a = doc.children[0]!;
  assert.equal(a.attrs.x, '1 & 2');
  assert.equal(a.children[1]!.text, '<raw><t>A');
  for (const bad of ['<a><b></a>', '<a>', '<a x="1></a>', '<a>&bogus;</a>', '<!DOCTYPE a [<!ENTITY x "y">]><a/>']) assert.throws(() => parseXml(bad), XmlError, bad);
});

test('SPL: only the matching product is read; originals, absent products and broken XML establish nothing', () => {
  const read = (f: string, ndc: string) => sourceProductsFromSpl(readFileSync(join(ROOT, 'tests', 'fixtures', 'spl', f), 'utf8'), ndc);
  assert.deepEqual(read('repackager_pdrx_lisinopril_bf59ff89.xml', '43063-074'), { kind: 'SOURCES', sourceProductNdcs: ['43547-352'] });
  assert.deepEqual(read('manufacturer_aurolife_hydrocodone_apap_392a846e.xml', '13107-211'), { kind: 'NO_SOURCE_LISTED' });
  assert.deepEqual(read('manufacturer_aurolife_hydrocodone_apap_392a846e.xml', '99999-999'), { kind: 'PRODUCT_NOT_IN_SPL' });
  assert.equal(sourceProductsFromSpl('<document><x></document>', '1-1').kind, 'UNREADABLE');
});

// ---------------------------------------------------------------- ports: cache and source verification

async function portsWith(transport: HttpTransport) {
  let clock = Date.parse('2026-11-12T12:00:00Z');
  const now = () => new Date(clock).toISOString();
  const { repos, db } = await openStorage(openNodeSqlite(), { now, newId: () => randomUUID() });
  const d = { transport, now };
  const ports = createLivePorts({ openfda: createOpenFdaClient(d), rxnav: createRxNavClient(d), dailymed: createDailyMedClient(d), cache: repos.cache, now, sleep: async () => undefined });
  return { ports, db, advance: (ms: number) => (clock += ms) };
}

test('cache: OK answers are reused with their original retrieval time; expired answers are fetched again', async () => {
  let calls = 0;
  const inner = replay();
  const counting: HttpTransport = { get: (u, o) => ((calls += 1), inner.get(u, o)) };
  const { ports, advance } = await portsWith(counting);
  const a = await ports.lookupPackageNdc('62756-142-02');
  advance(3600_000);
  const b = await ports.lookupPackageNdc('62756-142-02');
  assert.equal(calls, 1);
  assert.equal(b.meta.retrievedAt, a.meta.retrievedAt, 'age stays visible');
  assert.equal(b.meta.headers['x-served-from'], 'local-cache');
  advance(31 * 24 * 3600_000);
  await ports.lookupPackageNdc('62756-142-02');
  assert.equal(calls, 2);
});

test('cache: failures are never cached, and the positive control is never served from cache', async () => {
  let calls = 0;
  const failing: HttpTransport = { get: async () => ((calls += 1), { status: 503, headers: {}, bodyText: '' }) };
  const { ports, db } = await portsWith(failing);
  await ports.lookupPackageNdc('62756-142-02');
  await ports.lookupPackageNdc('62756-142-02');
  assert.equal(calls, 2);
  assert.equal((await db.all('SELECT 1 FROM source_cache')).length, 0);
  const ok = await portsWith(replay());
  await ok.ports.fetchRecallPage(POSITIVE_CONTROL.query, 0);
  assert.equal((await ok.db.all('SELECT 1 FROM source_cache')).length, 0, 'control not cached');
});

test('enrichment: RxNav ingredient RxCUIs are added only on an exact name match', async () => {
  const { ports } = await portsWith(replay());
  const id = productIdentity(firstNdcRecord('ndc_pkg_62756-142-02'), '62756-142-02');
  const e = await ports.enrichIdentity!(id);
  assert.equal(e.ingredients[0]?.rxcui, '6809');
});

test('source products: verified only when the SPL declares the source and the directory confirms the same formulation', async () => {
  const { ports } = await portsWith(replay());
  const rec = JSON.parse(cassette.entries[ndcUrl('packaging.package_ndc:"68094-756-62"')]!.bodyText).results[0];
  const furosemide = productIdentity(rec, '68094-756-62');
  assert.equal(furosemide.isOriginalPackager, null, 'openFDA omits is_original_packager for this product');
  const ok = await ports.enrichIdentity!(furosemide);
  assert.equal(ok.sourceProductStatus, 'VERIFIED');
  assert.deepEqual(ok.relatedSourceProductNdcs, ['0054-3294']);
  // SYNTHETIC mismatch: the same identity but a different strength — the source must NOT be accepted.
  const other = { ...furosemide, ingredients: furosemide.ingredients.map((i) => ({ ...i, strength: { value: 8, unit: 'MG', per: 'ML' } })) };
  const rejected = await ports.enrichIdentity!(other);
  assert.equal(rejected.sourceProductStatus, 'NOT_ESTABLISHED');
  assert.deepEqual(rejected.relatedSourceProductNdcs, []);
  // SYNTHETIC outage: DailyMed unreachable → UNAVAILABLE, nothing inferred.
  const down: HttpTransport = { get: (u, o) => (u.includes('dailymed') ? Promise.reject(new TypeError('fetch failed')) : replay().get(u, o)) };
  const unavailable = await (await portsWith(down)).ports.enrichIdentity!(furosemide);
  assert.equal(unavailable.sourceProductStatus, 'UNAVAILABLE');
});
