# Rx Recall Check

Repository: `rx-quality-check`. The patient-facing name is configured in `config/app_config.json`.

A privacy-first, phone-only Android app (React Native + TypeScript) that helps patients identify
their generic medication from a pharmacy bottle or original manufacturer packaging and see publicly
available FDA recall and regulatory quality information — including what **cannot** be determined.

> **Status:** Task 3 of 6 (live FDA integration, local database, extensible catalog and policy) —
> awaiting approval. The library in `mobile/src/` is pure TypeScript: workflow engine, rules, API
> clients and storage behind injected interfaces. There is no user interface yet (Task 4). See
> `docs/IMPLEMENTATION_PLAN.md`.
>
> Manufacturer provenance (facilities, establishments, inspections) is out of scope for MVP v0.1.

## Principles

- **On-device only.** No backend, no accounts, no analytics. Images, OCR and medication history never leave the phone.
- **Minimum necessary queries.** Only public drug identifiers are sent to openFDA, DailyMed and RxNav.
- **Honest evidence.** The absence of an FDA report is never presented as proof of safety. No safety scores.
- **Deterministic rules.** Every assessment is reproducible and covered by tests.

## MVP scope

14 generic drugs (oral outpatient formulations): atorvastatin, amlodipine, levothyroxine, lisinopril,
gabapentin, losartan, metformin, metoprolol succinate, omeprazole, rosuvastatin, pantoprazole,
furosemide, hydrocodone/acetaminophen, tamsulosin. Anticoagulants and transplant immunosuppressants
are excluded by policy (`docs/EXCLUSIONS.md`).

## Repository layout

```
CLAUDE.md, AGENTS.md     Agent and contributor rules
docs/                    PRD, architecture, state machine guide, data sources, privacy, exclusions, test & implementation plans
docs/references/         Reference documents A and B (unmodified) + adoption register
docs/feasibility/        Machine-readable results of the latest API feasibility run
mobile/src/              Core library: models/, rules/ (identity, exclusion, recall evidence), state/ (workflow
                         state machine), engine/ (effect runner with injected I/O ports)
data/                    Versioned config: drug catalog, exclusion policy (+ schemas/, examples/), aliases
config/                  App configuration (patient-facing display name)
tests/                   Deterministic unit/integration tests and real-response fixtures
scripts/                 API feasibility harness, Task 2 fixture capture, re-export shims
```

## Commands

Requires Node.js ≥ 22.

```bash
npm install
```

```bash
npm run typecheck
```

```bash
npm run test:coverage
```

```bash
npm test
```

Run the live API feasibility harness (makes ~135 read-only public requests, ~75 s):

```bash
npm run feasibility
```

Behind an HTTPS proxy (Node's built-in `fetch` ignores `HTTPS_PROXY` unless told otherwise; Node ≥ 22.21):

```bash
NODE_USE_ENV_PROXY=1 npm run feasibility
```

Validate the drug catalog and exclusion policy (guides: `docs/DRUG_CATALOG_GUIDE.md`,
`docs/EXCLUSION_POLICY_GUIDE.md`):

```bash
npm run config:test
```

```bash
npm run catalog:validate
```

```bash
npm run policy:validate
```

End-to-end integration through the production engine, replaying recorded real FDA, RxNav and
DailyMed responses:

```bash
npm run e2e
```

The same scenarios against the live public APIs (add `NODE_USE_ENV_PROXY=1` behind a proxy):

```bash
npm run e2e:live
```

Re-record the responses used by `npm run e2e`:

```bash
NODE_USE_ENV_PROXY=1 npm run e2e:record
```

Refresh the real-response fixtures in `tests/fixtures/api/`:

```bash
NODE_USE_ENV_PROXY=1 npm run feasibility:fixtures
```

## Disclaimer

This project is for research on patient interest and usability. It does not provide medical advice.
Data comes from public FDA and NLM sources, which state that results are unvalidated and should not be
relied on for medical decisions.
