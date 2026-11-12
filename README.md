# Rx Quality Check

A privacy-first, phone-only Android app (React Native + TypeScript) that helps patients identify
their generic medication from a pharmacy bottle or original manufacturer packaging and see publicly
available FDA recall and regulatory quality information — including what **cannot** be determined.

> **Status:** Task 2 of 6 (state machine and recall evidence engine) — awaiting approval. The core
> library in `mobile/src/` is pure TypeScript (no React Native, network or storage code yet). There is
> no user interface yet. See `docs/IMPLEMENTATION_PLAN.md`.
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
data/                    Versioned local data: drug catalog, exclusion policy, manufacturer aliases
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

Refresh the real-response fixtures in `tests/fixtures/api/`:

```bash
NODE_USE_ENV_PROXY=1 npm run feasibility:fixtures
```

## Disclaimer

This project is for research on patient interest and usability. It does not provide medical advice.
Data comes from public FDA and NLM sources, which state that results are unvalidated and should not be
relied on for medical decisions.
