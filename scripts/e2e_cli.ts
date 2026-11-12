/**
 * Command-line end-to-end integration through the production engine.
 *
 *   npm run e2e                 recorded mode: replays real responses from tests/fixtures/task3/cassette.json
 *   npm run e2e:live            live mode: direct HTTPS to openFDA, RxNav and DailyMed (behind a proxy add NODE_USE_ENV_PROXY=1)
 *   npm run e2e:record          live mode that also (re)records the cassette
 *   ... -- --only known-recall,excluded   run selected scenarios
 *
 * Exit code 0 = all scenarios passed (including the privacy audit), 1 = failures.
 * Recorded mode never substitutes a mock: an unrecorded request fails the scenario.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveTransport, loadCassette, recordingTransport, replayTransport, saveCassette } from './lib/cassette.ts';
import { SCENARIOS, runScenario } from './e2e/scenarios.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CASSETTE = join(ROOT, 'tests', 'fixtures', 'task3', 'cassette.json');

const args = process.argv.slice(2);
const live = args.includes('--live') || args.includes('--record');
const record = args.includes('--record');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? new Set((args[onlyIdx + 1] ?? '').split(',')) : null;

async function main(): Promise<void> {
  const cassette = loadCassette(CASSETTE);
  if (record) {
    cassette._fixture = {
      source: 'live public API responses (openFDA, RxNav, DailyMed) recorded by `npm run e2e:record`; requests contain only public identifiers; no patient data',
      capturedAt: new Date().toISOString(),
      note: 'Bodies stored as received. Replayed by URL in recorded mode; an unrecorded URL is an error.',
    };
  }
  const transport = live ? (record ? recordingTransport(liveTransport(), cassette) : liveTransport()) : replayTransport(cassette);
  const mode = live ? 'live' : 'recorded';
  console.log(`Rx Recall Check end-to-end (${mode}${record ? ', recording' : ''})\n`);
  let failed = 0;
  for (const s of SCENARIOS.filter((x) => only === null || only.has(x.id))) {
    let line: string;
    try {
      const { result, failures } = await runScenario(s, { root: ROOT, transport, mode });
      const f = result.state.ctx.finding;
      const x = result.state.ctx.exclusion;
      const summary = `${result.state.name}${f ? ` / ${f.finding}` : ''}${x && x.decision !== 'ELIGIBLE' ? ` / ${x.decision}:${x.reason}` : ''} · ${result.requests.length} requests`;
      line = `${failures.length === 0 ? 'PASS' : 'FAIL'}  ${s.id.padEnd(28)} ${summary}`;
      if (failures.length > 0) {
        failed++;
        line += failures.map((m) => `\n        - ${m}`).join('');
      }
      if (f) line += `\n        confirmed: ${f.confirmed.map((r) => r.recallNumber).join(', ') || '-'}; potential: ${f.potential.length}; not applicable: ${f.notApplicable.length}; FDA data ${f.coverage.datasetLastUpdated ?? '?'}`;
    } catch (e) {
      failed++;
      line = `FAIL  ${s.id.padEnd(28)} ${(e as Error).message}`;
    }
    console.log(line);
  }
  if (record) {
    saveCassette(CASSETTE, cassette);
    console.log(`\nrecorded ${Object.keys(cassette.entries).length} responses to ${CASSETTE}`);
  }
  console.log(failed === 0 ? '\nOK' : `\nFAILED: ${failed} scenario(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
