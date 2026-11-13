# Findings register — independent review of `b9c5989` (branch `task-4h/correctness-findings`)

**What this covers.** Every concern raised in the independent review of `task-4g/f1-staged-coverage` at
`b9c59895` (F1 included), checked against the current revision of this branch. The review document
itself was not available in the working session; this register follows the review items as listed in
the team's instructions of 2026-11-13. Items will be reconciled against the full review text when it
is shared (open item R-0).

**Rules followed.** Each reproducible defect gets a failing regression test **before** the fix
(`tests/regression/`), then a small separate commit. Real FDA responses are used where possible;
synthetic values are labeled SYNTHETIC. Nothing here activates drugs, merges into `main`, builds for
distribution, enables persistence or claims patient readiness. Stage 1 activation stays on hold.

**Categories.**
- **D — reproduced defect:** a failing test showed it before the fix.
- **T — code-traced concern:** found by reading the code; a test pins the behavior.
- **V — device behavior:** depends on a real phone, camera app or OS; cannot be verified here.
- **M — missing or future feature:** not a defect in what exists; needs a build-out with a gate.

**Status values:** Fixed · In progress · Planned · Decision needed · Deferred (with gate) · Not reproduced.

## 1. Medication and recall accuracy

| ID | Cat. | Finding | Patient impact | Reproduced | Affected code | Regression test | Fix / plan | Status · evidence |
|---|---|---|---|---|---|---|---|---|
| C1a | D | A typed or scanned combination written with an abbreviation ("APAP/CODEINE 300-30MG") paired the strengths with the wrong ingredients | Confirmation shows acetaminophen 30 mg + codeine 300 mg; catalog strength rules and refill checks judge the wrong values | Yes | `rules/identity.ts` `orderByAppearance`, `identityFromPrintedFields` | `c1_ingredient_association.test.ts` | Ingredient position found by name or alias | Fixed `a868c3b` |
| C1b | D | Recall comparison treated a combination's strengths as an unordered set (swapped strengths compared equal) | A recall of amlodipine 20 / atorvastatin 10 could be kept as a match for amlodipine 10 / atorvastatin 20 | Yes (SYNTHETIC recall text, real products) | `rules/recallRecord.ts` `compareAttributes` | same | Per-ingredient comparison when the text names every ingredient; otherwise the old set comparison (never claims an unseen difference) | Fixed `a868c3b` |
| C1c | D | Refill comparison: swapped strengths and salt changes not reported | Doxycycline hyclate → monohydrate, or swapped combination strengths, showed "no change" | Yes | `rules/refill.ts` `diffFills` | same | Per-ingredient strengths; new `SALT_CHANGED` (re-evaluate, check with pharmacist) | Fixed `a868c3b` |
| C1d | T | Identity cross-validation (label vs FDA listing) of combination strengths | Same as C1a for scanned NDC products | Covered by C1a/C1b changes; cross-validation uses the per-ingredient pairing from C1a | `rules/identity.ts` `crossValidate` | to add: swapped-strength cross-validation case | Add guard test | Planned |
| C2a | D | Recall text search ignored ingredient aliases | Recalls that name an ingredient only by an abbreviation are never retrieved. Real data: 18 oral HCTZ-combination notices say only "HCTZ", including D-0886-2022, which names the Lupin losartan/HCTZ 100/25 mg NDC | Yes (live openFDA 2026-11-13; recorded) | `rules/recallEvidence.ts` `planRecallQueries` | `c2_alias_search_coverage.test.ts`; `tests/integration/c2_alias_search.test.ts` (recorded) | Each ingredient searched as (name OR alias); `hctz` alias added to the proposed catalog with evidence | Fixed `f0387cc`. No record lost; 17 newly retrieved records ruled out by strength or combination, D-0886-2022 now a possible match |
| C2b | D | "All pages retrieved" was treated as complete coverage even when the search omitted terms or required NDC searches | A fully paged but incomplete search could produce "No matching recall found" | Yes | `evaluateRecallEvidence` | same | New `coverage.searchAdequate` (every name and alias, product-NDC and source-NDC searches) feeds `complete`; limitation `SEARCH_TERMS_INCOMPLETE` with patient copy; presentation also downgrades a saved result without it | Fixed `f0387cc` |
| C3a | T | Repackager source chain: one verified branch marks the whole chain `VERIFIED` even when another branch was unavailable, unreadable or cut off | No source qualifier on the result, although part of the source chain was not checked | To reproduce | `services/ports.ts` `sourceProducts` | `c3_source_chain.test.ts` | Partial chains get their own status, keep their qualifier and stop a no-match from being unqualified | In progress |
| C3b | T | Depth limit (3) reached silently | As C3a | To reproduce | same | same | Depth limit counts as incomplete | In progress |
| C3c | T | Unreadable or product-less SPL treated like "no source declared" | Reported as not established (qualified) rather than unavailable | To reproduce | same | same | Unreadable/absent product → unavailable | In progress |
| C3d | T | Packager status unknown and source not checked (`NOT_CHECKED`) gives no result qualifier | Possible unqualified "No matching recall found" for a repackaged product (against OD-17) | To reproduce | `presentation/present.ts` | same | Qualify `NOT_CHECKED` when the product is not known to be the original packager | In progress |
| C3e | T | Cycles in the source chain | None expected (visited set) | Guard only | `sourceProducts` | same | Guard test | In progress |
| C3f | T | With an unknown source, recall records naming other NDCs are ruled out as "other product", though one of them could be the unknown source | Possible missed relevant recall for repackaged products; today a qualified no-match | Code-traced | `rules/recallRecord.ts` | — | **Decision needed (OD-33)**: keep OD-17 qualified no-match, or show such same-strength records as possible matches | Decision needed |
| C4a | T | Malformed FDA dataset date passes the freshness check (`Date.parse` → NaN compares false) | "No matching recall found" shown with an unusable data date | To reproduce | `present.ts` `noMatchIsSupported` | `c4_dates_and_missing_info.test.ts` | Strict ISO date parse; malformed → cannot support a no-match | Planned |
| C4b | T | Future dataset date (or evaluated-before-dataset) passes | As C4a | To reproduce | same | same | Future dates rejected | Planned |
| C4c | T | Malformed or future evaluation time | Already rejected (age must be 0–24 h) | To verify | same | same | Guard test | Planned |
| C5 | T | Missing or conflicting information silently becoming a confirmed identity or a negative finding | Wrong medication checked, or false reassurance | To probe (empty fields, conflicting NDC/name, conflicting release, combination with missing strength) | `engine/runner.ts`, `state/machine.ts` | same | Fix any path found | Planned |

## 2. Patient data and saved-result integrity

| ID | Cat. | Finding | Patient impact | Reproduced | Affected code | Regression test | Fix / plan | Status · evidence |
|---|---|---|---|---|---|---|---|---|
| P1 | T | Offline reuse of a saved assessment keyed by product only; lot and package ignored, and the stored finding is shown without reassessment | A result about lot A (e.g. "recall match found" or "not in the listed lots") shown for a bottle from lot B or another package | To reproduce | `storage/repositories.ts` `latestFor` | `p_saved_results.test.ts` | Reuse only for the same product, package and lot; otherwise reassess the stored records against the current identity or show nothing | Planned |
| P2 | T | History joins a medication's latest assessment to its **first** fill | Saved result displayed with the wrong bottle's details | To reproduce | `app/screens/History.tsx` | same | Join by `assessment.fill_id` | Planned |
| P3a | T | After "Delete all data", the database is not recreated and the session keeps the destroyed database handle | Later checks fail or silently stop saving | To reproduce | `app/AppRoot.tsx`, `app/useRecallSession.ts` | jest screen test | Recreate storage after delete; rebuild the session when storage changes | Planned |
| P3b | T | Database open, key or migration failure is swallowed | History silently off; no message | To reproduce | `AppRoot.tsx` | jest screen test | Visible storage error; nothing saved | Planned |
| P3c | T | Delete-all failure (destroy or key deletion throws) | Consent cleared or not, no message | To reproduce | `AppRoot.tsx` `onDeleteAll` | jest screen test | Visible failure; do not report success | Planned |
| P4 | T/V | Image cleanup on success, cancel, error, process interruption | Photo of a label left on the phone | Code-traced: deleted on success, cancel and error; a photo left by a killed process is deleted at next start | `RxScannerModule.java` | JVM/unit where possible | Device verification needed | Device check |
| P5 | V | External camera app access | The phone's camera app writes the photo; some camera apps may keep their own copy | Device-dependent | `scanLabel` (system camera intent) | — | Device check per camera app; in-app camera is a future option | Device check |
| P6 | T | Backups | Saved data copied to cloud backup | Code-traced: `allowBackup=false`, `fullBackupContent=false`, data extraction rules | `AndroidManifest.xml` | to add: manifest test | Pin with a test | Planned |
| P7 | T | Logs | Label or medication content in logs | Code-traced: no `console.*` in `mobile/src`, `mobile/app`; native module logs nothing | — | existing privacy guard + to add grep test | Pin with a test | Planned |
| P8 | V/M | App-switcher exposure (recents thumbnail) | Medication visible in the recents screen | Not protected (OD-21 open) | `MainActivity` | — | Decision OD-21; device check | Decision needed |
| P9 | T | Network requests carry only public identifiers | — | Existing privacy-guard tests (Task 3); C2 adds alias terms only (public ingredient names) | `services/openfda.ts` SAFE_SEARCH | existing | Re-run | Planned |
| P10 | V | Encryption at rest on a device | — | Not verifiable here; persistence stays off in development builds | `platform/native.ts` | — | Gate: on-device verification before persistence is enabled | Deferred (gate) |

## 3. Confirmation and patient workflow

| ID | Cat. | Finding | Patient impact | Reproduced | Affected code | Regression test | Fix / plan | Status · evidence |
|---|---|---|---|---|---|---|---|---|
| W1 | T | Confirm button readiness ignores a required lot confirmation; the engine then stays on the same screen | Button looks ready, nothing happens | To reproduce | `app/screens/Confirm.tsx` vs `runner.requiredConfirmations` | jest screen test | Readiness from the engine's required list | Planned |
| W2 | T | No explicit way to continue without a scanned lot | User must confirm a lot they may not trust | To reproduce | `Confirm.tsx`, `screens.ts` | same | "Continue without the lot" choice; result says lot not used | Planned |
| W3 | T | Release mechanism must be IR/ER/DR; no "cannot tell" | Forces a guess that changes which recalls are ruled out | To reproduce | `Confirm.tsx`, `machine.ts` | same | "I can't tell" keeps the release unknown: recalls are not ruled out by release, release-dependent exclusions need clarification, a no-match is qualified | Planned |
| W4 | M | Refill changes not shown to the patient | A changed manufacturer, strength or salt goes unnoticed | — | `refill.ts` result unused in screens | — | Show refill changes when history is enabled | Deferred (gate: persistence) |
| W5 | M | No recheck of a saved medication, with sources and dates | — | — | History screen | — | Recheck button reusing the confirmed identity | Deferred (gate: persistence) |

## 4. Other items

| ID | Item | Status |
|---|---|---|
| F1 | Salt-word fix | Approved (bounded). Its regression checks stay. Wording: no regressions observed in the tested cases. |
| F2 | IV/infusion wording over-includes | Scheduled after the shared accuracy fixes |
| F3 | Mixed-salt drug (dextroamphetamine/amphetamine) | Stays inactive until mixed-salt handling is independently validated |
| R-0 | Reconcile this register against the full review document | Open — review text not available in the session |
