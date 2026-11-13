/**
 * Review item 8: scanner image retention and the external camera trust boundary. The photo is taken
 * by the phone's camera app (ACTION_IMAGE_CAPTURE), written to the app's private cache, read, and
 * deleted. Patient copy and the privacy document must say exactly that and nothing stronger; the
 * native module must check deletion, revoke the camera app's access and clean up on every path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COPY } from '../../mobile/src/copy/en.ts';
import { ROOT } from '../helpers/fixtures.ts';

const MODULE = readFileSync(join(ROOT, 'mobile/android/app/src/main/java/org/rxrecallcheck/app/scanner/RxScannerModule.java'), 'utf8');
const PRIVACY = readFileSync(join(ROOT, 'docs/PRIVACY.md'), 'utf8');

test('item 8: patient copy does not promise more than the app controls (the camera app is outside it)', () => {
  for (const t of [COPY.scan.privacy, COPY.firstLaunch.points.find((x) => /scan a label/i.test(x)) ?? '']) {
    assert.doesNotMatch(t, /never (uploaded or )?saved to your photos|only in memory|never stored/i, t);
    assert.match(t, /camera app/i, t);
  }
});

test('item 8: the privacy document does not claim photos are never written to storage', () => {
  assert.doesNotMatch(PRIVACY, /Images are not written to disk/);
  assert.match(PRIVACY, /camera app.*own copy|own copy.*camera app/is);
});

test('item 8: the native module checks deletion, revokes the camera app grant and cleans up on launch failure', () => {
  assert.match(MODULE, /revokeUriPermission/);
  assert.doesNotMatch(MODULE, /private static void deleteQuietly/, 'deletion results are checked, not ignored');
  assert.match(MODULE, /catch \(ActivityNotFoundException e\) \{\s*rejectWithPhoto\([^;]*cleanUpFailedLaunch\(activity\)[^;]*\);/);
  assert.match(MODULE, /private boolean cleanUpFailedLaunch[\s\S]*?return deletePhoto\(f\)/);
});

test('R2-5: every photo cleanup result is used by its caller (no ignored deletePhoto/cleanup call)', () => {
  const bare = MODULE.split('\n').filter((l) => /^\s*(deletePhoto|cleanUpFailedLaunch|clearScanCache)\(/.test(l));
  assert.deepEqual(bare, [], 'cleanup called as a bare statement: its failure would be ignored');
  assert.match(MODULE, /putBoolean\("photoDeleted"/);
  assert.match(MODULE, /photoDeleted/);
});

test('R3: every reported cleanup outcome includes outstanding leftovers, not only the current photo', () => {
  // Each place the module reports photoDeleted to the app must also account for leftoverRemaining.
  const reports = MODULE.split('\n').filter((l) => /rejectWithPhoto\(|putBoolean\("photoDeleted"/.test(l) && !/private static void rejectWithPhoto|info\.putBoolean\("photoDeleted", photoDeleted\)/.test(l));
  assert.ok(reports.length >= 6, `found ${reports.length} report sites`);
  const cancelBlock = MODULE.slice(MODULE.indexOf('// Cancelled:'), MODULE.indexOf('worker.execute'));
  for (const l of reports) {
    const ok = /leftoverRemaining|\bgone\b|putBoolean\("photoDeleted", false\)/.test(l);
    assert.ok(ok, `report ignores leftovers: ${l.trim()}`);
  }
  assert.match(MODULE, /final boolean gone = deletePhoto\(f\) && !leftoverRemaining;/);
  assert.match(cancelBlock, /deletePhoto\(f\) && !leftoverRemaining/);
});
