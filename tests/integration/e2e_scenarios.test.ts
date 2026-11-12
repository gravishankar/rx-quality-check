/**
 * The end-to-end scenarios of `npm run e2e`, run in recorded mode (real responses replayed by URL;
 * an unrecorded request fails). Same production engine as the app: composition root, state
 * machine, safety gates, exclusion evaluator, recall engine, storage. Live mode: `npm run e2e:live`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadCassette, replayTransport } from '../../scripts/lib/cassette.ts';
import { SCENARIOS, runScenario } from '../../scripts/e2e/scenarios.ts';
import { ROOT } from '../helpers/fixtures.ts';

const cassette = loadCassette(join(ROOT, 'tests', 'fixtures', 'task3', 'cassette.json'));

test('all eleven required scenario kinds are covered', () => {
  const ids = SCENARIOS.map((s) => s.id);
  for (const id of ['known-recall', 'no-applicable-match', 'unknown-lot', 'excluded', 'unsupported', 'new-catalog-entry', 'new-exclusion-rule', 'invalid-policy', 'network-failure', 'incomplete-response', 'offline-cached']) {
    assert.ok(ids.includes(id), id);
  }
});

for (const s of SCENARIOS) {
  test(`e2e (recorded): ${s.title}`, async () => {
    const { result, failures } = await runScenario(s, { root: ROOT, transport: replayTransport(cassette), mode: 'recorded' });
    assert.deepEqual(failures, [], `${s.id}: ${result.path.join(' → ')}`);
  });
}

test('privacy audit across all scenarios: only public identifiers to allowlisted hosts, nothing blocked', async () => {
  const urls: string[] = [];
  for (const s of SCENARIOS) {
    const { result } = await runScenario(s, { root: ROOT, transport: replayTransport(cassette), mode: 'recorded' });
    for (const r of result.requests) {
      assert.equal(r.outcome, 'SENT', r.url);
      urls.push(r.url);
    }
  }
  assert.ok(urls.length > 50);
  const allowed = [
    /^https:\/\/api\.fda\.gov\/drug\/(ndc|enforcement)\.json\?search=[A-Za-z0-9%+._-]+&limit=\d+(&skip=\d+)?$/,
    /^https:\/\/rxnav\.nlm\.nih\.gov\/REST\/ndcstatus\.json\?ndc=\d{11}$/,
    /^https:\/\/rxnav\.nlm\.nih\.gov\/REST\/rxcui\/\d+\/related\.json\?tty=IN\+PIN$/,
    /^https:\/\/dailymed\.nlm\.nih\.gov\/dailymed\/services\/v2\/spls\/[0-9a-f-]{36}\.xml$/,
  ];
  for (const u of urls) assert.ok(allowed.some((re) => re.test(u)), `unexpected request shape: ${u}`);
  // Search terms are only field:"identifier" pairs (ingredient names, NDCs, a recall number).
  for (const u of urls.filter((x) => x.includes('search='))) {
    const search = new URL(u).searchParams.get('search') ?? '';
    const stripped = search.replace(/(packaging\.package_ndc|product_ndc|product_description|openfda\.product_ndc|recall_number):"[a-z0-9 -]+"/gi, '').replace(/\bAND\b/g, '').trim();
    assert.equal(stripped, '', `search contains more than public identifiers: ${search}`);
  }
});
