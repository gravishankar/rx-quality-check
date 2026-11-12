/**
 * Static checks on mobile/src (Task 2 acceptance: "no I/O imports in rules/ or state/"):
 *  - models/, rules/, state/, engine/ import nothing outside mobile/src and no Node/RN/network APIs;
 *  - models/ imports only models/; state/ imports only models/; rules/ never imports state/ or engine/;
 *  - no backend, telemetry, analytics or language-model dependency anywhere in the library;
 *  - no manufacturing-facility / provenance code in the library (out of scope for v0.1);
 *  - task-2 fixtures are real captures with provenance metadata.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from '../helpers/fixtures.ts';

const SRC = join(ROOT, 'mobile', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const sources = files(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, 'utf8') }));
const importsOf = (text: string) => [...text.matchAll(/^\s*(?:import|export)[^'";]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] as string);

test('library modules import only relative paths inside mobile/src (no Node, RN, network or storage packages)', () => {
  assert.ok(sources.length >= 15);
  for (const s of sources) {
    for (const imp of importsOf(s.text)) {
      assert.ok(imp.startsWith('./') || imp.startsWith('../'), `${s.path} imports package "${imp}"`);
      assert.ok(!relative(SRC, join(SRC, s.path, '..', imp)).startsWith('..'), `${s.path} imports outside mobile/src: ${imp}`);
    }
  }
});

test('layering: fsm → nothing; models → nothing; state → models/fsm; rules → models/rules; engine → anything in the library', () => {
  for (const s of sources) {
    const layer = s.path.split('/')[0];
    for (const imp of importsOf(s.text)) {
      const target = relative(SRC, join(SRC, s.path, '..', imp)).split('/')[0];
      if (layer === 'fsm') assert.equal(target, 'fsm', `${s.path} → ${imp} (the generic core must stay app-independent)`);
      if (layer === 'models') assert.equal(target, 'models', `${s.path} → ${imp}`);
      if (layer === 'state') assert.ok(target === 'models' || target === 'fsm', `${s.path} → ${imp}`);
      if (layer === 'rules') assert.ok(target === 'models' || target === 'rules', `${s.path} → ${imp}`);
    }
  }
});

test('no I/O, timers, randomness or global clock in models/, rules/ or state/', () => {
  const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /\bprocess\./, /\brequire\s*\(/, /setTimeout|setInterval/, /Math\.random/, /Date\.now|new Date\(/, /localStorage|AsyncStorage|sqlite/i, /console\./];
  for (const s of sources.filter((x) => /^(models|rules|state|fsm)\//.test(x.path))) {
    for (const b of banned) assert.ok(!b.test(s.text), `${s.path} matches ${b}`);
  }
});

test('no backend, telemetry, analytics or language-model references in the library', () => {
  const banned = /firebase|supabase|sentry|amplitude|mixpanel|segment\.io|analytics\(|openai|anthropic|llm|gpt-|telemetry\(/i;
  for (const s of sources) assert.ok(!banned.test(s.text), s.path);
});

test('no manufacturing-provenance logic in the library (removed from MVP scope)', () => {
  const banned = /establishment|C43360|MANUFACTURE\b|facility[A-Z_a-z]*\s*[:=(]|inspection|FEI\b|DUNS/;
  for (const s of sources) assert.ok(!banned.test(s.text), s.path);
});

test('every task-2 fixture records its live source, query URL and capture time; INDEX lists them all', () => {
  const dir = join(ROOT, 'tests', 'fixtures', 'task2');
  const names = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'INDEX.json');
  const index = JSON.parse(readFileSync(join(dir, 'INDEX.json'), 'utf8')) as { fixtures: { name: string }[] };
  assert.deepEqual(index.fixtures.map((f) => `${f.name}.json`).sort(), [...names].sort());
  for (const n of names) {
    const f = JSON.parse(readFileSync(join(dir, n), 'utf8'));
    assert.match(f._fixture.source, /^live public openFDA response/, n);
    assert.match(f._fixture.url, /^https:\/\/api\.fda\.gov\/drug\/(enforcement|ndc)\.json\?/, n);
    assert.ok(!Number.isNaN(Date.parse(f._fixture.capturedAt)), n);
    assert.equal(typeof f.http.status, 'number', n);
  }
});
