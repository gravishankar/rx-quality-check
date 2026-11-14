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

// ---------------------------------------------------------------------------------------------
// Review items 10-11, explicit choices (no happy-path helper): every lot or release choice below is
// made by name, and the unchosen alternative is checked to be off.
// ---------------------------------------------------------------------------------------------
const LOT_AND_RELEASE = new Set<string>([COPY.confirm.lotNotUsed, COPY.confirm.releaseUnknown, COPY.confirm.releaseIR, COPY.confirm.releaseER, COPY.confirm.releaseDR]);
const switches = (r: ReactTestRenderer) => r.root.findAllByType(Switch);
const sw = (r: ReactTestRenderer, label: string) => switches(r).find((s) => s.props.accessibilityLabel === label);
const isLotUse = (l: unknown) => typeof l === 'string' && l.startsWith('Use lot ');
/** Tick only the identity items (each "matches my label" statement); never a lot or release choice. */
async function tickIdentityItems(r: ReactTestRenderer) {
  for (const s of switches(r)) if (!LOT_AND_RELEASE.has(s.props.accessibilityLabel) && !isLotUse(s.props.accessibilityLabel)) await act(async () => s.props.onValueChange(true));
}
const setSwitch = async (r: ReactTestRenderer, label: string, on: boolean) => {
  const s = sw(r, label);
  if (!s) throw new Error(`no switch "${label}":\n${allText(r)}`);
  await act(async () => s.props.onValueChange(on));
};
const confirmEnabled = (r: ReactTestRenderer) => {
  const b = r.root.findAll((n) => typeof n.props.onPress === 'function' && n.props.accessibilityRole === 'button' && textOf(n).includes(COPY.confirm.confirmAll));
  return b.length > 0 && !b[b.length - 1]!.props.disabled;
};

test('explicit: scanned lot, "continue without the lot" → check runs without it (possible match, never confirmed); the lot is never sent', async () => {
  const p = platform([label('23_')]);
  const r = await start(p);
  await press(r, COPY.scan.button);
  await tickIdentityItems(r);
  expect(confirmEnabled(r)).toBe(false);
  expect(allText(r)).toContain(COPY.confirm.needLotChoice);
  await setSwitch(r, COPY.confirm.lotNotUsed, true);
  expect(sw(r, COPY.confirm.lotUse('JKU4639A'))?.props.value).toBe(false);
  expect(confirmEnabled(r)).toBe(true);
  await press(r, COPY.confirm.confirmAll);
  const t = allText(r);
  expect(t).toContain(COPY.result.POTENTIAL.headline);
  expect(t).not.toContain(COPY.result.CONFIRMED.headline);
  expect(t).toContain(COPY.result.qualifiers.lotNotProvided);
  expect(p.requests.join('\n')).not.toContain('JKU4639A');
});

test('explicit: lot choices are exclusive, and changing your mind is honoured (not used → use → confirmed match)', async () => {
  const r = await start(platform([label('23_')]));
  await press(r, COPY.scan.button);
  await tickIdentityItems(r);
  await setSwitch(r, COPY.confirm.lotNotUsed, true);
  await setSwitch(r, COPY.confirm.lotUse('JKU4639A'), true);
  expect(sw(r, COPY.confirm.lotNotUsed)?.props.value).toBe(false);
  await setSwitch(r, COPY.confirm.lotUse('JKU4639A'), false);
  expect(confirmEnabled(r)).toBe(false); // un-choosing returns to "still needed"
  await setSwitch(r, COPY.confirm.lotUse('JKU4639A'), true);
  await press(r, COPY.confirm.confirmAll);
  expect(allText(r)).toContain(COPY.result.CONFIRMED.headline);
});

test('explicit: correcting the lot through "Correct the details" uses only the corrected lot, and asks again', async () => {
  const p = platform([label('23_')]);
  const r = await start(p);
  await press(r, COPY.scan.button);
  await setSwitch(r, COPY.confirm.lotUse('JKU4639A'), true);
  await press(r, COPY.scan.correct);
  const lotField = r.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === COPY.entry.lotLabel)[0]!;
  await act(async () => lotField.props.onChangeText('SYNTH999')); // SYNTHETIC corrected lot
  await press(r, COPY.entry.submit);
  const t = allText(r);
  expect(t).toContain('SYNTH999');
  expect(sw(r, COPY.confirm.lotUse('JKU4639A'))).toBeUndefined();
  expect(sw(r, COPY.confirm.lotUse('SYNTH999'))?.props.value).toBe(false); // earlier choice not carried over
  await tickIdentityItems(r);
  await setSwitch(r, COPY.confirm.lotUse('SYNTH999'), true);
  await press(r, COPY.confirm.confirmAll);
  const after = allText(r);
  expect(after).not.toContain(COPY.result.CONFIRMED.headline); // SYNTH999 is not a listed lot
  expect(after).toContain(COPY.result.POTENTIAL.headline);
  expect(p.requests.join('\n')).not.toMatch(/JKU4639A|SYNTH999/);
});

test('explicit: rescanning replaces the earlier label; an earlier lot choice never carries over', async () => {
  const p = platform([label('23_'), label('01_')]);
  const r = await start(p);
  await press(r, COPY.scan.button);
  await setSwitch(r, COPY.confirm.lotUse('JKU4639A'), true);
  await press(r, COPY.scan.rescan);
  const t = allText(r);
  expect(p.scans).toBe(2);
  expect(t).not.toContain('JKU4639A');
  expect(switches(r).some((s) => isLotUse(s.props.accessibilityLabel))).toBe(false); // pharmacy label: no lot
  await tickIdentityItems(r);
  await press(r, COPY.confirm.confirmAll);
  const after = allText(r);
  expect(after).toContain(COPY.result.POTENTIAL.headline);
  expect(after).toContain(COPY.result.qualifiers.lotNotProvided);
});

test('explicit: repeated confirmation — a press while something is missing does nothing; completing it runs exactly one check', async () => {
  const p = platform([label('23_')]);
  const r = await start(p);
  await press(r, COPY.scan.button);
  await tickIdentityItems(r);
  const before = p.requests.filter((u) => u.includes('enforcement')).length;
  const btn = () => r.root.findAll((n) => typeof n.props.onPress === 'function' && n.props.accessibilityRole === 'button' && textOf(n).includes(COPY.confirm.confirmAll)).pop()!;
  expect(btn().props.disabled).toBe(true);
  expect(p.requests.filter((u) => u.includes('enforcement')).length).toBe(before);
  await setSwitch(r, COPY.confirm.lotUse('JKU4639A'), true);
  const b = btn();
  await act(async () => {
    b.props.onPress();
    b.props.onPress(); // double tap
  });
  await flush();
  expect(allText(r)).toContain(COPY.result.CONFIRMED.headline);
  const controls = p.requests.filter((u) => u.includes('D-0325-2021') && u.includes('recall_number'));
  expect(controls.length).toBe(1); // one positive control → one recall check
});

// ---------------------------------------------------------------------------------------------
// Review round 2, issue 5: the native scanner reports when the label photo could not be removed
// (SYNTHETIC native results below); every caller path must tell the patient.
// ---------------------------------------------------------------------------------------------
const notDeleted = (out: ScanOutput): ScanOutput => ({ ...out, photoDeleted: false });

test('R2-5: photo not removed after a successful read → the patient is told, and the check continues', async () => {
  const r = await start(platform([notDeleted(label('01_'))]));
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.scan.photoNotDeleted);
  expect(t).toContain(COPY.confirm.title);
});

test('R2-5: photo not removed after a cancelled photo → told', async () => {
  const r = await start(platform([{ cancelled: true, photoDeleted: false } as never]));
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.scan.cancelled);
  expect(t).toContain(COPY.scan.photoNotDeleted);
});

test('R2-5: photo not removed when nothing could be read → told', async () => {
  const r = await start(platform([notDeleted({ lines: [], barcodes: [] })]));
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.scan.nothingRead);
  expect(t).toContain(COPY.scan.photoNotDeleted);
});

test('R2-5: photo not removed when the scanner fails → told', async () => {
  const r = await start(platform([Object.assign(new Error('SYNTHETIC'), { code: 'SCAN_FAILED', userInfo: { photoDeleted: false } })]));
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.scan.failed);
  expect(t).toContain(COPY.scan.photoNotDeleted);
});

test('R2-5 guard: a removed photo adds no notice', async () => {
  const r = await start(platform([{ ...label('01_'), photoDeleted: true }]));
  await press(r, COPY.scan.button);
  expect(allText(r)).not.toContain('could not be removed');
});

// ---------------------------------------------------------------------------------------------
// Review round 3 (R2-5 follow-up): the cleanup warning must survive every identification outcome.
// Scanner outputs are SYNTHETIC OCR lines; NDC Directory answers for the ambiguous case are SYNTHETIC
// copies of the real Sun metformin ER record with altered NDCs (as in tests/integration/workflow).
// ---------------------------------------------------------------------------------------------
const ocrOnly = (...lines: string[]): ScanOutput => ({ lines: lines.map((text) => ({ text, score: 0.99 })), barcodes: [], photoDeleted: false });
const ndcUrl = (n: string) => `https://api.fda.gov/drug/ndc.json?search=packaging.package_ndc%3A%22${n}%22&limit=10`;
function platformWith(results: (ScanOutput | Error)[], over: Record<string, Entry | 'THROW'>) {
  const p = platform(results);
  const inner = p.transport.get.bind(p.transport);
  p.transport = {
    async get(url: string, o?: unknown) {
      const x = over[url];
      if (x === 'THROW') {
        p.requests.push(url);
        throw new TypeError('Network request failed (SYNTHETIC)');
      }
      if (x) {
        p.requests.push(url);
        return x;
      }
      return inner(url, o as never);
    },
  } as typeof p.transport;
  return p;
}

test('R3: excluded medication (warfarin) → the cleanup warning is still shown', async () => {
  const r = await start(platform([ocrOnly('WARFARIN 5 MG TABLETS')]));
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.notAssessed.EXCLUDED.headline);
  expect(t).toContain(COPY.scan.photoNotDeleted);
});

test('R3: unsupported medication (metoprolol tartrate) → warning shown', async () => {
  const r = await start(platform([ocrOnly('METOPROLOL TARTRATE 25 MG TABLETS')]));
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.notAssessed.UNSUPPORTED.headline);
  expect(t).toContain(COPY.scan.photoNotDeleted);
});

test('R3: missing information (no strength read) → warning shown', async () => {
  const r = await start(platform([ocrOnly('METFORMIN HCL ER TABLETS')]));
  await press(r, COPY.scan.button);
  expect(allText(r)).toContain(COPY.scan.photoNotDeleted);
});

async function waitText(r: ReactTestRenderer, s: string, ms = 30_000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms && !allText(r).includes(s)) await act(async () => new Promise((res) => setTimeout(res, 200)));
}

test('R3: source error (FDA directory unreachable, after the engine\'s retries) → warning shown', async () => {
  const r = await start(platformWith([ocrOnly('NDC 62756-142-02', 'METFORMIN HCL ER 500 MG TABLET')], { [ndcUrl('62756-142-02')]: 'THROW' }));
  await press(r, COPY.scan.button);
  await waitText(r, COPY.errors.sourceUnavailable.headline);
  const t = allText(r);
  expect(t).toContain(COPY.errors.sourceUnavailable.headline);
  expect(t).toContain(COPY.scan.photoNotDeleted);
}, 40_000);

test('R3: ambiguous product (two FDA listings fit) → warning shown on the choice screen', async () => {
  const real = JSON.parse(entries[ndcUrl('62756-142-02')]!.bodyText).results[0];
  const rec = (productNdc: string, pkg: string) => ({ status: 200, headers: { 'content-type': 'application/json' }, bodyText: JSON.stringify({ meta: { last_updated: '2026-11-11', results: { skip: 0, limit: 1, total: 1 } }, results: [{ ...real, product_ndc: productNdc, packaging: [{ package_ndc: pkg, description: 'SYNTHETIC' }] }] }) });
  const notFound = { status: 404, headers: { 'content-type': 'application/json' }, bodyText: '{"error":{"code":"NOT_FOUND","message":"No matches found!"}}' };
  // SYNTHETIC UPC-A carrying the 10 NDC digits 6275614202 (three possible NDC readings).
  const upc: ScanOutput = { ...ocrOnly('METFORMIN HCL ER 500 MG TABLET'), barcodes: [{ format: 'UPC_A', text: '362756142022', symbology: null }] };
  const r = await start(platformWith([upc], {
    [ndcUrl('6275-6142-02')]: rec('6275-6142', '6275-6142-02'),
    [ndcUrl('62756-142-02')]: rec('62756-142', '62756-142-02'),
    [ndcUrl('62756-1420-2')]: notFound,
  }));
  await press(r, COPY.scan.button);
  const t = allText(r);
  expect(t).toContain(COPY.errors.ambiguous);
  expect(t).toContain(COPY.scan.photoNotDeleted);
});

test('R3: the warning stays across screens until a later scan reports the photo storage clean', async () => {
  const r = await start(platform([ocrOnly('WARFARIN 5 MG TABLETS'), { ...label('01_'), photoDeleted: true }]));
  await press(r, COPY.scan.button);
  expect(allText(r)).toContain(COPY.notAssessed.EXCLUDED.headline);
  expect(allText(r)).toContain(COPY.scan.photoNotDeleted);
  await press(r, 'Back');
  expect(allText(r)).toContain(COPY.scan.button); // home
  expect(allText(r)).toContain(COPY.scan.photoNotDeleted); // still reported
  await press(r, COPY.scan.button);
  expect(allText(r)).toContain(COPY.confirm.title);
  expect(allText(r)).not.toContain(COPY.scan.photoNotDeleted); // the later scan reported clean storage
});

test('photo guidance: what to photograph, how close, and accepting the photo are shown before the camera opens, and again after a failed read', async () => {
  const r = await start(platform([{ lines: [], barcodes: [] }]));
  let t = allText(r);
  expect(t).toContain(COPY.scan.howToTitle);
  for (const step of COPY.scan.howTo) expect(t).toContain(step);
  // The guidance comes before the scan button, not after it.
  expect(t.indexOf(COPY.scan.howToTitle)).toBeLessThan(t.indexOf(COPY.scan.button));
  await press(r, COPY.scan.button);
  t = allText(r);
  expect(t).toContain(COPY.scan.nothingRead);
  expect(t).toContain(COPY.scan.howToTitle);
});
