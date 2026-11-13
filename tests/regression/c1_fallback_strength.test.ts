/**
 * Review item 1, fallback path: a recall notice whose strength information is incomplete (fewer or
 * more numbers than the product has ingredients, or ingredients not all named) must never be ruled
 * out as a different strength unless the stated numbers prove a difference. Products are real
 * (Lupin losartan/HCTZ 100/25 mg, tests/fixtures/c2/exemplars.json; Camber hydrocodone/APAP 10/325);
 * notice texts marked SYNTHETIC are format-only.
 *
 * Soundness argument the tests pin:
 *  - same count, every ingredient named: pair by position → exact.
 *  - same count, not every ingredient named: multiset comparison. If the multisets differ, no
 *    assignment of the stated numbers to the ingredients can match → a difference is proven. If
 *    they are equal (including swapped values), the record is kept (never excluded).
 *  - different count: a difference is claimed only when none of the stated numbers equals any of the
 *    product's strengths; otherwise the strength is "partly stated" → kept.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareAttributes } from '../../mobile/src/rules/recallRecord.ts';
import { directoryProductFrom, identityFromProduct } from '../../mobile/src/rules/identity.ts';
import type { OpenFdaNdcProduct } from '../../mobile/src/models/openfda.ts';
import { ROOT, firstNdcRecord, productIdentity } from '../helpers/fixtures.ts';

const ex = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/c2/exemplars.json'), 'utf8')) as Record<string, OpenFdaNdcProduct>;
const losartanHctz = () => identityFromProduct(directoryProductFrom(ex['losartan/HCTZ 100/25 Lupin']!), null, null);
const hydrocodoneApap = () => productIdentity(firstNdcRecord('ndc_prod_31722-997'), '31722-997-01');
const differs = (t: string, id = losartanHctz()) => compareAttributes(id, t).differences.includes('STRENGTH_DIFFERS');

test('fallback: a notice stating only one of two strengths is not ruled out (SYNTHETIC)', () => {
  assert.equal(differs('Losartan Potassium and Hydrochlorothiazide Tablets USP, 100 mg, 30-count bottle'), false);
  assert.equal(differs('Losartan Potassium and Hydrochlorothiazide Tablets USP, 25 mg, 30-count bottle'), false);
});

test('fallback: strengths written separately per ingredient are not ruled out (SYNTHETIC)', () => {
  assert.equal(differs('Losartan Potassium 100 mg and Hydrochlorothiazide 25 mg Tablets, 90-count bottle'), false);
});

test('fallback: a partly stated strength is recorded as an unknown, keeping the record a possible match', () => {
  const c = compareAttributes(losartanHctz(), 'Losartan Potassium and Hydrochlorothiazide Tablets USP, 100 mg, 30-count bottle');
  assert.ok(c.unknowns.includes('STRENGTH_PARTIALLY_STATED'), JSON.stringify(c));
});

test('fallback guard: a stated number that matches none of the product strengths is a proven difference (SYNTHETIC)', () => {
  assert.equal(differs('Losartan Potassium and Hydrochlorothiazide Tablets USP, 50 mg, 30-count bottle'), true);
});

test('fallback guard: same count, ingredients not named, multisets differ → proven difference; equal (even swapped) → kept (SYNTHETIC)', () => {
  assert.equal(differs('Combination tablets 50 mg/12.5 mg, 30 count'), true);
  assert.equal(differs('Combination tablets 25 mg/100 mg, 30 count'), false);
});

test('fallback guard: every ingredient named, same count → paired by position (swapped is a difference) (SYNTHETIC)', () => {
  assert.equal(differs('Hydrocodone Bitartrate and Acetaminophen Tablets 325 mg/10 mg', hydrocodoneApap()), true);
  assert.equal(differs('Hydrocodone Bitartrate and Acetaminophen Tablets 10 mg/325 mg', hydrocodoneApap()), false);
});

test('fallback: a single-ingredient notice listing several strengths in one expression is kept when one matches (SYNTHETIC)', () => {
  const met = productIdentity(firstNdcRecord('ndc_pkg_62756-142-02'), '62756-142-02');
  assert.equal(differs('Metformin HCl Extended-Release Tablets 500 mg/750 mg, bottles of 100', met), false);
  assert.equal(differs('Metformin HCl Extended-Release Tablets 750 mg/1000 mg, bottles of 100', met), true);
});
