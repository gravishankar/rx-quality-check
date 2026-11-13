/**
 * C2 end to end on REAL recorded FDA responses (tests/fixtures/c2, openFDA 2026-11-13), through the
 * app's own evidence path: HCTZ combinations searched without the alias (as before C2) and with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runC2Comparison } from '../../scripts/catalog/c2_alias_search.ts';

const rows = await runC2Comparison();
const row = (id: string) => rows.find((r) => r.case === id)!;

test('C2: the recall naming the Lupin losartan/HCTZ NDC only as "HCTZ" was missed before and is now a possible match', () => {
  const r = row('losartan/HCTZ 100/25 Lupin');
  assert.equal(r.before.search, 'product_description:"hydrochlorothiazide" AND product_description:"losartan"');
  assert.equal(r.after.search, '(product_description:"hydrochlorothiazide" OR product_description:"hctz") AND product_description:"losartan"');
  assert.ok(!('D-0886-2022' in r.before.records));
  assert.match(r.after.records['D-0886-2022'] ?? '', /^POTENTIAL .*TEXT_NDC_MATCHES_PRODUCT/);
});

test('C2: no record is lost and newly found records for other strengths are ruled out, not confirmed', () => {
  for (const r of rows) {
    assert.deepEqual(r.lost, [], r.case);
    for (const n of r.newly) assert.doesNotMatch(n.after ?? '', /^CONFIRMED/, `${r.case} ${n.recall}`);
    assert.equal(r.after.searchAdequate, true, r.case);
  }
  const v = row('valsartan/HCTZ tablet');
  assert.equal(v.newly.length, 8);
  assert.ok(v.newly.every((n) => (n.after ?? '').startsWith('NOT_APPLICABLE')), JSON.stringify(v.newly));
});
