/**
 * Effect runner: executes state-machine effects with injected ports and the pure rules, and turns
 * results into events. It contains no network, storage or OCR code — those are ports supplied by the
 * app (Tasks 3 and 5) or by tests (real-fixture fakes). Everything here runs on the device.
 *
 * Privacy: the only values passed to network ports are public identifiers produced by the rules
 * (candidate package NDCs, and recall queries built from ingredient names and product NDCs). Lots,
 * label text and images never reach a network port.
 */
import type { EnforcementPage, QueryResult, RecallEvidenceBundle, RecallQuery } from '../models/evidence.ts';
import type { LabelExtraction, MedicationIdentity } from '../models/identity.ts';
import type { DataLoadResult, DrugCatalog, ExclusionPolicy } from '../models/policy.ts';
import { evaluateExclusion } from '../rules/exclusion.ts';
import { selectExplanation } from '../rules/explanation.ts';
import {
  confirmNdcCandidates,
  crossValidate,
  fieldsNeedingConfirmation,
  identityFromPrintedFields,
  identityFromProduct,
  type NdcDirectoryOutcome,
  type PrintedFields,
} from '../rules/identity.ts';
import { parseNdcInput, type NdcCandidate } from '../rules/ndc.ts';
import { evaluateRecallEvidence, planRecallQueries } from '../rules/recallEvidence.ts';
import {
  initialState,
  reduce,
  type CachedResult,
  type Capture,
  type Effect,
  type WorkflowEvent,
  type WorkflowState,
} from '../state/machine.ts';

/** openFDA rejects skip beyond 25,000; a query that would need more pages stays incomplete. */
export const MAX_SKIP = 25_000;

export interface Ports {
  /** On-device OCR / barcode extraction (Task 5). Returns null when nothing usable was read. */
  extract(capture: Capture): Promise<LabelExtraction | null>;
  /** NDC Directory lookup by package NDC: `packaging.package_ndc:"<ndc>"`. */
  lookupPackageNdc(packageNdc: string): Promise<NdcDirectoryOutcome>;
  /** One page of an enforcement query. */
  fetchRecallPage(query: RecallQuery, skip: number): Promise<EnforcementPage>;
  loadCachedResult(identity: MedicationIdentity | null): Promise<CachedResult | null>;
  persist(identity: MedicationIdentity, finding: NonNullable<WorkflowState['ctx']['finding']>): Promise<void>;
  /** Waits for a scheduled retry. Tests resolve immediately. */
  sleep(ms: number): Promise<void>;
  now(): string;
}

export interface RulesConfig {
  catalog: DataLoadResult<DrugCatalog>;
  policy: DataLoadResult<ExclusionPolicy>;
}

function printedFrom(x: LabelExtraction): PrintedFields {
  return { drugName: x.drugName?.value ?? null, strength: x.strength?.value ?? null, doseForm: x.doseForm?.value ?? null };
}

function lexicon(cfg: RulesConfig): string[] {
  const names = new Set<string>();
  if (cfg.catalog.ok) for (const d of cfg.catalog.value.drugs) for (const i of d.ingredients) names.add(i.name);
  if (cfg.policy.ok) for (const e of cfg.policy.value.entries) names.add(e.ingredient);
  return [...names];
}

function hasUsableField(x: LabelExtraction): boolean {
  return x.ndcTexts.length > 0 || x.drugName !== null || x.strength !== null;
}

async function resolveIdentity(x: LabelExtraction, discardNdc: boolean, ports: Ports, cfg: RulesConfig): Promise<WorkflowEvent> {
  const printed = printedFrom(x);
  const ndcTexts = discardNdc ? [] : x.ndcTexts;
  if (ndcTexts.length > 0) {
    // Union of candidates from every NDC text read; each must be directory-confirmed.
    const candidates = new Map<string, NdcCandidate>();
    let anyValid = false;
    for (const t of ndcTexts) {
      const parsed = parseNdcInput(t.value);
      if (parsed.kind === 'INVALID') continue;
      anyValid = true;
      for (const c of parsed.candidates) candidates.set(c.packageNdc, c);
    }
    if (!anyValid) return { type: 'NDC_REJECTED' };
    const outcomes = new Map<string, NdcDirectoryOutcome>();
    for (const c of candidates.values()) outcomes.set(c.packageNdc, await ports.lookupPackageNdc(c.packageNdc));
    const conf = confirmNdcCandidates(
      { input: '', kind: 'DIGITS_10', candidates: [...candidates.values()], ambiguous: candidates.size > 1 },
      outcomes,
    );
    switch (conf.kind) {
      case 'INVALID':
      case 'REJECTED':
        return { type: 'NDC_REJECTED' };
      case 'UNAVAILABLE':
        return { type: 'LOOKUP_UNAVAILABLE', detail: conf.detail };
      case 'RATE_LIMITED':
        return { type: 'LOOKUP_RATE_LIMITED', retryAfterSeconds: conf.retryAfterSeconds };
      case 'RESOLVED': {
        const cv = crossValidate(printed, conf.product);
        if (cv.status === 'MISMATCH') return { type: 'CROSS_VALIDATION_FAILED', detail: cv.mismatches.join(',') };
        return { type: 'IDENTITY_RESOLVED', identity: identityFromProduct(conf.product, conf.packageNdc, null) };
      }
      case 'AMBIGUOUS': {
        const consistent = conf.options.filter((o) => crossValidate(printed, o.product).status !== 'MISMATCH');
        if (consistent.length === 0) return { type: 'CROSS_VALIDATION_FAILED', detail: 'no candidate matches the printed label' };
        if (consistent.length === 1) {
          const o = consistent[0] as (typeof consistent)[number];
          return { type: 'IDENTITY_RESOLVED', identity: identityFromProduct(o.product, o.packageNdc, null) };
        }
        return { type: 'IDENTITY_AMBIGUOUS', options: consistent.map((o) => identityFromProduct(o.product, o.packageNdc, null)) };
      }
    }
  }
  const r = identityFromPrintedFields(printed, lexicon(cfg), null);
  if (!r.ok) return { type: 'IDENTITY_INCOMPLETE', missing: r.missing };
  return { type: 'IDENTITY_PARTIAL', identity: r.identity };
}

function requiredConfirmations(identity: MedicationIdentity, x: LabelExtraction | null, ndcDiscarded: boolean): string[] {
  const out = new Set<string>();
  if (x) {
    const printed = printedFrom(x);
    const cv = identity.level === 'PRODUCT' ? crossValidate(printed, identity) : null;
    for (const f of fieldsNeedingConfirmation(x, { ndcCrossValidated: cv !== null && cv.status === 'PASS' && !ndcDiscarded })) out.add(f);
    for (const c of cv?.confirmations ?? []) {
      if (c === 'STRENGTH_NOT_PRINTED') out.add('strength');
      if (c === 'DRUG_NAME_NOT_PRINTED') out.add('drugName');
      if (c === 'RELEASE_NOT_PRINTED' || c === 'RELEASE_CONFLICTING') out.add('release');
    }
  }
  if (identity.release === 'UNSPECIFIED') out.add('release');
  // A chosen or derived identity is always shown for confirmation as a whole.
  out.add('identity');
  return [...out].sort();
}

async function fetchQuery(q: RecallQuery, ports: Ports): Promise<QueryResult> {
  const pages: EnforcementPage[] = [];
  let skip = 0;
  for (;;) {
    const page = await ports.fetchRecallPage(q, skip);
    pages.push(page);
    if (page.kind !== 'OK') break;
    const n = page.data.results.length;
    const total = page.data.meta.results.total;
    skip += n;
    if (n === 0 || skip >= total || skip > MAX_SKIP) break;
  }
  return { queryId: q.id, pages };
}

async function fetchEvidence(identity: MedicationIdentity, ports: Ports): Promise<WorkflowEvent> {
  const plan = planRecallQueries(identity);
  const results: QueryResult[] = [];
  for (const q of [...plan.queries, plan.positiveControl.query]) results.push(await fetchQuery(q, ports));
  const bundle: RecallEvidenceBundle = { plan, results, evaluatedAt: ports.now() };
  const pages = results.flatMap((r) => r.pages);
  const limited = pages.find((p) => p.kind === 'RATE_LIMITED');
  if (limited && limited.kind === 'RATE_LIMITED') return { type: 'RATE_LIMITED', retryAfterSeconds: limited.retryAfterSeconds, partial: bundle };
  const down = pages.find((p) => p.kind === 'SOURCE_UNAVAILABLE');
  if (down && down.kind === 'SOURCE_UNAVAILABLE') return { type: 'SOURCE_FAILED', detail: `${down.reason}: ${down.detail}`, partial: bundle };
  return { type: 'EVIDENCE_READY', bundle };
}

/** Execute one effect and return the resulting event(s). */
export async function runEffect(effect: Effect, ports: Ports, cfg: RulesConfig): Promise<WorkflowEvent[]> {
  switch (effect.type) {
    case 'RUN_EXTRACTION': {
      const x = effect.capture.kind === 'MANUAL' ? effect.capture.extraction : await ports.extract(effect.capture);
      return [x !== null && hasUsableField(x) ? { type: 'EXTRACTED', extraction: x } : { type: 'EXTRACTION_EMPTY' }];
    }
    case 'RESOLVE_IDENTITY':
      return [await resolveIdentity(effect.extraction, effect.discardNdc, ports, cfg)];
    case 'CHECK_EXCLUSION': {
      const decision = evaluateExclusion(effect.identity, cfg.policy, cfg.catalog);
      const req = decision.decision === 'ELIGIBLE' ? requiredConfirmations(effect.identity, effect.extraction, effect.ndcDiscarded) : [];
      return [{ type: 'EXCLUSION_DECIDED', decision, requiredConfirmations: req }];
    }
    case 'FETCH_RECALL_EVIDENCE':
      return [await fetchEvidence(effect.identity, ports)];
    case 'EVALUATE_EVIDENCE': {
      const finding = evaluateRecallEvidence(effect.identity, effect.bundle);
      return [{ type: 'ASSESSED', finding, explanation: selectExplanation(effect.identity, finding) }];
    }
    case 'PERSIST_ASSESSMENT':
      try {
        await ports.persist(effect.identity, effect.finding);
        return [{ type: 'PERSISTED' }];
      } catch (err) {
        return [{ type: 'PERSIST_FAILED', detail: err instanceof Error ? err.message : String(err) }];
      }
    case 'LOAD_CACHED_RESULT': {
      const cached = await ports.loadCachedResult(effect.identity);
      return [cached ? { type: 'CACHE_AVAILABLE', cached } : { type: 'CACHE_MISSING' }];
    }
    case 'SCHEDULE_RETRY':
      await ports.sleep(effect.delayMs);
      return [{ type: 'RETRY_DUE' }];
    default: {
      const never: never = effect;
      return never;
    }
  }
}

export interface TraceEntry {
  from: string;
  event: WorkflowEvent['type'];
  to: string;
  effects: Effect['type'][];
  ignored: boolean;
}

/**
 * Apply an event and run resulting effects until the machine waits for the user (no pending
 * effects). Returns the final state and the transition trace.
 */
export async function dispatch(
  state: WorkflowState,
  event: WorkflowEvent,
  ports: Ports,
  cfg: RulesConfig,
  opts: { maxSteps?: number } = {},
): Promise<{ state: WorkflowState; trace: TraceEntry[] }> {
  const trace: TraceEntry[] = [];
  const queue: WorkflowEvent[] = [event];
  let s = state;
  let steps = 0;
  const max = opts.maxSteps ?? 100;
  while (queue.length > 0) {
    if (++steps > max) throw new Error('workflow did not settle');
    const e = queue.shift() as WorkflowEvent;
    const t = reduce(s, e);
    trace.push({ from: s.name, event: e.type, to: t.state.name, effects: t.effects.map((x) => x.type), ignored: t.ignored });
    s = t.state;
    for (const eff of t.effects) queue.push(...(await runEffect(eff, ports, cfg)));
  }
  return { state: s, trace };
}

export { initialState };
