/**
 * Workflow variants built with createRxWorkflow (docs/STATE_MACHINE_GUIDE.md):
 *  - an alternative workflow (no automatic retries; save before explaining),
 *  - an additional optional state (patient attestation before any recall request),
 *  - misconfigured variants that try to skip the exclusion check, the patient confirmation or the
 *    evidence evaluation — every one is vetoed by the mandatory safety gates.
 * Runs the real effect runner and rules against real openFDA fixtures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MachineDefinitionError } from '../../mobile/src/fsm/core.ts';
import {
  RX_SAFETY_GATES,
  createRxWorkflow,
  initialState,
  rxWorkflow,
  type RxMachine,
  type RxRule,
  type WorkflowState,
} from '../../mobile/src/state/machine.ts';
import { dispatch, dispatchVariant, type Ports } from '../../mobile/src/engine/runner.ts';
import type { EnforcementPage, RecallQuery } from '../../mobile/src/models/evidence.ts';
import type { FieldValue, LabelExtraction } from '../../mobile/src/models/identity.ts';
import { RETRIEVED_AT, control, enf, ndc, realServerError, rulesConfig } from '../helpers/fixtures.ts';

const cfg = rulesConfig();
const ocr = (value: string): FieldValue<string> => ({ value, origin: 'OCR', confidence: 0.97, confirmedByUser: false });

/** Sun metformin ER 500 mg label: the known recalled product (D-0325-2021, lot JKU4639A). */
const LABEL: LabelExtraction = {
  ndcTexts: [ocr('62756-142-02')],
  drugName: ocr('METFORMIN HCL ER'),
  strength: ocr('500 MG'),
  doseForm: ocr('TABLET'),
  labelerText: null,
  lot: null,
  expiry: null,
  containerType: 'PHARMACY_VIAL',
};

function ports(opts: { recallsFail?: boolean } = {}) {
  const audit = { recallQueries: [] as string[], persisted: 0 };
  const recalls: Record<string, () => EnforcementPage> = {
    'product_description:"metformin"': () => enf('enf_text_metformin'),
    'openfda.product_ndc:"62756-142"': () => enf('enf_pndc_62756-142'),
  };
  const p: Ports = {
    extract: async () => null,
    lookupPackageNdc: async (n) => (n === '62756-142-02' ? ndc('ndc_pkg_62756-142-02') : ndc('ndc_pkg_62756-0142-2')),
    fetchRecallPage: async (q: RecallQuery) => {
      audit.recallQueries.push(q.search);
      if (opts.recallsFail) return realServerError();
      if (q.kind === 'POSITIVE_CONTROL') return control();
      const f = recalls[q.search];
      if (!f) throw new Error(`unexpected query ${q.search}`);
      return f();
    },
    loadCachedResult: async () => null,
    persist: async () => {
      audit.persisted++;
    },
    sleep: async () => undefined,
    now: () => RETRIEVED_AT,
  };
  return { ports: p, audit };
}

const CAPTURE = { type: 'CAPTURED', capture: { kind: 'MANUAL', extraction: LABEL } } as const;
const CONFIRM_ALL = (s: { ctx: WorkflowState['ctx'] }) =>
  ({ type: 'USER_CONFIRMED' as const, confirmedFields: [...s.ctx.requiredConfirmations, 'lot'], lot: 'JKU4639A', lotChoice: 'USE' as const });

// ---------------------------------------------------------------- the default workflow is unchanged

test('default workflow: rule table and gates are in place', () => {
  assert.equal(rxWorkflow.definition.rules.length, 30);
  assert.deepEqual(rxWorkflow.gates.map((g) => g.id), RX_SAFETY_GATES.map((g) => g.id));
});

// ---------------------------------------------------------------- alternative workflow

/**
 * "Kiosk" variant: no automatic retries (RETRY state removed; failures go straight to
 * SOURCE_UNAVAILABLE or to evaluation of partial evidence), and the result is saved before it is
 * explained (EVALUATE → SAVE → EXPLAIN instead of EVALUATE → EXPLAIN → SAVE).
 */
const kiosk = createRxWorkflow({
  id: 'kiosk',
  removeStates: ['RETRY'],
  customize: (rules, kit) => {
    let r = kit.removeRule(rules, 'retry.due');
    r = kit.replaceRule(r, 'identify.lookup-unavailable', {
      id: 'kiosk.identify-unavailable',
      from: ['IDENTIFY'], on: ['LOOKUP_UNAVAILABLE'], to: ['SOURCE_UNAVAILABLE'], emits: ['LOAD_CACHED_RESULT'],
      apply: (s) => kit.go('SOURCE_UNAVAILABLE', { ...s.ctx, failedStep: 'IDENTIFY' }, [{ type: 'LOAD_CACHED_RESULT', identity: s.ctx.identity }]),
    });
    r = kit.replaceRule(r, 'fetch.source-failed', {
      id: 'kiosk.fetch-failed',
      from: ['FETCH_EVIDENCE'], on: ['SOURCE_FAILED'], to: ['EVALUATE', 'SOURCE_UNAVAILABLE'], emits: ['EVALUATE_EVIDENCE', 'LOAD_CACHED_RESULT'],
      apply: (s, e) => {
        if (e.type !== 'SOURCE_FAILED') return null;
        const ctx = { ...s.ctx, failedStep: 'FETCH_EVIDENCE' as const, bundle: e.partial ?? s.ctx.bundle };
        const hasData = ctx.bundle?.results.some((q) => q.pages.some((p) => p.kind === 'OK')) ?? false;
        return hasData && ctx.identity && ctx.bundle
          ? kit.go('EVALUATE', ctx, [{ type: 'EVALUATE_EVIDENCE', identity: ctx.identity, bundle: ctx.bundle }])
          : kit.go('SOURCE_UNAVAILABLE', ctx, [{ type: 'LOAD_CACHED_RESULT', identity: ctx.identity }]);
      },
    });
    // Reorder: save immediately after evaluation, then explain.
    r = kit.replaceRule(r, 'evaluate.assessed', {
      id: 'kiosk.assessed-save-first',
      from: ['EVALUATE'], on: ['ASSESSED'], to: ['SAVE'], emits: ['PERSIST_ASSESSMENT'],
      apply: (s, e) => {
        if (e.type !== 'ASSESSED' || !s.ctx.identity) return null;
        return kit.go('SAVE', { ...s.ctx, finding: e.finding, explanation: e.explanation }, [
          { type: 'PERSIST_ASSESSMENT', identity: s.ctx.identity, finding: e.finding },
        ]);
      },
    });
    r = kit.replaceRule(r, 'save.persisted', {
      id: 'kiosk.persisted-explain',
      from: ['SAVE'], on: ['PERSISTED'], to: ['EXPLAIN'],
      apply: (s) => kit.go('EXPLAIN', s.ctx),
    });
    return kit.removeRule(r, 'explain.save');
  },
});

test('alternative workflow: save-first order produces the same finding as the default workflow', async () => {
  const a = ports();
  const d1 = await dispatch(initialState(), CAPTURE, a.ports, cfg);
  const d2 = await dispatch(d1.state, CONFIRM_ALL(d1.state), a.ports, cfg);
  assert.equal(d2.state.ctx.finding?.finding, 'CONFIRMED_MATCH');

  const b = ports();
  const k1 = await dispatch(initialState(), CAPTURE, b.ports, cfg, { machine: kiosk });
  assert.equal(k1.state.name, 'CONFIRM', 'exclusion check and confirmation are unchanged');
  const k2 = await dispatch(k1.state, CONFIRM_ALL(k1.state), b.ports, cfg, { machine: kiosk });
  assert.deepEqual(k2.trace.map((t) => t.to), ['FETCH_EVIDENCE', 'EVALUATE', 'SAVE', 'EXPLAIN']);
  assert.equal(k2.state.ctx.finding?.finding, 'CONFIRMED_MATCH');
  assert.equal(b.audit.persisted, 1);
  assert.deepEqual(k2.state.ctx.finding, d2.state.ctx.finding);
});

test('alternative workflow: no automatic retries — a failed fetch goes straight to SOURCE_UNAVAILABLE', async () => {
  const { ports: p, audit } = ports({ recallsFail: true });
  const k1 = await dispatch(initialState(), CAPTURE, p, cfg, { machine: kiosk });
  const k2 = await dispatch(k1.state, CONFIRM_ALL(k1.state), p, cfg, { machine: kiosk });
  assert.equal(k2.state.name, 'SOURCE_UNAVAILABLE');
  assert.ok(!k2.trace.some((t) => t.to === 'RETRY'));
  assert.equal(audit.recallQueries.length, 3, 'one round only');
  assert.ok(!kiosk.definition.states.includes('RETRY' as never));
});

test('removing a state that rules still use is a construction error, not a silent change', () => {
  assert.throws(() => createRxWorkflow({ removeStates: ['RETRY'] }), (e: unknown) => e instanceof MachineDefinitionError && /undeclared state "RETRY"/.test(e.message));
});

// ---------------------------------------------------------------- additional optional state

type AttestationEvent = { type: 'PATIENT_ATTESTED' } | { type: 'ATTESTATION_DECLINED' };

/** Optional extra patient confirmation between CONFIRM and the recall request. */
const withAttestation = createRxWorkflow<'PATIENT_ATTESTATION', AttestationEvent>({
  id: 'with-attestation',
  extraStates: ['PATIENT_ATTESTATION'],
  customize: (rules, kit) => {
    const toAttestation: RxRule<'PATIENT_ATTESTATION', AttestationEvent> = {
      id: 'confirm.to-attestation',
      description: 'Complete confirmation leads to an attestation step instead of fetching',
      from: ['CONFIRM'], on: ['USER_CONFIRMED'], to: ['CONFIRM', 'PATIENT_ATTESTATION'],
      apply: (s, e) => {
        if (e.type !== 'USER_CONFIRMED') return null;
        const r = kit.applyUserConfirmation(s.ctx, e);
        return r.complete ? { name: 'PATIENT_ATTESTATION', ctx: r.ctx } : { name: 'CONFIRM', ctx: r.ctx };
      },
    };
    const added: RxRule<'PATIENT_ATTESTATION', AttestationEvent>[] = [
      {
        id: 'attestation.accepted',
        from: ['PATIENT_ATTESTATION'], on: ['PATIENT_ATTESTED'], to: ['FETCH_EVIDENCE'], emits: ['FETCH_RECALL_EVIDENCE'],
        apply: (s) => kit.startEvidenceFetch(s.ctx),
      },
      {
        id: 'attestation.declined',
        from: ['PATIENT_ATTESTATION'], on: ['ATTESTATION_DECLINED'], to: ['USER_CORRECTION'],
        apply: (s) => ({ name: 'USER_CORRECTION', ctx: { ...s.ctx, confirmation: null } }),
      },
      {
        id: 'attestation.restart',
        from: ['PATIENT_ATTESTATION'], on: ['RESTART', 'DONE'], to: ['SCAN'],
        apply: () => ({ name: 'SCAN', ctx: kit.emptyContext() }),
      },
    ];
    return [...kit.replaceRule(rules, 'confirm.user-confirmed', toAttestation), ...added];
  },
});

test('optional state: PATIENT_ATTESTATION sits between confirmation and the recall request', async () => {
  const { ports: p, audit } = ports();
  const s1 = await dispatchVariant(withAttestation, initialState(), CAPTURE, p, cfg);
  assert.equal(s1.state.name, 'CONFIRM');
  const s2 = await dispatchVariant(withAttestation, s1.state, CONFIRM_ALL(s1.state), p, cfg);
  assert.equal(s2.state.name, 'PATIENT_ATTESTATION');
  assert.equal(audit.recallQueries.length, 0, 'nothing is requested before attestation');
  const s3 = await dispatchVariant(withAttestation, s2.state, { type: 'PATIENT_ATTESTED' }, p, cfg);
  assert.deepEqual(s3.trace.map((t) => t.to), ['FETCH_EVIDENCE', 'EVALUATE', 'EXPLAIN']);
  assert.equal(s3.state.ctx.finding?.finding, 'CONFIRMED_MATCH');
});

test('optional state: declining attestation returns to correction without any request', async () => {
  const { ports: p, audit } = ports();
  const s1 = await dispatchVariant(withAttestation, initialState(), CAPTURE, p, cfg);
  const s2 = await dispatchVariant(withAttestation, s1.state, CONFIRM_ALL(s1.state), p, cfg);
  const s3 = await dispatchVariant(withAttestation, s2.state, { type: 'ATTESTATION_DECLINED' }, p, cfg);
  assert.equal(s3.state.name, 'USER_CORRECTION');
  assert.equal(audit.recallQueries.length, 0);
});

test('optional state: an incomplete confirmation still stays in CONFIRM (the default guard is reused)', async () => {
  const { ports: p } = ports();
  const s1 = await dispatchVariant(withAttestation, initialState(), CAPTURE, p, cfg);
  const s2 = await dispatchVariant(withAttestation, s1.state, { type: 'USER_CONFIRMED', confirmedFields: [], lot: null }, p, cfg);
  assert.equal(s2.state.name, 'CONFIRM');
  assert.deepEqual(s2.state.ctx.unconfirmed, s1.state.ctx.requiredConfirmations);
});

// ---------------------------------------------------------------- configuration cannot bypass safety

async function runToHalt(machine: RxMachine, events: ((s: WorkflowState) => Parameters<typeof dispatch>[1])[]) {
  const { ports: p, audit } = ports();
  let s: WorkflowState = initialState();
  let last;
  for (const ev of events) {
    last = await dispatch(s, ev(s), p, cfg, { machine });
    s = last.state;
    if (last.trace.some((t) => t.rejectedBy)) break;
  }
  return { state: s, rejected: last?.trace.find((t) => t.rejectedBy)?.rejectedBy ?? null, audit };
}

test('bypass attempt: fetching recalls straight from IDENTIFY (skipping exclusion and confirmation) is vetoed', async () => {
  const skipAll = createRxWorkflow({
    customize: (rules, kit) =>
      kit.insertBefore(rules, 'identify.resolved', {
        id: 'bad.identify-to-fetch',
        from: ['IDENTIFY'], on: ['IDENTITY_RESOLVED'], to: ['FETCH_EVIDENCE'], emits: ['FETCH_RECALL_EVIDENCE'],
        apply: (s, e) => (e.type === 'IDENTITY_RESOLVED' ? kit.startEvidenceFetch({ ...s.ctx, identity: e.identity }) : null),
      }),
  });
  const r = await runToHalt(skipAll, [() => CAPTURE]);
  assert.match(r.rejected ?? '', /^exclusion-before-evidence/);
  assert.equal(r.state.name, 'IDENTIFY');
  assert.equal(r.audit.recallQueries.length, 0);
});

test('bypass attempt: skipping the patient confirmation after an ELIGIBLE decision is vetoed', async () => {
  const skipConfirm = createRxWorkflow({
    customize: (rules, kit) =>
      kit.insertBefore(rules, 'exclusion.decided', {
        id: 'bad.eligible-to-fetch',
        from: ['CHECK_EXCLUSION'], on: ['EXCLUSION_DECIDED'], to: ['FETCH_EVIDENCE'], emits: ['FETCH_RECALL_EVIDENCE'],
        guard: (_s, e) => e.type === 'EXCLUSION_DECIDED' && e.decision.decision === 'ELIGIBLE',
        apply: (s, e) => {
          if (e.type !== 'EXCLUSION_DECIDED' || !s.ctx.identity) return null;
          // Even a correctly recorded decision is not enough without the user's confirmation.
          return kit.startEvidenceFetch({ ...s.ctx, exclusion: e.decision, exclusionKey: null });
        },
      }),
  });
  const r = await runToHalt(skipConfirm, [() => CAPTURE]);
  assert.ok(r.rejected !== null && /^(exclusion|confirmation)-before-evidence/.test(r.rejected), String(r.rejected));
  assert.equal(r.audit.recallQueries.length, 0);
});

test('bypass attempt: fabricating a confirmation outside USER_CONFIRMED is vetoed', async () => {
  const forged = createRxWorkflow({
    customize: (rules, kit) =>
      kit.insertBefore(rules, 'confirm.edit', {
        id: 'bad.edit-confirms',
        from: ['CONFIRM'], on: ['EDIT_REQUESTED'], to: ['FETCH_EVIDENCE'], emits: ['FETCH_RECALL_EVIDENCE'],
        apply: (s) =>
          kit.startEvidenceFetch({ ...s.ctx, unconfirmed: [], confirmation: { fields: s.ctx.requiredConfirmations, exclusionKey: s.ctx.exclusionKey ?? '' } }),
      }),
  });
  const r = await runToHalt(forged, [() => CAPTURE, () => ({ type: 'EDIT_REQUESTED' })]);
  assert.match(r.rejected ?? '', /^confirmation-provenance/);
  assert.equal(r.audit.recallQueries.length, 0);
});

test('bypass attempt: routing an EXCLUDED/UNSUPPORTED decision into CONFIRM is vetoed', async () => {
  const ignoreDecision = createRxWorkflow({
    customize: (rules, kit) =>
      kit.replaceRule(rules, 'exclusion.decided', {
        id: 'bad.always-confirm',
        from: ['CHECK_EXCLUSION'], on: ['EXCLUSION_DECIDED'], to: ['CONFIRM'],
        apply: (s, e) => (e.type === 'EXCLUSION_DECIDED' ? kit.go('CONFIRM', { ...s.ctx, exclusion: e.decision }) : null),
      }),
  });
  // Warfarin: the policy says EXCLUDED.
  const { ports: p, audit } = ports();
  const warfarin: LabelExtraction = { ...LABEL, ndcTexts: [], drugName: ocr('WARFARIN'), strength: ocr('5 MG') };
  const r = await dispatch(initialState(), { type: 'CAPTURED', capture: { kind: 'MANUAL', extraction: warfarin } }, p, cfg, { machine: ignoreDecision });
  const rejected = r.trace.find((t) => t.rejectedBy)?.rejectedBy ?? '';
  assert.match(rejected, /^policy-routing: EXCLUDED decision routed to "CONFIRM"/);
  assert.equal(r.state.name, 'CHECK_EXCLUSION');
  assert.equal(audit.recallQueries.length, 0);
});

test('bypass attempt: producing a finding without evaluating the retrieved evidence is vetoed', async () => {
  const fakeFinding = createRxWorkflow({
    customize: (rules, kit) =>
      kit.replaceRule(rules, 'fetch.evidence-ready', {
        id: 'bad.skip-evaluation',
        from: ['FETCH_EVIDENCE'], on: ['EVIDENCE_READY'], to: ['EXPLAIN'],
        apply: (s) => kit.go('EXPLAIN', { ...s.ctx, finding: { finding: 'NO_MATCH_FOUND' } as never }),
      }),
  });
  const r = await runToHalt(fakeFinding, [() => CAPTURE, (s) => CONFIRM_ALL(s)]);
  assert.match(r.rejected ?? '', /^evidence-integrity: finding set by "EVIDENCE_READY"/);
  assert.notEqual(r.state.name, 'EXPLAIN');
});

test('a rule that emits an effect it did not declare is vetoed by the core', () => {
  const sneaky = createRxWorkflow({
    customize: (rules, kit) =>
      kit.replaceRule(rules, 'scan.captured', {
        id: 'bad.undeclared',
        from: ['SCAN'], on: ['CAPTURED'], to: ['EXTRACT'], emits: [],
        apply: (_s, e) => (e.type === 'CAPTURED' ? kit.go('EXTRACT', kit.emptyContext(), [{ type: 'RUN_EXTRACTION', capture: e.capture }]) : null),
      }),
  });
  const t = sneaky.step(initialState(), CAPTURE);
  assert.match(t.rejectedBy ?? '', /^undeclared-effect/);
  assert.equal(t.state.name, 'SCAN');
});

test('gates cannot be configured away: every variant carries all safety gates', () => {
  for (const gates of [rxWorkflow.gates, kiosk.gates, withAttestation.gates]) {
    assert.deepEqual(gates.map((g) => g.id), ['exclusion-provenance', 'confirmation-provenance', 'exclusion-before-evidence', 'confirmation-before-evidence', 'evidence-integrity', 'policy-routing']);
  }
});
