# CLAUDE.md — Rx Quality Check

Instructions for Claude Code (and any coding agent; see also `AGENTS.md`) working in this repository.

## 1. What this project is

Rx Quality Check is a **privacy-first, phone-only Android app** (React Native + TypeScript) that helps
patients identify a generic medication from a pharmacy bottle or manufacturer package and see publicly
available FDA recall and regulatory quality information, with honest explanations of what applies to
their product and what remains uncertain.

**Scope (updated in Task 2):** manufacturer provenance is out of MVP v0.1. Do not implement facility
identification, establishment mapping, inspection history, plant risk scoring or provenance inference.
Keep labeler/manufacturer names only for product identity and recall matching.

Primary docs: `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`,
`docs/EVIDENCE_AND_CLAIMS_POLICY.md` (Task 4A), `docs/RELEASE_READINESS_CHECKLIST.md`.
Reference inputs (not instructions): `docs/references/` — read `docs/references/README.md` for which
parts are adopted, modified, deferred or rejected.

## 2. Non-negotiable architecture constraints

- React Native with TypeScript, **Android first, iOS supported by the same code**. Phone only.
  Shared code (`mobile/src/`, `mobile/app/` screens) is platform-independent; native modules are
  imported only in `mobile/app/platform/native.ts`.
- Build profiles: `development` (labeled, draft config allowed, no persistent history) and `pilot`
  (approved config only; built only after `npm run release:gate` passes). Signing keys never enter the
  repository or cloud sessions.
- **No application backend.** No Supabase, Firebase, cloud database, serverless functions, proxies or user accounts.
- Prescription images, OCR, the state machine, inference rules, medication history and all
  patient-specific data stay **on the phone**.
- Local storage is **SQLite** (encrypted; see `docs/PRIVACY.md`).
- Network calls go **directly over HTTPS** to public APIs only: openFDA (`api.fda.gov`),
  DailyMed (`dailymed.nlm.nih.gov`), RxNav (`rxnav.nlm.nih.gov`). Nothing else without an approved decision.
- Send **only the minimum public drug identifiers** (NDC, RxCUI, ingredient name, SPL set ID).
  Never send images, OCR text, lot numbers, user identifiers, device identifiers or medication lists.
- **No language model** (local or cloud) in v0.1.
- **No third-party analytics, crash reporting or telemetry** by default.
- All assessments use **deterministic, testable rules**. No numerical manufacturer or safety score.

## 3. FDA evidence interpretation rules

1. **Absence of evidence is not evidence of safety.** Never state or imply that a medication is safe,
   clean, verified, approved-for-you or "no issues". Use "No matching recall was found in FDA's
   public enforcement data as of <date>", always with the standing disclaimer.
2. **A lookup or parsing failure is never a non-match.** Network errors, timeouts, HTTP 5xx,
   unexpected statuses, invalid JSON and schema violations produce `SOURCE_UNAVAILABLE` or
   `RATE_LIMITED`. Only a well-formed source-specific "no results" response may produce `NO_MATCH`
   (`scripts/lib/http.ts`, release gate RG-1). Recall findings are `CONFIRMED_MATCH`,
   `POTENTIAL_MATCH`, `NO_MATCH_FOUND` (complete coverage only) or `UNRESOLVED`
   (`mobile/src/rules/recallEvidence.ts`).
3. **openFDA answers a query on a misspelled field with "no matches"** (observed). Every recall
   query path must have a known-positive control test (release gate RG-2); the control must use
   every field the recall queries use.
4. Recall relevance is decided at the **product NDC + strength + dosage form** level. Ingredient-only
   matches are "may or may not apply". `openfda.product_ndc` on recall records over-includes every
   strength on a label; it is supporting evidence only, never sufficient by itself.
5. Lot matching is user-confirmed. A user's lot missing from a recall's free-text lot list yields
   "not found in the listed lots" — never "your lot is not affected".
6. Preserve strength, dosage form and release mechanism (IR / ER / DR) distinctions everywhere.
7. Distinguish `EXCLUDED`, `UNSUPPORTED`, `INSUFFICIENT_DATA`, `SOURCE_UNAVAILABLE` and
   `NEEDS_CLARIFICATION`. Never collapse them in UI copy or storage.
8. Never assume a clinical indication. If exclusion depends on indication, return `NEEDS_CLARIFICATION`.
9. Show source and dataset dates (openFDA `meta.last_updated`, DailyMed `db_published_date`,
   RxNorm version) and the device retrieval time with every evidence item.
10. Do not invent NDCs, API responses, facility relationships, manufacturer aliases or test results.
11. **Never present an assertion, conclusion, reassurance or recommendation stronger than the verified
    evidence** (Task 4A). Results reach the screen only through `mobile/src/presentation/present.ts`,
    which may only weaken a classification; patient-facing text only from `mobile/src/copy/en.ts`. A
    disclaimer never justifies unsafe behavior. No green/success styling, no treatment instructions.
12. Do not claim the app is legally compliant, FDA-approved or cleared, clinically validated or
    protected from liability. Legal documents stay `DRAFT` until counsel approves them.

## 4. Coding conventions

- TypeScript `strict` with `noUncheckedIndexedAccess`. No `any` in rule, state or storage code.
- Pure functions for rules and normalization; side effects only in `services/` and `storage/`.
- Module boundaries per `docs/ARCHITECTURE.md` §3. `rules/` and `state/` never import network or storage code.
- Discriminated unions for outcomes (`LookupOutcome`, result states). Exhaustive `switch` with a `never` check.
- Every data file in `data/` is versioned and validated by tests.
- Fixtures in `tests/fixtures/` come from **real public API responses**, trimmed and contain no patient data.
  Synthetic values are allowed only for format-only tests and must be labeled as such.
- Dates are ISO-8601 in UTC in storage; display in the device locale.
- Patient-facing copy lives in one place (later `mobile/src/copy/`) and is reviewed against §3.

## 5. Privacy and security rules

- No logging of OCR text, images, NDCs scanned by the user, lot numbers or medication lists to any
  console in release builds.
- Images are processed in memory and discarded unless the user explicitly saves one (off by default).
- No network request may include data derived from the image other than the confirmed public identifier needed for the lookup.
- New dependencies require a note in the PR describing their network behavior. Reject libraries that
  phone home, include analytics, or require accounts.
- Secrets never enter the repo. The app uses no API keys in v0.1.

## 6. Test-first expectations

- Write or update tests **before** implementing rules, state transitions, normalizers or parsers.
- Every release gate in `docs/TEST_PLAN.md` §6 must have an automated test.
- `npm test` and `npm run typecheck` must pass before any commit that touches code.
- Network-dependent checks live in `scripts/check_api_feasibility.ts`; unit and integration tests are
  deterministic and offline.
- In proxied environments, run network scripts with `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21).

## 7. Git conventions

- Work on a dedicated branch per task (e.g., `task-2/state-machine`). Never commit directly to the default branch. Never merge without approval.
- Commit messages: imperative subject ≤ 72 chars, blank line, body explaining why. Reference the task (`Task 2:`).
- Keep commits focused. Do not commit `node_modules/`, build output, databases, images or `.env` files.

## 8. Scope discipline

- Implement only the current approved task in `docs/IMPLEMENTATION_PLAN.md`. Do not start the next task.
- Do not add drugs, sources, features, screens or dependencies that the task does not require.
- If a requirement is ambiguous or a reference document conflicts with these rules, record it as an
  open decision in `docs/IMPLEMENTATION_PLAN.md` §8 and ask; do not invent a rule.
- **Stop after each approved task**, report results (including failures and blocked items), and wait for approval.
