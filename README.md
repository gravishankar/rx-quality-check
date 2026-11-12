# MedLuma (working name) — Medication Recall Check

*Know your medication. Understand the evidence.*

Repository: `rx-quality-check`. Product name, tagline, feature names, version and app labels live in
`config/brand.json`. **"MedLuma" is a provisional working name with a known conflict and is not
trademark-cleared** (`docs/BRAND_CLEARANCE.md`). Earlier working name: Rx Recall Check.

A privacy-first, phone-only Android app (React Native + TypeScript) that helps patients identify
their generic medication from a pharmacy bottle or original manufacturer packaging and see publicly
available FDA recall and regulatory quality information — including what **cannot** be determined.

> **Status:** Task 4C (scanner-first) — awaiting the owner's Pixel test and review. Current development
> build: 0.1.3 (build 4) with on-device label scanning; test with `docs/task4c/PIXEL_SCAN_TEST_GUIDE.md`.
> Earlier: Task 4A.2 (functional validation), build 3. Earlier: Task 4A
> (Android pilot: evidence safety, legal and regulatory readiness). A React Native app (Android first, iOS-ready) runs the Task 3 engine. Only a **development
> APK** exists, for the owner's testing; a pilot build is blocked by `npm run release:gate`
> (approvals, legal/clinical/regulatory sign-offs and on-device encryption verification are
> missing). This is an evaluation prototype: not clinically validated, not reviewed by counsel, not
> FDA-cleared. See `docs/IMPLEMENTATION_PLAN.md` and `docs/RELEASE_READINESS_CHECKLIST.md`.
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
mobile/src/              Shared TypeScript (Android + iOS): models/, rules/, state/, fsm/, engine/, services/,
                         storage/, presentation/ (evidence-limited wording), copy/, legal/, app/
mobile/app/              React Native screens; native modules only in app/platform/native.ts
mobile/android/, ios/    Native projects (Android: dev/pilot flavors; iOS: not built yet)
docs/legal/              DRAFT legal documents (legal review required)
data/                    Versioned config: drug catalog, exclusion policy (+ schemas/, examples/), aliases
config/                  App configuration (patient-facing display name)
tests/                   Deterministic unit/integration tests and real-response fixtures
scripts/                 API feasibility harness, Task 2 fixture capture, re-export shims
```

## Key documents (Task 4A, 4A.1)

- `docs/BRAND_AND_PRODUCT_STRATEGY.md`, `docs/BRAND_CLEARANCE.md`
- `docs/INSTALL_ON_ANDROID.md`, `docs/FUNCTIONAL_TEST_PLAN.md`, `docs/UX_REVIEW_4A2.md` — Task 4A.2
- `docs/FIRST_DEVICE_TEST_RUNBOOK.md` — owner-only first phone test (build 2)

- `docs/EVIDENCE_AND_CLAIMS_POLICY.md` — what the app may say, the evidence each statement needs, and the tests enforcing it
- `docs/LEGAL_REGULATORY_REVIEW.md` — issues list for counsel (no compliance conclusions)
- `docs/adr/0001-task4a-evidence-and-pilot-decisions.md` — OD-2, OD-4, OD-17, OD-18, OD-19
- `docs/ANDROID_BUILD_AND_INSTALL.md`, `docs/ANDROID_DEVICE_TEST_PLAN.md`, `docs/IOS_BUILD.md`
- `docs/RELEASE_READINESS_CHECKLIST.md`

## Android app

```bash
(cd mobile && npm ci)
```

```bash
ANDROID_HOME=$HOME/android-sdk npm run android:dev
```

```bash
npm run release:gate
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
