# App fix F1 and staged activation — results for approval

Proposal for review (2026-11-13). Nothing here is merged into `main` or shipped in a build. The app's
drug list stays at the current 14 drugs until we approve a stage.

## Decisions (2026-11-13)

- **F1 approved as a bounded correction.** No catalog activation and no distribution yet.
- **Staged expansion approved in principle; Stage 1 on hold** until the shared correctness findings
  (`docs/CORRECTNESS_FINDINGS.md`) are resolved.
- **F2 scheduled after the shared correctness fixes.**
- **F3:** dextroamphetamine/amphetamine stays inactive until its mixed-salt handling is independently
  validated.

## 1. What we were asked to approve

1. **App fix F1** (salt words in the recall search), with the results below.
2. **The staged activation plan** (section 6), starting with Stage 1 (68 drugs).
3. Follow-ups, each separate: **F2** (recognise IV/infusion wording such as "in NS" as non-oral),
   **F3** (mixed-salt products such as dextroamphetamine/amphetamine).

Decisions applied: OD-30, prioritise broad, reliable coverage (staged); OD-32, existing exclusion
criteria retained unchanged until reviewed separately (digoxin stays held).

## 2. App fix F1

**Problem.** For 14 proposed drugs, the app searched FDA recall notices with the salt still attached
("hydroxyzine dihydrochloride"), because its salt-word list was incomplete. Notices that say only
"hydroxyzine" were missed, which can turn into a false "No matching recall found".

**Change** (`mobile/src/rules/ingredients.ts`, one function):

- New salt words: bisulfate, oxalate, hydrobromide, hyclate, mononitrate, propanediol, phosphate,
  gluconate, palmitate, tromethamine, pamoate. "Dihydrochloride" is read as "hydrochloride" (the
  same products are published under both names; treating them as different would wrongly rule recalls
  out as "different salt").
- **Guards against conflating different drugs:**
  - A salt word never splits off a mineral or metal ("sodium phosphate", "calcium gluconate",
    "ferrous sulfate" and "potassium chloride" stay whole). This also fixes an existing quirk:
    "calcium acetate" used to be read as "calcium".
  - A new salt word only counts at the end of a name ("acidulated phosphate fluoride" stays whole).
  - Not salt words: "dinitrate" (isosorbide dinitrate is a different drug from the mononitrate),
    "chloride", "aspartate" and "saccharate" (mixed-salt products need F3).
- Words that were salt words before F1 are read exactly as before.

**Conflation check across all of RxNorm** (14,718 ingredients, 3,688 salt forms; recorded
2026-11-13 and kept as an offline test): **no ingredient name is now read as an ingredient the app
checks or excludes.** 61 ingredients that used to be shortened to a metal are now kept whole; 151
salt forms now read correctly as their ingredient. 11 cosmetic or veterinary names (for example
"cetyl palmitate", "tylosin phosphate") are now read as another RxNorm name; none is an oral
prescription drug in scope.

**Before and after, on recorded FDA responses**, through the app's own evidence path (search,
paging, positive control, evaluation). One real FDA product per case; extra salt forms test false
positives; two controls must not change. All responses are recorded in `tests/fixtures/f1/` and
replayed by `tests/integration/f1_salt_search.test.ts`.

| Case | Product NDC | Records retrieved | Result for that product | New possible | New ruled out | Lost |
|---|---|---|---|---|---|---|
| clopidogrel bisulfate tablet | 60505-0253 | 1 → 7 | No match → No match | 0 | 6 | 0 |
| escitalopram oxalate tablet | 68788-4171 | 0 → 2 | No match → No match | 0 | 2 | 0 |
| citalopram hydrobromide tablet | 0378-6231 | 1 → 8 | No match → Possible match **(false no-match fixed)** | 1 | 6 | 0 |
| doxycycline hyclate capsule | 85534-0048 | 17 → 30 | No match → Possible match **(false no-match fixed)** | 4 | 9 | 0 |
| doxycycline monohydrate capsule | 72189-358 | 30 → 30 | Possible match → Possible match | 0 | 0 | 0 |
| isosorbide mononitrate ER tablet | 68071-4290 | 3 → 11 | No match → No match | 0 | 8 | 0 |
| dapagliflozin tablet | 69097-388 | 0 → 1 | No match → No match | 0 | 1 | 0 |
| hydroxyzine hydrochloride tablet | 80425-0394 | 0 → 24 | No match → Possible match **(false no-match fixed)** | 1 | 23 | 0 |
| hydroxyzine pamoate capsule | 43063-172 | 4 → 24 | No match → Possible match **(false no-match fixed)** | 1 | 19 | 0 |
| sitagliptin tablet | 0781-5766 | 1 → 2 | No match → No match | 0 | 1 | 0 |
| chlorhexidine gluconate oral rinse | 59883-175 | 83 → 86 | Possible match → Possible match | 1 | 2 | 0 |
| clindamycin palmitate oral solution | 53746-468 | 2 → 50 | No match → Possible match **(false no-match fixed)** | 5 | 43 | 0 |
| clindamycin hydrochloride capsule | 50090-7659 | 50 → 50 | Possible match → Possible match | 0 | 0 | 0 |
| levocetirizine tablet | 82804-232 | 3 → 4 | No match → No match | 0 | 1 | 0 |
| pramipexole tablet | 29300-211 | 17 → 23 | No match → No match | 0 | 6 | 0 |
| ketorolac tromethamine tablet | 0904-7303 | 33 → 58 | No match → No match | 0 | 25 | 0 |
| CONTROL metformin ER tablet (current drug) | 62756-142 | 91 → 91 | Possible match → Possible match | 0 | 0 | 0 |
| CONTROL potassium chloride ER tablet | 60687-756 | 48 → 48 | Possible match → Possible match | 0 | 0 | 0 |

What this shows:

- **No regressions observed in the tested cases:** in these 18 cases no record found before F1 is lost
  (last column) and no product moves toward a no-match. This is evidence from the cases tested, not
  proof that F1 can never cause a false negative.
- **Five false no-matches fixed:** citalopram, doxycycline hyclate, hydroxyzine (hydrochloride and
  pamoate) and clindamycin palmitate went from "No match" to "Possible match" because relevant recall
  records are now found.
- **False positives controlled:** newly found records are never "Recall match found". Records for other
  salts, dosage forms and strengths are ruled out: 16 hydrochloride recalls for the hydroxyzine pamoate
  capsule; 19 hydrochloride/phosphate recalls for the clindamycin palmitate solution. A newly found
  record becomes a *possible* match only when it states no comparable strength or form (for example a
  compounding pharmacy's "all hydroxyzine products" recall), which is the app's existing cautious rule.
- **Reviewed by hand:** 7 chlorhexidine records moved from "possible" to "ruled out": four oral-care kits
  (toothbrushes, swabs, solutions) and three chlorhexidine + alcohol skin swabs. Before F1 the app
  could not read "chlorhexidine" in these notices.
- **Known over-inclusion (F2):** one IV clindamycin infusion record ("120MG in NS … Homepumps") is
  shown as a *possible* match for the oral solution, because "in NS"/"homepump" are not yet recognised
  as non-oral wording. It errs toward caution; F2 would fix it.
- **Controls unchanged:** metformin ER (a current drug) and potassium chloride ER retrieve and classify
  exactly as before.

**Preserved:** the four result categories, the matching rules, uncertainty handling and all
patient-facing wording are unchanged (no copy or rule-table change). The full suite passes: 448
automated tests and 33 screen tests, including the build 7 scanner and summary-first result screens.

## 3. The 17 held entries (all still switched off)

| Drug | Specific issue | Status |
|---|---|---|
| clopidogrel, escitalopram, citalopram, doxycycline, isosorbide mononitrate, dapagliflozin, hydroxyzine, sitagliptin, chlorhexidine, clindamycin, levocetirizine, pramipexole, ketorolac | Recall-search gap | Fixed by F1 and verified; held until F1 is approved |
| dextroamphetamine/amphetamine | Mixed salts (four salts of two ingredients) | Gap remains (35 vs 37 records); needs F3 |
| tiotropium | FDA lists its capsules as oral and inhaled | Needs a route decision |
| lidocaine | FDA lists viscous lidocaine as oral and topical | Needs a route decision |
| digoxin | Narrow therapeutic index | Held for the separate OD-32 review |

## 4. Review of the 130 proposed active entries

Every oral prescription product in FDA's NDC Directory with exactly each drug's ingredient set was run
through the app's own identity and eligibility code (`scripts/catalog/step6_product_review.ts`;
results in `data/proposals/extended_drug_list_product_review.json`).

- **Product identity:** 22,380 FDA products across the 144 active drugs; 21,882 matched to the right
  drug; 461 are metoprolol products correctly matched to the other metoprolol salt; none matched a
  wrong drug.
- **Exclusion policy:** no product of any proposed drug is excluded, and none carries an anticoagulant or
  transplant-immunosuppressant class signal. The four excluded drugs (apixaban, rivaroxaban, warfarin,
  cyclosporine) remain blocked.
- **Dosage form and route:** the only cautious answers are 14 metoprolol products (counted under both metoprolol
  entries) where FDA's own record disagrees on the salt ("needs clarification", the known OD-13 case), 8 lactulose products listed as
  oral and rectal and 1 nystatin product listed as oral and topical ("not covered"). Nitroglycerin's
  products are mostly tongue sprays (moved to Stage 3).
- **Release type:** 38 proposed drugs have products with more than one release type (for example
  bupropion IR/ER); the app keeps them distinct and asks when the label does not say (Stage 2).
- **Not oral for most products:** albuterol, semaglutide, methylprednisolone, estradiol, nystatin,
  ketoconazole, timolol, hydrocortisone, nitroglycerin and methotrexate (Stage 3).

## 5. Counts and coverage, reconciled

- **Ranking:** 200 CMS generic names → 196 rows (four pairs are the same ingredient: doxycycline,
  hydroxyzine, ondansetron, fenofibrate; their claims are added, never double-counted). Combination
  products are separate CMS names with their own claims, so single-ingredient and combination rows never
  overlap.
- **Catalog:** 161 drugs = 14 current + 130 proposed active + 17 held; 159 ingredients (combinations
  share ingredients, for example hydrochlorothiazide appears in four drugs).
- **Decisions:** 14 current + 130 + 17 + 4 excluded + 31 out of scope = 196 rows.
- **Denominator:** all 1,616,932,462 Part D claims in 2023 (all drugs, all forms); 20,185,472 of the top
  200's claims are vaccines and supplies. Claims count fills, Medicare only.
- **Coverage range:** an upper bound (every claim of a covered generic name, including forms the app
  does not check) and an oral-weighted estimate (claims × the share of the drug's FDA prescription
  products that are oral-only; a proxy, as CMS does not split claims by dosage form):

| Scope | Drugs | Upper bound | Oral-weighted estimate |
|---|---|---|---|
| Today | 14 | 29.1% | 28.1% |
| + Stage 1 | +68 | 51.9% | 50.2% |
| + Stage 2 | +40 | 65.8% | 63.4% |
| + Stage 3 | +22 | 74.5% | 69.3% |
| + Stage 4 (held) | +17 | 79.2% | 73.5% |

## 6. Staged activation plan

| Stage | Drugs | Criteria | Gate before switching on |
|---|---|---|---|
| Stage 1 | 68 | Single ingredient; oral tablets/capsules; one release type; every FDA product matched to the drug; not a controlled substance; mostly oral | Recorded-data flow tests for 10 drugs; Pixel test with 3 labels; team review of the stage rows |
| Stage 2 | 40 | Combination products, drugs with several release types (the app asks when the label does not say), mostly liquids, or a few FDA products answered cautiously | Same, plus release-question and combination flows; 10 more drugs on recorded data |
| Stage 3 | 22 | Controlled substances; generic names whose FDA products are mostly not oral (inhalers, patches, eye drops, sprays); methotrexate (clinical review) | Team decision on how to present non-oral forms; clinical review of controlled substances and methotrexate |
| Stage 4 | 17 | The 17 held: 13 fixed by F1 (after F1 approval); dextroamphetamine/amphetamine (needs F3); tiotropium and lidocaine (route data review); digoxin (OD-32 review) | Each drug only when its specific issue is closed and re-verified |

Each stage: re-run the pipeline (FDA data changes), switch the stage's drugs to ACTIVE in a new catalog
version, review the change summary, approve that exact catalog version (OD-2), then build and device-test
before any distribution.

**Stage 1 (68):** hydrochlorothiazide, trazodone, simvastatin, sertraline, famotidine, duloxetine, montelukast, meloxicam, pravastatin, allopurinol, amoxicillin, azithromycin, alendronate, empagliflozin, spironolactone, mirtazapine, donepezil, ibuprofen, cephalexin, buspirone, ezetimibe, finasteride, atenolol, tizanidine, hydralazine, celecoxib, baclofen, ciprofloxacin, glimepiride, ondansetron, valsartan, aripiprazole, risperidone, olanzapine, nitrofurantoin, mirabegron, amitriptyline, fluconazole, pioglitazone, olmesartan, valacyclovir, amiodarone, chlorthalidone, meclizine, torsemide, lovastatin, methocarbamol, levofloxacin, irbesartan, hydroxychloroquine, dicyclomine, linaclotide, sucralfate, benazepril, bumetanide, enalapril, cefdinir, benztropine, icosapent_ethyl, acyclovir, sumatriptan, anastrozole, ramipril, ergocalciferol, linagliptin, promethazine, dexamethasone, colchicine

**Stage 2 (40):** metoprolol_tartrate, potassium_chloride, carvedilol, prednisone, quetiapine, bupropion, diclofenac, glipizide, fluoxetine, cyclobenzaprine, amoxicillin_clavulanate, diltiazem, venlafaxine, lisinopril_hydrochlorothiazide, memantine, oxybutynin, losartan_hydrochlorothiazide, valproate, levetiracetam, sulfamethoxazole_trimethoprim, lamotrigine, propranolol, carbidopa_levodopa, clonidine, nifedipine, prednisolone, paroxetine, ropinirole, topiramate, sacubitril_valsartan, naproxen, triamterene_hydrochlorothiazide, esomeprazole, doxazosin, metronidazole, fenofibrate, lactulose, amlodipine_benazepril, verapamil, valsartan_hydrochlorothiazide

**Stage 3 (22):** albuterol, tramadol, alprazolam, oxycodone, clonazepam, oxycodone_acetaminophen, lorazepam, semaglutide, zolpidem, pregabalin, methylprednisolone, estradiol, nystatin, ketoconazole, diazepam, timolol, hydrocortisone, morphine, acetaminophen_codeine, nitroglycerin, temazepam, methotrexate

**Stage 4 (17, held):** clopidogrel, escitalopram, citalopram, doxycycline, isosorbide_mononitrate, dapagliflozin, hydroxyzine, sitagliptin, chlorhexidine, tiotropium, clindamycin, dextroamphetamine_amphetamine, levocetirizine, pramipexole, digoxin, ketorolac, lidocaine

## 7. Not done (by request)

No merge into `main`, no new build, no distribution, no catalog activation. Everything is on branch
`task-4c/scanner` for review.
