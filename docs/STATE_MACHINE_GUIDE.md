# State Machine Guide

How the workflow state machine is built, how to change it, and which parts you cannot change.

| Layer | File | Knows about Rx? | Purpose |
|---|---|---|---|
| Generic core | `mobile/src/fsm/core.ts` | No | Rules, gates, validation, graph queries, rule-list editing, run loop |
| Rx workflow | `mobile/src/state/machine.ts` | Yes | States, context, events, effects, the default rule table `RX_RULES`, the safety gates `RX_SAFETY_GATES`, `createRxWorkflow` |
| Effect runner | `mobile/src/engine/runner.ts` | Yes | Executes effects through injected ports and the domain rules (`RxRules`) |
| Domain rules | `mobile/src/rules/*` | Yes | Identity, exclusion and recall evidence; never imported by `fsm/` or `state/` |

## 1. Concepts

- **State:** `{ name, ctx }`. For Rx, `ctx` is `WorkflowContext`.
- **Event:** an input with a `type`, either from the user (`USER_CONFIRMED`) or from an effect's result (`EVIDENCE_READY`).
- **Effect:** a descriptor of work for the runner (`FETCH_RECALL_EVIDENCE`). The machine never performs I/O.
- **Rule:** in states `from`, on events `on`, if `guard` holds, `apply` returns the next state and effects. `to` and `emits` must list every state and effect type the rule can produce; the core rejects anything undeclared.
- **Order:** rules are tried in array order. The first rule whose `from`, `on` and `guard` match handles the event. If no rule matches, the event is ignored and the state is unchanged.
- **Gate:** a mandatory invariant checked after every rule. If a gate fails, the transition is rejected: the state is unchanged, no effects run, and `rejectedBy` names the gate. Gates are passed to the machine separately from the rules, so no edit to the rule table can remove them.

```ts
const t = rxWorkflow.step(state, event);  // { state, effects, ignored, ruleId, rejectedBy }
```

`reduce(state, event)` is the same as `rxWorkflow.step`, kept for the existing API. `dispatch(...)` (runner) applies an event and runs the resulting effects until the machine waits for the user.

## 2. Mandatory safety gates (`RX_SAFETY_GATES`)

Every machine built with `createRxWorkflow` carries all of these, whatever `customize` returns:

| Gate | Guarantees |
|---|---|
| `exclusion-provenance` | `ctx.exclusion` can only be set by an `EXCLUSION_DECIDED` event, which the runner produces from the policy evaluation. |
| `confirmation-provenance` | `ctx.confirmation` can only be set by a `USER_CONFIRMED` event, listing only fields the user confirmed. |
| `exclusion-before-evidence` | `FETCH_RECALL_EVIDENCE`, `EVALUATE_EVIDENCE` and `PERSIST_ASSESSMENT` need an `ELIGIBLE` decision made for the current identity (compared via `exclusionKeyOf`). |
| `confirmation-before-evidence` | The same effects need a user confirmation that covers `identity` and every required field, made for the current identity, with a stated release mechanism. |
| `evidence-integrity` | Evaluation runs on the bundle stored in the context; a finding can only come from an `ASSESSED` event after evidence was retrieved; the saved finding is the evaluated one. |
| `policy-routing` | `EXCLUDED` / `UNSUPPORTED` / `NEEDS_CLARIFICATION` match the decision, and a non-eligible decision can only lead to that state, `SCAN` or `USER_CORRECTION`. |

The core adds two checks for every machine: `undeclared-target` and `undeclared-effect`.

**What gates protect against:** mistakes in configuration, such as reordered or removed rules, a new state that skips a step, or a rule that copies context incorrectly. They check the data in the context, not the path taken, so they hold for any workflow order.

**What gates do not protect against:** code that is deliberately written to defeat them, for example by fabricating an `EXCLUSION_DECIDED` event in a custom runner. Rule code and runner code go through code review like any other code. Changing `RX_SAFETY_GATES` itself is a safety change: it needs a release-gate review (`docs/TEST_PLAN.md` §6) and must keep `tests/integration/workflow_variants.test.ts` passing.

## 3. Changing the default workflow

The default table is `RX_RULES` in `state/machine.ts`. Each rule has a stable `id` in the form `<state>.<event-or-purpose>`, for example `confirm.user-confirmed` or `fetch.source-failed`.

**Change a transition:** edit the rule's `apply` (and `to`/`emits` if targets change). Example: send `CROSS_VALIDATION_FAILED` straight to `MISSING_INFORMATION`:

```ts
{
  id: 'identify.ndc-discarded',
  from: ['IDENTIFY'], on: ['CROSS_VALIDATION_FAILED', 'NDC_REJECTED'], to: ['MISSING_INFORMATION'],
  apply: (s) => go('MISSING_INFORMATION', { ...s.ctx, missing: ['ndc'] }),
}
```

**Add a guard:** add `guard(state, event)`. When it returns false, the next matching rule is tried, so you can stack rules with different guards for the same state and event.

**Add a recovery path:** add a rule for the failure event from the state where it happens. For example, `RATE_LIMITED` with `USER_RETRY` goes back to the failed step (`unavailable.user-retry`). Reuse the context fields `failedStep`, `attempts`, `retryPending` and `rateLimitAutoRetried`, and keep the budgets (`MAX_ATTEMPTS`, `BACKOFF_MS`).

**Add a state:** add it to `StateName` and `RX_STATES`, then add rules that enter and leave it. `createMachine` fails with `MachineDefinitionError` if any rule names a state that isn't declared.

**Remove a state:** remove the rules that use it, then the state. Construction fails if any rule still refers to it.

After any change, run `npm test`. `tests/unit/state_machine.test.ts` has one test per default transition; update the row that matches your change.

## 4. Workflow variants without editing the default

Use `createRxWorkflow` to build a variant from the default table:

```ts
const variant = createRxWorkflow<'EXTRA_STATE', ExtraEvent>({
  id: 'my-variant',
  extraStates: ['EXTRA_STATE'],          // new states
  removeStates: ['RETRY'],               // built-in states to drop
  customize: (rules, kit) => {           // receives a copy of RX_RULES
    let r = kit.replaceRule(rules, 'some.rule', newRule);
    r = kit.insertBefore(r, 'other.rule', higherPriorityRule);
    r = kit.removeRule(r, 'unused.rule');
    return r;
  },
});
await dispatch(state, event, ports, cfg, { machine: variant });          // same events as default
await dispatchVariant(variant, state, extraEvent, ports, cfg);           // with extra events
```

`kit` contains the rule-list helpers (`replaceRule`, `removeRule`, `insertBefore`, `insertAfter`) and the default building blocks:
- `go(name, ctx, effects)`
- `applyUserConfirmation(ctx, event)`: the default confirmation logic, including the lot and release handling.
- `startEvidenceFetch(ctx)`
- `emptyContext()`

Reuse these rather than copying their logic.

### 4.1 Example: optional step (extra patient confirmation)

This is tested in `tests/integration/workflow_variants.test.ts`. A complete confirmation now leads to `PATIENT_ATTESTATION`, and the recall request starts only after `PATIENT_ATTESTED`:

```ts
createRxWorkflow<'PATIENT_ATTESTATION', { type: 'PATIENT_ATTESTED' } | { type: 'ATTESTATION_DECLINED' }>({
  extraStates: ['PATIENT_ATTESTATION'],
  customize: (rules, kit) => [
    ...kit.replaceRule(rules, 'confirm.user-confirmed', {
      id: 'confirm.to-attestation', from: ['CONFIRM'], on: ['USER_CONFIRMED'], to: ['CONFIRM', 'PATIENT_ATTESTATION'],
      apply: (s, e) => {
        if (e.type !== 'USER_CONFIRMED') return null;
        const r = kit.applyUserConfirmation(s.ctx, e);
        return { name: r.complete ? 'PATIENT_ATTESTATION' : 'CONFIRM', ctx: r.ctx };
      },
    }),
    { id: 'attestation.accepted', from: ['PATIENT_ATTESTATION'], on: ['PATIENT_ATTESTED'], to: ['FETCH_EVIDENCE'],
      emits: ['FETCH_RECALL_EVIDENCE'], apply: (s) => kit.startEvidenceFetch(s.ctx) },
    { id: 'attestation.declined', from: ['PATIENT_ATTESTATION'], on: ['ATTESTATION_DECLINED'], to: ['USER_CORRECTION'],
      apply: (s) => ({ name: 'USER_CORRECTION', ctx: { ...s.ctx, confirmation: null } }) },
  ],
});
```

### 4.2 Example: alternative order (no automatic retries, save before explaining)

This is the "kiosk" variant in the same test file. It removes `RETRY`, replaces the failure rules so they go straight to `SOURCE_UNAVAILABLE` (or evaluate partial evidence), and reorders the end of the flow to `EVALUATE → SAVE → EXPLAIN`. It produces the same finding as the default workflow.

### 4.3 What a variant cannot do

The test file shows each of these being rejected:
- Fetching recalls from `IDENTIFY` (skipping the exclusion check and confirmation): `exclusion-before-evidence`.
- Fetching straight after an `ELIGIBLE` decision without `CONFIRM`: `exclusion-before-evidence` / `confirmation-before-evidence`.
- Recording a confirmation from any event other than `USER_CONFIRMED`: `confirmation-provenance`.
- Routing an `EXCLUDED` decision to `CONFIRM`: `policy-routing`.
- Producing a finding without evaluating the retrieved evidence: `evidence-integrity`.
- Emitting an effect the rule didn't declare: `undeclared-effect`.
- Removing a state that rules still use: `MachineDefinitionError`.

A rejected transition stops `dispatch`. Its trace entry carries `rejectedBy`. In the app (Task 4), treat a rejection as a programming error: show a neutral error screen and never show a result.

## 5. Reusing the core in another application

`fsm/core.ts` has no imports. Define your own states, context, events, effects, rules and gates:

```ts
import { createMachine, runUntilIdle, type TransitionRule, type Gate } from './fsm/core.ts';

const machine = createMachine({ id: 'doc-approval', states, initial, rules }, { gates: [fourEyes] });
const next = machine.step(state, event);
await runUntilIdle(machine, state, event, async (effect) => executeAndReturnEvents(effect));
```

The core also provides:
- `validateDefinition(def)`: lists structural problems.
- `edges(def)` and `reachable(def, { avoiding })`: graph queries, for example "is `APPROVED` reachable without `IN_REVIEW`?".

`tests/unit/fsm_core.test.ts` shows a complete document-approval example with no Rx code.

## 6. Domain rules behind the runner

The runner calls domain logic only through `RxRules`:
- `evaluateExclusion`
- `planRecallQueries`
- `evaluateRecallEvidence`
- `selectExplanation`

The default implementation is `DEFAULT_RX_RULES`. Pass `{ rules }` to `dispatch` to substitute an implementation, for example in tests or for a new evidence engine version. The state machine itself never imports `rules/`; `tests/unit/architecture_boundaries.test.ts` enforces this.

## 7. Before / after (Task 2 refinement)

| Aspect | Before | After |
|---|---|---|
| Transition definitions | One `switch` in `reduce` (≈200 lines) with inline guards | `RX_RULES`: 30 declarative rules with ids, declared targets and effects, run by `fsm/core.ts` |
| Safety | Held only because the `switch` was written correctly | Six mandatory gates applied to every workflow, plus core checks for undeclared targets and effects |
| Context | No record of which identity was checked or confirmed | `exclusionKey` and `confirmation` record what was checked and confirmed; the gates rely on them |
| New identity | Kept any earlier exclusion decision in the context | Entering `CHECK_EXCLUSION` clears the earlier decision and confirmation |
| Variants | Edit the `switch` | `createRxWorkflow({ extraStates, removeStates, customize })` |
| Reuse | Not possible | `fsm/core.ts` has no imports; a non-Rx example is tested |
| Runner and evidence engine | Runner imported the rule functions directly | Runner depends on the `RxRules` interface (`DEFAULT_RX_RULES`); `dispatch` accepts `{ machine, rules }`; the loop is the generic `runUntilIdle` |
| Public API | `reduce`, `initialState`, `emptyContext`, `dispatch`, `runEffect`, types | Unchanged; `Transition` gained `ruleId` and `rejectedBy` |
| Behavior | — | Identical: a one-off differential run of the old and new reducers over 300,000 seeded random transitions found 0 differences and 0 gate rejections; all 214 existing tests pass |
| Dependencies | None | None added |
