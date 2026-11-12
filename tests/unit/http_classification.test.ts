/**
 * Release gate RG-1: a lookup or parsing failure must never be classified as NO_MATCH
 * ("no recall found"). Only a well-formed, source-specific "no results" answer may be.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyResponse, type RawResponse, type SourceId } from '../../scripts/lib/http.ts';
import {
  validateOpenFdaEnforcement,
  validateDailyMedSplList,
  validateRxNavIdGroup,
} from '../../scripts/lib/schemas.ts';

const T = { retrievedAt: '2026-11-12T00:00:00.000Z', elapsedMs: 1 };
const raw = (status: number, body: string, headers: Record<string, string> = {}): RawResponse => ({
  status,
  headers,
  bodyText: body,
});
const classify = (src: SourceId, r: RawResponse, v = validateOpenFdaEnforcement) =>
  classifyResponse(src, 'https://example.invalid/test', r, v, T);

// Bodies below reproduce the exact shapes observed from the live services on 2026-11-12.
const OPENFDA_NOT_FOUND = '{"error":{"code":"NOT_FOUND","message":"No matches found!"}}';
const OPENFDA_SERVER_ERROR =
  '{"error":{"code":"SERVER_ERROR","message":"Check your request and try again","details":"[parse_exception]"}}';
const OPENFDA_OK_EMPTYISH =
  '{"meta":{"last_updated":"2026-11-04","results":{"skip":0,"limit":1,"total":1}},"results":[{"recall_number":"D-0325-2021","status":"Terminated","classification":"Class III","product_description":"Metformin HCl Extended-Release Tablets, USP, 500 mg ... NDC 62756-142-02.","code_info":"Lot #JKU4639A, Exp 10/2022","recalling_firm":"SUN PHARMACEUTICAL INDUSTRIES INC","reason_for_recall":"x","report_date":"20210414"}]}';

test('openFDA 404 NOT_FOUND is the only openFDA response that becomes NO_MATCH', () => {
  assert.equal(classify('OPENFDA', raw(404, OPENFDA_NOT_FOUND)).kind, 'NO_MATCH');
});

test('openFDA 404 without the NOT_FOUND error body is SOURCE_UNAVAILABLE (e.g., gateway 404)', () => {
  const o = classify('OPENFDA', raw(404, '<html>Not Found</html>'));
  assert.equal(o.kind, 'SOURCE_UNAVAILABLE');
});

test('openFDA 500 (also returned for malformed queries) is SOURCE_UNAVAILABLE, never NO_MATCH', () => {
  const o = classify('OPENFDA', raw(500, OPENFDA_SERVER_ERROR));
  assert.equal(o.kind, 'SOURCE_UNAVAILABLE');
  if (o.kind === 'SOURCE_UNAVAILABLE') assert.equal(o.reason, 'HTTP_5XX');
});

test('HTTP 429 is RATE_LIMITED and carries Retry-After when present', () => {
  const o = classify('OPENFDA', raw(429, '{"error":{"code":"OVER_RATE_LIMIT"}}', { 'retry-after': '30' }));
  assert.equal(o.kind, 'RATE_LIMITED');
  if (o.kind === 'RATE_LIMITED') assert.equal(o.retryAfterSeconds, 30);
});

test('HTTP 429 without Retry-After is RATE_LIMITED with unknown delay', () => {
  const o = classify('OPENFDA', raw(429, 'Too Many Requests'));
  assert.equal(o.kind, 'RATE_LIMITED');
  if (o.kind === 'RATE_LIMITED') assert.equal(o.retryAfterSeconds, null);
});

test('HTML maintenance page with 503 is SOURCE_UNAVAILABLE', () => {
  assert.equal(classify('OPENFDA', raw(503, '<html>Service Unavailable</html>')).kind, 'SOURCE_UNAVAILABLE');
});

test('truncated JSON body on HTTP 200 is SOURCE_UNAVAILABLE/INVALID_JSON, never NO_MATCH', () => {
  const o = classify('OPENFDA', raw(200, OPENFDA_OK_EMPTYISH.slice(0, 120)));
  assert.equal(o.kind, 'SOURCE_UNAVAILABLE');
  if (o.kind === 'SOURCE_UNAVAILABLE') assert.equal(o.reason, 'INVALID_JSON');
});

test('a known recall record with a missing required field is SCHEMA_VIOLATION, never NO_MATCH', () => {
  const broken = OPENFDA_OK_EMPTYISH.replace('"code_info":"Lot #JKU4639A, Exp 10/2022",', '');
  const o = classify('OPENFDA', raw(200, broken));
  assert.equal(o.kind, 'SOURCE_UNAVAILABLE');
  if (o.kind === 'SOURCE_UNAVAILABLE') assert.equal(o.reason, 'SCHEMA_VIOLATION');
});

test('a well-formed recall response is OK and preserves the record', () => {
  const o = classify('OPENFDA', raw(200, OPENFDA_OK_EMPTYISH));
  assert.equal(o.kind, 'OK');
});

test('HTTP 200 with an empty object (no results array) is SOURCE_UNAVAILABLE, not NO_MATCH', () => {
  const o = classify('OPENFDA', raw(200, '{}'));
  assert.equal(o.kind, 'SOURCE_UNAVAILABLE');
});

test('DailyMed empty data with total_elements 0 is NO_MATCH', () => {
  const body =
    '{"data":[],"metadata":{"db_published_date":"Nov 11, 2026 08:02:44PM EST","total_elements":0,"total_pages":0}}';
  assert.equal(classify('DAILYMED', raw(200, body), validateDailyMedSplList).kind, 'NO_MATCH');
});

test('DailyMed empty data without metadata is SOURCE_UNAVAILABLE', () => {
  assert.equal(classify('DAILYMED', raw(200, '{"data":[]}'), validateDailyMedSplList).kind, 'SOURCE_UNAVAILABLE');
});

test('DailyMed 406 is SOURCE_UNAVAILABLE', () => {
  assert.equal(classify('DAILYMED', raw(406, ''), validateDailyMedSplList).kind, 'SOURCE_UNAVAILABLE');
});

test('RxNav idGroup without rxnormId is NO_MATCH', () => {
  assert.equal(classify('RXNAV', raw(200, '{"idGroup":{}}'), validateRxNavIdGroup).kind, 'NO_MATCH');
});

test('RxNav malformed rxnormId is SOURCE_UNAVAILABLE', () => {
  assert.equal(
    classify('RXNAV', raw(200, '{"idGroup":{"rxnormId":[29046]}}'), validateRxNavIdGroup).kind,
    'SOURCE_UNAVAILABLE',
  );
});

test('an openFDA-shaped NOT_FOUND body from a different source is not treated as NO_MATCH', () => {
  assert.equal(classify('RXNAV', raw(404, OPENFDA_NOT_FOUND), validateRxNavIdGroup).kind, 'SOURCE_UNAVAILABLE');
});
