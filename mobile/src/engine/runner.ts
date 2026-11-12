/**
 * Effect runner: executes state-machine effects with injected ports and the pure rules, and turns
 * results into events. It contains no network, storage or OCR code — those are ports supplied by the
 * app (Tasks 3 and 5) or by tests (real-fixture fakes). Everything here runs on the device.
 *
 * Privacy: the only values passed to network ports are public identifiers produced by the rules
 * (candidate package NDCs, and recall queries built from ingredient names and product NDCs). Lots,
 * label text and images never reach a network port.
 */
import type { EnforcementPage, QueryResult, RecallEvidenceBundle, RecallFinding, RecallQuery, RecallQueryPlan } from '../models/evidence.ts';
import type { Explanation } from '../models/explanation.ts';
import type { ExclusionDecision } from '../models/policy.ts';
import { runUntilIdle, type FsmState, type Machine, type RunTraceEntry } from '../fsm/core.ts';
import type { LabelExtraction, MedicationIdentity } from '../models/identity.ts';
import type { DataLoadResult, DrugCatalog, ExclusionPolicy } from '../models/policy.ts';
import { evaluateExclusion } from '../rules/exclusion.ts';
import { selectExplanation } from '../rules/explanation.ts';
import {
  confirmNdcCandidates,
  crossValidate,
  fieldsNeedingConfirmation,
  aliasMap,
  identityFromPrintedFields,
  identityFromProduct,
  withCatalogAliases,
  type NdcDirectoryOutcome,
  type PrintedFields,
} from '../rules/identity.ts';
import { parseNdcInput, type NdcCandidate } from '../rules/ndc.ts';
import { evaluateRecallEvidence, planRecallQueries } from '../rules/recallEvidence.ts';
import {
  initialState,
  rxWorkflow,
  type CachedResult,
  type Capture,
  type Effect,
  type RxMachine,
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
  /**
   * Optional identity enrichment after resolution (Task 3: RxNav ingredient RxCUIs and verified
   * repackager source products). Must never throw; on failure it returns the identity unchanged with
   * `sourceProductStatus` recording what could not be established.
   */
  enrichIdentity?(identity: MedicationIdentity): Promise<MedicationIdentity>;
  /** Waits for a scheduled retry. Tests resolve immediately. */
  sleep(ms: number): Promise<void>;
  now(): string;
}

export interface RulesConfig {
  catalog: DataLoadResult<DrugCatalog>;
  policy: DataLoadResult<ExclusionPolicy>;
}

/**
 * The domain rules the runner calls. Orchestration (state machine + runner) depends only on this
 * interface, not on the recall evidence engine's modules, so either side can change independently
 * and tests or other products can substitute their own rules.
 */
export interface RxRules {
  evaluateExclusion(identity: MedicationIdentity, policy: RulesConfig['policy'], catalog: RulesConfig['catalog']): ExclusionDecision;
  planRecallQueries(identity: MedicationIdentity): RecallQueryPlan;
  evaluateRecallEvidence(identity: MedicationIdentity, bundle: RecallEvidenceBundle): RecallFinding;
  selectExplanation(identity: MedicationIdentity, finding: RecallFinding): Explanation;
}

export const DEFAULT_RX_RULES: RxRules = { evaluateExclusion, planRecallQueries, evaluateRecallEvidence, selectExplanation };

function printedFrom(x: LabelExtraction): PrintedFields {
  return { drugName: x.drugName?.value ?? null, strength: x.strength?.value ?? null, doseForm: x.doseForm?.value ?? null };
}

/** Ingredient names the printed-name path can recognize: catalog ingredients and policy rules (data-driven). */
function lexicon(cfg: RulesConfig): string[] {
  const names = new Set<string>();
  if (cfg.catalog.ok) for (const i of cfg.catalog.value.ingredients) names.add(i.name);
  if (cfg.policy.ok) for (const r of cfg.policy.value.ingredientRules) names.add(r.ingredient);
  return [...names];
}

function catalogAliases(cfg: RulesConfig): Record<string, string> {
  return cfg.catalog.ok ? aliasMap(cfg.catalog.value.ingredients) : {};
}

function enrich(identity: MedicationIdentity, cfg: RulesConfig): MedicationIdentity {
  return cfg.catalog.ok ? withCatalogAliases(identity, cfg.catalog.value.ingredients) : identity;
}

/** Catalog aliases, then the optional enrichment port (RxNav ingredient RxCUIs, verified repackager sources). */
async function finish(identity: MedicationIdentity, ports: Ports, cfg: RulesConfig): Promise<MedicationIdentity> {
  const withAliases = enrich(identity, cfg);
  return ports.enrichIdentity ? ports.enrichIdentity(withAliases) : withAliases;
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
        return { type: 'IDENTITY_RESOLVED', identity: await finish(identityFromProduct(conf.product, conf.packageNdc, null), ports, cfg) };
      }
      case 'AMBIGUOUS': {
        const consistent = conf.options.filter((o) => crossValidate(printed, o.product).status !== 'MISMATCH');
        if (consistent.length === 0) return { type: 'CROSS_VALIDATION_FAILED', detail: 'no candidate matches the printed label' };
        if (consistent.length === 1) {
          const o = consistent[0] as (typeof consistent)[number];
          return { type: 'IDENTITY_RESOLVED', identity: await finish(identityFromProduct(o.product, o.packageNdc, null), ports, cfg) };
        }
        return { type: 'IDENTITY_AMBIGUOUS', options: await Promise.all(consistent.map((o) => finish(identityFromProduct(o.product, o.packageNdc, null), ports, cfg))) };
      }
    }
  }
  const r = identityFromPrintedFields(printed, lexicon(cfg), null, catalogAliases(cfg));
  if (!r.ok) return { type: 'IDENTITY_INCOMPLETE', missing: r.missing };
  return { type: 'IDENTITY_PARTIAL', identity: await finish(r.identity, ports, cfg) };
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

async function fetchEvidence(identity: MedicationIdentity, ports: Ports, rules: RxRules): Promise<WorkflowEvent> {
  const plan = rules.planRecallQueries(identity);
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
export async function runEffect(effect: Effect, ports: Ports, cfg: RulesConfig, rules: RxRules = DEFAULT_RX_RULES): Promise<WorkflowEvent[]> {
  switch (effect.type) {
    case 'RUN_EXTRACTION': {
      const x = effect.capture.kind === 'MANUAL' ? effect.capture.extraction : await ports.extract(effect.capture);
      return [x !== null && hasUsableField(x) ? { type: 'EXTRACTED', extraction: x } : { type: 'EXTRACTION_EMPTY' }];
    }
    case 'RESOLVE_IDENTITY':
      return [await resolveIdentity(effect.extraction, effect.discardNdc, ports, cfg)];
    case 'CHECK_EXCLUSION': {
      const decision = rules.evaluateExclusion(effect.identity, cfg.policy, cfg.catalog);
      const req = decision.decision === 'ELIGIBLE' ? requiredConfirmations(effect.identity, effect.extraction, effect.ndcDiscarded) : [];
      return [{ type: 'EXCLUSION_DECIDED', decision, requiredConfirmations: req }];
    }
    case 'FETCH_RECALL_EVIDENCE':
      return [await fetchEvidence(effect.identity, ports, rules)];
    case 'EVALUATE_EVIDENCE': {
      const finding = rules.evaluateRecallEvidence(effect.identity, effect.bundle);
      return [{ type: 'ASSESSED', finding, explanation: rules.selectExplanation(effect.identity, finding) }];
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

export type TraceEntry = RunTraceEntry;

/**
 * Apply an event and run resulting effects until the machine waits for the user (no pending
 * effects). Returns the final state and the transition trace. `machine` defaults to the standard
 * workflow; pass a variant built with `createRxWorkflow` to run it with the same effects.
 * A transition vetoed by a safety gate stops the run (see `trace[].rejectedBy`).
 */
export async function dispatch(
  state: WorkflowState,
  event: WorkflowEvent,
  ports: Ports,
  cfg: RulesConfig,
  opts: { maxSteps?: number; machine?: RxMachine; rules?: RxRules } = {},
): Promise<{ state: WorkflowState; trace: TraceEntry[] }> {
  const machine = opts.machine ?? rxWorkflow;
  const rules = opts.rules ?? DEFAULT_RX_RULES;
  const r = await runUntilIdle(machine, state, event, (eff) => runEffect(eff, ports, cfg, rules), { maxSteps: opts.maxSteps ?? 100 });
  return { state: r.state as WorkflowState, trace: r.trace };
}

/** Like `dispatch`, for workflow variants with extra states and events. */
export async function dispatchVariant<S extends string, E extends { type: string }>(
  machine: Machine<S, WorkflowState['ctx'], E, Effect>,
  state: FsmState<S, WorkflowState['ctx']>,
  event: E,
  ports: Ports,
  cfg: RulesConfig,
  opts: { maxSteps?: number; rules?: RxRules } = {},
): Promise<{ state: FsmState<S, WorkflowState['ctx']>; trace: TraceEntry[] }> {
  const rules = opts.rules ?? DEFAULT_RX_RULES;
  return runUntilIdle(machine, state, event, async (eff) => (await runEffect(eff, ports, cfg, rules)) as unknown as E[], {
    maxSteps: opts.maxSteps ?? 100,
  });
}

export { initialState };
