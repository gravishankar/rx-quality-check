# Drug Quality Score App PRD (Oct 22, 2026) — Traceability (completes OD-26)

Source: `docs/references/Drug Quality Score App PRD.md` (provided 2026-11-12; diagrams missing in
the paste). Baseline: Task 4C (`task-4c/scanner`). Governing product decision (Task 4B): **no scores,
colors, rankings or verdicts; verified, sourced regulatory facts, including unfavorable ones, with
scope, date and uncertainty.** Several PRD requirements therefore change from "verdict" to
"evidence". Priority: P0 done/next, P1 4D–4F, P2 later/conditional, X rejected.

## Requirements

| ID | PRD requirement | Current implementation | Gap | Data availability | Feasibility | Regulatory / legal concern | Status / priority |
|---|---|---|---|---|---|---|---|
| Q-1 | One-glance green/yellow/red/gray verdict per bottle | Four evidence outcomes (recall match / possible / no match in records checked / could not determine); no green | Color verdict | — | — | Scoring named firms (PRD cites Yuka litigation); device-software and FTC claims risk | **X** (product decision); replaced by evidence categories |
| Q-2 | Identify product, maker and candidate factories from a label photo | **Done (product):** photo → on-device OCR/barcode → NDC → FDA directory → confirmation (Task 4C) | Candidate factories | SPL establishments (DailyMed, on device) | Feasible | "Listed in labeling", never "made at" | Product **P0 done**; factories **P1 (4D)** |
| Q-3 | Score each factory on its full recent history | — | — | FDA Data Dashboard (key-gated; downloads) | Only via bundled snapshot | — | **X** (score); factual history = B3, **deferred with OD-25** |
| Q-4 | Show data confidence separately; never green on weak/stale data | No green at all; qualifiers, freshness limits, "could not determine" | — | — | Done | — | **Adopted** (in evidence form) |
| Q-5 | Recommend up to 3 better makers with NDCs | — | — | — | — | Steering/ranking; treatment-adjacent; manufacturer legal exposure | **X** |
| Q-6 | Monthly re-check; alerts on changes to user's factory/drug/lot | — | Background checks, notifications, saved list | — | Possible later (local only) | Implies monitoring (OD-4 decided per-medication, no monitoring) | **P2**, needs a new decision |
| Q-7 | Scan pharmacy label and manufacturer bottle; read NDC, MFR line, strength, lot, pharmacy | **Done (Task 4C):** NDC (text/UPC/GS1), name, strength, form, MFR abbreviation as printed, lot only where labeled, GS1 lot/expiry; pharmacy and patient text kept private and never sent | Pharmacy name not used (by design) | On device | Done; Pixel accuracy pending | Image privacy (no upload/retention) | **P0 done** |
| Q-8 | Pill photo reads the imprint | — | Imprint OCR from a pill photo | RxNav imprint data (verified 39/40) | Hard (tiny debossed text); imprint *picker* easier | Misidentification | **P2**; imprint picker **P1 (4D)** |
| Q-9 | Confirm screen shows what was found and flags conflicts (e.g., imprint ≠ NDC) | **Done:** three groups (matched in FDA records / read from label / needs input); barcode-vs-text NDC conflict; cross-validation discards an NDC that contradicts the printed name/strength | Imprint conflict | RxNav | Feasible | — | **P0 done**; imprint conflict **P1** |
| Q-10 | Evidence: last 5 inspections with finding types, recalls, warning letters, foreign regulator actions, each with source link and date | Recalls (product-level, lot-aware) with official record links and dates | Inspections, warning letters, foreign regulators | FDA first-party (OD-25); foreign regulators not evaluated | Snapshot only | Facility vs company attribution; staleness | Recalls **done**; inspections/letters **deferred (OD-25)**; foreign regulators **X for now** |
| Q-11 | Act: pharmacist script with maker NDC to order; doctor note; lab recheck (TSH, INR, LDL) suggestion | "Contact your pharmacist or healthcare professional"; official record; "do not stop, change or replace … because of this app alone" | Maker-specific scripts, lab suggestions | — | — | Individualized treatment/monitoring advice → device and liability risk | **X** (needs clinical + regulatory review before any reconsideration) |
| Q-12 | Rescan prompt at refill; refill comparison | `rules/refill.ts` diff; no UI (history disabled) | Saved records + compare UI | On device | Feasible after PV-4 | Encryption must be verified | **P1 (4F)** |
| Q-13 | Five-link bottle→factory chain storing known/unknown per link | Proposed graph with per-edge source and verification status (Task 4B) | Implementation | — | Feasible | — | **P1** |
| Q-14 | Per-drug facts: narrow-margin, lab test, dosage-form difficulty, API plant | — | — | API plant: SPL "api manufacture" (C82401, observed); NTI/difficulty lists: no first-party structured source identified | API plant feasible | NTI/difficulty as scoring inputs = rejected; as facts, need clinical review | API plant **P1 (4D, factual)**; others **X/P2** |
| Q-15 | Sources: ProPublica Rx Inspector, Keypedia, WHO/MHRA/EU/HC/TGA, FOIA, Form 483 PDFs | First-party FDA/NLM only | — | Third-party licensing unknown; foreign regulators differ by product line | — | Data licensing (PRD itself flags) | **X for v0.1**; first-party only |
| Q-16 | Scoring rules 1–10 | — | — | — | — | Scores | **X**; the *facts* behind rules 1, 3, 5–7, 9 become relevance notes (multiple candidates, same-firm other-product recall, no recent inspection, unclassified inspection, findings not posted, different production line) |
| Q-17 | Every verdict stores sources, dates, rules fired, compute date | Recall findings store catalog/policy/rule-set versions, retrieval and dataset dates | — | — | Done for recalls | — | **Adopted** |
| Q-18 | Guardrails: never stop/skip/change dose; say unknowns plainly; recall card matches NDC, strength, lot; fact vs inference; source date; country-neutral | Implemented and tested (claims policy, prohibited-wording tests, evidence levels, lot logic) | "Keep taking it" wording | — | Done | "Keep taking it" is itself advice → app says "do not stop, change or replace … because of this app alone"; pharmacist review | **Adopted (modified)** |
| Q-19 | Acceptance cases (7 + imprint) | See re-verification below | Inspection facts unverifiable here | — | — | — | Research cases, rewritten as evidence expectations |
| Q-20 | Correction process for manufacturers and users | — | Public contact + correction log | — | Process, not code | Fairness, defamation | **P2** (before any evidence viewer ships) |
| Q-21 | Health-data privacy: encryption, no selling, deletion, on-device mode | On-device only; no accounts; deletion; encryption pending device verification | PV-4 | — | — | FTC HBNR, state laws | **Adopted** |
| Q-22 | Medical-device question with counsel | Issues list in `docs/LEGAL_REGULATORY_REVIEW.md` | Counsel review | — | — | — | **Open (counsel)** |
| Q-23 | Build on an AI assistant plus curated database | Deterministic rules; no LLM | — | — | — | CLAUDE.md: no LLM in v0.1 | **X (v0.1)** |
| Q-24 | Caregiver view, shareable summary | — | Multi-person, sharing | — | — | Sharing exports health data | **P2** |
| Q-25 | Success metric: share of bottles resolved to a confirmed factory | — | Lot-to-plant data is not public (PRD agrees) | — | — | — | Replace with: share of scanned bottles resolved to an FDA product listing; share with listed candidate sites |
| Q-26 | Bottle to sourced answer in under 5 minutes | Scan → confirm → result | Measure on Pixel | — | — | — | **Measure in Pixel test** |

## Acceptance cases — re-verification (2026-11-12, live first-party sources reachable from this environment)

Data: `docs/research/task4b/prd_cases_results.json`. Inspection classifications, inspection counts,
warning letters and import alerts could **not** be checked (FDA Data Dashboard / accessdata blocked;
OD-25 deferred) and are not asserted here.

| PRD case | PRD claim | What first-party data showed | Evidence-based expectation (no colors) |
|---|---|---|---|
| Levothyroxine, Jerome Stevens | 10 of 12 inspections VAI; latest clean; "Yellow, improving" | Product is labeled by Amneal (Unithroid, e.g. 60846-801/803); its SPL lists **no** establishment; inspection history not verifiable here | Show labeler as listed; "labeling does not list a manufacturing site"; no inspection facts until a verified FEI link exists |
| Rosuvastatin, MSN (NDC 72205-003) | Two candidate plants; one with an unclassified July 2025 inspection | SPL lists **3** MANUFACTURE sites (PRD said 2); inspection status not verifiable | List all 3 as candidate sites equally; "result pending" only from first-party data |
| Telmisartan, Inventia | Plant recalled chlorthalidone twice in 2026 for dissolution | **Confirmed as recalling firm:** D-0610-2026 (2026-06-24) and D-0852-2026 (2026-09-23), Class II, failed dissolution. No current telmisartan NDC listing for Inventia found | Company-level evidence ("other products recalled by the same firm"); cannot be attributed to the telmisartan site from recall data (no FEI) |
| Progesterone, Bionpharma | Two plants; one plant's findings on a sterile line | 69452-148: 1 site; 69452-233: 2 sites (depends on product) | Candidate sites per product; production-line relevance note requires inspection data (deferred) |
| Anastrozole, Zydus | OAIs in 2019/2014/2011; latest VAI; no inspection since 2022 | 65841-743 and 68382-209: 1 MANUFACTURE site each | One listed site; inspection history pending OD-25 |
| Arimidex (ANI) | Factory undisclosed → gray | 62559-670: SPL has **no** establishment section | "Labeling does not list a manufacturing site" — consistent |
| Estradiol patch, Mylan | 7 of 7 inspections clean → green, high confidence | 4 Mylan estradiol patch SPLs: **none** lists an establishment | Cannot name the plant from labeling; no reassurance possible from SPL |
| Imprint check | "JSP 515 vs 523" disagree | RxNav: 60846-801 → JSP;513, 60846-803 → JSP;515 (different strengths); the 515/523 conflict was not reproduced | Use the official label; show a conflict only when sources actually disagree |

Conclusion: two of the PRD's factory facts differ from current labeling (MSN 3 sites; Mylan patch
lists none), and several depend on sources the app does not use (ProPublica, FOIA). This supports the
design choice to show only first-party, dated facts with their scope — and to re-verify any
assertion immediately before it is used.
