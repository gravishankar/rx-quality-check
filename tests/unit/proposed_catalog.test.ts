/**
 * Proposed extended catalog (data/proposals/drug_catalog_0.3.0-proposed.json): built by
 * scripts/catalog/ from CMS Part D 2023, RxNav and openFDA. Not used by the app until approved.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crossValidateConfig, validateCatalog, validatePolicy } from '../../mobile/src/rules/catalog.ts';
import { ROOT } from '../helpers/fixtures.ts';

const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const proposed = read('data/proposals/drug_catalog_0.3.0-proposed.json');
const current = read('data/drug_catalog.json');

test('proposed catalog passes the app validator and does not overlap the exclusion policy', () => {
  const c = validateCatalog(proposed, { allowUnapproved: true });
  assert.deepEqual(c.problems.filter((p) => p.severity === 'error'), []);
  const p = validatePolicy(read('data/exclusion_policy.json'), { allowUnapproved: true });
  assert.deepEqual(crossValidateConfig(c.catalog!, p.policy!).filter((x) => x.severity === 'error'), []);
  assert.equal(proposed.status, 'PROPOSED_PENDING_APPROVAL', 'a proposal, never shipped as approved');
});

test('current drugs are kept unchanged (only metoprolol succinate gains release type ER)', () => {
  for (const d of current.drugs) {
    const n = proposed.drugs.find((x: { id: string }) => x.id === d.id);
    assert.ok(n, d.id);
    if (d.id === 'metoprolol_succinate') {
      assert.deepEqual(n.restrictions.release_types, ['ER']);
      assert.deepEqual(n.restrictions.precise_ingredients, d.restrictions.precise_ingredients);
    } else assert.deepEqual(n, d, d.id);
  }
  for (const i of current.ingredients) assert.deepEqual(proposed.ingredients.find((x: { id: string }) => x.id === i.id), i, i.id);
});

test('every added drug is ranked, sourced, prescription-only, and every switched-off drug says why', () => {
  const added = proposed.drugs.filter((d: { id: string }) => !current.drugs.some((c: { id: string }) => c.id === d.id));
  assert.ok(added.length >= 100);
  for (const d of added) {
    assert.ok(Number.isInteger(d.part_d_rank_2023) && d.part_d_rank_2023 >= 1 && d.part_d_rank_2023 <= 200, d.id);
    assert.match(d.provenance.source, /CMS Medicare Part D Prescribers/);
    assert.equal(d.rx_scope, 'PRESCRIPTION_ONLY');
    if (d.status === 'INACTIVE') assert.match(d.notes, /INACTIVE: /, d.id);
  }
  for (const i of proposed.ingredients) assert.match(i.rxcui ?? '', /^\d+$/, i.id);
});

test('excluded drugs stay out; digoxin waits for OD-32; recall-search gaps wait for fix F1', () => {
  const ids = new Set(proposed.drugs.map((d: { id: string }) => d.id));
  for (const x of ['apixaban', 'rivaroxaban', 'warfarin', 'cyclosporine']) assert.ok(![...ids].some((i) => (i as string).includes(x)), x);
  const status = (id: string) => proposed.drugs.find((d: { id: string }) => d.id === id)?.status;
  assert.equal(status('digoxin'), 'INACTIVE');
  for (const id of ['clopidogrel', 'escitalopram', 'citalopram', 'hydroxyzine', 'clindamycin']) assert.equal(status(id), 'INACTIVE', id);
});
