/**
 * Static checks on mobile/src (Task 2 acceptance: "no I/O imports in rules/ or state/"):
 *  - models/, rules/, state/, engine/ import nothing outside mobile/src and no Node/RN/network APIs;
 *  - models/ imports only models/; state/ imports only models/; rules/ never imports state/ or engine/;
 *  - no backend, telemetry, analytics or language-model dependency anywhere in the library;
 *  - no manufacturing-facility / provenance code in the library (out of scope for v0.1);
 *  - task-2 fixtures are real captures with provenance metadata.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from '../helpers/fixtures.ts';

const SRC = join(ROOT, 'mobile', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const sources = files(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, 'utf8') }));
const importsOf = (text: string) => [...text.matchAll(/^\s*(?:import|export)[^'";]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] as string);

// The Node-only SQLite driver (tests and command-line integration) is the one module allowed to
// import Node built-ins; nothing in the app imports it.
const NODE_ONLY = 'storage/drivers/nodeSqlite.ts';

test('the Node-only SQLite driver is imported by no library module', () => {
  for (const s of sources) for (const imp of importsOf(s.text)) assert.ok(!imp.endsWith('nodeSqlite.ts'), `${s.path} imports the Node-only driver`);
});

test('library modules import only relative paths inside mobile/src (no Node, RN, network or storage packages)', () => {
  assert.ok(sources.length >= 15);
  for (const s of sources.filter((x) => x.path !== NODE_ONLY)) {
    for (const imp of importsOf(s.text)) {
      assert.ok(imp.startsWith('./') || imp.startsWith('../'), `${s.path} imports package "${imp}"`);
      assert.ok(!relative(SRC, join(SRC, s.path, '..', imp)).startsWith('..'), `${s.path} imports outside mobile/src: ${imp}`);
    }
  }
});

test('layering: fsm → nothing; models → nothing; state → models/fsm; rules → models/rules; engine → anything in the library', () => {
  for (const s of sources) {
    const layer = s.path.split('/')[0];
    for (const imp of importsOf(s.text)) {
      const target = relative(SRC, join(SRC, s.path, '..', imp)).split('/')[0];
      if (layer === 'fsm') assert.equal(target, 'fsm', `${s.path} → ${imp} (the generic core must stay app-independent)`);
      if (layer === 'models') assert.equal(target, 'models', `${s.path} → ${imp}`);
      if (layer === 'state') assert.ok(target === 'models' || target === 'fsm', `${s.path} → ${imp}`);
      if (layer === 'rules') assert.ok(target === 'models' || target === 'rules', `${s.path} → ${imp}`);
      if (layer === 'services') assert.ok(['models', 'rules', 'services', 'engine', 'state'].includes(target ?? ''), `${s.path} → ${imp}`);
      if (layer === 'storage') assert.ok(['models', 'rules', 'storage', 'services', 'state'].includes(target ?? ''), `${s.path} → ${imp}`);
      // Task 4C: the scanner reads text and barcodes only; it never touches network, storage or state.
      if (layer === 'scanner') assert.ok(['models', 'rules', 'scanner'].includes(target ?? ''), `${s.path} → ${imp}`);
    }
  }
});

test('no I/O, timers, randomness or global clock in models/, rules/ or state/', () => {
  const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /\bprocess\./, /\brequire\s*\(/, /setTimeout|setInterval/, /Math\.random/, /Date\.now|new Date\(/, /localStorage|AsyncStorage|sqlite/i, /console\./];
  for (const s of sources.filter((x) => /^(models|rules|state|fsm|scanner)\//.test(x.path))) {
    for (const b of banned) assert.ok(!b.test(s.text), `${s.path} matches ${b}`);
  }
});

test('no network call outside services/ (and there only through the injected fetch)', () => {
  for (const s of sources) {
    if (/\bfetch\s*\(/.test(s.text)) assert.ok(s.path === 'services/transport.ts', `${s.path} calls fetch`);
    assert.doesNotMatch(s.text, /XMLHttpRequest|WebSocket/, s.path);
  }
});

test('no backend, telemetry, analytics or language-model references in the library', () => {
  const banned = /firebase|supabase|sentry|amplitude|mixpanel|segment\.io|analytics\(|openai|anthropic|llm|gpt-|telemetry\(/i;
  for (const s of sources) assert.ok(!banned.test(s.text), s.path);
});

test('no manufacturing-provenance logic in the library (removed from MVP scope)', () => {
  // Code only: comments may (and do) state that such data is NOT read.
  const banned = /establishment|C43360|MANUFACTURE\b|facility[A-Z_a-z]*\s*[:=(]|inspection|FEI\b|DUNS/i;
  const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const s of sources) assert.ok(!banned.test(code(s.text)), s.path);
});

test('every task-2 fixture records its live source, query URL and capture time; INDEX lists them all', () => {
  const dir = join(ROOT, 'tests', 'fixtures', 'task2');
  const names = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'INDEX.json');
  const index = JSON.parse(readFileSync(join(dir, 'INDEX.json'), 'utf8')) as { fixtures: { name: string }[] };
  assert.deepEqual(index.fixtures.map((f) => `${f.name}.json`).sort(), [...names].sort());
  for (const n of names) {
    const f = JSON.parse(readFileSync(join(dir, n), 'utf8'));
    assert.match(f._fixture.source, /^live public openFDA response/, n);
    assert.match(f._fixture.url, /^https:\/\/api\.fda\.gov\/drug\/(enforcement|ndc)\.json\?/, n);
    assert.ok(!Number.isNaN(Date.parse(f._fixture.capturedAt)), n);
    assert.equal(typeof f.http.status, 'number', n);
  }
});

// ---------------------------------------------------------------- React Native app (Task 4A, cross-platform)

const APP = join(ROOT, 'mobile', 'app');
const appFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? appFiles(p) : /\.tsx?$/.test(p) ? [p] : [];
  });

test('mobile/app: native modules are imported only by the platform adapter; screens use the platform-neutral interface', () => {
  const NATIVE = /^(@op-engineering\/op-sqlite|react-native-keychain|react-native-get-random-values)$/;
  const files = appFiles(APP).map((p) => ({ path: relative(APP, p), text: readFileSync(p, 'utf8') }));
  assert.ok(files.length >= 10);
  for (const f of files) {
    for (const imp of importsOf(f.text)) {
      if (NATIVE.test(imp)) assert.equal(f.path, join('platform', 'native.ts'), `${f.path} imports native module ${imp}`);
      // Shared code is reached through mobile/src only; no Node built-ins or the Node-only driver.
      assert.ok(!imp.startsWith('node:') && !imp.endsWith('nodeSqlite.ts'), `${f.path} → ${imp}`);
      // No Android-only or iOS-only JavaScript APIs in screens.
      assert.doesNotMatch(imp, /ToastAndroid|ActionSheetIOS|PermissionsAndroid/, f.path);
    }
    assert.doesNotMatch(f.text, /ToastAndroid|ActionSheetIOS|PermissionsAndroid|BackHandler\.exitApp/, f.path);
    assert.doesNotMatch(f.text, /firebase|sentry|amplitude|mixpanel|analytics|crashlytics|admob/i, f.path);
  }
});

test('mobile/package.json: no analytics, crash-reporting, advertising or backend dependency', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'mobile', 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  for (const d of deps) assert.doesNotMatch(d, /firebase|sentry|bugsnag|amplitude|mixpanel|segment|analytics|crashlytics|admob|ads|supabase|onesignal|appcenter/i, d);
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@op-engineering/op-sqlite', 'react', 'react-native', 'react-native-get-random-values', 'react-native-keychain', 'react-native-safe-area-context']);
  for (const v of Object.values(pkg.dependencies)) assert.match(v, /^\d+\.\d+\.\d+$/, 'exact versions only');
});

test('Android manifest: only the INTERNET permission, backup disabled, cleartext disabled', () => {
  const m = readFileSync(join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  const perms = [...m.matchAll(/<uses-permission android:name="([^"]+)"(?![^>]*tools:node="remove")/g)].map((x) => x[1]);
  assert.deepEqual(perms, ['android.permission.INTERNET']);
  assert.match(m, /android:allowBackup="false"/);
  assert.match(m, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(m, /android:usesCleartextTraffic="false"/);
});

test('Android build: universal and ARM64-only APKs, explicit CPU filter (no partial x86 set), compressed native libraries', () => {
  const g = readFileSync(join(ROOT, 'mobile', 'android', 'app', 'build.gradle'), 'utf8');
  assert.match(g, /abiFilters\.addAll\(\(project\.findProperty\("reactNativeArchitectures"\)/);
  assert.match(g, /useLegacyPackaging true/);
  const sh = readFileSync(join(ROOT, 'scripts', 'android_build.sh'), 'utf8');
  assert.match(sh, /-universal\.apk/);
  assert.match(sh, /-PreactNativeArchitectures=arm64-v8a/);
  const archs = /^reactNativeArchitectures=(.+)$/m.exec(readFileSync(join(ROOT, 'mobile', 'android', 'gradle.properties'), 'utf8'))?.[1]?.split(',') ?? [];
  assert.deepEqual(archs.sort(), ['arm64-v8a', 'armeabi-v7a', 'x86_64']);
  assert.doesNotMatch(g, /minifyEnabled true/, 'R8 stays off until verified on a device');
});

test('scanner dependencies (Task 4C): no ML Kit or analytics; ONNX Runtime pinned below its telemetry; privacy gate in the build', () => {
  const g = readFileSync(join(ROOT, 'mobile', 'android', 'app', 'build.gradle'), 'utf8');
  assert.match(g, /onnxruntime-android:1\.28\.0"/, 'ONNX Runtime >= 1.29.0 ships Microsoft 1DS telemetry');
  assert.match(g, /io\.github\.zxing-cpp:android:3\.1\.1"/);
  assert.doesNotMatch(g, /mlkit|play-services-mlkit|firebase|crashlytics|analytics/i);
  const m = readFileSync(join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  assert.match(m, /android\.permission\.CAMERA" tools:node="remove"/, 'photos come from the camera app; the app holds no camera permission');
  assert.match(m, /ACCESS_NETWORK_STATE" tools:node="remove"/);
  assert.match(m, /ai\.onnxruntime\.TelemetryInitializer"[^>]*tools:node="remove"/);
  assert.match(m, /android:authorities="\$\{applicationId\}\.scanprovider"\s+android:exported="false"/);
  const sh = readFileSync(join(ROOT, 'scripts', 'android_build.sh'), 'utf8');
  assert.match(sh, /PRIVACY GATE: unexpected permissions/);
  assert.match(sh, /ai\/onnxruntime\/telemetry/);
  const mod = readFileSync(join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'java', 'org', 'rxrecallcheck', 'app', 'scanner', 'RxScannerModule.java'), 'utf8');
  assert.doesNotMatch(mod, /java\.net|HttpURLConnection|okhttp|Log\.(d|i|v|w|e)\(/, 'scanner module: no network, no logging');
  assert.match(mod, /deleteQuietly\(f\)/);
});

test('scanner native module (Pixel defect, build 4): barcode read gets a non-null crop rectangle; text and barcodes fail independently', () => {
  const mod = readFileSync(join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'java', 'org', 'rxrecallcheck', 'app', 'scanner', 'RxScannerModule.java'), 'utf8');
  // zxingcpp.BarcodeReader.read(Bitmap, Rect, int) is Kotlin with a non-null Rect: null threw on every scan.
  assert.doesNotMatch(mod, /\.read\(\s*bmp\s*,\s*null/);
  assert.match(mod, /\.read\(bmp, new Rect\(0, 0, img\.width, img\.height\), 0\)/);
  assert.match(mod, /TEXT_FAILED/);
  assert.match(mod, /BARCODE_FAILED/);
  assert.match(mod, /p\.reject\("SCAN_FAILED", describe\(e\)\)/, 'failures carry a technical description for development diagnostics');
});

test('scanner OCR dictionary (Pixel defect, build 5): read from the model file, size checked against the model', () => {
  const dir = join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'java', 'org', 'rxrecallcheck', 'app', 'scanner');
  const mod = readFileSync(join(dir, 'RxScannerModule.java'), 'utf8');
  const core = readFileSync(join(dir, 'core', 'PpOcr.java'), 'utf8');
  // ONNX Runtime's metadata API returned an unusable dictionary on the phone (and drops a 4-byte
  // character on desktop), so every line decoded empty and the scan showed "0 text lines".
  assert.doesNotMatch(mod, /dictionaryFromMetadata/);
  assert.match(mod, /PpOcr\.dictionaryFromModelBytes\(rec\)/);
  assert.match(core, /does not fit model classes/, 'a dictionary/model mismatch fails loudly instead of returning no text');
  assert.match(mod, /ocr\/ppocrv4_det_w8\.onnx/);
  assert.match(mod, /ocr\/ppocrv4_rec_latin\.onnx/);
  const fetch = readFileSync(join(ROOT, 'scripts', 'fetch_ocr_models.sh'), 'utf8');
  assert.match(fetch, /rapidocr_onnxruntime-1\.4\.4-py3-none-any\.whl/);
});

test('scanner models (build 8): shrunk deterministically from pinned sources, outputs pinned by SHA-256', () => {
  const fetch = readFileSync(join(ROOT, 'scripts', 'fetch_ocr_models.sh'), 'utf8');
  const opt = readFileSync(join(ROOT, 'scripts', 'optimize_ocr_models.py'), 'utf8');
  for (const v of ['WHEEL_SHA', 'SRC_DET_SHA', 'SRC_REC_SHA', 'DET_SHA', 'REC_SHA']) assert.match(fetch, new RegExp(`${v}="[0-9a-f]{64}"`), v);
  assert.match(fetch, /PY_PINS="onnx==[\d.]+ numpy==[\d.]+"/, 'tool versions pinned');
  assert.match(fetch, /--only-binary=:all:/);
  assert.match(fetch, /check "\$DEST\/\$DET" "\$DET_SHA"/);
  assert.match(fetch, /check "\$DEST\/\$REC" "\$REC_SHA"/);
  // The recognizer keeps the characters of US labels; quantizing all of it misread the real vial.
  assert.match(opt, /KEEP = \[chr\(c\) for c in range\(33, 127\)\]/);
  assert.match(opt, /REC_MIN_ELEMENTS = 200_000/);
  // No opset change (opset 12 Squeeze/Reduce semantics); dequantization by Cast + Mul.
  assert.doesNotMatch(opt, /imp\.version\s*=/);
  assert.doesNotMatch(opt, /"DequantizeLinear"/);
});
