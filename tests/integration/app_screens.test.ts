/**
 * Screen models over the real end-to-end scenarios (recorded responses): what each screen shows is
 * derived only through the presentation layer, never stronger than the evidence, and the
 * confirmation step requires each item to be ticked. Also checks OD-19: locally excluded,
 * unsupported or blocked medications cause no RxNav or DailyMed request.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadCassette, replayTransport } from '../../scripts/lib/cassette.ts';
import { SCENARIOS, runScenario } from '../../scripts/e2e/scenarios.ts';
import { confirmationEvent, manualExtraction, screenFor, type ScreenModel } from '../../mobile/src/app/screens.ts';
import { createRecallCheck } from '../../mobile/src/app/recallCheck.ts';
import { COPY, REVIEWED_NEGATED_STATEMENTS } from '../../mobile/src/copy/en.ts';
import { ROOT } from '../helpers/fixtures.ts';

const cassette = loadCassette(join(ROOT, 'tests', 'fixtures', 'task3', 'cassette.json'));
const NOW = '2026-11-12T12:10:00.000Z';

const EXPECTED: Record<string, ScreenModel['kind'] | `RESULT:${string}`> = {
  'known-recall': 'RESULT:CONFIRMED',
  'no-applicable-match': 'RESULT:NO_MATCH',
  'unknown-lot': 'RESULT:POTENTIAL',
  excluded: 'NOT_ASSESSED',
  unsupported: 'NOT_ASSESSED',
  'invalid-policy': 'NOT_ASSESSED',
  'network-failure': 'SOURCE_PROBLEM',
  'incomplete-response': 'RESULT:UNABLE',
};

function texts(m: ScreenModel): string[] {
  switch (m.kind) {
    case 'RESULT':
      return [m.view.headline, ...m.view.qualifiers, ...m.view.nextSteps, ...m.view.sources, ...m.view.limitations, ...m.fields.map((f) => `${f.label} ${f.value} ${f.note ?? ''}`)];
    case 'NOT_ASSESSED':
      return [m.view.headline, ...m.view.body];
    case 'SOURCE_PROBLEM':
      return [m.headline, m.body];
    default:
      return [];
  }
}

for (const s of SCENARIOS) {
  test(`screen model: ${s.id}`, async () => {
    const { result } = await runScenario(s, { root: ROOT, transport: replayTransport(cassette), mode: 'recorded' });
    const m = screenFor(result.state, { now: NOW, persistHistory: false });
    const want = EXPECTED[s.id];
    if (want) assert.equal(m.kind === 'RESULT' ? `RESULT:${m.view.category}` : m.kind, want);
    if (m.kind === 'RESULT') assert.equal(m.canSave, false, 'development builds never offer saving');
    for (const t of texts(m)) {
      let x = t;
      for (const r of REVIEWED_NEGATED_STATEMENTS) x = x.split(r).join('');
      assert.doesNotMatch(x, /\bsafe\b|recall[- ]free|guarantee|fda[- ]verified|no issues/i, t);
    }
    if (['excluded', 'unsupported', 'invalid-policy'].includes(s.id)) {
      const enrichment = result.requests.filter((r) => r.host === 'rxnav.nlm.nih.gov' || r.host === 'dailymed.nlm.nih.gov');
      assert.equal(enrichment.length, 0, 'OD-19: no optional lookups for a locally decided medication');
    }
  });
}

test('invalid configuration is shown as "recall checks are turned off", not as a medication finding', async () => {
  const s = SCENARIOS.find((x) => x.id === 'invalid-policy')!;
  const { result } = await runScenario(s, { root: ROOT, transport: replayTransport(cassette), mode: 'recorded' });
  const m = screenFor(result.state, { now: NOW, persistHistory: false });
  assert.ok(m.kind === 'NOT_ASSESSED' && m.view.kind === 'CONFIG_BLOCKED');
});

test('confirmation: each item must be ticked; an incomplete confirmation does not fetch evidence', async () => {
  const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
  const app = createRecallCheck({ transport: replayTransport(cassette), now: () => '2026-11-12T12:00:00.000Z', sleep: async () => undefined, catalogJson: read('data/drug_catalog.json'), policyJson: read('data/exclusion_policy.json'), load: { allowUnapproved: true } });
  const r = await app.scan(manualExtraction({ ndc: '62756-142-02', drugName: 'METFORMIN HCL ER', strength: '500 MG', form: 'TABLET', lot: 'JKU4639A' }));
  const m = screenFor(r.state, { now: NOW, persistHistory: false });
  assert.equal(m.kind, 'CONFIRM');
  if (m.kind !== 'CONFIRM') return;
  assert.ok(m.fields.some((f) => f.evidence === 'VERIFIED_SOURCE'));
  assert.ok(m.items.some((i) => i.key === 'lot'), 'lot confirmation offered');
  const before = app.audit.entries.length;
  const partial = await app.send(r.state, confirmationEvent([], null, null));
  assert.notEqual(partial.state.name, 'FETCH_EVIDENCE');
  assert.ok(!['EXPLAIN', 'SAVED'].includes(partial.state.name));
  assert.equal(app.audit.entries.filter((e) => e.host === 'api.fda.gov' && e.url.includes('enforcement')).length, app.audit.entries.slice(0, before).filter((e) => e.url.includes('enforcement')).length);
  const full = await app.send(r.state, confirmationEvent(m.items.map((i) => i.key), m.lot, m.askRelease ? 'ER' : null));
  const shown = screenFor(full.state, { now: NOW, persistHistory: false });
  assert.ok(shown.kind === 'RESULT' && shown.view.category === 'CONFIRMED', JSON.stringify(shown.kind));
  assert.ok(app.audit.entries.every((e) => !e.url.includes('JKU4639A')), 'lot never transmitted');
});

test('manual entry: empty fields are absent; lot stays local; nothing invented', () => {
  const x = manualExtraction({ ndc: ' ', drugName: 'Metformin', strength: '', form: 'tablet', lot: '' });
  assert.deepEqual(x.ndcTexts, []);
  assert.equal(x.strength, null);
  assert.equal(x.lot, null);
  assert.equal(x.labelerText, null);
  assert.equal(COPY.entry.lotHelp.includes('never sent'), true);
});
