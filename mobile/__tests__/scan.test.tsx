/**
 * Task 4C scan-first UI flows on the real screens. The native scanner is replaced by a fake that
 * returns the REAL outputs of the app's OCR core and ZXing-cpp on SYNTHETIC labels
 * (tests/fixtures/scanner/ocr_lab.json). Network answers are recorded real responses
 * (tests/fixtures/scanner/cassette.json, tests/fixtures/task3/cassette.json).
 */
import React from 'react';
import { Switch, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { App } from '../app/AppRoot.tsx';
import type { PlatformServices } from '../app/platform/types.ts';
import type { ScanOutput } from '../src/scanner/readScan.ts';
import { memoryConsentStore } from '../src/legal/consent.ts';
import { COPY, REVIEWED_NEGATED_STATEMENTS } from '../src/copy/en.ts';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

type Entry = { status: number; headers: Record<string, string>; bodyText: string };
const entries: Record<string, Entry> = {
  ...(require('../../tests/fixtures/task3/cassette.json') as { entries: Record<string, Entry> }).entries,
  ...(require('../../tests/fixtures/scanner/cassette.json') as { entries: Record<string, Entry> }).entries,
};
const lab = require('../../tests/fixtures/scanner/ocr_lab.json') as { labels: { file: string; ocr_lines: { text: string; score: number }[]; barcodes: { format: string; text: string; symbology: string | null }[] }[] };
const label = (prefix: string): ScanOutput => {
  const l = lab.labels.find((x) => x.file.startsWith(prefix))!;
  return { lines: l.ocr_lines, barcodes: l.barcodes, timings: { ocrMs: 500, barcodeMs: 50, totalMs: 600 } };
};

function platform(results: (ScanOutput | null | Error)[]): PlatformServices & { requests: string[]; scans: number } {
  const p = {
    requests: [] as string[],
    scans: 0,
    os: 'android',
    transport: {
      async get(url: string) {
        p.requests.push(url);
        const e = entries[url];
        if (!e) throw new Error(`UNRECORDED request: ${url}`);
        return { status: e.status, headers: e.headers, bodyText: e.bodyText };
      },
    },
    randomBytes: (n: number) => new Uint8Array(n),
    keyStore: { getOrCreateKey: async () => 'k'.repeat(64), deleteKey: async () => undefined },
    openEncryptedDatabase: async () => {
      throw new Error('not in development builds');
    },
    encryptionSelfTest: async () => ({ passed: true, ranAt: '', steps: [] }),
    openUrl: async () => undefined,
    scanner: {
      scanLabel: async () => {
        const r = results[p.scans++];
        if (r instanceof Error) throw r;
        return r ?? null;
      },
    },
  };
  return p;
}

beforeAll(() => jest.useFakeTimers({ now: new Date('2026-11-12T12:05:00.000Z'), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'] }));
afterAll(() => jest.useRealTimers());

const flush = async () => {
  for (let i = 0; i < 40; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};
function allText(r: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object' && 'children' in n) walk((n as { children: unknown }).children);
  };
  walk(r.toJSON());
  return out.join('\n');
}
const textOf = (n: ReactTestInstance): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
async function press(r: ReactTestRenderer, label: string) {
  const hits = r.root.findAll((n) => typeof n.props.onPress === 'function' && (n.props.accessibilityRole === 'button' || n.props.accessibilityRole === 'link') && textOf(n).includes(label));
  if (hits.length === 0) throw new Error(`no button "${label}" on screen:\n${allText(r)}`);
  await act(async () => hits[hits.length - 1]!.props.onPress());
  await flush();
}
async function start(p: PlatformServices) {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<App platform={p} consent={memoryConsentStore()} />);
  });
  await flush();
  await press(r, COPY.firstLaunch.acknowledge);
  return r;
}
async function confirmAll(r: ReactTestRenderer) {
  const skip = new Set<string>([COPY.confirm.lotNotUsed, COPY.confirm.releaseUnknown]);
  for (const s of r.root.findAllByType(Switch)) if (!/release|regular/i.test(String(s.props.accessibilityLabel)) && !skip.has(s.props.accessibilityLabel)) await act(async () => s.props.onValueChange(true));
  const reg = r.root.findAllByType(Switch).find((s) => s.props.accessibilityLabel === COPY.confirm.releaseIR);
  if (reg) await act(async () => reg.props.onValueChange(true));
  await press(r, COPY.confirm.confirmAll);
}
function noProhibited(t: string) {
  let x = t;
  for (const s of REVIEWED_NEGATED_STATEMENTS) x = x.split(s).join('');
  expect(x).not.toMatch(/\bsafe\b|recall[- ]free|guarantee|fda[- ]verified|all clear|no issues/i);
}

test('scan is the primary action; typing is offered as a fallback', async () => {
  const r = await start(platform([]));
  const t = allText(r);
  expect(t).toContain(COPY.scan.button);
  expect(t).toContain(COPY.scan.typeInstead);
  expect(t).toContain(COPY.scan.privacy);
  expect(t).not.toContain(COPY.entry.ndcLabel);
});

test('pharmacy label photo → product matched in FDA records without typing → three groups → recall result', async () => {
  const p = platform([label('01_')]);
  const r = await start(p);
  await press(r, COPY.scan.button);
  let t = allText(r);
  expect(t).toContain(COPY.confirm.title);
  expect(t).toContain(COPY.scan.scannedNote);
  expect(t).toContain(COPY.scan.groups.VERIFIED);
  expect(t).toContain('62756-142-02');
  expect(t).toContain(COPY.evidence.VERIFIED_SOURCE);
  expect(t).toContain(COPY.scan.groups.NEEDS_INPUT); // lot not on a pharmacy label
  expect(t).toContain(COPY.scan.details); // development diagnostics
  await confirmAll(r);
  t = allText(r);
  expect(t).toContain(COPY.result.POTENTIAL.headline);
  expect(t).toContain(COPY.result.qualifiers.lotNotProvided);
  noProhibited(t);
  // Privacy: the synthetic Rx number and patient name were never sent.
  const sent = p.requests.join('\n').toUpperCase();
  expect(sent).not.toMatch(/RX#|EXAMPLE|PLACEHOLDER|SYNTHETIC/);
});

test('stock bottle with a printed lot → lot read from the label, confirmed by the user → recall match found', async () => {
  const r = await start(platform([label('23_')]));
  await press(r, COPY.scan.button);
  let t = allText(r);
  expect(t).toContain('JKU4639A');
  expect(t).toContain(COPY.evidence.SCANNED); // lot: read from your label, not confirmed yet
  await confirmAll(r);
  t = allText(r);
  expect(t).toContain(COPY.result.CONFIRMED.headline);
  expect(t).toContain('D-0325-2021');
});

test('label without an NDC → fields shown as read from the label, never as FDA-verified', async () => {
  const r = await start(platform([label('21_')]));
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.scan.groups.READ_OR_ENTERED);
  expect(t).toContain(COPY.evidence.SCANNED);
  expect(t).not.toContain(COPY.evidence.VERIFIED_SOURCE);
});

test('excluded medication scanned → no recall check', async () => {
  const r = await start(platform([label('07_')]));
  await press(r, COPY.scan.button);
  expect(allText(r)).toContain(COPY.notAssessed.EXCLUDED.headline);
});

test('cancelled photo → back to scan with a short notice', async () => {
  const r = await start(platform([null]));
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.scan.cancelled);
  expect(t).toContain(COPY.scan.button);
});

test('nothing readable → explains and offers rescan or typing; never a result', async () => {
  const r = await start(platform([{ lines: [], barcodes: [] }, label('01_')]));
  await press(r, COPY.scan.button);
  let t = allText(r);
  expect(t).toContain(COPY.scan.problemTitle);
  expect(t).toContain(COPY.scan.nothingRead);
  expect(t).not.toMatch(/No matching recall/);
  await press(r, COPY.scan.rescan);
  t = allText(r);
  expect(t).toContain(COPY.confirm.title);
});

test('scanner failure → problem screen, never a result', async () => {
  const r = await start(platform([new Error('native failure')]));
  await press(r, COPY.scan.button);
  expect(allText(r)).toContain(COPY.scan.failed);
});

test('"Correct the details" opens the form prefilled with what was read (manual fallback)', async () => {
  const r = await start(platform([label('01_')]));
  await press(r, COPY.scan.button);
  await press(r, COPY.scan.correct);
  const field = (lab: string) => r.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === lab)[0]!.props.value;
  expect(field(COPY.entry.ndcLabel)).toBe('62756-0142-02'); // as printed on this label (11-digit pharmacy format)
  expect(field(COPY.entry.nameLabel)).toBe('METFORMIN HCL ER');
  expect(field(COPY.entry.strengthLabel)).toBe('500 MG');
});

test('type instead from the scan screen shows the manual form', async () => {
  const r = await start(platform([]));
  await press(r, COPY.scan.typeInstead);
  expect(allText(r)).toContain(COPY.entry.submit);
});

test('native failure (as seen on the Pixel, build 4): development build shows the technical cause; card says nothing was checked', async () => {
  const err = Object.assign(new Error("NullPointerException: Parameter specified as non-null is null: method zxingcpp.BarcodeReader.read, parameter cropRect at zxingcpp.BarcodeReader.read:0"), { code: 'SCAN_FAILED' });
  const r = await start(platform([err]));
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.scan.failed);
  expect(t).toContain(COPY.scan.nothingChecked);
  expect(t).not.toMatch(/^RESULT$/m);
  expect(t).toContain(`${COPY.scan.technical}: SCAN_FAILED: NullPointerException`);
});

test('partial native failure (barcodes failed, text read): the scan still proceeds with the text', async () => {
  const out = { ...label('01_'), barcodes: [], warnings: ['BARCODE_FAILED: SomeError'] };
  const r = await start(platform([out]));
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.confirm.title);
  expect(t).toContain('62756-142-02');
  expect(t).toContain('BARCODE_FAILED');
});

test('build 5 on the Pixel ("0 text lines"): the development detail shows OCR counts', async () => {
  const r = await start(platform([{ lines: [], barcodes: [{ format: 'CODE_128', text: 'SYN12345', symbology: ']C0' }], ocrStats: { regions: 13, droppedEmpty: 13, droppedLowScore: 0, dictionary: 6623 } }]));
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.scan.nothingRead); // exactly what build 5 showed on the phone
  expect(t).toContain('text regions 13 (empty 13, unclear 0); dictionary 6623');
});

test('real vial photo, drug line only ("AMLODIPINEMGTA"): name is prefilled, strength and form are asked for; nothing checked', async () => {
  const p = platform([{ lines: [{ text: 'AMLODIPINEMGTA', score: 0.84 }, { text: 'Qty:90', score: 0.9 }], barcodes: [] }]);
  const r = await start(p);
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.scan.partialRead);
  const field = (lab: string) => r.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === lab)[0]!.props.value;
  expect(field(COPY.entry.nameLabel)).toBe('AMLODIPINE');
  expect(field(COPY.entry.strengthLabel)).toBe('');
  expect(t).not.toMatch(/No matching recall|Recall match found|Possible recall match/);
});
