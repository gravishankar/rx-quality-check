/**
 * Composition root: wires configuration, the public-API clients, the privacy guard, storage and the
 * existing workflow (state machine + safety gates + recall engine). Everything with side effects is
 * injected (transport, clock, sleep, database), so the same wiring runs on the phone, in the
 * command-line integration (recorded or live) and in tests. No logic is duplicated here.
 */
import { dispatch, initialState, type Ports, type RulesConfig } from '../engine/runner.ts';
import type { LabelExtraction, MedicationIdentity } from '../models/identity.ts';
import { loadRxConfig, type ConfigProblem, type LoadOptions } from '../rules/catalog.ts';
import { RULESET_VERSION } from '../rules/version.ts';
import { BRAND } from '../brand/brand.ts';
import { createDailyMedClient } from '../services/dailymed.ts';
import { createOpenFdaClient } from '../services/openfda.ts';
import { createLivePorts } from '../services/ports.ts';
import { createRxNavClient } from '../services/rxnav.ts';
import { guardedTransport, type AuditLog, type HttpTransport } from '../services/transport.ts';
import type { WorkflowEvent, WorkflowState } from '../state/machine.ts';
import { createAssessmentStore, type Repositories } from '../storage/repositories.ts';

export interface AppConfig {
  displayName: string;
  acceptUnapprovedConfig: boolean;
}

/**
 * Parse config/app_config.json. The display name now comes from config/brand.json (Task 4A.1);
 * a display_name here is accepted only for backward compatibility.
 */
export function parseAppConfig(json: unknown): AppConfig {
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  const displayName = typeof o.display_name === 'string' && o.display_name.trim() !== '' ? o.display_name.trim() : BRAND.productName;
  return { displayName, acceptUnapprovedConfig: o.accept_unapproved_config === true };
}

export interface RecallCheckDeps {
  transport: HttpTransport;
  now: () => string;
  sleep: (ms: number) => Promise<void>;
  catalogJson: unknown;
  policyJson: unknown;
  load?: LoadOptions;
  repos?: Repositories;
  timeoutMs?: number;
}

export interface RecallCheck {
  cfg: RulesConfig;
  configProblems: ConfigProblem[];
  ports: Ports;
  audit: AuditLog;
  /** Patient-specific values the privacy guard refuses to send (armed per label). */
  setPrivateValues(values: string[]): void;
  scan(extraction: LabelExtraction): Promise<{ state: WorkflowState; trace: string[] }>;
  send(state: WorkflowState, event: WorkflowEvent): Promise<{ state: WorkflowState; trace: string[] }>;
}

export function createRecallCheck(d: RecallCheckDeps): RecallCheck {
  const config = loadRxConfig(d.catalogJson, d.policyJson, d.load ?? {});
  const cfg: RulesConfig = { catalog: config.catalog, policy: config.policy };
  let privateValues: string[] = [];
  const audit: AuditLog = { entries: [] };
  const transport = guardedTransport(d.transport, { sensitiveValues: () => privateValues }, audit);
  const deps = { transport, now: d.now, ...(d.timeoutMs ? { timeoutMs: d.timeoutMs } : {}) };
  const versions = {
    rulesetVersion: RULESET_VERSION,
    policyVersion: cfg.policy.ok ? cfg.policy.value.policyVersion : 'invalid',
    catalogVersion: cfg.catalog.ok ? cfg.catalog.value.catalogVersion : 'invalid',
  };
  const displayNameOf = (identity: MedicationIdentity) => {
    const names = identity.ingredients.map((i) => i.name).sort();
    const drug = cfg.catalog.ok ? cfg.catalog.value.drugs.find((x) => [...x.ingredientIds].sort().join('+') === names.join('+')) : undefined;
    return { displayName: drug?.displayName ?? names.join(' / '), catalogDrugId: drug?.id ?? null };
  };
  const ports = createLivePorts({
    openfda: createOpenFdaClient(deps),
    rxnav: createRxNavClient(deps),
    dailymed: createDailyMedClient(deps),
    ...(d.repos ? { cache: d.repos.cache, store: createAssessmentStore(d.repos, versions, displayNameOf) } : {}),
    now: d.now,
    sleep: d.sleep,
  });
  const trace = (r: { state: WorkflowState; trace: { to: string }[] }) => ({ state: r.state, trace: r.trace.map((t) => t.to) });
  return {
    cfg,
    configProblems: config.problems,
    ports,
    audit,
    setPrivateValues(values) {
      privateValues = values.filter((v) => v.trim().length >= 3);
    },
    async scan(extraction) {
      // Arm the guard with everything on the label that must never leave the phone.
      this.setPrivateValues([
        ...(extraction.privateText ?? []),
        ...(extraction.lot ? [extraction.lot.value] : []),
        ...(extraction.expiry ? [extraction.expiry.value] : []),
      ]);
      return trace(await dispatch(initialState(), { type: 'CAPTURED', capture: { kind: 'MANUAL', extraction } }, ports, cfg));
    },
    async send(state, event) {
      // A lot typed or corrected at confirmation is also never sent.
      if (event.type === 'USER_CONFIRMED' && event.lot) this.setPrivateValues([...privateValues, event.lot]);
      return trace(await dispatch(state, event, ports, cfg));
    },
  };
}
