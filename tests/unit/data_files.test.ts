/**
 * Structural and policy invariants for the versioned local data files in data/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const catalog = load('data/drug_catalog.json');
const policy = load('data/exclusion_policy.json');
const aliases = load('data/manufacturer_aliases.json');

test('catalog contains exactly the 14 MVP drugs', () => {
  const ids = catalog.drugs.map((d: { id: string }) => d.id).sort();
  assert.deepEqual(ids, [
    'amlodipine',
    'atorvastatin',
    'furosemide',
    'gabapentin',
    'hydrocodone_acetaminophen',
    'levothyroxine',
    'lisinopril',
    'losartan',
    'metformin',
    'metoprolol_succinate',
    'omeprazole',
    'pantoprazole',
    'rosuvastatin',
    'tamsulosin',
  ]);
});

test('every catalog ingredient has a numeric RxCUI', () => {
  for (const d of catalog.drugs) {
    for (const i of d.ingredients) assert.match(i.rxcui, /^\d+$/, `${d.id}/${i.name}`);
  }
});

test('hydrocodone/acetaminophen is an exact two-ingredient set', () => {
  const d = catalog.drugs.find((x: { id: string }) => x.id === 'hydrocodone_acetaminophen');
  assert.equal(d.ingredients.length, 2);
});

test('exclusion policy lists the 11 Document B ingredients', () => {
  const names = policy.entries.map((e: { ingredient: string }) => e.ingredient).sort();
  assert.deepEqual(names, [
    'apixaban',
    'azathioprine',
    'cyclosporine',
    'dabigatran',
    'edoxaban',
    'everolimus',
    'mycophenolate',
    'rivaroxaban',
    'sirolimus',
    'tacrolimus',
    'warfarin',
  ]);
});

test('no RxCUI is both supported and excluded', () => {
  const supported = new Set(catalog.drugs.flatMap((d: { ingredients: { rxcui: string }[] }) => d.ingredients.map((i) => i.rxcui)));
  for (const e of policy.entries) for (const c of e.rxcuis) assert.ok(!supported.has(c), `${e.ingredient} ${c}`);
});

test('every exclusion entry references a defined class and an allowed decision', () => {
  const classes = new Set(policy.classes.map((c: { id: string }) => c.id));
  for (const e of policy.entries) {
    assert.ok(classes.has(e.class), e.ingredient);
    assert.ok(['EXCLUDED', 'NEEDS_CLARIFICATION'].includes(e.decision), e.ingredient);
  }
});

test('everolimus is NEEDS_CLARIFICATION because its indication cannot be established from a label', () => {
  const e = policy.entries.find((x: { ingredient: string }) => x.ingredient === 'everolimus');
  assert.equal(e.decision, 'NEEDS_CLARIFICATION');
});

test('policy is versioned and the next review is no more than six months after the last review', () => {
  assert.match(policy.policy_version, /^\d+\.\d+\.\d+/);
  const last = new Date(policy.last_reviewed);
  const next = new Date(policy.next_review_due);
  const limit = new Date(last);
  limit.setMonth(limit.getMonth() + 6);
  assert.ok(next <= limit, 'next_review_due exceeds six months');
  assert.ok(policy.change_log.length >= 1);
  for (const c of policy.change_log) {
    assert.ok(c.date && c.source && c.version, 'change log entries need date, version and source');
  }
});

test('administration-based rule is recorded as an open decision, not an invented rule', () => {
  assert.equal(policy.administration_rule.status, 'OPEN_DECISION');
});

test('policy states that exclusion does not imply other drugs are safe', () => {
  assert.ok(policy.principles.some((p: string) => /does not imply/i.test(p)));
});

test('manufacturer aliases contain only sourced, verified entries', () => {
  for (const e of aliases.entries) {
    assert.ok(e.source && e.verified_on && Array.isArray(e.labeler_codes), JSON.stringify(e));
  }
});
