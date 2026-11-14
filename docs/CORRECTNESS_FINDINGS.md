# Findings register — independent code review of `b9c5989`

| | |
|---|---|
| Review baseline | `gravishankar/rx-quality-check`, branch `task-4g/f1-staged-coverage`, commit `b9c59895de84abbc8ec9e7d68ab38f0e53f38cab` (F1 included) |
| Remediation branch | `task-4h/correctness-findings` (from `f7d7bae`, which is `b9c5989` plus F1 decision records). Local only: not pushed, not merged. Catalog activation and persistence stay disabled |
| Line numbers | Current revision of this branch unless marked "review" |
| Rules | Failing regression test before each fix (`tests/regression/`); real recorded FDA data where possible; synthetic values labeled SYNTHETIC; no drug activation, no persistence enabled, no distribution, no claim of patient readiness |

**Kinds.** **D** verified defect (failing test before fix) · **T** code-traced concern · **V** native or
device behavior not verifiable here · **M** missing or future feature.
**Dispositions.** Fixed · Not reproduced (with evidence) · Deferred (with gate) · Decision needed.

## Summary

| # | Finding | Priority | Kind | Disposition |
|---|---|---|---|---|
| 1 | Ingredient strengths lose their association with names | P1 | D | Reopened in review round 2 (R2-1); fix passed re-review for the reproduced cases |
| 2 | Recall query omits aliases; pagination ≠ search coverage | P1 | D | Fixed (C2a–b) |
| 3 | Incomplete repackager-source resolution | P1 | D/T | Reopened in review round 2 (R2-2, R2-3); fixes passed re-review for the reproduced cases |
| 4 | Malformed freshness dates fail open | P1 | D | Fixed (C4) |
| 5 | Offline matching ignores lot and package | P2 | D | Fixed |
| 6 | History pairs latest assessment with oldest fill | P2 | D | Fixed |
| 7 | Delete-all leaves stale storage in the session | P2 | D | Reopened in review round 2 (R2-4); fix passed re-review for the reproduced cases; device check remains |
| 8 | Scanner image retention, external camera | P2 | T/V | Reopened in rounds 2 (R2-5) and 3 (R3-1, R3-2) and fixed; device check remains |
| 9 | Encryption and native privacy need device evidence | P2 | V | Code-checkable parts pinned; rest deferred (device gate) |
| 10 | Lot confirmation: UI and engine disagree | P3 | D | Fixed |
| 11 | Release mechanism forces a guess | P3 | T | Fixed (no guess, no check); OD-34 decision |
| 12 | Refill comparison and recheck not surfaced | P3 | M | **Outstanding MVP requirement**, gated before persistence |
| 13 | Identity-source provenance and completeness | Follow-up | M | Partly addressed; see §4 for what is and is not kept |
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
| Fallback proof (requested 2026-11-13) | When a notice does not name every ingredient, strengths cannot be paired by position. The fallback must never rule a relevant record out. **Found and fixed** (`f0e3c54`): a notice stating fewer numbers than the product has ingredients ("Losartan/HCTZ … 100 mg", or one strength beside each ingredient) failed the length check and was ruled out as a different strength. Now: (1) same count — multiset comparison: if the multisets differ, no assignment of the stated numbers can match, so the difference is proven; if equal (including swapped), the record is kept, never excluded; (2) different count — a difference only if none of the stated numbers equals any of the product's strengths, otherwise `STRENGTH_PARTIALLY_STATED` keeps it; (3) all ingredients named — exact pairing. What the fallback can and cannot do, precisely: (i) it only decides whether `STRENGTH_DIFFERS` is added; it never adds a reason that makes a record a match. (ii) It removes a record from consideration only when the stated numbers prove a difference under every possible pairing (rules 1–2), so it cannot by itself exclude a record the numbers do not contradict, and therefore cannot by itself turn a would-be possible match into a no-match. (iii) Other evidence still classifies a kept record: when the notice names the patient's product NDC with no stated difference, the record is a product-level match and can be confirmed by the lot rules, exactly as before (the NDC, not the strength fallback, carries that decision); without that NDC a kept record is at most a possible match. (iv) It does not protect against other exclusions (form, release, salt, combination, NDC) that are wrong for other reasons; those are separate rules. Tests: `c1_fallback_strength.test.ts` (7). On all 251 recorded classifications no record changed category; 11 lost an unproven `STRENGTH_DIFFERS` and stay ruled out by independent evidence |
| Remaining limitations | (a) **False-positive burden:** because records the stated numbers cannot rule out are kept, a patient may be shown possible matches that are in fact for another strength of the same combination, and must ask a pharmacist to resolve them. This is a deliberate trade toward not hiding relevant recalls; on the recorded cases it did not add any possible match (no category changed), but it can on other data and is not measured beyond the recorded set. (b) The pharmacy abbreviation "BIT" (bitartrate) is read as an extra ingredient → conservative mismatch, so the NDC is set aside (test pins this). (c) Unknown or unreadable strengths already require confirmation (`STRENGTH_NOT_PRINTED`); no change |
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
| OD-33 (approved 2026-11-13) | For a source that is not established, unchecked with an unknown packager, only partly verified, or unavailable, a notice ruled out *only* because it names other NDCs (text or structured) stays a possible match (`SOURCE_PRODUCT_UNRESOLVED`) with a patient qualifier; exclusions with independent evidence (ingredient set, salt, strength, route, form, release) stay. Tests: `c3_od33_unresolved_source.test.ts` (15: each status with engine result and patient category/qualifier; independent exclusions kept; guards for original packager and verified chain; 18 recorded exemplars). Recorded effect: only additions of possible matches; the 8 original packagers unchanged; 4 repackaged products move from no match to possible match. Real example: Aphena tamsulosin keeps D-1844-2019 (Macleods 33342-159), the product the RP-4 test assumes it repackaged. Commit `4f8699f` |
| Remaining | (a) Missing SPL set id and source-NDC-not-found: tested (`f40d229`). (b) Durable per-branch provenance → item 13. (c) The effect above is measured without DailyMed enrichment; on a device some sources will resolve |
| Disposition | **Fixed** (traversal, qualifiers, classification) — pending independent review |

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
| Regression tests | `w_confirmation.test.ts` (6); jest, each choice made by name (no helper that skips it): continue without the lot; exclusive choices and a change of mind; correction through "Correct the details" (only the corrected lot is used, the choice is asked again); rescan (an earlier lot choice never carries over); repeated confirmation |
| Found by the explicit tests | A double tap on the confirm button started two recall checks from the same state; the session now runs one engine step at a time (`e38fc3b`) |
| Fix | Readiness from the engine's requirement list with a "Still needed" message; explicit "Use lot …" / "Continue without the lot number"; correcting it goes through "Change details"; a lot is used only with "use" |
| Evidence · disposition | `726d62e` · **Fixed**. Existing tests that sent an unconfirmed lot now send an explicit "use" |

### Item 11 — release mechanism

"I can't tell" shows where to look on the label and suggests the pharmacist; no check starts and no
guessed release enters a confirmed identity (`w_confirmation.test.ts`, jest `flows.test.tsx`; `726d62e`).
Explicit test: "I can't tell" blocks the check; choosing "ER" after finding it on the label clears the
guidance and runs the check (`e38fc3b`). **OD-34 decided (approved):** no product-specific check while
the release is unresolved; no broader evidence-browsing mode. **Fixed.**

### Item 12 — refill comparison and recheck

**Outstanding MVP requirement (not a future feature) — must be done before persistence is enabled.**
Needed: show refill changes (product, labeler,
strength, salt, form, release), a recheck action with sources, dates and assessment age, and a review of
grouping saved records by ingredient set (today metformin IR and ER group under one medication —
`medicationKey`). Refill rules themselves are fixed (item 1).

## 3a. Independent review, round 2 (of head `6d1ce07`)

The reviewer reproduced the automated results and found five remaining issues. Each was reproduced here
with a failing regression test before its fix, one commit per issue.

| ID | Reopens | Issue | Reproduced | Regression test | Fix | Commit |
|---|---|---|---|---|---|---|
| R2-1 | 1 | Recall strengths paired by each name's *first appearance anywhere* in the notice. A title in one order followed by a strength block in the other ("Amlodipine and Atorvastatin Tablets (Atorvastatin/Amlodipine 20 mg/10 mg)") was falsely ruled out; the same block with swapped values was not caught | Yes (SYNTHETIC text, real ingredients and strengths) | `r2_local_strength_association.test.ts` (6) | Each expression is paired with the shortest run just before it (after the previous expression) that names every ingredient once. When no such run exists the pairing is not established: equal values are kept with `STRENGTH_ASSOCIATION_UNCLEAR` (never "same"); only values that cannot match under any pairing are a difference. No classification changed on the 287 recorded cases | `9266fd5` |
| R2-2 | 3 | A declared source that the NDC Directory did not list under its NDC, or listed with another formulation, was skipped silently, so one verified branch still made the chain `VERIFIED` | Yes (real furosemide chain, SYNTHETIC extra branch) | `c3_source_chain.test.ts` R2-2 (2) | A rejected branch marks the chain incomplete: `PARTIAL` with another verified branch, otherwise not established; never used for matching | `0cd5d24` |
| R2-3 | 3 | Source formulation check compared names and strengths but not salts | Yes | `c3_source_chain.test.ts` R2-3 (2) | Salts must be equal; an unknown salt on either side cannot be verified | `a602869` (tests in `0cd5d24`) |
| R2-4 | 7 | Delete-all dropped its database handle before destroy ran; after a failed destroy a retry skipped destruction, deleted only the key and reported success while the database stayed on disk | Yes, with a **file-backed** SQLite database persisting across opens | `r2_delete_retry.test.ts` (3): failed destroy then retry (a new connection in the same process reopening the file sees no data; an app restart is not exercised — device check. Commit message `cb0836b` overstated this as a "fresh process"); key failure after destroy; old handles refused | The database stays the deletion target until destroy succeeds, and the key until its deletion succeeds; a retry finishes what is left and never destroys twice | `cb0836b` |
| R2-5 | 8 | The native scanner computed whether the photo was deleted, but every caller ignored it (cancel, success, unreadable, errors, launch failure, startup leftovers) | Yes (screen tests with SYNTHETIC native results; source check) | jest `scan.test.tsx` R2-5 (5); `p_scanner_privacy.test.ts` R2-5 | Every path reports `photoDeleted`; the patient is told on every path when a photo could not be removed; leftovers retried at each scan start, never while a scan is pending (avoids deleting a new scan's file) | `fbcefc7` |

Limits that remain: pairing that cannot be established keeps the record as a possible match (more
pharmacist questions, by design); whether a phone's camera app or file system actually lets the photo be
removed is a device check.

## 3b. Independent review, round 3 (of head `e1dc7e9`)

R2-1 to R2-4 passed re-review for the reproduced cases. R2-5 was partially unresolved:

| ID | Issue | Reproduced | Regression test | Fix | Commit |
|---|---|---|---|---|---|
| R3-1 | The cleanup warning was attached only to the confirmation, scan-problem and cancel screens; a scan of "WARFARIN 5 MG TABLETS" with `photoDeleted: false` reached the excluded screen with no warning | Yes, on five routes: excluded, unsupported, missing information, ambiguous product, source error | jest `scan.test.tsx` R3 (6): each route (SYNTHETIC scanner output; ambiguous uses SYNTHETIC copies of the real Sun record and a SYNTHETIC UPC-A), and the warning persisting across screens until a later clean scan | Cleanup status is app state set from every scanner report and shown on every screen; an error that does not report the photo never clears it | `2ac68bf` |
| R3-2 | The native outer error path and the camera-launch-failure paths reported cleanup from the current photo alone, ignoring an outstanding leftover | Yes (source-level check of every report site) | `p_scanner_privacy.test.ts` R3 | Every report requires the current photo removed and no leftover remaining | `381637f` |
| R3-3 | The R2-4 test comment and register claimed a "fresh process" reopened the database; it is a new connection in the same process | — | test title and comment corrected | Wording; an app restart remains a device check | this commit |

## 4. Architecture and future work

| # | Disposition |
|---|---|
| 13 | Partly addressed; details below. Gate for the rest: before persistence is enabled (saved results must be auditable) and before any feature that shows source relationships beyond the current check. No plant or facility inference |
| 14 | Maintained: every fix is shared TypeScript (`rules/`, `services/`, `storage/lifecycle.ts`, `app/screens.ts`, `presentation/`); native code changed only for the photo file and grant. `architecture_boundaries.test.ts` enforces pure rules (it caught a clock use in C4) |
| 15 | **Deferred** (iOS gate): Android-only scanner, iOS backup exclusion, profile separation, ATS review, Keychain-on-reinstall policy. No iOS readiness claimed |
| 16 | **Deferred** (out of MVP scope): facility provenance, inspections, warning letters, import alerts, comparisons, monitoring. No scores or rankings |

### Item 13 — source-relationship provenance: what is kept today and what is missing

Kept with each result (in memory now; in the encrypted database once persistence is enabled, as
`fill.identity_json` and `assessment.finding_json`):

| Kept | Where |
|---|---|
| The product's own NDC, labeler, packager flag as openFDA publishes it, and its SPL set id | identity (`productNdc`, `labelerName`, `isOriginalPackager`, `splSetId`) |
| Verified source product NDCs (only those declared in an SPL *and* matched in the NDC Directory with the same formulation) | identity `relatedSourceProductNdcs` |
| Overall chain status: `VERIFIED`, `PARTIAL`, `NOT_ESTABLISHED`, `UNAVAILABLE`, `NOT_CHECKED`, `NOT_APPLICABLE` | identity `sourceProductStatus` |
| Internal inconsistencies in the product's FDA record | identity `sourceConflicts` |
| Effect on the result: `SOURCE_PRODUCT_NOT_ESTABLISHED` limitation, `TEXT_NDC_MATCHES_RELATED_SOURCE_PRODUCT` / `SOURCE_PRODUCT_UNRESOLVED` record reasons, each source-NDC recall search with its dataset date and retrieval time | finding |
| Raw public responses (NDC Directory, DailyMed SPL) with retrieval time and dataset date | `source_cache`, **short-lived** (identity data 30 days), not an audit record |

Not kept (needed for an auditable account of a source relationship):

1. For every node of the chain: the SPL set id **and SPL version/effective date** read (the SPL version
   is not parsed today), and the NDC Directory record used, with retrieval times and dataset dates.
2. Per-branch outcome: which source was verified, not found, unavailable, unreadable, a cycle, or cut
   off at the depth limit (today only the aggregate status, e.g. `PARTIAL`, survives).
3. Why a declared source was rejected (formulation mismatch: which ingredient, strength, form or release).
4. Conflicts between sources (e.g. two declared sources with different formulations).
5. A link from each kept record reason to the source node that produced it.

Proposed shape (not implemented): immutable `source_record` rows (source, identifier, version,
dataset date, retrieved at, content hash) and typed `relationship` rows (from, to, kind
`REPACKAGED_FROM`, verification status, failure reason, depth), referenced by the assessment. Scope
stays product identity; no facility or company inference.

## 5. Device-dependent checks (no device in this environment)

All unverified; each blocks enabling persistence or the pilot: encrypted database file and `-wal`/`-shm`
sidecars; wrong-key failure; key deletion and reset after delete-all; backup and device-transfer
exclusion on a real device; release logcat; scanner network silence during OCR; whether React Native's
Android networking honors `credentials: 'omit'` and `redirect: 'error'` (its shared cookie jar may still
store cookies); app-switcher thumbnail (OD-21); uninstall/reinstall; photo cache after a killed process;
camera-app copies of the photo.

## 6. Verification (head after review round 3)

| Command | Result |
|---|---|
| `npm test` | 558 tests, 558 pass, 0 fail, 0 skipped |
| `npm run typecheck`, `npm run mobile:typecheck` | pass |
| `npm run mobile:test` (jest) | 54 tests in 3 suites, all pass |
| `npm run e2e` (recorded) | 13 scenarios pass |
| `npm run config:validate` | OK |
| Gradle `:app:compileDevReleaseJavaWithJavac` (offline) | pass. Debug flavor not compiled (artifacts not cached offline); no device run |

## 7. F1, F2, F3 and catalog

F1 kept with its regression checks: **no regressions observed in the recorded cases and conflation
checks**, not proof that no false negatives exist. **F2 done** (`ec66d16`): infusion wording read as
non-oral; on all 670 recorded notices exactly 6 change, all IV bags or infusion pumps. F3's drug stays inactive.
Route-dependent and policy-held drugs stay inactive. Stage 1 stays on hold; coverage percentages are
estimates of potential reach, not recall accuracy or readiness.
