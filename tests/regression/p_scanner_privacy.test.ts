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
  assert.match(MODULE, /catch \(ActivityNotFoundException e\) \{\s*cleanUpFailedLaunch/);
  assert.match(MODULE, /private void cleanUpFailedLaunch[\s\S]*?deletePhoto\(f\)/);
});
