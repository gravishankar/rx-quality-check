/**
 * End-to-end scenarios: medication input → identity → exclusion policy → patient confirmation →
 * public API lookup → recall classification → explanation → optional local save, through the
 * production composition root (mobile/src/app/recallCheck.ts), the existing state machine, safety
 * gates and recall engine. Nothing here classifies evidence.
 *
 * Inputs are manual-entry label fields. Values marked SYNTHETIC are invented (patient name, Rx
 * number, directions, pharmacy) and exist only to prove they are never transmitted. NDCs, lots and
 * recall numbers are real (openFDA, 2026-11-12). Failure injection wraps the real transport and is
 * labeled per scenario.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRecallCheck } from '../../mobile/src/app/recallCheck.ts';
import type { FieldValue, LabelExtraction, ReleaseMechanism } from '../../mobile/src/models/identity.ts';
import type { HttpTransport } from '../../mobile/src/services/transport.ts';
import { ALLOWED_HOSTS } from '../../mobile/src/services/transport.ts';
import { openNodeSqlite } from '../../mobile/src/storage/drivers/nodeSqlite.ts';
import { openStorage, type Repositories } from '../../mobile/src/storage/repositories.ts';
import type { WorkflowState } from '../../mobile/src/state/machine.ts';

export const SYNTHETIC_PRIVATE_TEXT = ['SYNTHETIC PATIENT NAME', 'RX0000000', 'TAKE 1 TABLET BY MOUTH DAILY', 'SYNTHETIC PHARMACY'];

const typed = (value: string): FieldValue<string> => ({ value, origin: 'USER', confidence: null, confirmedByUser: false });

function label(f: { ndc?: string; name: string; strength: string; form: string; lot?: string }): LabelExtraction {
  return {
    ndcTexts: f.ndc ? [typed(f.ndc)] : [],
    drugName: typed(f.name),
    strength: typed(f.strength),
    doseForm: typed(f.form),
    labelerText: null,
    lot: f.lot ? typed(f.lot) : null,
    expiry: null,
    containerType: 'PHARMACY_VIAL',
    privateText: SYNTHETIC_PRIVATE_TEXT,
  };
}

export interface ScenarioResult {
  state: WorkflowState;
  path: string[];
  requests: { url: string; host: string; outcome: string }[];
  persisted: boolean;
  notes: string[];
}

export interface Scenario {
  id: string;
  title: string;
  /** What is synthetic or injected in this scenario. */
  labeling: string;
  label: LabelExtraction;
  confirmLot?: string | null;
  release?: ReleaseMechanism;
  save?: boolean;
  catalog?: (c: Record<string, unknown>, root: string) => Record<string, unknown>;
  policy?: (p: Record<string, unknown>, root: string) => Record<string, unknown>;
  wrap?: (t: HttpTransport) => HttpTransport;
  /** Run twice on the same database; the second run uses `secondRun` (offline cache). */
  secondRun?: { wrap: (t: HttpTransport) => HttpTransport; advanceMs: number };
  check: (r: ScenarioResult, mode: 'recorded' | 'live') => string[];
}

// ---------------------------------------------------------------- failure injection (synthetic)

/** SYNTHETIC failure: every request matching `match` throws like a dropped connection. */
export const networkDown = (match: (url: string) => boolean) => (t: HttpTransport): HttpTransport => ({
  async get(url, opts) {
    if (match(url)) throw new TypeError('fetch failed (injected network failure)');
    return t.get(url, opts);
  },
});

/**
 * MODIFIED REAL responses: the first page keeps `n` records (meta.results.total as published) and
 * every following page comes back with no records — an incomplete answer the client cannot repair.
 * (Truncating every page alone is not incomplete: the client pages on and recovers all records.)
 */
export const truncatePage = (match: (url: string) => boolean, n: number) => (t: HttpTransport): HttpTransport => ({
  async get(url, opts) {
    const firstPage = !/[?&]skip=/.test(url);
    const r = await t.get(firstPage ? url : url.replace(/&skip=\d+/, ''), opts);
    if (!match(url) || r.status !== 200) return r;
    const body = JSON.parse(r.bodyText) as { meta: { results: Record<string, number> }; results: unknown[] };
    const skip = Number(/[?&]skip=(\d+)/.exec(url)?.[1] ?? 0);
    return { ...r, bodyText: JSON.stringify({ ...body, meta: { ...body.meta, results: { ...body.meta.results, skip } }, results: firstPage ? body.results.slice(0, n) : [] }) };
  },
});

const isEnforcement = (u: string) => u.includes('/drug/enforcement.json');
const anyUrl = () => true;

// ---------------------------------------------------------------- configuration edits (data only)

const readJson = (root: string, rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8')) as Record<string, unknown>;

export function addCatalogFragment(c: Record<string, unknown>, root: string, fragment: string): Record<string, unknown> {
  const f = readJson(root, fragment) as { ingredients: unknown[]; drugs: unknown[]; change_log_entry: unknown };
  return {
    ...c,
    catalog_version: (f.change_log_entry as { version: string }).version,
    ingredients: [...(c.ingredients as unknown[]), ...f.ingredients],
    drugs: [...(c.drugs as unknown[]), ...f.drugs],
    change_log: [...(c.change_log as unknown[]), f.change_log_entry],
  };
}

export function addPolicyFragment(p: Record<string, unknown>, root: string, fragment: string): Record<string, unknown> {
  const f = readJson(root, fragment) as { classes: unknown[]; ingredient_rules: unknown[]; change_log_entry: unknown };
  return {
    ...p,
    policy_version: (f.change_log_entry as { version: string }).version,
    classes: [...(p.classes as unknown[]), ...f.classes],
    ingredient_rules: [...(p.ingredient_rules as unknown[]), ...f.ingredient_rules],
    change_log: [...(p.change_log as unknown[]), f.change_log_entry],
  };
}

// ---------------------------------------------------------------- checks

const finding = (r: ScenarioResult) => r.state.ctx.finding;
const exclusion = (r: ScenarioResult) => r.state.ctx.exclusion;
const expect = (cond: boolean, msg: string, out: string[]) => {
  if (!cond) out.push(msg);
};
const recallRequests = (r: ScenarioResult) => r.requests.filter((q) => q.url.includes('/drug/enforcement.json'));

// ---------------------------------------------------------------- scenarios

const SUN_METFORMIN_ER = { ndc: '62756-142-02', name: 'METFORMIN HCL ER', strength: '500 MG', form: 'TABLET' };

export const SCENARIOS: Scenario[] = [
  {
    id: 'known-recall',
    title: 'Verified known recall: Sun metformin ER 500 mg (NDC 62756-142-02), lot JKU4639A → D-0325-2021',
    labeling: 'Real NDC, lot and recall; synthetic patient text.',
    label: label({ ...SUN_METFORMIN_ER, lot: 'JKU4639A' }),
    confirmLot: 'JKU4639A',
    save: true,
    check: (r) => {
      const o: string[] = [];
      const f = finding(r);
      expect(f?.finding === 'CONFIRMED_MATCH', `finding ${f?.finding}`, o);
      expect(f?.confirmed.some((x) => x.recallNumber === 'D-0325-2021') ?? false, 'D-0325-2021 not confirmed', o);
      expect(f?.coverage.positiveControl.status === 'PASSED', 'control not passed', o);
      expect(r.persisted, 'not saved', o);
      expect(r.state.ctx.identity?.ingredients[0]?.rxcui === '6809', `RxNav ingredient RxCUI ${r.state.ctx.identity?.ingredients[0]?.rxcui}`, o);
      return o;
    },
  },
  {
    id: 'no-applicable-match',
    title: 'No applicable match in a complete dataset: Quallent rosuvastatin 10 mg (NDC 82009-018-10)',
    labeling: 'Real NDC and complete recall dataset (13 rosuvastatin records); synthetic patient text.',
    label: label({ ndc: '82009-018-10', name: 'ROSUVASTATIN CALCIUM', strength: '10 MG', form: 'TABLET' }),
    check: (r, mode) => {
      const o: string[] = [];
      const f = finding(r);
      if (mode === 'recorded') expect(f?.finding === 'NO_MATCH_FOUND', `finding ${f?.finding}`, o);
      else expect(f !== null && f.finding !== 'UNRESOLVED', `live finding ${f?.finding} (new FDA data may change this; must not be UNRESOLVED with a healthy network)`, o);
      expect(f?.coverage.complete === true, 'coverage incomplete', o);
      expect(f?.limitations.includes('ABSENCE_IS_NOT_SAFETY') ?? false, 'missing standing limitation', o);
      expect((f?.notApplicable.length ?? 0) > 0, 'records not kept visible', o);
      return o;
    },
  },
  {
    id: 'unknown-lot',
    title: 'Unknown lot: same recalled product, lot not provided → potential, never confirmed or cleared',
    labeling: 'Real NDC and recalls; synthetic patient text.',
    label: label(SUN_METFORMIN_ER),
    confirmLot: null,
    check: (r) => {
      const o: string[] = [];
      const f = finding(r);
      expect(f?.finding === 'POTENTIAL_MATCH', `finding ${f?.finding}`, o);
      expect(f?.confirmed.length === 0, 'confirmed without a lot', o);
      expect(f?.potential.some((x) => x.recallNumber === 'D-0325-2021' && x.reasons.includes('LOT_REQUIRED')) ?? false, 'LOT_REQUIRED missing', o);
      return o;
    },
  },
  {
    id: 'excluded',
    title: 'Excluded medication: warfarin (NDC 67046-2072-3) → EXCLUDED, no recall request',
    labeling: 'Real NDC; synthetic patient text.',
    label: label({ ndc: '67046-2072-3', name: 'WARFARIN SODIUM', strength: '1 MG', form: 'TABLET' }),
    check: (r) => {
      const o: string[] = [];
      expect(r.state.name === 'EXCLUDED', `state ${r.state.name}`, o);
      const x = exclusion(r);
      expect(x?.decision === 'EXCLUDED' && x.ruleId === 'EXCL-WARFARIN', `exclusion ${JSON.stringify(x)}`, o);
      expect(recallRequests(r).length === 0, `${recallRequests(r).length} recall requests sent`, o);
      return o;
    },
  },
  {
    id: 'unsupported',
    title: 'Unsupported medication: metoprolol tartrate (name-only label) → UNSUPPORTED, no request at all',
    labeling: 'Typed label fields; synthetic patient text.',
    label: label({ name: 'METOPROLOL TARTRATE', strength: '25 MG', form: 'TABLET' }),
    check: (r) => {
      const o: string[] = [];
      expect(r.state.name === 'UNSUPPORTED', `state ${r.state.name}`, o);
      const x = exclusion(r);
      expect(x?.decision === 'UNSUPPORTED' && x.reason === 'SALT_NOT_IN_SCOPE', `exclusion ${JSON.stringify(x)}`, o);
      expect(r.requests.length === 0, `${r.requests.length} requests sent`, o);
      return o;
    },
  },
  {
    id: 'new-catalog-entry',
    title: 'Newly added catalog entry (data only): sertraline 100 mg (NDC 68180-353-09), lot QB00865 → D-0227-2026',
    labeling: 'Catalog extended with data/examples/add_sertraline.catalog-fragment.json; real NDC, lot and recall; synthetic patient text.',
    label: label({ ndc: '68180-353-09', name: 'SERTRALINE HCL', strength: '100 MG', form: 'TABLET', lot: 'QB00865' }),
    confirmLot: 'QB00865',
    catalog: (c, root) => addCatalogFragment(c, root, 'data/examples/add_sertraline.catalog-fragment.json'),
    check: (r) => {
      const o: string[] = [];
      const x = exclusion(r);
      expect(x?.decision === 'ELIGIBLE' && x.catalogDrugId === 'sertraline', `exclusion ${JSON.stringify(x)}`, o);
      expect(finding(r)?.finding === 'CONFIRMED_MATCH', `finding ${finding(r)?.finding}`, o);
      expect(finding(r)?.confirmed.some((y) => y.recallNumber === 'D-0227-2026') ?? false, 'D-0227-2026 not confirmed', o);
      return o;
    },
  },
  {
    id: 'new-catalog-entry-baseline',
    title: 'Same sertraline label with the shipped 14-drug catalog → UNSUPPORTED (shows the data change is what enabled it)',
    labeling: 'Real NDC; synthetic patient text.',
    label: label({ ndc: '68180-353-09', name: 'SERTRALINE HCL', strength: '100 MG', form: 'TABLET' }),
    check: (r) => {
      const o: string[] = [];
      const x = exclusion(r);
      expect(x?.decision === 'UNSUPPORTED' && x.reason === 'NOT_IN_CATALOG', `exclusion ${JSON.stringify(x)}`, o);
      expect(recallRequests(r).length === 0, 'recall requests sent', o);
      return o;
    },
  },
  {
    id: 'new-exclusion-rule',
    title: 'Newly added exclusion rule (data only): levothyroxine (NDC 68788-8793-3) → EXCLUDED although in the catalog',
    labeling: 'Policy extended with data/examples/exclude_levothyroxine.policy-fragment.json (illustrative, not a policy decision); real NDC; synthetic patient text.',
    label: label({ ndc: '68788-8793-3', name: 'LEVOTHYROXINE SODIUM', strength: '175 MCG', form: 'TABLET' }),
    policy: (p, root) => addPolicyFragment(p, root, 'data/examples/exclude_levothyroxine.policy-fragment.json'),
    check: (r) => {
      const o: string[] = [];
      const x = exclusion(r);
      expect(r.state.name === 'EXCLUDED', `state ${r.state.name}`, o);
      expect(x?.decision === 'EXCLUDED' && x.ruleId === 'EXCL-LEVOTHYROXINE-EXAMPLE', `exclusion ${JSON.stringify(x)}`, o);
      expect(recallRequests(r).length === 0, 'recall requests sent', o);
      return o;
    },
  },
  {
    id: 'invalid-policy',
    title: 'Invalid policy file → fail closed: UNSUPPORTED (POLICY_INVALID), no recall request',
    labeling: 'Shipped policy with policy_version removed (synthetic corruption); real NDC.',
    label: label(SUN_METFORMIN_ER),
    policy: (p) => {
      const { policy_version: _v, ...rest } = p;
      return rest;
    },
    check: (r) => {
      const o: string[] = [];
      const x = exclusion(r);
      expect(x?.decision === 'UNSUPPORTED' && x.reason === 'POLICY_INVALID', `exclusion ${JSON.stringify(x)}`, o);
      expect(recallRequests(r).length === 0, 'recall requests sent', o);
      return o;
    },
  },
  {
    id: 'network-failure',
    title: 'Network failure during recall lookup → bounded retries, SOURCE_UNAVAILABLE; never NO_MATCH_FOUND',
    labeling: 'SYNTHETIC: every enforcement request fails like a dropped connection; identity data real.',
    label: label(SUN_METFORMIN_ER),
    confirmLot: null,
    wrap: networkDown(isEnforcement),
    check: (r) => {
      const o: string[] = [];
      expect(r.state.name === 'SOURCE_UNAVAILABLE', `state ${r.state.name}`, o);
      expect(finding(r) === null, `finding ${finding(r)?.finding}`, o);
      expect(r.path.filter((p) => p === 'RETRY').length === 2, 'expected two automatic retries', o);
      return o;
    },
  },
  {
    id: 'incomplete-response',
    title: 'Incomplete FDA response (5 of 13 records on the only page) → UNRESOLVED, not NO_MATCH_FOUND',
    labeling: 'MODIFIED REAL: the rosuvastatin text-query page keeps 5 of its 13 records; meta.results.total unchanged.',
    label: label({ ndc: '82009-018-10', name: 'ROSUVASTATIN CALCIUM', strength: '10 MG', form: 'TABLET' }),
    wrap: truncatePage((u) => isEnforcement(u) && u.includes('rosuvastatin'), 5),
    check: (r) => {
      const o: string[] = [];
      const f = finding(r);
      expect(f?.finding === 'UNRESOLVED', `finding ${f?.finding}`, o);
      expect(f?.coverage.queries.some((q) => q.status === 'INCOMPLETE_PAGINATION') ?? false, 'incompleteness not recorded', o);
      return o;
    },
  },
  {
    id: 'offline-cached',
    title: 'Offline cached assessment: saved result shown with its date when FDA cannot be reached two days later',
    labeling: 'First run real; SYNTHETIC second run with every request failing except cached NDC Directory answers (30-day cache).',
    label: label({ ...SUN_METFORMIN_ER, lot: 'JKU4639A' }),
    confirmLot: 'JKU4639A',
    save: true,
    secondRun: { wrap: networkDown(anyUrl), advanceMs: 2 * 24 * 3600_000 },
    check: (r) => {
      const o: string[] = [];
      expect(r.state.name === 'OFFLINE_CACHED_RESULT', `state ${r.state.name}`, o);
      expect(r.state.ctx.cached?.finding.finding === 'CONFIRMED_MATCH', `cached ${r.state.ctx.cached?.finding.finding}`, o);
      expect(r.state.ctx.cached?.evaluatedAt !== undefined, 'no evaluation date', o);
      return o;
    },
  },
  {
    id: 'repackaged-product',
    title: 'Repackaged product: Precision Dose furosemide oral solution (NDC 68094-756-62) → verified source 0054-3294 queried too',
    labeling: 'Real NDC, SPL source relationship and NDC Directory verification; synthetic patient text.',
    label: label({ ndc: '68094-756-62', name: 'FUROSEMIDE', strength: '10 MG/ML', form: 'ORAL SOLUTION' }),
    check: (r) => {
      const o: string[] = [];
      const id = r.state.ctx.identity;
      expect(id?.sourceProductStatus === 'VERIFIED', `source status ${id?.sourceProductStatus}`, o);
      expect(id?.relatedSourceProductNdcs.includes('0054-3294') ?? false, `sources ${JSON.stringify(id?.relatedSourceProductNdcs)}`, o);
      expect(recallRequests(r).some((q) => q.url.includes('0054-3294')), 'source product recall query not sent', o);
      expect(finding(r) !== null && finding(r)?.coverage.complete === true, 'assessment incomplete', o);
      return o;
    },
  },
];

/** Privacy audit applied to every scenario. */
export function privacyFindings(r: ScenarioResult, scenario: Scenario): string[] {
  const o: string[] = [];
  const secrets = [...SYNTHETIC_PRIVATE_TEXT, ...(scenario.label.lot ? [scenario.label.lot.value] : []), ...(scenario.confirmLot ? [scenario.confirmLot] : [])];
  for (const q of r.requests) {
    if (q.outcome === 'BLOCKED') o.push(`request blocked by the privacy guard: ${q.url}`);
    if (!ALLOWED_HOSTS.includes(q.host)) o.push(`host not allowlisted: ${q.host}`);
    const decoded = decodeURIComponent(q.url).toUpperCase();
    for (const s of secrets) if (decoded.includes(s.toUpperCase())) o.push(`request contains patient-specific value "${s}": ${q.url}`);
  }
  return o;
}

export interface RunOptions {
  root: string;
  transport: HttpTransport;
  mode: 'recorded' | 'live';
  startMs?: number;
}

export async function runScenario(s: Scenario, o: RunOptions): Promise<{ result: ScenarioResult; failures: string[] }> {
  let clock = o.startMs ?? Date.parse('2026-11-12T12:00:00Z');
  const now = () => new Date(clock).toISOString();
  const catalogJson = s.catalog ? s.catalog(readJson(o.root, 'data/drug_catalog.json'), o.root) : readJson(o.root, 'data/drug_catalog.json');
  const policyJson = s.policy ? s.policy(readJson(o.root, 'data/exclusion_policy.json'), o.root) : readJson(o.root, 'data/exclusion_policy.json');
  const { repos } = await openStorage(openNodeSqlite(), { now, newId: () => randomUUID() });
  let persisted = false;
  const notes: string[] = [];

  const once = async (transport: HttpTransport, rp: Repositories) => {
    const app = createRecallCheck({ transport, now, sleep: async () => undefined, catalogJson, policyJson, load: { allowUnapproved: true }, repos: rp });
    let r = await app.scan(s.label);
    const path = [...r.trace];
    if (r.state.name === 'CONFIRM') {
      const lot = s.confirmLot === undefined ? (s.label.lot?.value ?? null) : s.confirmLot;
      r = await app.send(r.state, { type: 'USER_CONFIRMED', confirmedFields: r.state.ctx.requiredConfirmations, lot, ...(s.release ? { release: s.release } : {}) });
      path.push(...r.trace);
    }
    if (r.state.name === 'EXPLAIN' && s.save) {
      r = await app.send(r.state, { type: 'SAVE_REQUESTED' });
      path.push(...r.trace);
      persisted = r.state.name === 'SAVED';
    }
    return { state: r.state, path, requests: app.audit.entries.map((e) => ({ url: e.url, host: e.host, outcome: e.outcome })) };
  };

  const base = s.wrap ? s.wrap(o.transport) : o.transport;
  let run = await once(base, repos);
  if (s.secondRun) {
    notes.push(`first run: ${run.state.name} ${run.state.ctx.finding?.finding ?? ''}`);
    clock += s.secondRun.advanceMs;
    run = await once(s.secondRun.wrap(o.transport), repos);
  }
  const result: ScenarioResult = { ...run, persisted, notes };
  const failures = [...s.check(result, o.mode), ...privacyFindings(result, s)];
  return { result, failures };
}
