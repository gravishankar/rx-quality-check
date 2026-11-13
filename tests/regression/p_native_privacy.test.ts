/**
 * Review item 9: native privacy claims. What can be checked without a device is pinned here; what
 * needs a device is listed in docs/CORRECTNESS_FINDINGS.md §5 and stays unverified.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../helpers/fixtures.ts';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

test('item 9: no console or Android log calls anywhere in app code (release logs carry no label or medication data)', () => {
  const files = [...walk(join(ROOT, 'mobile/src')), ...walk(join(ROOT, 'mobile/app')), ...walk(join(ROOT, 'mobile/android/app/src/main/java'))].filter((f) => /\.(ts|tsx|java|kt)$/.test(f));
  assert.ok(files.length > 50);
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /console\.(log|warn|error|info|debug)|android\.util\.Log|\bLog\.[dewiv]\(/, f);
});

test('item 9: cloud backup and device transfer exclude every app data domain', () => {
  const x = readFileSync(join(ROOT, 'mobile/android/app/src/main/res/xml/data_extraction_rules.xml'), 'utf8');
  for (const section of ['cloud-backup', 'device-transfer']) {
    const body = x.split(`<${section}>`)[1]?.split(`</${section}>`)[0] ?? '';
    for (const d of ['root', 'file', 'database', 'sharedpref', 'external']) assert.match(body, new RegExp(`<exclude domain="${d}" path="\\."`), `${section} ${d}`);
  }
  assert.match(readFileSync(join(ROOT, 'mobile/android/app/src/main/AndroidManifest.xml'), 'utf8'), /android:fullBackupContent="false"/);
});

test('item 9: the transport asks for no cookies or credentials and refuses redirects (native honoring is a device check)', () => {
  const t = readFileSync(join(ROOT, 'mobile/src/services/transport.ts'), 'utf8');
  assert.match(t, /credentials: 'omit'/);
  assert.match(t, /redirect: 'error'/);
});
