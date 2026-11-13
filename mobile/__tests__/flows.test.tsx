/**
 * End-to-end UI flows on the real screens (Task 4A.2). Renders <App> with react-test-renderer and
 * drives it like a user: type, toggle, press. Network answers are recorded real responses from
 * openFDA, RxNav and DailyMed (tests/fixtures/task3/cassette.json, recorded 2026-11-12) replayed by
 * exact URL. Labeled SYNTHETIC items: the openFDA "not found" answer for the made-up NDC
 * 00000-0000-00 (openFDA's documented 404 body), injected network failures, the fake key store and
 * the fake encryption self-test (native modules cannot run under Jest).
 */
import React from 'react';
import { Alert, BackHandler, Switch, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { App } from '../app/AppRoot.tsx';
import type { PlatformServices } from '../app/platform/types.ts';
import { memoryConsentStore } from '../src/legal/consent.ts';
import { COPY } from '../src/copy/en.ts';
import { REVIEWED_NEGATED_STATEMENTS } from '../src/copy/en.ts';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cassette = require('../../tests/fixtures/task3/cassette.json') as { entries: Record<string, { status: number; headers: Record<string, string>; bodyText: string }> };

const NOT_FOUND = { status: 404, headers: { 'content-type': 'application/json' }, bodyText: '{"error":{"code":"NOT_FOUND","message":"No matches found!"}}' };
// SYNTHETIC: 00000-0000-00 is a made-up NDC; the app looks up each 10-digit form of it.
const SYNTHETIC: Record<string, typeof NOT_FOUND> = Object.fromEntries(
  ['0000-0000-00', '00000-000-00', '00000-0000-0', '00000-0000-00'].map((n) => [`https://api.fda.gov/drug/ndc.json?search=packaging.package_ndc%3A%22${n}%22&limit=10`, NOT_FOUND]),
);

interface Fake extends PlatformServices {
  requests: string[];
  opened: string[];
  offline: boolean;
}

function platform(): Fake {
  const p: Fake = {
    requests: [],
    opened: [],
    offline: false,
    os: 'android',
    transport: {
      async get(url) {
        p.requests.push(url);
        if (p.offline) throw new TypeError('Network request failed (SYNTHETIC offline)');
        const hit = cassette.entries[url] ?? SYNTHETIC[url];
        if (!hit) throw new Error(`UNRECORDED request: ${url}`);
        return { status: hit.status, headers: hit.headers, bodyText: hit.bodyText };
      },
    },
    randomBytes: (n) => new Uint8Array(n).map((_, i) => (i * 37 + 11) % 256),
    keyStore: { getOrCreateKey: async () => 'k'.repeat(64), deleteKey: async () => undefined },
    openEncryptedDatabase: async () => {
      throw new Error('development builds must not open a database');
    },
    encryptionSelfTest: async () => ({ passed: true, ranAt: '2026-11-12T12:05:00.000Z', steps: [{ name: 'SQLCipher compiled in', passed: true, detail: 'SYNTHETIC fake' }] }),
    openUrl: async (u) => {
      p.opened.push(u);
    },
  };
  return p;
}

// Freeze only the clock (the recorded FDA data is from 2026-11-12); timers stay real.
beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2026-11-12T12:05:00.000Z'), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'] });
});
afterAll(() => jest.useRealTimers());

const flush = async () => {
  for (let i = 0; i < 40; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

async function waitFor(r: ReactTestRenderer, pred: (t: string) => boolean, ms = 25_000) {
  const end = Date.now() + ms;
  // Date is frozen by fake timers; measure real elapsed time with performance.now().
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (pred(allText(r))) return;
    await act(async () => new Promise((res) => setTimeout(res, 100)));
  }
  void end;
  throw new Error(`timed out waiting; screen:\n${allText(r)}`);
}

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

const textOf = (n: ReactTestInstance): string =>
  n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

async function press(r: ReactTestRenderer, label: string, which: 'first' | 'last' = 'last') {
  const hits = r.root.findAll((n) => typeof n.props.onPress === 'function' && (n.props.accessibilityRole === 'button' || n.props.accessibilityRole === 'link') && textOf(n).includes(label));
  if (hits.length === 0) throw new Error(`no button "${label}" on screen:\n${allText(r)}`);
  const target = (which === 'first' ? hits[0] : hits[hits.length - 1])!;
  if (target.props.disabled) throw new Error(`button "${label}" is disabled`);
  await act(async () => target.props.onPress());
  await flush();
}

function isEnabled(r: ReactTestRenderer, label: string): boolean {
  const hits = r.root.findAll((n) => typeof n.props.onPress === 'function' && n.props.accessibilityRole === 'button' && textOf(n).includes(label));
  return hits.length > 0 && !hits[hits.length - 1]!.props.disabled;
}

async function type(r: ReactTestRenderer, label: string, value: string) {
  const input = r.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === label)[0];
  if (!input) throw new Error(`no field "${label}"`);
  await act(async () => input.props.onChangeText(value));
}

// Confirms everything: "use this lot" (not "continue without it") and never "I can't tell".
const OPPOSITE_CHOICES = new Set<string>([COPY.confirm.lotNotUsed, COPY.confirm.releaseUnknown]);
async function toggleAll(r: ReactTestRenderer, except: (label: string) => boolean = () => false) {
  for (const s of r.root.findAllByType(Switch)) if (!except(s.props.accessibilityLabel) && !OPPOSITE_CHOICES.has(s.props.accessibilityLabel)) await act(async () => s.props.onValueChange(true));
}

async function start(p = platform()) {
  let r!: ReactTestRenderer;
  await act(async () => {
    // A fresh acknowledgement store per test (the app keeps them in memory for the process life).
    r = create(<App platform={p} consent={memoryConsentStore()} />);
  });
  await flush();
  return { r, p };
}

async function accept(r: ReactTestRenderer) {
  expect(allText(r)).toContain(COPY.firstLaunch.title);
  await press(r, COPY.firstLaunch.acknowledge);
}

async function enter(r: ReactTestRenderer, e: { ndc?: string; name?: string; strength?: string; form?: string; lot?: string }) {
  if (e.ndc !== undefined) await type(r, COPY.entry.ndcLabel, e.ndc);
  if (e.name !== undefined) await type(r, COPY.entry.nameLabel, e.name);
  if (e.strength !== undefined) await type(r, COPY.entry.strengthLabel, e.strength);
  if (e.form !== undefined) await type(r, COPY.entry.formLabel, e.form);
  if (e.lot !== undefined) await type(r, COPY.entry.lotLabel, e.lot);
  await press(r, COPY.entry.submit);
}

const PROHIBITED = /\bsafe\b|recall[- ]free|no recalls exist|guarantee|fda[- ]verified|all clear|no issues|you can continue taking|stop taking this/i;
function assertNoProhibited(text: string) {
  let t = text;
  for (const s of REVIEWED_NEGATED_STATEMENTS) t = t.split(s).join('');
  expect(t).not.toMatch(PROHIBITED);
}

const SUN = { ndc: '62756-142-02', name: 'METFORMIN HCL ER', strength: '500 MG', form: 'TABLET' };

test('first launch: development label, evaluation-prototype notice, draft legal documents, acknowledgement', async () => {
  const { r } = await start();
  const t = allText(r);
  expect(t).toContain(COPY.app.devBanner);
  expect(t).toContain(COPY.disclaimer.standing);
  await press(r, COPY.firstLaunch.readTerms);
  expect(allText(r)).toMatch(/DRAFT|drafts pending legal review/);
  await press(r, 'Back');
  await accept(r);
  expect(allText(r)).toContain(COPY.entry.title);
});

test('confirmed recall: product from FDA records, each item confirmed, lot listed, sources and limitations shown', async () => {
  const { r, p } = await start();
  await accept(r);
  await enter(r, { ...SUN, lot: 'JKU4639A' });
  let t = allText(r);
  expect(t).toContain(COPY.confirm.title);
  expect(t).toContain(COPY.evidence.VERIFIED_SOURCE);
  expect(t).toContain(COPY.evidence.USER_ENTERED); // the typed lot, before it is confirmed
  expect(t).toContain(COPY.fields.lotUnconfirmedNote);
  expect(isEnabled(r, COPY.confirm.confirmAll)).toBe(false);
  await toggleAll(r);
  expect(isEnabled(r, COPY.confirm.confirmAll)).toBe(true);
  await press(r, COPY.confirm.confirmAll);
  t = allText(r);
  expect(t).toContain(COPY.result.CONFIRMED.headline);
  expect(t).toContain(COPY.evidence.USER_CONFIRMED);
  expect(t).toContain(COPY.result.categoryLabel.CONFIRMED);
  expect(t).toContain('D-0325-2021');
  expect(t).toContain(COPY.result.record.lotListed);
  expect(t).toContain(COPY.result.nextSteps.contactProfessional);
  expect(t).toContain(COPY.result.nextSteps.doNotChange);
  expect(t).toMatch(/Retrieved on this phone: /);
  expect(t).toMatch(/FDA recall data last updated: 2026-11-04/);
  expect(t).toContain(COPY.result.limitsTitle);
  expect(t).toContain(COPY.disclaimer.standing);
  assertNoProhibited(t);
  expect(p.requests.every((u) => !u.includes('JKU4639A'))).toBe(true);
  await press(r, COPY.result.record.officialRecord, 'first'); // first record = the matching recall
  expect(p.opened[0]).toMatch(/^https:\/\/api\.fda\.gov\/drug\/enforcement\.json\?search=recall_number:%22D-0325-2021%22$/);
});

test('possible recall: same product without a lot is "may be affected", never confirmed', async () => {
  const { r } = await start();
  await accept(r);
  await enter(r, SUN);
  await toggleAll(r);
  await press(r, COPY.confirm.confirmAll);
  const t = allText(r);
  expect(t).toContain(COPY.result.POTENTIAL.headline);
  expect(t).toContain(COPY.result.categoryLabel.POTENTIAL);
  expect(t).toContain(COPY.result.qualifiers.lotNotProvided);
  expect(t).not.toContain(COPY.result.CONFIRMED.headline);
});

test('no match found: dated, qualified headline; never "safe"; distinct label from "unable"', async () => {
  const { r } = await start();
  await accept(r);
  await enter(r, { ndc: '82009-018-10', name: 'ROSUVASTATIN CALCIUM', strength: '10 MG', form: 'TABLET' });
  await toggleAll(r);
  await press(r, COPY.confirm.confirmAll);
  const t = allText(r);
  expect(t).toMatch(/No matching recall was identified in the sources successfully checked as of .+\. This does not establish that the medication is free from recalls/);
  expect(t).toContain(COPY.result.categoryLabel.NO_MATCH);
  expect(t).not.toContain(COPY.result.categoryLabel.UNABLE);
  expect(t).toContain(COPY.result.excluded.title);
  assertNoProhibited(t);
});

test('excluded medication: no recall check, policy rule shown, no recall/RxNav/DailyMed request', async () => {
  const { r, p } = await start();
  await accept(r);
  await enter(r, { ndc: '67046-2072-3', name: 'WARFARIN SODIUM', strength: '1 MG', form: 'TABLET' });
  const t = allText(r);
  expect(t).toContain(COPY.notAssessed.EXCLUDED.headline);
  expect(t).toMatch(/No recall check was done/);
  expect(t).toContain('EXCL-WARFARIN');
  expect(p.requests.filter((u) => /enforcement|rxnav|dailymed/.test(u))).toEqual([]);
  assertNoProhibited(t);
});

test('unsupported medication: not covered, no check, no request at all', async () => {
  const { r, p } = await start();
  await accept(r);
  await enter(r, { name: 'METOPROLOL TARTRATE', strength: '25 MG', form: 'TABLET' });
  const t = allText(r);
  expect(t).toContain(COPY.notAssessed.UNSUPPORTED.headline);
  expect(p.requests).toEqual([]);
});

test('unknown NDC: user is told it was not found; details are marked as typed, not FDA-verified', async () => {
  const { r } = await start();
  await accept(r);
  await enter(r, { ndc: '00000-0000-00', name: 'METFORMIN', strength: '500 MG', form: 'TABLET' });
  const t = allText(r);
  expect(t).toContain(COPY.confirm.title);
  expect(t).toContain(COPY.confirm.ndcNotFound);
  expect(t).toContain(COPY.evidence.USER_ENTERED);
  expect(t).not.toContain(COPY.evidence.VERIFIED_SOURCE);
});

test('missing fields: asks for name, strength and form and keeps what was typed', async () => {
  const { r } = await start();
  await accept(r);
  await enter(r, { name: 'METFORMIN' });
  expect(allText(r)).toContain(COPY.errors.missing);
  const name = r.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === COPY.entry.nameLabel)[0]!;
  expect(name.props.value).toBe('METFORMIN');
});

test('network failure: progress shown, then "nothing was checked", never a result; recovery with Try again', async () => {
  const p = platform();
  const { r } = await start(p);
  await accept(r);
  await enter(r, { ndc: '82009-018-10', name: 'ROSUVASTATIN CALCIUM', strength: '10 MG', form: 'TABLET' });
  await toggleAll(r);
  p.offline = true;
  await press(r, COPY.confirm.confirmAll);
  // Progress is shown while the app retries (defect fixed in 4A.2: the screen used to stay on Confirm).
  expect(allText(r)).toContain(COPY.working.search);
  await waitFor(r, (x) => x.includes(COPY.errors.sourceUnavailable.headline));
  let t = allText(r);
  expect(t).toContain(COPY.errors.sourceUnavailable.headline);
  expect(t).toContain(COPY.errors.sourceUnavailable.body);
  expect(t).not.toMatch(/No matching recall was identified/);
  p.offline = false;
  await press(r, COPY.errors.retry);
  await waitFor(r, (x) => !x.includes(COPY.working.search));
  t = allText(r);
  expect(t).toMatch(/No matching recall was identified|We could not reliably determine/);
}, 60_000);

test('about: version and build, legal documents, encryption self-test (development), delete all data', async () => {
  const { r } = await start();
  await accept(r);
  await press(r, COPY.about.title);
  let t = allText(r);
  expect(t).toMatch(/version \d+\.\d+\.\d+ \(build \d+\)/);
  expect(t).toContain(COPY.about.attribution);
  await press(r, 'Run encryption self-test');
  expect(allText(r)).toContain('PASS — SQLCipher compiled in');
  await press(r, COPY.about.deleteAll);
  t = allText(r);
  expect(t).toBeTruthy();
});

test('history is off in the development build and says why', async () => {
  const { r } = await start();
  await accept(r);
  await press(r, COPY.history.title);
  expect(allText(r)).toContain(COPY.history.disabled);
});

test('each result category has its own label, so the four outcomes can be told apart', () => {
  const labels = Object.values(COPY.result.categoryLabel);
  expect(new Set(labels).size).toBe(4);
  for (const l of labels) assertNoProhibited(l);
});

test('Android Back returns from a result to the entry screen (does not leave the app); typed values kept', async () => {
  const handlers: (() => boolean | null | undefined)[] = [];
  const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
    handlers.push(h);
    return { remove: () => handlers.splice(handlers.indexOf(h), 1) };
  });
  const { r } = await start();
  await accept(r);
  await enter(r, { ndc: '67046-2072-3', name: 'WARFARIN SODIUM', strength: '1 MG', form: 'TABLET' });
  expect(allText(r)).toContain(COPY.notAssessed.EXCLUDED.headline);
  let handled: boolean | null | undefined;
  await act(async () => {
    handled = handlers[handlers.length - 1]!();
  });
  await flush();
  expect(handled).toBe(true);
  expect(allText(r)).toContain(COPY.entry.title);
  const ndc = r.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === COPY.entry.ndcLabel)[0]!;
  expect(ndc.props.value).toBe('67046-2072-3');
  // On the entry screen Back is left to Android (leaves the app).
  expect(handlers[handlers.length - 1]!()).toBe(false);
  spy.mockRestore();
});

test('Change details on the confirmation screen returns to entry with the typed values', async () => {
  const { r } = await start();
  await accept(r);
  await enter(r, { ...SUN, lot: 'JKU4639A' });
  await press(r, COPY.confirm.edit);
  const lot = r.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === COPY.entry.lotLabel)[0]!;
  expect(lot.props.value).toBe('JKU4639A');
});

test('Delete all data clears typed values and shows the first-launch notice again', async () => {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    const del = buttons?.find((b) => b.style === 'destructive');
    del?.onPress?.();
  });
  const { r } = await start();
  await accept(r);
  await type(r, COPY.entry.nameLabel, 'METFORMIN');
  await press(r, COPY.about.title);
  await press(r, COPY.about.deleteAll);
  await flush();
  expect(allText(r)).toContain(COPY.firstLaunch.title);
  await accept(r);
  const name = r.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === COPY.entry.nameLabel)[0]!;
  expect(name.props.value).toBe('');
  spy.mockRestore();
});

// ------------------------------------------------------------------ Task 4C build 7: summary-first result

const before = (t: string, a: string, b: string) => {
  const i = t.indexOf(a);
  const j = t.indexOf(b);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(j).toBeGreaterThan(i);
};
const countOf = (t: string, s: string) => t.split(s).length - 1;

test('build 7, confirmed: summary first, limits directly below, matching recall prominent; excluded records collapsed until asked', async () => {
  const { r } = await start();
  await accept(r);
  await enter(r, { ...SUN, lot: 'JKU4639A' });
  await toggleAll(r);
  await press(r, COPY.confirm.confirmAll);
  let t = allText(r);
  expect(t).toMatch(/We checked \d+ FDA recall records for metformin: 1 matches your product; \d+ might match; \d+ were for a different product\./);
  before(t, COPY.result.categoryLabel.CONFIRMED, COPY.result.limitsTitle);
  before(t, COPY.result.limitsTitle, COPY.disclaimer.standing);
  before(t, COPY.disclaimer.standing, COPY.result.groups.matches);
  before(t, COPY.result.groups.matches, COPY.result.groups.possible);
  before(t, COPY.result.groups.possible, COPY.result.excluded.title);
  before(t, COPY.result.excluded.title, COPY.result.sources.title);
  // The matching record shows plain-language details on the card.
  for (const l of [COPY.result.record.recallStarted, COPY.result.record.firm, COPY.result.record.reason, COPY.result.record.classification, COPY.result.record.status, COPY.result.record.recallNumber]) expect(t).toContain(l);
  expect(t).toContain('D-0325-2021');
  // The status note sits at the top of each record section shown (matches, might match).
  expect(countOf(t, COPY.result.record.statusNote)).toBe(2);
  // Excluded records: counted by reason, not listed.
  const why = COPY.result.record.whyExcluded;
  expect(countOf(t, why)).toBe(0);
  const m = /(\d+) were for a different product/.exec(t)!;
  const n = Number(m[1]);
  const counts = [...t.matchAll(/^• (.+): (\d+)$/gm)].filter((x) => Object.values(COPY.result.excluded.reasons).includes(x[1]!));
  expect(counts.reduce((a, x) => a + Number(x[2]), 0)).toBe(n);
  await press(r, COPY.result.excluded.show(n));
  t = allText(r);
  expect(countOf(t, why)).toBe(n);
  expect(countOf(t, COPY.result.record.statusNote)).toBe(3);
  await press(r, COPY.result.excluded.hide);
  expect(countOf(allText(r), why)).toBe(0);
  assertNoProhibited(t);
});

test('build 7, possible match without a lot: possible records shown (first three, the rest one tap away), lot qualifier on top', async () => {
  const { r } = await start();
  await accept(r);
  await enter(r, SUN);
  await toggleAll(r);
  await press(r, COPY.confirm.confirmAll);
  let t = allText(r);
  expect(t).toContain(COPY.result.categoryLabel.POTENTIAL);
  before(t, COPY.result.qualifiers.lotNotProvided, COPY.result.limitsTitle);
  const n = Number(/(\d+) might match/.exec(t)![1]);
  expect(n).toBeGreaterThan(0);
  const shown = () => countOf(allText(r), COPY.result.record.lotUnknown) + countOf(allText(r), COPY.result.record.allLots);
  if (n > 3) {
    expect(t).toContain(COPY.result.showMorePossible(n - 3));
    await press(r, COPY.result.showMorePossible(n - 3));
    t = allText(r);
    expect(t).not.toContain(COPY.result.showMorePossible(n - 3));
  }
  expect(shown()).toBeGreaterThan(0);
  expect(t).not.toContain(COPY.result.CONFIRMED.headline);
});

test('build 7, no match: required wording, never "active"; record details open per record', async () => {
  const { r, p } = await start();
  await accept(r);
  await enter(r, { ndc: '82009-018-10', name: 'ROSUVASTATIN CALCIUM', strength: '10 MG', form: 'TABLET' });
  await toggleAll(r);
  await press(r, COPY.confirm.confirmAll);
  let t = allText(r);
  expect(t).toContain('No matching recall found in the FDA records checked');
  expect(t).not.toMatch(/\bactive\b/i);
  expect(t).not.toContain(COPY.result.groups.matches);
  expect(t).not.toContain(COPY.result.groups.possible);
  before(t, COPY.result.limitsTitle, COPY.result.excluded.title);
  const n = Number(/(\d+) were for a different product/.exec(t)![1]);
  await press(r, COPY.result.excluded.show(n));
  await press(r, COPY.result.record.moreDetails, 'first');
  t = allText(r);
  expect(t).toContain(COPY.result.record.lots);
  expect(t).toContain(COPY.result.record.product);
  await press(r, COPY.result.record.officialRecord, 'first');
  expect(p.opened[0]).toMatch(/^https:\/\/api\.fda\.gov\/drug\/enforcement\.json\?search=recall_number:%22/);
  assertNoProhibited(t);
});

test('build 7, offline: a failed lookup never shows a summary or a no-match', async () => {
  const p = platform();
  const { r } = await start(p);
  await accept(r);
  await enter(r, { ndc: '82009-018-10', name: 'ROSUVASTATIN CALCIUM', strength: '10 MG', form: 'TABLET' });
  await toggleAll(r);
  p.offline = true;
  await press(r, COPY.confirm.confirmAll);
  await waitFor(r, (x) => x.includes(COPY.errors.sourceUnavailable.headline));
  const t = allText(r);
  expect(t).not.toMatch(/We checked \d+ FDA recall record/);
  expect(t).not.toContain(COPY.result.categoryLabel.NO_MATCH);
  expect(t).not.toContain(COPY.result.excluded.title);
}, 60_000);

test('item 10: with a lot entered, the button waits for a lot choice and says what is missing; "continue without" checks without the lot', async () => {
  const { r, p } = await start();
  await accept(r);
  await enter(r, { ...SUN, lot: 'JKU4639A' });
  await toggleAll(r, (l) => l === COPY.confirm.lotUse('JKU4639A'));
  expect(isEnabled(r, COPY.confirm.confirmAll)).toBe(false);
  expect(allText(r)).toContain(COPY.confirm.needLotChoice);
  const notUsed = r.root.findAllByType(Switch).find((s) => s.props.accessibilityLabel === COPY.confirm.lotNotUsed)!;
  await act(async () => notUsed.props.onValueChange(true));
  expect(isEnabled(r, COPY.confirm.confirmAll)).toBe(true);
  await press(r, COPY.confirm.confirmAll);
  const t = allText(r);
  expect(t).toContain(COPY.result.POTENTIAL.headline); // the lot was not used: never "recall match found"
  expect(t).not.toContain(COPY.result.CONFIRMED.headline);
  expect(p.requests.every((u) => !u.includes('JKU4639A'))).toBe(true);
});

test('item 11: "I can\'t tell" the release type shows where to look and to ask a pharmacist, and no check starts', async () => {
  const { r, p } = await start();
  await accept(r);
  await enter(r, { ndc: '', name: 'METFORMIN', strength: '500 MG', form: 'TABLET' }); // release not printed
  expect(allText(r)).toContain(COPY.confirm.releaseQuestion);
  const before = p.requests.filter((u) => u.includes('enforcement')).length;
  await toggleAll(r, (l) => [COPY.confirm.releaseIR, COPY.confirm.releaseER, COPY.confirm.releaseDR].includes(l));
  const unknown = r.root.findAllByType(Switch).find((s) => s.props.accessibilityLabel === COPY.confirm.releaseUnknown)!;
  await act(async () => unknown.props.onValueChange(true));
  const t = allText(r);
  for (const h of COPY.confirm.releaseUnknownHelp) expect(t).toContain(h);
  expect(isEnabled(r, COPY.confirm.confirmAll)).toBe(false);
  expect(p.requests.filter((u) => u.includes('enforcement')).length).toBe(before);
});
