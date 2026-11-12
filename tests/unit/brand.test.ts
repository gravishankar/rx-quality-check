/**
 * Brand configuration (Task 4A.1): one source (config/brand.json) for product name, tagline,
 * feature name, version and display labels; separate from data, policy, workflow and evidence;
 * never changes package identifiers; and the provisional name blocks a pilot release.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildBrandModule, readBrand, withIosDisplayName } from '../../scripts/bundle_brand.ts';
import { BRAND } from '../../mobile/src/brand/brand.ts';
import { APP_VERSION, pilotBlockers } from '../../mobile/src/app/buildProfile.ts';
import { COPY, REVIEWED_NEGATED_STATEMENTS, allCopyStrings } from '../../mobile/src/copy/en.ts';
import { LEGAL_DOCUMENTS } from '../../mobile/src/legal/documents.ts';
import { releaseGate } from '../../scripts/release_gate.ts';
import { ROOT } from '../helpers/fixtures.ts';

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

test('generated brand module and iOS display name match config/brand.json (run `npm run brand:bundle`)', () => {
  assert.equal(read('mobile', 'src', 'brand', 'brand.ts'), buildBrandModule());
  const plist = read('mobile', 'ios', 'RxRecallCheck', 'Info.plist');
  assert.equal(withIosDisplayName(plist, readBrand().display_labels.pilot), plist);
});

test('working name, tagline and first feature are as instructed; the name is marked provisional', () => {
  const b = readBrand();
  assert.equal(b.product_name, 'MedLuma');
  assert.equal(b.tagline, 'Know your medication. Understand the evidence.');
  assert.equal(b.features.recall_check?.name, 'Medication Recall Check');
  assert.notEqual(b.name_status, 'CLEARED_BY_COUNSEL', 'clearance requires counsel; never set automatically');
  assert.equal(APP_VERSION, b.app_version);
});

test('package identifiers and signing are unchanged by the brand', () => {
  const g = read('mobile', 'android', 'app', 'build.gradle');
  assert.match(g, /applicationId "org\.rxrecallcheck\.app"/);
  assert.match(g, /namespace "org\.rxrecallcheck\.app"/);
  assert.match(g, /applicationIdSuffix "\.dev"/);
  assert.match(g, /resValue "string", "app_name", brandJson\.display_labels\.development/);
  assert.match(g, /versionName brandJson\.app_version/);
  assert.match(read('mobile', 'ios', 'RxRecallCheck.xcodeproj', 'project.pbxproj'), /PRODUCT_BUNDLE_IDENTIFIER = "org\.rxrecallcheck\.app"/);
  assert.equal(readBrand().unchanged_identifiers.android_application_id, 'org.rxrecallcheck.app');
});

test('no product name is hard-coded outside the brand file (copy, screens, shared code, legal sources)', () => {
  const names = [readBrand().product_name, ...readBrand().former_names];
  const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : /\.(tsx?|md)$/.test(f) ? [join(d, f)] : []));
  const scan = [...files(join(ROOT, 'mobile', 'src')), ...files(join(ROOT, 'mobile', 'app')), ...files(join(ROOT, 'docs', 'legal'))].filter(
    (f) => !f.endsWith(join('brand', 'brand.ts')) && !f.endsWith(join('legal', 'documents.ts')),
  );
  for (const f of scan) for (const n of names) assert.ok(!read(relative(ROOT, f)).includes(n), `${relative(ROOT, f)} hard-codes "${n}"`);
});

test('brand is presentation only: rules, state, fsm, engine, services, storage and models never import it', () => {
  const dirs = ['rules', 'state', 'fsm', 'engine', 'services', 'storage', 'models'];
  for (const d of dirs) {
    const dir = join(ROOT, 'mobile', 'src', d);
    const walk = (x: string): string[] => readdirSync(x).flatMap((f) => (statSync(join(x, f)).isDirectory() ? walk(join(x, f)) : [join(x, f)]));
    for (const f of walk(dir)) assert.doesNotMatch(readFileSync(f, 'utf8'), /brand\/brand\.ts/, relative(ROOT, f));
  }
  for (const f of ['data/drug_catalog.json', 'data/exclusion_policy.json']) assert.doesNotMatch(read(f), /MedLuma|tagline/, f);
});

test('legal documents carry the configured name, stay DRAFT, and say the name is provisional', () => {
  for (const d of LEGAL_DOCUMENTS) {
    assert.equal(d.status, 'DRAFT');
    assert.ok(d.title.endsWith(BRAND.productName), d.title);
    assert.match(d.text, /provisional working name/);
    assert.doesNotMatch(d.text, /\{\{PRODUCT_NAME\}\}|Rx Recall Check/);
  }
});

test('brand wording obeys the claims policy (tagline and labels contain no prohibited claim)', () => {
  for (const t of [BRAND.tagline, COPY.app.provisionalName, COPY.app.devBanner, BRAND.features.recallCheck]) {
    let x = t;
    for (const r of REVIEWED_NEGATED_STATEMENTS) x = x.split(r).join('');
    assert.doesNotMatch(x, /\bsafe\b|verified|approved|guarantee|trusted|certified|accurate/i, t);
  }
  assert.match(COPY.app.devBanner, /evaluation prototype/i);
  assert.match(COPY.app.devBanner, /Not clinically validated/);
  assert.ok(allCopyStrings().includes(COPY.app.provisionalName));
});

test('release gate: a provisional or conflicted name is a pilot blocker; only counsel clearance removes it', () => {
  const base = { catalogStatus: 'APPROVED', policyStatus: 'APPROVED', legalDocuments: [], signoffs: {}, encryptionVerifiedOnDevice: true };
  assert.ok(pilotBlockers({ ...base, brandNameStatus: 'PROVISIONAL_CONFLICTS_FOUND' }).some((b) => b.includes('product name')));
  assert.ok(!pilotBlockers({ ...base, brandNameStatus: 'CLEARED_BY_COUNSEL' }).some((b) => b.includes('product name')));
  assert.ok(releaseGate().some((b) => b.includes('product name is PROVISIONAL_CONFLICTS_FOUND')));
});
