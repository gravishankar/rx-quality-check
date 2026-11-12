# Rx Quality Check

A privacy-first, phone-only Android app (React Native + TypeScript) that helps patients identify
their generic medication from a pharmacy bottle or original manufacturer packaging and see publicly
available FDA recall and regulatory quality information — including what **cannot** be determined.

> **Status:** Task 1 of 6 (repository initialization and API feasibility). There is no mobile app
> code yet. See `docs/IMPLEMENTATION_PLAN.md`.

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
docs/                    PRD, architecture, data sources, privacy, exclusions, test & implementation plans
docs/references/         Reference documents A and B (unmodified) + adoption register
docs/feasibility/        Machine-readable results of the latest API feasibility run
mobile/                  React Native app (scaffolded in Task 4; directories only for now)
data/                    Versioned local data: drug catalog, exclusion policy, manufacturer aliases
tests/                   Deterministic unit/integration tests and real-response fixtures
scripts/                 API feasibility harness and shared normalization/parsing helpers
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
