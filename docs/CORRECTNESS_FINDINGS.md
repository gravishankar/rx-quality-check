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
| 5 | Offline matching ignores lot and package | P2 | D | see §2 |
| 6 | History pairs latest assessment with oldest fill | P2 | D | see §2 |
| 7 | Delete-all leaves stale storage in the session | P2 | D | see §2 |
| 8 | Scanner image retention, external camera | P2 | T/V | see §2 |
| 9 | Encryption and native privacy need device evidence | P2 | V | Deferred (device gate) |
| 10 | Lot confirmation: UI and engine disagree | P3 | D | see §3 |
| 11 | Release mechanism forces a guess | P3 | T | see §3 |
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
| Remaining | Query-plan version is tracked through `RULESET_VERSION`; a separate plan version is planned with the item 5 fingerprint. Aliases are reviewed catalog data only (no fuzzy matching) |
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
| Remaining | (a) **OD-33 decision needed**: notices of the same ingredient/strength/form that name *other* NDCs are ruled out even when one could be the unknown source; recommendation: show them as possible matches. (b) Missing SPL set id and source-NDC-not-found: handled (`NOT_ESTABLISHED` / incomplete) — targeted tests to add. (c) Durable per-branch provenance → item 13 |
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

Persistence is **off** in every build that exists (`buildProfile.ts`: development `persistHistory:
false`; pilot only when encryption is verified on a device). Exposure today is nil; these block enabling it.

| # | Locations | Plan / status |
|---|---|---|
| 5 | `storage/repositories.ts:45` `identityLookupKey`, `:242` `latestFor` | Reproduce with different lots/packages; reuse only for an exact fill fingerprint (product, package, lot, strengths, salts, form, release, rules/policy/catalog/query-plan versions) and reassess stored records against the current identity |
| 6 | `app/screens/History.tsx:27`, `storage/repositories.ts:144` | Join assessment to its `fill_id`; repository + screen regression with multiple fills |
| 7 | `app/AppRoot.tsx:165`, `app/useRecallSession.ts:36` | Explicit storage lifecycle (open → ready → deleting → recreated / failed); session rebuilt on change; visible failures for key, open, migration and delete |
| 8 | `RxScannerModule.java:110` | Code-traced: deleted on success, cancel, analysis error; leftovers cleared at next start; deletion result ignored; camera app receives a write grant. Plan: check deletion results, revoke URI grants, document the trust boundary; in-app camera assessed as an option |
| 9 | native | Device evidence required (see §5) |

## 3. Confirmation and workflow (Priority 3)

| # | Locations | Plan / status |
|---|---|---|
| 10 | `app/screens/Confirm.tsx:21`, `state/machine.ts:328` | Readiness from the engine's list; explicit "use this lot / correct it / continue without a lot"; unconfirmed scanned lot never used |
| 11 | `app/screens/Confirm.tsx:45` | "I can't tell" with guidance; no guessed release enters a confirmed identity (see §4 for the decision) |
| 12 | `rules/refill.ts`, `storage/repositories.ts:230`, History | Deferred until persistence: surfaced refill changes, recheck action, and a review of grouping saved records by ingredient set |

## 4. Architecture and future work

| # | Disposition |
|---|---|
| 13 | Partly addressed: traversal completeness is now separate from verified relationships (`PARTIAL`). Durable source records (SPL version, retrieval date, per-branch outcome) deferred — gate: before any feature that shows or stores source relationships beyond the current check |
| 14 | Maintained: all fixes are in shared TypeScript (`rules/`, `services/`, `presentation/`); `architecture_boundaries.test.ts` enforces no I/O/clock in rules (it caught and forced a fix in C4) |
| 15 | Deferred: Android-only scanner, iOS backup exclusion, profile separation, ATS review, Keychain-on-reinstall policy. Gate: each before the matching iOS capability is enabled. No iOS readiness claimed |
| 16 | Deferred, not part of this work: facility provenance, inspections, warning letters, import alerts, comparisons, monitoring. No scores or rankings |

## 5. Device-dependent checks (cannot be done in this environment)

Encrypted DB file and sidecars; wrong-key failure; key deletion/reset; backup and device-transfer
exclusion on a device; release logs; scanner network silence; native redirect/cookie behavior;
app-switcher exposure (OD-21); uninstall/reinstall; camera-app copies of the photo.

## 6. F1, F2, F3 and catalog

F1 kept with its regression checks: **no regressions observed in the recorded cases and conflation
checks**, not proof that no false negatives exist. F2 after these fixes. F3's drug stays inactive.
Route-dependent and policy-held drugs stay inactive. Stage 1 stays on hold; coverage percentages are
estimates of potential reach, not recall accuracy or readiness.
