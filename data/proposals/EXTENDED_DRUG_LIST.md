# Extended drug list — proposal for review (catalog 0.3.0-proposed)

Proposal, not yet in the app. The app still uses `data/drug_catalog.json` 0.2.0 (14 drugs) until the
team approves this list (OD-2) and decides OD-30 and OD-32. Verified 2026-11-13.

## How the list was made (same method as the original 15)

1. **Ranking.** CMS *Medicare Part D Prescribers — by Geography and Drug*, data year 2023, National rows
   ([file](https://data.cms.gov/sites/default/files/2025-04/9fe6b8a6-0cb9-4b7c-9760-87800da010a8/MUP_DPR_RY25_P04_V10_DY23_Geo.csv), SHA-256 `876ff262c8a3eb0b8fca312f2004f14d42a8bfd01829e0695d64e34b5191f4f8`). Generic names ranked by total claims, summed over
   brand names; the top 200 are taken. These cover 88.7% of all
   1,616,932,462 Part D claims in 2023. This reproduces the original list: ranks 1–18 match OpenPrescriber's
   published top 20 exactly (19 and 20 swap). OpenPrescriber's counts are about 42–44% of CMS's
   official national totals, so the counts here come from CMS directly.
2. **Ingredients.** Each CMS name is mapped to RxNorm ingredients and verified exactly on RxNav, with
   every salt form (precise ingredient). CMS abbreviations that cannot be matched automatically are
   mapped in a small, listed override table (`scripts/catalog/step1_rank_and_map.py`) and still verified.
3. **Scope.** FDA's NDC Directory (openFDA) must list at least one **oral, prescription** product with
   exactly that ingredient set. Inhalers, eye drops, skin products, injections, sublingual products,
   kits, vaccines and supplies are out of scope, as today.
4. **Exclusions.** The existing exclusion policy (anticoagulants, transplant immunosuppressants) is
   applied unchanged. Digoxin is switched off pending OD-32 (narrow-therapeutic-index criterion).
5. **App check.** For every drug, the app's own code reads a real FDA product record, decides
   eligibility against this catalog (before and after the RxNav step), and runs the recall search it
   would send. All 165 drugs behave exactly as listed below. Drugs whose recall search would
   find fewer records than the plain ingredient name are switched off until app fix F1.
6. **Validation.** The proposed catalog passes the app's configuration validator and precedence
   self-test (`npm run config:validate -- --catalog-file data/proposals/drug_catalog_0.3.0-proposed.json`).

## Summary

| Decision | Drugs | Share of all 2023 Part D claims |
|---|---|---|
| In the app now | 14 | 29.1% |
| Add (active) | 130 | 45.4% |
| Add (switched off until a fix or decision) | 17 | 4.7% |
| Excluded by policy | 4 | 2.2% |
| Out of scope (not oral, or not a drug) | 31 | 7.3% |

Coverage of all 2023 Part D claims, as a range. The upper bound counts every claim of a covered
generic name, including patches, inhalers and eye drops the app does not check; the oral-weighted
estimate weights each drug's claims by the share of its FDA prescription products that are oral-only
(a proxy: CMS data does not split claims by dosage form). Details: `docs/F1_AND_STAGED_ACTIVATION.md`.

| Scope | Upper bound | Oral-weighted estimate |
|---|---|---|
| Today (14 drugs) | 29.1% | 28.1% |
| + 130 proposed active | 74.5% | 69.3% |
| + 17 held | 79.2% | 73.5% |

**App fix F1 (implemented 2026-11-13, awaiting approval):** the recall-search gap is closed for 13 of
the 14 drugs it affected (verified on recorded FDA responses); they stay switched off until F1 is
approved. Dextroamphetamine/amphetamine still needs follow-up F3 (mixed salts). Activation is
proposed in four stages (`data/proposals/activation_stages.json`).

**Worth a second look before approving:** methotrexate (an immunosuppressant used outside
transplant, so the transplant criterion does not cover it); sacubitril/valsartan (0 recall records
found, plausible for a brand-only product); timolol and estradiol (most of their claims are eye drops
or patches, which the app does not cover).

## The list

Columns: CMS rank; CMS generic name(s); 2023 claims; RxNorm ingredient(s) with RxCUI; decision;
catalog drug ID; oral prescription products in FDA's NDC Directory; recall records the app's search
finds today (openFDA enforcement, 2026-11-13); one real product NDC used for the app check; reason.
The 200 CMS names make 196 rows: names that are the same ingredient are one row (for example
"Ondansetron" and "Ondansetron Hcl"). Product and recall counts are per ingredient set across all
salts, so metoprolol succinate and tartrate show the same counts.

| # | CMS generic name | Claims 2023 | Ingredient (RxCUI) | Decision | Stage | Catalog ID | FDA oral Rx products | Oral-only share | Recall records found | Example NDC | Reason |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Atorvastatin Calcium | 68,495,916 | atorvastatin (RxCUI 83367) | In the app now | now | `atorvastatin` | 395 | 100% | 68 | 0093-5056 |  |
| 2 | Amlodipine Besylate | 47,540,195 | amlodipine (RxCUI 17767) | In the app now | now | `amlodipine` | 200 | 100% | 98 | 0480-0083 |  |
| 3 | Levothyroxine Sodium | 46,609,036 | levothyroxine (RxCUI 10582) | In the app now | now | `levothyroxine` | 553 | 95% | 188 | 0480-8690 |  |
| 4 | Lisinopril | 36,069,353 | lisinopril (RxCUI 29046) | In the app now | now | `lisinopril` | 274 | 100% | 41 | 0591-0405 |  |
| 5 | Gabapentin | 35,149,588 | gabapentin (RxCUI 25480) | In the app now | now | `gabapentin` | 583 | 100% | 25 | 0121-1067 |  |
| 6 | Losartan Potassium | 33,196,550 | losartan (RxCUI 52175) | In the app now | now | `losartan` | 208 | 100% | 117 | 0615-7958 |  |
| 7 | Metformin Hcl | 33,107,562 | metformin (RxCUI 6809) | In the app now | now | `metformin` | 449 | 100% | 91 | 0378-6001 |  |
| 8 | Metoprolol Succinate | 29,696,750 | metoprolol (RxCUI 6918) | In the app now | now | `metoprolol_succinate` | 476 | 96% | 43 | 0615-7823 |  |
| 9 | Omeprazole | 28,132,175 | omeprazole (RxCUI 7646) | In the app now | now | `omeprazole` | 176 | 100% | 17 | 0615-8079 |  |
| 10 | Rosuvastatin Calcium | 25,907,213 | rosuvastatin (RxCUI 301542) | In the app now | now | `rosuvastatin` | 282 | 100% | 13 | 0615-8532 |  |
| 11 | Pantoprazole Sodium | 23,654,268 | pantoprazole (RxCUI 40790) | In the app now | now | `pantoprazole` | 138 | 82% | 27 | 0378-6688 |  |
| 12 | Furosemide | 23,023,929 | furosemide (RxCUI 4603) | In the app now | now | `furosemide` | 137 | 62% | 14 | 0054-3294 |  |
| 13 | Apixaban | 21,185,751 | apixaban (RxCUI 1364430) | Excluded by policy | — | `—` | 18 | — | 0 | 0115-1721 | Exclusion policy rule EXCL-APIXABAN |
| 14 | Hydrocodone/Acetaminophen | 20,015,432 | hydrocodone (RxCUI 5489); acetaminophen (RxCUI 161) | In the app now | now | `hydrocodone_acetaminophen` | 208 | 100% | 16 | 0054-0843 |  |
| 15 | Tamsulosin Hcl | 19,859,696 | tamsulosin (RxCUI 77492) | In the app now | now | `tamsulosin` | 64 | 100% | 5 | 0115-8211 |  |
| 16 | Albuterol Sulfate | 19,688,815 | albuterol (RxCUI 435) | Add (active) | 3 | `albuterol` | 27 | 21% | 42 | 51407-367 |  |
| 17 | Hydrochlorothiazide | 18,347,405 | hydrochlorothiazide (RxCUI 5487) | Add (active) | 1 | `hydrochlorothiazide` | 170 | 100% | 128 | 0172-2083 |  |
| 18 | Trazodone Hcl | 17,032,783 | trazodone (RxCUI 10737) | Add (active) | 1 | `trazodone` | 169 | 100% | 9 | 0555-0711 |  |
| 19 | Metoprolol Tartrate | 16,235,425 | metoprolol (RxCUI 6918) | Add (active) | 2 | `metoprolol_tartrate` | 476 | 96% | 43 | 0378-0018 |  |
| 20 | Simvastatin | 15,947,590 | simvastatin (RxCUI 36567) | Add (active) | 1 | `simvastatin` | 160 | 100% | 41 | 0615-7992 |  |
| 21 | Potassium Chloride | 15,382,335 | potassium chloride (RxCUI 8591) | Add (active) | 2 | `potassium_chloride` | 261 | 92% | 48 | 0121-0948 |  |
| 22 | Sertraline Hcl | 15,258,687 | sertraline (RxCUI 36437) | Add (active) | 1 | `sertraline` | 229 | 100% | 7 | 0615-8596 |  |
| 23 | Carvedilol | 15,175,020 | carvedilol (RxCUI 20352) | Add (active) | 2 | `carvedilol` | 207 | 100% | 25 | 0093-0051 |  |
| 24 | Prednisone | 14,985,485 | prednisone (RxCUI 8640) | Add (active) | 2 | `prednisone` | 317 | 100% | 11 | 0054-0017 |  |
| 25 | Fluticasone Propionate | 13,382,310 | fluticasone (RxCUI 41126) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 26 | Clopidogrel Bisulfate | 13,031,458 | clopidogrel (RxCUI 32968) | Add (switched off) | 4 | `clopidogrel` | 68 | 100% | 7 | 0093-7314 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 7 records; before F1 1). Held inactive until F1 is approved, then Stage 4 |
| 27 | Tramadol Hcl | 12,883,350 | tramadol (RxCUI 10689) | Add (active) | 3 | `tramadol` | 126 | 100% | 12 | 0093-3301 |  |
| 28 | Famotidine | 12,743,061 | famotidine (RxCUI 4278) | Add (active) | 1 | `famotidine` | 176 | 91% | 23 | 0172-5728 |  |
| 29 | Duloxetine Hcl | 12,231,525 | duloxetine (RxCUI 72625) | Add (active) | 1 | `duloxetine` | 205 | 100% | 63 | 0228-2890 |  |
| 30 | Montelukast Sodium | 11,943,280 | montelukast (RxCUI 88249) | Add (active) | 1 | `montelukast` | 93 | 100% | 14 | 0781-5560 |  |
| 31 | Escitalopram Oxalate | 11,831,986 | escitalopram (RxCUI 321988) | Add (switched off) | 4 | `escitalopram` | 155 | 100% | 2 | 0615-8475 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 2 records; before F1 0). Held inactive until F1 is approved, then Stage 4 |
| 32 | Alprazolam | 11,674,615 | alprazolam (RxCUI 596) | Add (active) | 3 | `alprazolam` | 141 | 100% | 33 | 0054-3068 |  |
| 33 | Meloxicam | 11,301,668 | meloxicam (RxCUI 41493) | Add (active) | 1 | `meloxicam` | 151 | 99% | 9 | 0615-8040 |  |
| 34 | Latanoprost | 10,283,427 | latanoprost (RxCUI 43611) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 35 | Pravastatin Sodium | 9,605,809 | pravastatin (RxCUI 42463) | Add (active) | 1 | `pravastatin` | 185 | 100% | 17 | 0093-7201 |  |
| 36 | Quetiapine Fumarate | 9,472,557 | quetiapine (RxCUI 51272) | Add (active) | 2 | `quetiapine` | 349 | 100% | 12 | 0054-0220 |  |
| 37 | Allopurinol | 9,282,458 | allopurinol (RxCUI 519) | Add (active) | 1 | `allopurinol` | 171 | 98% | 7 | 0378-0137 |  |
| 38 | Bupropion Hcl | 9,078,063 | bupropion (RxCUI 42347) | Add (active) | 2 | `bupropion` | 345 | 100% | 44 | 0115-5445 |  |
| 39 | Amoxicillin | 9,023,192 | amoxicillin (RxCUI 723) | Add (active) | 1 | `amoxicillin` | 280 | 100% | 20 | 0093-2263 |  |
| 40 | Oxycodone Hcl | 8,924,419 | oxycodone (RxCUI 7804) | Add (active) | 3 | `oxycodone` | 161 | 100% | 25 | 0054-0390 |  |
| 41 | Insulin Glargine,hum.Rec.Anlog | 8,898,382 | insulin glargine (RxCUI 274783) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 42 | Clonazepam | 8,855,573 | clonazepam (RxCUI 2598) | Add (active) | 3 | `clonazepam` | 145 | 100% | 15 | 0093-0832 |  |
| 43 | Oxycodone Hcl/Acetaminophen | 8,671,673 | oxycodone (RxCUI 7804); acetaminophen (RxCUI 161) | Add (active) | 3 | `oxycodone_acetaminophen` | 136 | 100% | 9 | 0406-0512 |  |
| 44 | Diclofenac Sodium | 8,631,549 | diclofenac (RxCUI 3355) | Add (active) | 2 | `diclofenac` | 210 | 60% | 29 | 0228-2550 |  |
| 45 | Azithromycin | 8,261,233 | azithromycin (RxCUI 18631) | Add (active) | 1 | `azithromycin` | 187 | 93% | 13 | 0093-2026 |  |
| 46 | Alendronate Sodium | 8,211,446 | alendronate (RxCUI 46041) | Add (active) | 1 | `alendronate` | 36 | 100% | 2 | 0054-0282 |  |
| 47 | Empagliflozin | 8,149,965 | empagliflozin (RxCUI 1545653) | Add (active) | 1 | `empagliflozin` | 11 | 100% | 8 | 0597-0152 |  |
| 48 | Lorazepam | 8,088,872 | lorazepam (RxCUI 6470) | Add (active) | 3 | `lorazepam` | 127 | 87% | 21 | 0054-3532 |  |
| 49 | Semaglutide | 8,000,462 | semaglutide (RxCUI 1991302) | Add (active) | 3 | `semaglutide` | 10 | 38% | 57 | 0169-1704 |  |
| 50 | Spironolactone | 7,954,357 | spironolactone (RxCUI 9997) | Add (active) | 1 | `spironolactone` | 182 | 100% | 11 | 0378-0243 |  |
| 51 | Mirtazapine | 7,837,419 | mirtazapine (RxCUI 15996) | Add (active) | 1 | `mirtazapine` | 144 | 100% | 9 | 0378-3515 |  |
| 52 | Zolpidem Tartrate | 7,771,210 | zolpidem (RxCUI 39993) | Add (active) | 3 | `zolpidem` | 138 | 97% | 10 | 0781-5315 |  |
| 53 | Glipizide | 7,751,298 | glipizide (RxCUI 4821) | Add (active) | 2 | `glipizide` | 145 | 100% | 14 | 0591-0460 |  |
| 54 | Donepezil Hcl | 7,655,818 | donepezil (RxCUI 135447) | Add (active) | 1 | `donepezil` | 73 | 100% | 6 | 0615-7951 |  |
| 55 | Ibuprofen | 7,216,984 | ibuprofen (RxCUI 5640) | Add (active) | 1 | `ibuprofen` | 320 | 98% | 68 | 0472-2002 |  |
| 56 | Fluoxetine Hcl | 7,198,477 | fluoxetine (RxCUI 4493) | Add (active) | 2 | `fluoxetine` | 227 | 100% | 11 | 0093-7198 |  |
| 57 | Cephalexin | 7,109,186 | cephalexin (RxCUI 2231) | Add (active) | 1 | `cephalexin` | 184 | 100% | 24 | 0093-2238 |  |
| 58 | Buspirone Hcl | 7,108,008 | buspirone (RxCUI 1827) | Add (active) | 1 | `buspirone` | 277 | 100% | 10 | 0093-0053 |  |
| 59 | Ezetimibe | 6,992,500 | ezetimibe (RxCUI 341248) | Add (active) | 1 | `ezetimibe` | 42 | 100% | 18 | 0904-7103 |  |
| 60 | Citalopram Hydrobromide | 6,899,092 | citalopram (RxCUI 2556) | Add (switched off) | 4 | `citalopram` | 116 | 100% | 8 | 0054-0062 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 8 records; before F1 1). Held inactive until F1 is approved, then Stage 4 |
| 61 | Finasteride | 6,891,435 | finasteride (RxCUI 25025) | Add (active) | 1 | `finasteride` | 72 | 100% | 17 | 0615-8562 |  |
| 62 | Cyclobenzaprine Hcl | 6,853,578 | cyclobenzaprine (RxCUI 21949) | Add (active) | 2 | `cyclobenzaprine` | 243 | 100% | 8 | 0093-3420 |  |
| 63 | Amoxicillin/Potassium Clav | 6,834,726 | amoxicillin (RxCUI 723); clavulanate (RxCUI 48203) | Add (active) | 2 | `amoxicillin_clavulanate` | 205 | 100% | 5 | 0093-2274 |  |
| 64 | Pregabalin | 6,778,280 | pregabalin (RxCUI 187832) | Add (active) | 3 | `pregabalin` | 542 | 100% | 10 | 0904-6991 |  |
| 65 | Atenolol | 6,713,810 | atenolol (RxCUI 1202) | Add (active) | 1 | `atenolol` | 129 | 100% | 5 | 0093-0752 |  |
| 66 | Rivaroxaban | 6,651,363 | rivaroxaban (RxCUI 1114195) | Excluded by policy | — | `—` | 44 | — | 3 | 14445-147 | Exclusion policy rule EXCL-RIVAROXABAN |
| 67 | Tizanidine Hcl | 6,510,163 | tizanidine (RxCUI 57258) | Add (active) | 1 | `tizanidine` | 200 | 100% | 14 | 0615-8468 |  |
| 68 | Diltiazem Hcl | 6,393,852 | diltiazem (RxCUI 3443) | Add (active) | 2 | `diltiazem` | 280 | 94% | 52 | 0093-0318 |  |
| 69 | Pen Needle, Diabetic | 6,237,487 | — | Out of scope | — | `—` | — | — | — | — | Not a drug ingredient (vaccine, device or supply) |
| 70 | Triamcinolone Acetonide | 6,197,121 | triamcinolone (RxCUI 10759) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 71 | Venlafaxine Hcl | 5,976,979 | venlafaxine (RxCUI 39786) | Add (active) | 2 | `venlafaxine` | 334 | 100% | 29 | 0093-7384 |  |
| 72 | Doxycycline Hyclate; Doxycycline Monohydrate | 7,687,929 | doxycycline (RxCUI 3640) | Add (switched off) | 4 | `doxycycline` | 624 | 93% | 30 | 0143-2112 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 30 records; before F1 17). Held inactive until F1 is approved, then Stage 4 |
| 73 | Hydralazine Hcl | 5,806,142 | hydralazine (RxCUI 5470) | Add (active) | 1 | `hydralazine` | 120 | 83% | 18 | 0615-7973 |  |
| 74 | Lisinopril/Hydrochlorothiazide | 5,771,925 | lisinopril (RxCUI 29046); hydrochlorothiazide (RxCUI 5487) | Add (active) | 2 | `lisinopril_hydrochlorothiazide` | 96 | 100% | 7 | 0591-0860 |  |
| 75 | Varicella-Zoster Ge/As01b/Pf | 5,694,531 | — | Out of scope | — | `—` | — | — | — | — | Not a drug ingredient (vaccine, device or supply) |
| 76 | Memantine Hcl | 5,684,839 | memantine (RxCUI 6719) | Add (active) | 2 | `memantine` | 120 | 100% | 12 | 0615-8192 |  |
| 77 | Warfarin Sodium | 5,541,041 | warfarin (RxCUI 11289) | Excluded by policy | — | `—` | 148 | — | 9 | 0093-1712 | Exclusion policy rule EXCL-WARFARIN |
| 78 | Oxybutynin Chloride | 5,408,933 | oxybutynin (RxCUI 32675) | Add (active) | 2 | `oxybutynin` | 115 | 99% | 10 | 0615-8219 |  |
| 79 | Methylprednisolone | 5,401,458 | methylprednisolone (RxCUI 6902) | Add (active) | 3 | `methylprednisolone` | 53 | 37% | 93 | 0603-4593 |  |
| 80 | Dulaglutide | 5,313,751 | dulaglutide (RxCUI 1551291) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 81 | Losartan/Hydrochlorothiazide | 5,191,911 | losartan (RxCUI 52175); hydrochlorothiazide (RxCUI 5487) | Add (active) | 2 | `losartan_hydrochlorothiazide` | 111 | 100% | 27 | 0093-7367 |  |
| 82 | Divalproex Sodium | 5,009,951 | valproate (RxCUI 40254) | Add (active) | 2 | `valproate` | 211 | 98% | 16 | 0378-0472 |  |
| 83 | Fluticasone/Umeclidin/Vilanter | 5,007,613 | fluticasone (RxCUI 41126); umeclidinium (RxCUI 1487514); vilanterol (RxCUI 1424884) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 84 | Celecoxib | 4,988,964 | celecoxib (RxCUI 140587) | Add (active) | 1 | `celecoxib` | 238 | 100% | 4 | 0591-3982 |  |
| 85 | Baclofen | 4,969,215 | baclofen (RxCUI 1292) | Add (active) | 1 | `baclofen` | 216 | 91% | 71 | 0172-4096 |  |
| 86 | Ciprofloxacin Hcl | 4,829,389 | ciprofloxacin (RxCUI 2551) | Add (active) | 1 | `ciprofloxacin` | 170 | 84% | 28 | 0143-9928 |  |
| 87 | Isosorbide Mononitrate | 4,807,944 | isosorbide (RxCUI 6057) | Add (switched off) | 4 | `isosorbide_mononitrate` | 62 | 100% | 11 | 0228-2620 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 11 records; before F1 3). Held inactive until F1 is approved, then Stage 4 |
| 88 | Glimepiride | 4,697,311 | glimepiride (RxCUI 25789) | Add (active) | 1 | `glimepiride` | 105 | 100% | 21 | 0615-8332 |  |
| 89 | Levetiracetam | 4,657,288 | levetiracetam (RxCUI 114477) | Add (active) | 2 | `levetiracetam` | 238 | 78% | 18 | 0121-0799 |  |
| 90 | Fluticasone Propion/Salmeterol | 4,606,450 | fluticasone (RxCUI 41126); salmeterol (RxCUI 36117) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 91 | Sulfamethoxazole/Trimethoprim | 4,603,185 | sulfamethoxazole (RxCUI 10180); trimethoprim (RxCUI 10829) | Add (active) | 2 | `sulfamethoxazole_trimethoprim` | 96 | 91% | 16 | 0615-8121 |  |
| 92 | Rsvpref3 Antigen/As01e/Pf | 4,394,584 | — | Out of scope | — | `—` | — | — | — | — | Not a drug ingredient (vaccine, device or supply) |
| 93 | Dapagliflozin Propanediol | 4,296,969 | dapagliflozin (RxCUI 1488564) | Add (switched off) | 4 | `dapagliflozin` | 50 | 100% | 1 | 69097-388 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 1 records; before F1 0). Held inactive until F1 is approved, then Stage 4 |
| 94 | Estradiol | 4,286,117 | estradiol (RxCUI 4083) | Add (active) | 3 | `estradiol` | 72 | 26% | 295 | 0555-0886 |  |
| 95 | Hydroxyzine Hcl; Hydroxyzine Pamoate | 5,779,729 | hydroxyzine (RxCUI 5553) | Add (switched off) | 4 | `hydroxyzine` | 548 | 98% | 24 | 0093-5060 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 24 records; before F1 0). Held inactive until F1 is approved, then Stage 4 |
| 96 | Lamotrigine | 4,214,448 | lamotrigine (RxCUI 28439) | Add (active) | 2 | `lamotrigine` | 287 | 100% | 13 | 0115-1526 |  |
| 97 | Budesonide/Formoterol Fumarate | 4,188,863 | budesonide (RxCUI 19831); formoterol (RxCUI 25255) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 98 | Ondansetron; Ondansetron Hcl | 8,065,764 | ondansetron (RxCUI 26225) | Add (active) | 1 | `ondansetron` | 438 | 81% | 24 | 0054-0064 |  |
| 99 | Sitagliptin Phosphate | 4,027,265 | sitagliptin (RxCUI 593411) | Add (switched off) | 4 | `sitagliptin` | 36 | 100% | 2 | 0480-2607 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 2 records; before F1 1). Held inactive until F1 is approved, then Stage 4 |
| 100 | Valsartan | 3,968,024 | valsartan (RxCUI 69749) | Add (active) | 1 | `valsartan` | 145 | 100% | 138 | 0378-5807 |  |
| 101 | Aripiprazole | 3,915,571 | aripiprazole (RxCUI 89013) | Add (active) | 1 | `aripiprazole` | 267 | 99% | 29 | 0615-8375 |  |
| 103 | Propranolol Hcl | 3,835,234 | propranolol (RxCUI 8787) | Add (active) | 2 | `propranolol` | 211 | 97% | 12 | 0054-3727 |  |
| 104 | Risperidone | 3,820,299 | risperidone (RxCUI 35636) | Add (active) | 1 | `risperidone` | 169 | 96% | 6 | 0615-8196 |  |
| 105 | Olanzapine | 3,813,076 | olanzapine (RxCUI 61381) | Add (active) | 1 | `olanzapine` | 205 | 94% | 21 | 0093-5245 |  |
| 106 | Nitrofurantoin Monohyd/M-Cryst | 3,776,730 | nitrofurantoin (RxCUI 7454) | Add (active) | 1 | `nitrofurantoin` | 140 | 100% | 17 | 0185-0122 |  |
| 107 | Nystatin | 3,687,948 | nystatin (RxCUI 7597) | Add (active) | 3 | `nystatin` | 29 | 31% | 29 | 0093-0983 |  |
| 108 | Ketoconazole | 3,658,054 | ketoconazole (RxCUI 6135) | Add (active) | 3 | `ketoconazole` | 13 | 22% | 10 | 35573-433 |  |
| 109 | Mirabegron | 3,650,058 | mirabegron (RxCUI 1300786) | Add (active) | 1 | `mirabegron` | 23 | 100% | 1 | 67184-0571 |  |
| 110 | Amitriptyline Hcl | 3,642,822 | amitriptyline (RxCUI 704) | Add (active) | 1 | `amitriptyline` | 212 | 100% | 6 | 0781-1486 |  |
| 111 | Carbidopa/Levodopa | 3,547,852 | carbidopa (RxCUI 2019); levodopa (RxCUI 6375) | Add (active) | 2 | `carbidopa_levodopa` | 98 | 99% | 8 | 0378-0088 |  |
| 112 | Clonidine Hcl | 3,543,472 | clonidine (RxCUI 2599) | Add (active) | 2 | `clonidine` | 147 | 84% | 92 | 0228-2127 |  |
| 113 | Nifedipine | 3,539,567 | nifedipine (RxCUI 7417) | Add (active) | 2 | `nifedipine` | 133 | 100% | 21 | 0615-8549 |  |
| 114 | Prednisolone Acetate | 3,534,278 | prednisolone (RxCUI 8638) | Add (active) | 2 | `prednisolone` | 39 | 68% | 34 | 0121-0759 |  |
| 115 | Fluconazole | 3,508,060 | fluconazole (RxCUI 4450) | Add (active) | 1 | `fluconazole` | 153 | 93% | 23 | 0904-6500 |  |
| 116 | Paroxetine Hcl | 3,497,303 | paroxetine (RxCUI 32937) | Add (active) | 2 | `paroxetine` | 168 | 99% | 25 | 0378-7001 |  |
| 117 | Mupirocin | 3,476,045 | mupirocin (RxCUI 42372) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 118 | Ropinirole Hcl | 3,299,998 | ropinirole (RxCUI 72302) | Add (active) | 2 | `ropinirole` | 149 | 100% | 13 | 0228-3640 |  |
| 119 | Topiramate | 3,204,833 | topiramate (RxCUI 38404) | Add (active) | 2 | `topiramate` | 303 | 100% | 11 | 0480-2356 |  |
| 120 | Sacubitril/Valsartan | 3,198,752 | sacubitril (RxCUI 1656328); valsartan (RxCUI 69749) | Add (active) | 2 | `sacubitril_valsartan` | 103 | 100% | 0 | 0904-7580 |  |
| 121 | Pioglitazone Hcl | 3,073,371 | pioglitazone (RxCUI 33738) | Add (active) | 1 | `pioglitazone` | 68 | 100% | 9 | 0093-7271 |  |
| 122 | Olmesartan Medoxomil | 3,003,478 | olmesartan (RxCUI 321064) | Add (active) | 1 | `olmesartan` | 131 | 100% | 18 | 0527-2425 |  |
| 123 | Insulin Lispro | 2,998,533 | insulin lispro (RxCUI 86009) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 124 | Insulin Aspart | 2,974,041 | insulin aspart, human (RxCUI 51428) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory |
| 125 | Diazepam | 2,955,220 | diazepam (RxCUI 3322) | Add (active) | 3 | `diazepam` | 88 | 68% | 13 | 0054-3185 |  |
| 126 | Valacyclovir Hcl | 2,953,135 | valacyclovir (RxCUI 73645) | Add (active) | 1 | `valacyclovir` | 116 | 100% | 5 | 0378-4275 |  |
| 127 | Naproxen | 2,913,656 | naproxen (RxCUI 7258) | Add (active) | 2 | `naproxen` | 223 | 100% | 12 | 0054-3630 |  |
| 128 | Amiodarone Hcl | 2,884,995 | amiodarone (RxCUI 703) | Add (active) | 1 | `amiodarone` | 43 | 60% | 9 | 0245-0144 |  |
| 129 | Triamterene/Hydrochlorothiazid | 2,882,734 | triamterene (RxCUI 10763); hydrochlorothiazide (RxCUI 5487) | Add (active) | 2 | `triamterene_hydrochlorothiazide` | 69 | 100% | 7 | 0591-0348 |  |
| 130 | Chlorthalidone | 2,827,233 | chlorthalidone (RxCUI 2409) | Add (active) | 1 | `chlorthalidone` | 105 | 100% | 9 | 0378-0213 |  |
| 131 | Esomeprazole Magnesium | 2,823,488 | esomeprazole (RxCUI 283742) | Add (active) | 2 | `esomeprazole` | 125 | 97% | 17 | 0378-2350 |  |
| 132 | Azelastine Hcl | 2,784,497 | azelastine (RxCUI 18603) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 133 | Meclizine Hcl | 2,782,004 | meclizine (RxCUI 6676) | Add (active) | 1 | `meclizine` | 72 | 100% | 16 | 0615-8514 |  |
| 134 | Timolol Maleate | 2,765,364 | timolol (RxCUI 10600) | Add (active) | 3 | `timolol` | 4 | 5% | 34 | 0378-0221 |  |
| 135 | Torsemide | 2,739,184 | torsemide (RxCUI 38413) | Add (active) | 1 | `torsemide` | 63 | 100% | 4 | 0054-0077 |  |
| 136 | Lovastatin | 2,738,534 | lovastatin (RxCUI 6472) | Add (active) | 1 | `lovastatin` | 72 | 100% | 4 | 0093-0576 |  |
| 137 | Hydrocortisone | 2,713,231 | hydrocortisone (RxCUI 5492) | Add (active) | 3 | `hydrocortisone` | 54 | 27% | 71 | 0115-1696 |  |
| 138 | Morphine Sulfate | 2,687,564 | morphine (RxCUI 7052) | Add (active) | 3 | `morphine` | 116 | 75% | 189 | 0115-1277 |  |
| 139 | Dorzolamide Hcl/Timolol Maleat | 2,671,068 | dorzolamide (RxCUI 60207); timolol (RxCUI 10600) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 140 | Fluticasone/Vilanterol | 2,599,568 | fluticasone (RxCUI 41126); vilanterol (RxCUI 1424884) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 141 | Brimonidine Tartrate | 2,535,614 | brimonidine (RxCUI 134615) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 142 | Acetaminophen With Codeine | 2,524,047 | acetaminophen (RxCUI 161); codeine (RxCUI 2670) | Add (active) | 3 | `acetaminophen_codeine` | 75 | 100% | 9 | 0121-0504 |  |
| 143 | Methocarbamol | 2,513,195 | methocarbamol (RxCUI 6845) | Add (active) | 1 | `methocarbamol` | 200 | 94% | 12 | 0276-0510 |  |
| 144 | Nitroglycerin | 2,495,243 | nitroglycerin (RxCUI 4917) | Add (active) | 3 | `nitroglycerin` | 12 | 12% | 19 | 45802-210 |  |
| 145 | Levofloxacin | 2,446,240 | levofloxacin (RxCUI 82122) | Add (active) | 1 | `levofloxacin` | 97 | 78% | 23 | 0527-1948 |  |
| 146 | Irbesartan | 2,443,364 | irbesartan (RxCUI 83818) | Add (active) | 1 | `irbesartan` | 83 | 100% | 31 | 29300-212 |  |
| 147 | Chlorhexidine Gluconate | 2,443,173 | chlorhexidine (RxCUI 2358) | Add (switched off) | 4 | `chlorhexidine` | 35 | 65% | 86 | 0116-0101 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 86 records; before F1 83). Held inactive until F1 is approved, then Stage 4 |
| 148 | Hydroxychloroquine Sulfate | 2,375,157 | hydroxychloroquine (RxCUI 5521) | Add (active) | 1 | `hydroxychloroquine` | 58 | 100% | 2 | 0093-2401 |  |
| 149 | Temazepam | 2,364,315 | temazepam (RxCUI 10355) | Add (active) | 3 | `temazepam` | 88 | 100% | 2 | 0228-2076 |  |
| 150 | Dicyclomine Hcl | 2,337,339 | dicyclomine (RxCUI 3361) | Add (active) | 1 | `dicyclomine` | 121 | 94% | 4 | 0054-0622 |  |
| 151 | Clobetasol Propionate | 2,323,720 | clobetasol (RxCUI 2590) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 152 | Methotrexate Sodium | 2,323,208 | methotrexate (RxCUI 6851) | Add (active) | 3 | `methotrexate` | 36 | 46% | 14 | 0054-4550 |  |
| 153 | Tiotropium Bromide | 2,298,858 | tiotropium (RxCUI 69120) | Add (switched off) | 4 | `tiotropium` | 4 | 0% | 5 | 68180-964 | Needs review: FDA lists route ORAL + RESPIRATORY (INHALATION) for the example product |
| 154 | Linaclotide | 2,261,914 | linaclotide (RxCUI 1307404) | Add (active) | 1 | `linaclotide` | 4 | 100% | 1 | 0456-1201 |  |
| 155 | Nirmatrelvir/Ritonavir | 2,255,631 | nirmatrelvir (RxCUI 2587892); ritonavir (RxCUI 85762) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory |
| 156 | Sucralfate | 2,223,838 | sucralfate (RxCUI 10156) | Add (active) | 1 | `sucralfate` | 70 | 100% | 8 | 0093-2210 |  |
| 157 | Clindamycin Hcl | 2,222,276 | clindamycin (RxCUI 2582) | Add (switched off) | 4 | `clindamycin` | 103 | 49% | 50 | 0009-0760 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 50 records; before F1 2). Held inactive until F1 is approved, then Stage 4 |
| 158 | Benazepril Hcl | 2,209,363 | benazepril (RxCUI 18867) | Add (active) | 1 | `benazepril` | 88 | 100% | 13 | 23155-749 |  |
| 159 | Bumetanide | 2,191,740 | bumetanide (RxCUI 1808) | Add (active) | 1 | `bumetanide` | 95 | 75% | 6 | 0185-0128 |  |
| 160 | Doxazosin Mesylate | 2,182,347 | doxazosin (RxCUI 49276) | Add (active) | 2 | `doxazosin` | 130 | 100% | 16 | 0093-2067 |  |
| 161 | Dextroamphetamine/Amphetamine | 2,137,883 | dextroamphetamine (RxCUI 3288); amphetamine (RxCUI 725) | Add (switched off) | 4 | `dextroamphetamine_amphetamine` | 218 | 100% | 35 | 0115-1486 | Recall-search gap remains after F1: mixed-salt product (amphetamine + amphetamine aspartate + dextroamphetamine + dextroamphetamine saccharate) finds 35 records vs 37 by ingredient name; needs follow-up F3 (merge salts of the same ingredient in one product) |
| 162 | Rsv Vacc, Pref A And Pref B/Pf | 2,133,393 | — | Out of scope | — | `—` | — | — | — | — | Not a drug ingredient (vaccine, device or supply) |
| 163 | Metronidazole | 2,106,632 | metronidazole (RxCUI 6922) | Add (active) | 2 | `metronidazole` | 121 | 69% | 15 | 0904-7126 |  |
| 164 | Levocetirizine Dihydrochloride | 2,092,693 | levocetirizine (RxCUI 356887) | Add (switched off) | 4 | `levocetirizine` | 45 | 100% | 4 | 0093-7701 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 4 records; before F1 3). Held inactive until F1 is approved, then Stage 4 |
| 165 | Insulin Detemir | 2,077,611 | insulin detemir (RxCUI 139825) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 166 | Enalapril Maleate | 2,056,056 | enalapril (RxCUI 3827) | Add (active) | 1 | `enalapril` | 107 | 100% | 22 | 0904-7309 |  |
| 167 | Cyclosporine | 2,052,225 | cyclosporine (RxCUI 3008) | Excluded by policy | — | `—` | 31 | — | 27 | 0074-3108 | Exclusion policy rule EXCL-CYCLOSPORINE |
| 168 | Cefdinir | 2,008,033 | cefdinir (RxCUI 25037) | Add (active) | 1 | `cefdinir` | 81 | 100% | 11 | 0093-3160 |  |
| 169 | Ipratropium Bromide | 1,998,933 | ipratropium (RxCUI 7213) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 170 | Benztropine Mesylate | 1,990,446 | benztropine (RxCUI 1424) | Add (active) | 1 | `benztropine` | 51 | 91% | 4 | 0603-2433 |  |
| 171 | Icosapent Ethyl | 1,983,920 | icosapent ethyl (RxCUI 1304974) | Add (active) | 1 | `icosapent_ethyl` | 39 | 100% | 3 | 0054-0508 |  |
| 172 | Fenofibrate; Fenofibrate Nanocrystallized | 3,816,055 | fenofibrate (RxCUI 8703) | Add (active) | 2 | `fenofibrate` | 438 | 100% | 11 | 0115-5511 |  |
| 173 | Insulin Degludec | 1,918,927 | insulin degludec (RxCUI 1670007) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 174 | Lactulose | 1,913,784 | lactulose (RxCUI 6218) | Add (active) | 2 | `lactulose` | 37 | 76% | 9 | 0116-4005 |  |
| 175 | Acyclovir | 1,899,052 | acyclovir (RxCUI 281) | Add (active) | 1 | `acyclovir` | 156 | 76% | 19 | 0472-0082 |  |
| 177 | Tirzepatide | 1,820,883 | tirzepatide (RxCUI 2601723) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 178 | Sumatriptan Succinate | 1,795,531 | sumatriptan (RxCUI 37418) | Add (active) | 1 | `sumatriptan` | 74 | 63% | 9 | 0378-5630 |  |
| 180 | Buprenorphine Hcl/Naloxone Hcl | 1,761,492 | buprenorphine (RxCUI 1819); naloxone (RxCUI 7242) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 181 | Pramipexole Di-Hcl | 1,741,633 | pramipexole (RxCUI 746741) | Add (switched off) | 4 | `pramipexole` | 137 | 100% | 23 | 0615-8551 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 23 records; before F1 17). Held inactive until F1 is approved, then Stage 4 |
| 182 | Alcohol Antiseptic Pads | 1,725,477 | — | Out of scope | — | `—` | — | — | — | — | Not a drug ingredient (vaccine, device or supply) |
| 183 | Digoxin | 1,676,083 | digoxin (RxCUI 3407) | Add (switched off) | 4 | `digoxin` | 47 | 80% | 7 | 0115-9811 | Pending OD-32 (narrow-therapeutic-index criterion) |
| 184 | Amlodipine Besylate/Benazepril | 1,666,390 | amlodipine (RxCUI 17767); benazepril (RxCUI 18867) | Add (active) | 2 | `amlodipine_benazepril` | 93 | 100% | 8 | 23155-920 |  |
| 185 | Clotrimazole/Betamethasone Dip | 1,657,717 | clotrimazole (RxCUI 2623); betamethasone (RxCUI 1514) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 186 | Verapamil Hcl | 1,656,910 | verapamil (RxCUI 11170) | Add (active) | 2 | `verapamil` | 84 | 62% | 17 | 0378-6320 |  |
| 187 | Valsartan/Hydrochlorothiazide | 1,621,363 | valsartan (RxCUI 69749); hydrochlorothiazide (RxCUI 5487) | Add (active) | 2 | `valsartan_hydrochlorothiazide` | 104 | 100% | 40 | 0378-6321 |  |
| 188 | Anastrozole | 1,613,420 | anastrozole (RxCUI 84857) | Add (active) | 1 | `anastrozole` | 41 | 100% | 54 | 0093-7536 |  |
| 189 | Ramipril | 1,584,563 | ramipril (RxCUI 35296) | Add (active) | 1 | `ramipril` | 69 | 100% | 6 | 0054-0106 |  |
| 190 | Ketorolac Tromethamine | 1,551,666 | ketorolac (RxCUI 35827) | Add (switched off) | 4 | `ketorolac` | 55 | 28% | 58 | 0093-0314 | Recall-search gap fixed by app fix F1 (verified 2026-11-13: the search now uses the ingredient name and finds 58 records; before F1 33). Held inactive until F1 is approved, then Stage 4 |
| 191 | Ergocalciferol (Vitamin D2) | 1,550,641 | ergocalciferol (RxCUI 4018) | Add (active) | 1 | `ergocalciferol` | 38 | 100% | 2 | 42291-266 |  |
| 192 | Bimatoprost | 1,534,282 | bimatoprost (RxCUI 283810) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 194 | Linagliptin | 1,495,809 | linagliptin (RxCUI 1100699) | Add (active) | 1 | `linagliptin` | 3 | 100% | 2 | 0597-0140 |  |
| 195 | Evolocumab | 1,466,828 | evolocumab (RxCUI 1665684) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 196 | Lidocaine | 1,458,645 | lidocaine (RxCUI 6387) | Add (switched off) | 4 | `lidocaine` | 22 | 2% | 369 | 0054-3500 | Needs review: FDA lists route ORAL + TOPICAL for the example product |
| 197 | Promethazine Hcl | 1,418,152 | promethazine (RxCUI 8745) | Add (active) | 1 | `promethazine` | 91 | 70% | 18 | 0116-4023 |  |
| 198 | Dexamethasone | 1,412,844 | dexamethasone (RxCUI 3264) | Add (active) | 1 | `dexamethasone` | 147 | 60% | 81 | 0054-3176 |  |
| 199 | Umeclidinium Brm/Vilanterol Tr | 1,389,702 | umeclidinium (RxCUI 1487514); vilanterol (RxCUI 1424884) | Out of scope | — | `—` | 0 | — | — | — | No oral prescription product with exactly this ingredient set in FDA's NDC Directory (products exist for other routes: inhaled, eye, skin, injection or under the tongue) |
| 200 | Colchicine | 1,380,446 | colchicine (RxCUI 2683) | Add (active) | 1 | `colchicine` | 48 | 100% | 6 | 0254-0460 |  |

CSV of the same table: `data/proposals/extended_drug_list_review.csv`. Catalog in the app's format: `data/proposals/drug_catalog_0.3.0-proposed.json`.
