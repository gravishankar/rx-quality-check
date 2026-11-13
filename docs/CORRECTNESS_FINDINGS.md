# Findings register — independent code review of `b9c5989`

| | |
|---|---|
| Review baseline | `gravishankar/rx-quality-check`, branch `task-4g/f1-staged-coverage`, commit `b9c59895de84abbc8ec9e7d68ab38f0e53f38cab` (F1 included) |
| Remediation branch | `task-4h/correctness-findings` (from `f7d7bae`, which is `b9c5989` plus F1 decision records). Local only: not pushed, not merged |
| Line numbers | Current revision of this branch unless marked "review" |
| Rules | Failing regression test before each fix (`tests/regression/`); real recorded FDA data where possible; synthetic values labeled SYNTHETIC; no drug activation, no persistence enabled, no distribution, no claim of patient readiness |

**Kinds.** **D** verified defect (failing test before fix) · **T** code-traced concern · **V** native or
device behavior not verifiable here · **M** missing or future feature.
**Dispositions.** Fixed · Not reproduced (with evidence) · Deferred (with gate) · Decision needed.

## Summary

| # | Finding | Priority | Kind | Disposition |
|---|---|---|---|---|
| 1 | Ingredient strengths lose their association with names | P1 | D | Fixed (C1a–c, C5); two limitations recorded |
| 2 | Recall query omits aliases; pagination ≠ search coverage | P1 | D | Fixed (C2a–b) |
| 3 | Incomplete repackager-source resolution | P1 | D/T | Fixed for traversal and qualifiers (C3); OD-33 decision needed for classification |
| 4 | Malformed freshness dates fail open | P1 | D | Fixed (C4) |
| 5 | Offline matching ignores lot and package | P2 | D | Fixed |
| 6 | History pairs latest assessment with oldest fill | P2 | D | Fixed |
| 7 | Delete-all leaves stale storage in the session | P2 | D | Fixed (shared lifecycle); device check remains |
| 8 | Scanner image retention, external camera | P2 | T/V | Fixed in code and copy; device check remains |
| 9 | Encryption and native privacy need device evidence | P2 | V | Code-checkable parts pinned; rest deferred (device gate) |
| 10 | Lot confirmation: UI and engine disagree | P3 | D | Fixed |
| 11 | Release mechanism forces a guess | P3 | T | Fixed (no guess, no check); OD-34 decision |
| 12 | Refill comparison and recheck not surfaced | P3 | M | Deferred (persistence gate) |
| 13 | Identity-source provenance and completeness | Follow-up | M | Partly addressed (PARTIAL status); rest deferred |
| 14 | Keep business logic platform-independent | Follow-up | T | Maintained; enforced by boundary tests |
| 15 | iOS not verified or feature-complete | Follow-up | M | Deferred (iOS gate) |
| 16 | Provenance, regulatory evidence, monitoring | Future | M | Deferred (out of MVP) |

## 1. Medication and recall accuracy (Priority 1)

### Item 1 — ingredient–strength association

| | |
|---|---|
| Patient impact | High. A combination with swapped strengths (e.g. hydrocodone 5 / acetaminophen 325 vs 325 / 5) could be accepted as the scanned product, matched to the wrong recall notice, or pass a refill with no warning |
| Review locations | `identity.ts:175`, `strength.ts:79`, `refill.ts:53` (review) |
| Current locations | `rules/identity.ts:155` `crossValidate`; `rules/identity.ts` `orderByAppearance`; `rules/recallRecord.ts:93` `sameStrengthFor`; `rules/refill.ts:39` `diffFills`; `services/ports.ts` `sameFormulation`; `engine/runner.ts` `requiredConfirmations` |
| Reproduced | Yes, each path, before its fix |
| Regression tests | `tests/regression/c1_ingredient_association.test.ts` (6): abbreviation "APAP/CODEINE 300-30MG"; reordered names guard; recall notice with swapped vs reordered strengths (SYNTHETIC text); refill hyclate→monohydrate (different salt); refill swapped strengths; refill reordered guard. `c5_missing_conflicting.test.ts` (5): cross-validation of a real Camber hydrocodone/APAP listing against a SYNTHETIC swapped listing; alias label "HYDROCODONE/APAP"; two different NDCs on one label; "BIT" limitation. `c3_source_chain.test.ts`: source verification with swapped strengths |
| Fix | Each strength is paired with the ingredient the text names in that position (name or alias); swapped strengths are a strength difference everywhere; refill adds `SALT_CHANGED`; an unclear pairing on a label asks the patient to confirm the strength; two different NDCs read from one label require NDC confirmation |
| Evidence | Commits `a868c3b`, `7523d6c`, `ec2d387`; all tests listed pass |
| Remaining limitations | (a) A recall notice that does not name every ingredient keeps the unordered comparison; such a notice can only be a *possible* match (never confirmed without the product NDC in its text). (b) The pharmacy abbreviation "BIT" (bitartrate) is read as an extra ingredient → conservative mismatch, so the NDC is set aside (test pins this). (c) Unknown or unreadable strengths already require confirmation (`STRENGTH_NOT_PRINTED`); no change |
| Disposition | **Fixed** |

### Item 2 — aliases in recall search; pagination vs search coverage

| | |
|---|---|
| Patient impact | High. Notices that use only an abbreviation were never retrieved. Live openFDA (2026-11-13): 18 oral HCTZ-combination notices say only "HCTZ", including D-0886-2022, which names the Lupin losartan/HCTZ 100/25 mg NDC. Today's active catalog: 0 hydrocodone notices use only "APAP" (no live false negative in the active catalog) |
| Locations | `rules/recallEvidence.ts:91` `planRecallQueries`; `:236` `searchIsAdequate`; `evaluateRecallEvidence` |
| Reproduced | Yes: plan omitted the alias; a fully paged but alias-less search produced `NO_MATCH_FOUND` |
| Regression tests | `c2_alias_search_coverage.test.ts` (5, real task2 responses; alias "rsv" SYNTHETIC); `tests/integration/c2_alias_search.test.ts` (2, recorded openFDA `tests/fixtures/c2/`) |
| Fix | Each ingredient searched as (name OR alias…), deduplicated, deterministic order; terms outside the client's safe character set are left out and then reported. Separate `coverage.searchAdequate` (every name and alias; product-NDC search; every verified source NDC) feeds `coverage.complete`; limitation `SEARCH_TERMS_INCOMPLETE` with patient copy; a saved result without it is downgraded. `hctz` added to the **proposed** catalog only, with evidence |
| Evidence | Commit `f0387cc`. Recorded case: 0 records lost; D-0886-2022 now a possible match; 16 other newly found records ruled out by strength or combination, none confirmed. F1 regression checks unchanged and passing |
| Remaining | Aliases are reviewed catalog data only (no fuzzy matching). Query-plan version `2` recorded on every plan and finding (`f40d229`); `RULESET_VERSION` 0.3.0 → 0.4.0 so earlier saved results are stale |
| Disposition | **Fixed** |

### Item 3 — repackager source resolution

| | |
|---|---|
| Patient impact | Medium–high. Part of the source chain could be unchecked while the result showed no source qualifier |
| Locations | `services/ports.ts:123` `sourceProducts`; `rules/recallEvidence.ts:251` `sourceProductUncertain`; `rules/recallRecord.ts:267` (RP-4); `presentation/present.ts` |
| Reproduced | Yes: partial branch, depth limit, cycle (product listed as its own source), later SPL failure → all `VERIFIED`; unreadable SPL → "not established"; unknown packager never checked → no qualifier |
| Patient-visible behavior (checked before deciding) | `UNAVAILABLE`/`NOT_ESTABLISHED` already showed "No matching recall found in the FDA records checked" **with** a repackaging qualifier (OD-17). The gaps were `VERIFIED` hiding a partial chain and `NOT_CHECKED` with no qualifier |
| Regression tests | `c3_source_chain.test.ts` (10): real furosemide chain guard; SYNTHETIC partial branch, depth limit, cycle, later SPL outage, unreadable SPL, swapped-strength source; patient view for PARTIAL, NOT_CHECKED, original packager |
| Fix | New status `PARTIAL` (verified branches kept for matching, completeness reported separately); unreadable SPL → `UNAVAILABLE`; product never its own source; PARTIAL and unchecked-unknown-packager get the limitation and a patient qualifier |
| Evidence | Commit `7523d6c` |
| Remaining | (a) **OD-33 decision needed**: notices of the same ingredient/strength/form that name *other* NDCs are ruled out even when one could be the unknown source; recommendation: show them as possible matches. (b) Missing SPL set id and source-NDC-not-found: tested (`f40d229`). (c) Durable per-branch provenance → item 13 |
| Disposition | **Fixed** (traversal, qualifiers) · **Decision needed** (OD-33) |

### Item 4 — freshness dates

| | |
|---|---|
| Patient impact | High. "No matching recall found" with an unusable data date |
| Locations | `presentation/present.ts:216` `noMatchIsSupported`; `rules/recallEvidence.ts:65` `datasetDateUsable`; `readQuery` |
| Reproduced | Yes: "last week", "2026-13-45", "", future date → no-match; dataset date changing between pages unseen |
| Regression tests | `c4_dates.test.ts` (9): real tamsulosin and amlodipine responses with SYNTHETIC dates; later-page failure; invalid or future evaluation time (device clock behind) |
| Fix | Strict YYYY-MM-DD calendar check; date must not be after a valid UTC evaluation time; checked at evaluation (limitation `DATASET_DATE_INVALID`) and again when presenting saved results; date change between pages → inconsistent pagination. Dataset, retrieval and evaluation times stay separate fields |
| Evidence | Commit `13fe113` |
| Disposition | **Fixed** |

### Related: missing or conflicting information (C5)

Probed: empty extraction, missing strength, combination with a missing strength, conflicting
release text, two different NDCs, swapped label strengths. Already conservative before this work:
missing name/strength/form → `MISSING_INFORMATION`; unprinted or conflicting release → release must be
stated; missing strength on an NDC product → strength confirmation. Fixed here: swapped label strengths
and two different NDCs (above). No path was found where missing information became a confirmed
identity or a no-match (existing RG-1 tests plus `c4`, `c5`).

## 2. Saved-result integrity and patient data (Priority 2 — before persistence)

Persistence is **off** in every build that exists (`mobile/src/app/buildProfile.ts`: development
`persistHistory: false`; pilot only once encryption is verified on a device). Patient exposure today is
nil; these fixes are prerequisites for turning it on, not permission to.

### Item 5 — offline reuse ignored lot and package

| | |
|---|---|
| Patient impact | High once persistence is on: "Recall match found" for lot JKU4639A offered offline for a bottle from another lot, or a result made under older rules |
| Locations | `storage/repositories.ts:45` `identityLookupKey` (fill fingerprint); `latestFor` (store) |
| Reproduced | Yes (real Sun metformin ER and recall D-0325-2021; other lots and package SYNTHETIC) |
| Regression tests | `p_saved_results.test.ts`: different lot, no lot, different package, other policy version, and different strength / salt / form / release |
| Fix | Reuse only for an identical fill fingerprint (level, product, package, lot, each ingredient's salt and strength, form, release) made under the running rules, policy and catalog; otherwise nothing is reused and the patient sees "could not reach FDA" |
| Remaining | Reusable public evidence is the 24 h source cache; re-evaluating stored raw records offline against a new fill is not implemented (conservative: no result) |
| Evidence · disposition | `ee6de2c` · **Fixed** |

### Item 6 — history joined to the wrong fill

| | |
|---|---|
| Locations | `app/screens/History.tsx`; `storage/repositories.ts` `latestWithFill` |
| Reproduced | Yes: repository test, and the History screen (jest) showed the oldest bottle |
| Regression tests | `p_saved_results.test.ts` (item 6); `mobile/__tests__/history.test.tsx` (fails on the old screen) |
| Fix | Assessment joined by its own `fill_id`; History says which bottle (NDC, lot) and when it was checked |
| Evidence · disposition | `ee6de2c` · **Fixed** |

### Item 7 — storage and session lifecycle

| | |
|---|---|
| Locations | `storage/lifecycle.ts` (new, shared); `app/AppRoot.tsx`; `app/useRecallSession.ts`; `app/screens/History.tsx` |
| Reproduced | Yes: old repositories are dead after delete-all and nothing re-opened storage (test 1); session memoized the first repositories (code-traced) |
| Regression tests | `p_storage_lifecycle.test.ts` (7, real SQLite): delete then save again; stale handle refused; failed deletion; key / open / migration failures; disabled build never opens; slow start after delete-all discarded. `history.test.tsx`: storage failure shown |
| Fix | States OFF · OPENING · READY(generation) · DELETING · FAILED(KEY, OPEN, MIGRATION, DELETE). Delete-all destroys database and key, then opens fresh storage; older handles refuse every call; the session rebuilds its engine when storage changes; failures are shown; a failed delete is reported as failed |
| Remaining | Native SQLCipher open/delete on a device (item 9) |
| Evidence · disposition | `59ec48e` · **Fixed** (device check remains) |

### Item 8 — scanner image and the camera app

| | |
|---|---|
| Locations | `RxScannerModule.java` (`scanLabel`, `onActivityResult`, `deletePhoto`, `revokeGrant`, `cleanUpFailedLaunch`); `copy/en.ts`; `docs/PRIVACY.md` |
| Reproduced | Yes (code): deletion results ignored; URI grant never revoked; launch failure left state; copy promised "never saved to your photos"; PRIVACY.md said "not written to disk" |
| Regression tests | `p_scanner_privacy.test.ts` (3); `architecture_boundaries.test.ts` updated |
| Fix | Grant revoked on return and on launch failure; every deletion checked, an undeletable file emptied and removed at next start; copy and PRIVACY.md describe the camera-app trust boundary. Java compiles (`:app:compileDevReleaseJavaWithJavac`) |
| Remaining | Device check: cache contents after success, cancel, error and a killed process; per-camera-app copies and network use. An in-app camera would remove the trust boundary — recorded as a future option, not implemented |
| Evidence · disposition | `dc5bd2e` · **Fixed in code and copy; device check remains** |

### Item 9 — encryption and native privacy

Pinned without a device (`p_native_privacy.test.ts`, `617c0bb`): no console or Android log calls in app
code; backup and device-transfer exclusions for every data domain; transport omits credentials and
refuses redirects. Everything in §5 remains **unverified** and blocks enabling persistence.

## 3. Confirmation and workflow (Priority 3)

### Item 10 — lot confirmation

| | |
|---|---|
| Locations | `app/screens.ts` (model `required`, `ready`, `stillNeeded`, `confirmationEvent`); `app/screens/Confirm.tsx`; `state/machine.ts` `applyUserConfirmation` and the confirmation gate |
| Reproduced | Yes: "use this lot" sent the way the old screen did left the patient on CONFIRM; the engine used any lot sent even without the patient confirming it |
| Regression tests | `w_confirmation.test.ts` (6); jest `flows.test.tsx` (lot choice and "still needed" message; continue without lot → possible match, lot never sent) |
| Fix | Readiness from the engine's requirement list with a "Still needed" message; explicit "Use lot …" / "Continue without the lot number"; correcting it goes through "Change details"; a lot is used only with "use" |
| Evidence · disposition | `726d62e` · **Fixed**. Existing tests that sent an unconfirmed lot now send an explicit "use" |

### Item 11 — release mechanism

"I can't tell" shows where to look on the label and suggests the pharmacist; no check starts and no
guessed release enters a confirmed identity (`w_confirmation.test.ts`, jest `flows.test.tsx`; `726d62e`).
**Decision OD-34**: whether to offer a check with the release left unknown. **Fixed** (conservative).

### Item 12 — refill comparison and recheck

**Deferred — gate: before persistence is enabled.** Needed: show refill changes (product, labeler,
strength, salt, form, release), a recheck action with sources, dates and assessment age, and a review of
grouping saved records by ingredient set (today metformin IR and ER group under one medication —
`medicationKey`). Refill rules themselves are fixed (item 1).

## 4. Architecture and future work

| # | Disposition |
|---|---|
| 13 | Partly addressed: traversal completeness is separate from verified relationships (`PARTIAL`); query-plan version recorded. **Deferred:** durable source records (SPL version, retrieval date, per-branch outcome, conflicts). Gate: before any feature that shows or stores source relationships beyond the current check. No plant or facility inference |
| 14 | Maintained: every fix is shared TypeScript (`rules/`, `services/`, `storage/lifecycle.ts`, `app/screens.ts`, `presentation/`); native code changed only for the photo file and grant. `architecture_boundaries.test.ts` enforces pure rules (it caught a clock use in C4) |
| 15 | **Deferred** (iOS gate): Android-only scanner, iOS backup exclusion, profile separation, ATS review, Keychain-on-reinstall policy. No iOS readiness claimed |
| 16 | **Deferred** (out of MVP scope): facility provenance, inspections, warning letters, import alerts, comparisons, monitoring. No scores or rankings |

## 5. Device-dependent checks (no device in this environment)

All unverified; each blocks enabling persistence or the pilot: encrypted database file and `-wal`/`-shm`
sidecars; wrong-key failure; key deletion and reset after delete-all; backup and device-transfer
exclusion on a real device; release logcat; scanner network silence during OCR; whether React Native's
Android networking honors `credentials: 'omit'` and `redirect: 'error'` (its shared cookie jar may still
store cookies); app-switcher thumbnail (OD-21); uninstall/reinstall; photo cache after a killed process;
camera-app copies of the photo.

## 6. Verification (revision `ec66d16`)

| Command | Result |
|---|---|
| `npm test` | 523 tests, 523 pass, 0 fail, 0 skipped |
| `npm run typecheck`, `npm run mobile:typecheck` | pass |
| `npm run mobile:test` (jest) | 37 tests in 3 suites, all pass |
| `npm run e2e` (recorded) | 13 scenarios pass |
| `npm run config:validate` | OK |
| Gradle `:app:compileDevReleaseJavaWithJavac` | pass (no device run) |

## 7. F1, F2, F3 and catalog

F1 kept with its regression checks: **no regressions observed in the recorded cases and conflation
checks**, not proof that no false negatives exist. **F2 done** (`ec66d16`): infusion wording read as
non-oral; on all 670 recorded notices exactly 6 change, all IV bags or infusion pumps. F3's drug stays inactive.
Route-dependent and policy-held drugs stay inactive. Stage 1 stays on hold; coverage percentages are
estimates of potential reach, not recall accuracy or readiness.
