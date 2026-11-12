/**
 * Versioning (Task 4A.2): one source (config/app_version.json) for the version and build number in
 * the app, the Android APK and the iOS project; every build gets a new, increasing build number.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildVersionModule, readVersion, withIosVersion } from '../../scripts/bundle_version.ts';
import { APP_VERSION, BUILD_NUMBER } from '../../mobile/src/app/version.ts';
import { profileFor } from '../../mobile/src/app/buildProfile.ts';
import { COPY } from '../../mobile/src/copy/en.ts';
import { ROOT } from '../helpers/fixtures.ts';

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

test('generated version module and iOS project match config/app_version.json (run `npm run version:bundle`)', () => {
  const v = readVersion();
  assert.equal(read('mobile', 'src', 'app', 'version.ts'), buildVersionModule(v));
  const pbx = read('mobile', 'ios', 'RxRecallCheck.xcodeproj', 'project.pbxproj');
  assert.equal(withIosVersion(pbx, v), pbx);
  assert.equal(APP_VERSION, v.version);
  assert.equal(BUILD_NUMBER, v.build_number);
});

test('Android versionCode and versionName come from config/app_version.json', () => {
  const g = read('mobile', 'android', 'app', 'build.gradle');
  assert.match(g, /versionCode versionJson\.build_number/);
  assert.match(g, /versionName versionJson\.version/);
  assert.doesNotMatch(g, /versionCode \d/);
});

test('build numbers increase and earlier builds are recorded with their checksums', () => {
  const v = readVersion();
  const nums = v.history.map((h) => h.build_number);
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
  assert.ok(v.build_number >= 3, 'builds 1 (Task 4A) and 2 (Task 4A.1) already exist');
  assert.equal(v.history.find((h) => h.build_number === 1)?.apk_sha256, '648e9c07b4598ea570d22cefd11c5b9ff983bc56392cfb16f6ad9748fa00de11');
  assert.equal(v.history.find((h) => h.build_number === 2)?.apk_sha256, '0718180fb5a107c0fb99bf6cc2ffde256c1b9a81a35b9380f44fe97bec2b3907');
});

test('the app shows version and build number', () => {
  const p = profileFor('development', false);
  assert.equal(p.buildNumber, BUILD_NUMBER);
  assert.match(COPY.about.version(p.appVersion, p.buildNumber, p.label), new RegExp(`version ${APP_VERSION.replace(/\./g, '\\.')} \\(build ${BUILD_NUMBER}\\)`));
});
