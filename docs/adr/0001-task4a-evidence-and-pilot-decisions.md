# ADR-0001 — Task 4A decisions: approval, uncertainty, build profiles, query order, per-medication checks

- Status: **Accepted by the product owner in the Task 4A brief (2026-11-12)**. Recorded by the implementer.
- Scope: Rx Recall Check v0.1.0 Android pilot (and the iOS build that will share the same code).
- Related: `docs/IMPLEMENTATION_PLAN.md` §8 (OD-2, OD-4, OD-17, OD-18, OD-19),
  `docs/EVIDENCE_AND_CLAIMS_POLICY.md`, `docs/RELEASE_READINESS_CHECKLIST.md`.

These decisions are product and engineering decisions. None of them is a legal, regulatory or
clinical approval.

## OD-2 — Draft exclusion policy and drug catalog

**Decision.** Keep the current draft policy (`0.2.0-draft`, status `PROPOSED_PENDING_APPROVAL`) and
catalog (status `DRAFT_PENDING_APPROVAL`). A file may be marked `APPROVED` only after a named
reviewer has reviewed its **exact contents and version**. Approval of a configuration file is an
engineering/product approval only; it is not legal or clinical approval.

**Enforcement.**
- The engine loads unapproved files only with `allowUnapproved: true`, which only the development
  build profile sets (`mobile/src/app/buildProfile.ts`).
- A pilot build refuses unapproved files: every medication is shown as "Recall checks are turned off
  in this build" (`CONFIG_BLOCKED`), never as a finding.
- `npm run release:gate` lists unapproved files as blockers; `scripts/android_build.sh pilot` and the
  Gradle pilot variant refuse to build until the gate passes.

## OD-17 — Conservative handling of uncertainty

**Decision.** Accept conservative uncertainty. The app never infers missing information.
- No unqualified "no matching recall" when missing source information could affect coverage
  (unknown repackager source, unavailable lookup, name-only identity): the result carries a
  qualifier and the limitation is listed next to it.
- The app never identifies a plant, a manufacturer, or a source NDC without official evidence. Only a
  source declared in the repackager's SPL **and** found in the NDC Directory is used.
- Presentation may only weaken a classification (`presentation/present.ts`); a weakening caused by an
  internal inconsistency is flagged for investigation.

## OD-18 — Draft configuration only in labeled development builds

**Decision.** Draft configuration is allowed only in explicitly labeled development builds
(application ID suffix `.dev`, name "Rx Recall Check (DEV)", purple "DEVELOPMENT BUILD" banner on
every screen). It is never allowed in a pilot or release APK. Development builds keep every safety
gate, evidence rule and presentation rule; they only differ in configuration approval and in having
saved history turned off.

**Enforcement.** Build profile file `mobile/config/build_profile.json` (committed value:
`development`) is written only by the build script; the Gradle pre-build check refuses a variant
whose flavor does not match the profile. Tests: `claims_and_copy.test.ts` (build profiles, release
gate).

## OD-19 — Local exclusions before optional external lookups

**Decision.** Apply locally determinable exclusions before optional external enrichment. RxNav and
DailyMed are consulted only for medications that the local policy has found eligible. Identity
verification is not weakened: the NDC Directory lookup still happens first (it establishes the
product), and the exclusion decision is re-evaluated on the enriched identity, which may only make
it stricter or more precise.

**Identifiers sent, per service and why** (also in `docs/PRIVACY.md`):

| Service | Identifier | Why | When |
|---|---|---|---|
| openFDA NDC Directory | product/package NDC typed by the user | Establish the product | Every check with an NDC |
| RxNav | NDC; RxNorm concept code | Ingredient RxCUIs for catalog matching | Only after a local ELIGIBLE decision |
| DailyMed | SPL set ID (public) | Find a repackaged product's declared source | Only after ELIGIBLE, only for repackagers |
| openFDA Enforcement | ingredient name, product NDC, verified source NDCs, a fixed control query | Recall records | Only after the user confirms identity |

**Enforcement.** `engine/runner.ts` (`CHECK_EXCLUSION`); tests `tests/integration/app_screens.test.ts`
(no RxNav/DailyMed request for excluded, unsupported or invalid-configuration scenarios).

## OD-4 — Per-medication lookup

**Decision.** Recall lookups are per medication, on request. The app does not imply surveillance,
monitoring or notifications. Each assessment shows its retrieval date, source coverage (searches
completed, control check, FDA dataset date) and that it is not refreshed automatically.

**Enforcement.** Copy `disclaimer.notMonitoring`, `result.sources.refresh`,
`result.sources.perMedication`; results older than 24 hours or based on FDA data older than 45 days
are not shown as "no match" (`FRESHNESS` in `presentation/present.ts`).

## Consequences

- A pilot build cannot be produced today: `npm run release:gate` reports 14 blockers.
- The development APK is for owner testing only and must not be distributed.
