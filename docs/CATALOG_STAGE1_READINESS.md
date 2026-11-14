# Extended catalog — reconciliation, Stage 1 gates and the smallest next batch

Recommendation for team review. **Nothing is activated**: `data/drug_catalog.json` (14 drugs) is
unchanged; the proposal is `data/proposals/drug_catalog_0.3.0-proposed.json` (status
`PROPOSED_PENDING_APPROVAL`). Prepared 2026-11-14 on branch `task-4h/correctness-findings`.

## 1. Reconciliation (checked by script against the data files)

| Set | Count | Where | Check |
|---|---|---|---|
| Current, in the app | 14 | `data/drug_catalog.json`, all ACTIVE | all 14 also in the proposal; none re-staged |
| Candidates | 130 | proposal ACTIVE minus the current 14 | equal to Stages 1–3 of `activation_stages.json` (68 + 40 + 22) |
| Held | 17 | proposal INACTIVE | equal to Stage 4 (17) |
| **Proposal total** | **161** | 14 + 130 + 17 | no duplicates; every staged drug is in the proposal |

"ACTIVE" in the proposal means "would be checked once the proposal is approved". It switches on
nothing in the app.

Why the 17 are held (from `activation_stages.json`, per drug):

| Reason | Drugs | Count | What clears it |
|---|---|---|---|
| Recall-search gap that F1 fixed; held until F1 was approved, then last stage | clopidogrel, escitalopram, citalopram, doxycycline, isosorbide mononitrate, dapagliflozin, hydroxyzine, sitagliptin, chlorhexidine, clindamycin, levocetirizine, pramipexole, ketorolac | 13 | F1 is now approved as a bounded correction, so the search gap no longer blocks them; they stay in Stage 4 (activated last) and need the same gates as Stage 1. Note: for 4 repackaged exemplars among them (escitalopram, levocetirizine, ketorolac, isosorbide mononitrate) OD-33 now turns a no-match into a possible match on recorded data |
| Route needs review (FDA lists a non-oral route for the example product) | tiotropium (oral + inhalation), lidocaine (oral + topical) | 2 | Route decision per product; stay inactive until then |
| Policy hold | digoxin (OD-32, narrow-therapeutic-index criterion) | 1 | OD-32 decision |
| Mixed-salt search gap remaining after F1 | dextroamphetamine/amphetamine | 1 | F3, independently validated |

## 2. Stage 1 gates

Stage 1 = 68 single-ingredient, oral tablet/capsule, single-release drugs; every FDA product matched;
not controlled; mostly oral.

| # | Gate | Status |
|---|---|---|
| G1 | Shared correctness findings resolved (independent review rounds 1–3) | **Met** — passed targeted re-review (head `0405eb6`) |
| G2 | Device verification of build 11 (V0–V12: photo cleanup, camera, SQLCipher and wrong key, deletion, backup, logs, networking, recents) | **Open** — not run; no device reachable from the preparing environment |
| G3 | Recorded-data flow tests (scan or entry → confirmation → result) for 10 Stage 1 drugs, including a known-recall positive and a no-NDC label for each | **Open** — to be done for the batch below first |
| G4 | Pixel test with 3 synthetic labels of Stage 1 drugs | **Open** (needs G2's device session) |
| G5 | Team review of the Stage 1 rows (identity, form, route, release, exclusions) | **Open** |
| G6 | Patient-visible validation beyond directory matching: recall retrieval completeness, uncertainty wording, confirmation flow, false-positive burden (OD-33 possible matches for repackaged products; partly stated strengths kept) | **Open** — measure per batch drug on recorded data |
| G7 | OD-32 (whether exclusion criteria widen, e.g. narrow-therapeutic-index drugs) — Stage 1 drugs that a widening could exclude must wait | **Open decision**; the batch below avoids drugs a widening is likely to touch |
| G8 | Catalog approval and version (OD-2): an approved catalog version for pilot builds; development builds may carry the proposal only as a labeled draft | **Open** |
| G9 | Known search-name gap: nitrofurantoin ("monohyd/macrocrystals" naming) | **Open** for that drug only — excluded from the batch |

## 3. Smallest next activation batch (recommendation, not activation)

Five Stage 1 drugs chosen for the least identity ambiguity and enough real recall notices to test both
matches and exclusions:

| Drug | 2023 Part D claims | FDA oral Rx products | Recall notices found by the app's search | Why |
|---|---|---|---|---|
| simvastatin | 15.9 M | 160 | 41 | No salt forms; 100% oral; the most recall notices of the five |
| spironolactone | 8.0 M | 182 | 11 | No salt forms; 100% oral |
| ezetimibe | 7.0 M | 42 | 18 | No salt forms; 100% oral; single ingredient (combinations are separate drugs) |
| finasteride | 6.9 M | 72 | 17 | No salt forms; 100% oral |
| glimepiride | 4.7 M | 105 | 21 | No salt forms; 100% oral |

Excluded from the first batch on purpose: hydrochlorothiazide (new `hctz` alias; most of its 128
notices are combination products — better as a second-batch alias test), drugs with several salt forms
(e.g. amoxicillin, azithromycin), drugs that are partly non-oral or also sold OTC (famotidine, ibuprofen,
ondansetron, ciprofloxacin), nitrofurantoin (G9), and drugs an OD-32 widening could plausibly affect
(e.g. amiodarone).

Before this batch is switched on: G2, G3 (these 5 plus 5 more Stage 1 drugs), G4, G5, G6, G8, and G7 for
any drug it touches. Coverage percentages remain estimates of potential reach, not measures of recall
accuracy or patient readiness.
