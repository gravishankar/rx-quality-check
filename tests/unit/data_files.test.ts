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

// Task 3: invariants restated for schema 2 (ingredient definitions separate from drugs; ingredient_rules).
test('every catalog ingredient has a numeric RxCUI with provenance', () => {
  for (const i of catalog.ingredients) {
    assert.match(i.rxcui, /^\d+$/, i.id);
    assert.ok(i.provenance.source && i.provenance.verified_on, i.id);
  }
  for (const d of catalog.drugs) for (const id of d.ingredients) assert.ok(catalog.ingredients.some((i: { id: string }) => i.id === id), `${d.id}/${id}`);
});

test('task 1 RxCUIs are preserved in schema 2', () => {
  const expected: Record<string, string> = {
    atorvastatin: '83367', amlodipine: '17767', levothyroxine: '10582', lisinopril: '29046', gabapentin: '25480', losartan: '52175',
    metformin: '6809', metoprolol: '6918', omeprazole: '7646', rosuvastatin: '301542', pantoprazole: '40790', furosemide: '4603',
    hydrocodone: '5489', acetaminophen: '161', tamsulosin: '77492',
  };
  for (const [id, rx] of Object.entries(expected)) assert.equal(catalog.ingredients.find((i: { id: string }) => i.id === id)?.rxcui, rx, id);
  const meto = catalog.drugs.find((d: { id: string }) => d.id === 'metoprolol_succinate');
  assert.deepEqual(meto.restrictions.precise_ingredients.metoprolol.allow, ['221124']);
});

test('hydrocodone/acetaminophen is an exact two-ingredient set', () => {
  const d = catalog.drugs.find((x: { id: string }) => x.id === 'hydrocodone_acetaminophen');
  assert.deepEqual(d.ingredients, ['hydrocodone', 'acetaminophen']);
});

test('exclusion policy lists the 11 Document B ingredients', () => {
  const names = policy.ingredient_rules.map((e: { ingredient: string }) => e.ingredient).sort();
  assert.deepEqual(names, ['apixaban', 'azathioprine', 'cyclosporine', 'dabigatran', 'edoxaban', 'everolimus', 'mycophenolate', 'rivaroxaban', 'sirolimus', 'tacrolimus', 'warfarin']);
});

test('no RxCUI is both supported and excluded', () => {
  const supported = new Set(catalog.ingredients.flatMap((i: { rxcui: string; precise_ingredients: { rxcui: string }[] }) => [i.rxcui, ...i.precise_ingredients.map((p) => p.rxcui)]));
  for (const e of policy.ingredient_rules) for (const c of e.rxcuis) assert.ok(!supported.has(c), `${e.ingredient} ${c}`);
});

test('every exclusion rule references a defined class, an allowed decision, a source and a verification date', () => {
  const classes = new Set(policy.classes.map((c: { id: string }) => c.id));
  for (const e of policy.ingredient_rules) {
    assert.ok(classes.has(e.class), e.ingredient);
    assert.ok(['EXCLUDED', 'NEEDS_CLARIFICATION'].includes(e.decision), e.ingredient);
    assert.ok(e.source && /^\d{4}-\d{2}-\d{2}$/.test(e.verified_on), e.ingredient);
  }
});

test('everolimus is NEEDS_CLARIFICATION because its indication cannot be established from a label', () => {
  const e = policy.ingredient_rules.find((x: { ingredient: string }) => x.ingredient === 'everolimus');
  assert.equal(e.decision, 'NEEDS_CLARIFICATION');
});

test('azathioprine and mycophenolate are excluded by ingredient regardless of indication', () => {
  for (const n of ['azathioprine', 'mycophenolate']) {
    const e = policy.ingredient_rules.find((x: { ingredient: string }) => x.ingredient === n);
    assert.equal(e.decision, 'EXCLUDED');
    assert.match(e.note, /regardless of indication/);
  }
});

test('policy is versioned and the next review is no more than six months after the last review', () => {
  assert.match(policy.policy_version, /^\d+\.\d+\.\d+/);
  const last = new Date(policy.last_reviewed);
  const next = new Date(policy.next_review_due);
  const limit = new Date(last);
  limit.setMonth(limit.getMonth() + 6);
  assert.ok(next <= limit, 'next_review_due exceeds six months');
  assert.ok(policy.change_log.length >= 2);
  for (const c of policy.change_log) {
    assert.ok(c.date && c.source && c.version, 'change log entries need date, version and source');
  }
});

test('administration-based rule is recorded as an open decision, not an invented rule', () => {
  const r = policy.route_rules.find((x: { id: string }) => x.id === 'ADMIN-NON-ORAL');
  assert.equal(r.status, 'OPEN_DECISION');
  assert.equal(r.decision_id, 'OD-1');
});

test('OTC products are excluded by an explicit product-type rule', () => {
  const r = policy.product_type_rules.find((x: { id: string }) => x.id === 'OTC-MVP');
  assert.deepEqual(r.product_types, ['HUMAN OTC DRUG']);
  assert.equal(r.decision, 'EXCLUDED');
});

test('policy states that exclusion does not imply other drugs are safe', () => {
  assert.ok(policy.principles.some((p: string) => /does not imply/i.test(p)));
});

test('manufacturer aliases contain only sourced, verified entries', () => {
  for (const e of aliases.entries) {
    assert.ok(e.source && e.verified_on && Array.isArray(e.labeler_codes), JSON.stringify(e));
  }
});
