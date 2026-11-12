# Product Requirements — Rx Recall Check MVP v0.1

Patient-facing name: **Rx Recall Check** (configurable in `config/app_config.json`; the repository name `rx-quality-check` is unchanged).

| Field | Value |
|---|---|
| Status | Draft for approval (Task 1); scope updated in Task 2 (manufacturer provenance removed) |
| Platform | Android phone first (React Native + TypeScript) |
| Purpose of MVP | Assess patient interest, usability and the usefulness of public regulatory data |

## 1. Patient problem

Generic medications with the same ingredient and strength are sold by many labelers. Patients usually
receive them in pharmacy vials that show a drug name and strength, and sometimes an NDC and a short
labeler string.
When patients hear about a drug recall, they cannot easily tell whether it concerns **their**
product, their strength, or their lot. Public FDA data exists but is spread across several systems,
uses identifiers patients don't know, and is easy to misread. In particular, "no recall found" is
easily misread as "this medication is safe".

## 2. Intended users

- **Primary:** adults managing one or more chronic oral generic medications from a retail or mail-order pharmacy, including older adults (the scope list comes from Medicare Part D claims).
- **Secondary:** caregivers managing medications for a family member.
- **Not intended for:** clinicians making treatment decisions, pharmacies, or anyone seeking dosing or substitution advice.

Accessibility needs: large text, high contrast, screen-reader labels, plain language (target reading
level ≤ grade 8), no time-limited interactions.

## 3. MVP capabilities

1. **Scan** a pharmacy prescription label or original manufacturer packaging (camera; on-device OCR and barcode reading).
2. **Identify** drug, strength, dosage form (including IR/ER/DR), NDC and labeler where possible, with the user confirming or correcting each field.
3. **Check exclusion policy** before any assessment.
4. **Retrieve evidence** from public sources: FDA NDC Directory, FDA drug recall (enforcement) reports, RxNorm, and DailyMed SPL (only to relate a repackaged product to its source product NDC).
5. **Explain** which recall records apply to the confirmed product, which might apply, and what is unknown, with sources and dates.
6. **Save** medications locally and **compare refills** (detect changes in NDC, labeler, strength or form between fills).
7. **Re-check** saved medications on demand, with visible data dates. Cached results are clearly marked offline.
8. **Delete** any saved record or all data from within the app.

## 4. MVP drug scope and exclusions

Supported (exact ingredient set; oral outpatient formulations; prescription products):
atorvastatin, amlodipine, levothyroxine, lisinopril, gabapentin, losartan, metformin,
metoprolol succinate, omeprazole, rosuvastatin, pantoprazole, furosemide,
hydrocodone/acetaminophen, tamsulosin. Source: `data/drug_catalog.json`.

Over-the-counter products are excluded from MVP v0.1 (policy rule `OTC-MVP`; OD-3 closed). The catalog and policy are data: adding a drug or an exclusion needs no code change (`docs/DRUG_CATALOG_GUIDE.md`, `docs/EXCLUSION_POLICY_GUIDE.md`).

Excluded by policy (recognized, **not assessed**): warfarin, apixaban, rivaroxaban, dabigatran,
edoxaban, tacrolimus, cyclosporine, sirolimus, everolimus (transplant use → `NEEDS_CLARIFICATION`),
mycophenolate, azathioprine. Source: `data/exclusion_policy.json`, `docs/EXCLUSIONS.md`.

Result states that must stay distinct in UI and storage:

| State | Meaning | Patient-facing gist |
|---|---|---|
| `EXCLUDED` | Recognized, deliberately not assessed by policy | "We don't assess this medication. This is a policy choice, not a finding about the medication." |
| `UNSUPPORTED` | Outside MVP drug or formulation scope | "This medication or form isn't covered by this version of the app." |
| `NEEDS_CLARIFICATION` | Eligibility or identity depends on information we don't have | "We need more information before we can continue." |
| `INSUFFICIENT_DATA` | Supported, but not enough identity information to assess | "We couldn't identify your exact product, so we can't tell which records apply." |
| `SOURCE_UNAVAILABLE` | Required public data could not be retrieved | "We couldn't reach FDA's data. Nothing has been checked yet." |
| `RATE_LIMITED` | Source temporarily refused requests | "FDA's service asked us to wait. Try again in a few minutes." |

## 5. User journeys

### J1 — Pharmacy bottle with an NDC (Doc A UC-2)
1. User photographs the label. OCR runs on the device.
2. App extracts candidate NDC(s), drug name, strength, form, manufacturer string, and fill date if present.
3. **Cross-validation:** the NDC's ingredient and strength from the NDC Directory must match the printed name and strength. If they disagree, the NDC is discarded and the journey continues as J2.
4. If the NDC normalizes to more than one directory-confirmed product, the user chooses (`AMBIGUOUS_IDENTITY`).
5. Exclusion check → user confirms identity → evidence fetch → result (§7) → optional save.

### J2 — Pharmacy bottle without an NDC (Doc A UC-3/UC-4)
1. OCR yields name, strength, form and possibly a manufacturer string (often truncated).
2. App resolves the RxNorm clinical drug (ingredient + strength + form). Labeler candidates come only from verified alias entries or exact name matches, and the user confirms them.
3. If the labeler and product NDC are confirmed → as J1. If not → `INSUFFICIENT_DATA` for product-level relevance. The app still lists recalls for the same ingredient, strength and form, labeled "may or may not apply to your product", and suggests asking the pharmacy for the NDC or manufacturer.
4. v0.1 does **not** offer a pill-imprint picker (deferred; Doc A A-14).

### J3 — Original manufacturer packaging (Doc A UC-1)
1. User scans the barcode (UPC-A / GTIN-14 / DataMatrix) or the printed NDC; lot and expiry are read from the DataMatrix when present, or typed by the user.
2. Barcode check digits are validated, and candidate NDCs are confirmed against the directory.
3. Lot is compared with recall `code_info` text (user-confirmed comparison).

### J4 — Unknown labeler or incomplete identity
- Missing labeler, unreadable NDC or conflicting fields lead to explicit choices: correct the field, enter it manually, or proceed at ingredient/strength level with `INSUFFICIENT_DATA` labeling.
- A repackaged product is assessed on its own product NDC. When its source product NDC is known (Task 3), recalls naming the source product are shown as "might match".
- The app does not identify manufacturing facilities or infer where a product was made (out of scope for v0.1).

### J5 — Refill comparison
1. User scans a new fill of a saved medication.
2. App compares the new fill's confirmed identity with the previous fill: NDC, labeler, strength, dosage form, release mechanism.
3. Differences are shown neutrally (e.g., "Different labeler than your last fill: A → B"). Strength or form changes are highlighted with "check with your pharmacist".
4. Evidence is re-evaluated for the new product. No judgment that one labeler is better than another.

### J6 — Excluded or unsupported medication
- Excluded: show the exclusion message, the class rationale from the policy, and the policy version. No recall lookup is performed.
- Unsupported: show the scope message. No recall lookup is performed.

## 6. Patient-facing evidence and uncertainty explanations

Every result screen shows:
1. **What we identified** and how (scanned / confirmed by you / corrected by you).
2. **What we checked:** sources, dataset dates and retrieval time.
3. **Findings**, grouped:
   - "Recalls that match your product": product NDC, strength and form all match.
   - "Recalls that might match": same ingredient, strength and form but the product is unconfirmed, or the record text is incomplete.
   - "Recalls for other products with the same ingredient", collapsed by default.
4. **For matched recalls:** recall class (with a plain-language description of FDA's class definitions), status (ongoing, completed or terminated), dates, reason as published, recalling firm, and lot comparison if a lot was provided.
5. **What we could not determine**, e.g., lot or exact product.
6. **Standing disclaimer** (always shown):
   > "Not finding a recall does not mean a medication is safe or free of quality problems. FDA's
   > public data can be incomplete or delayed. Excluding some medications from this app does not mean
   > other medications are safe. Do not stop or change a medication without talking to your
   > pharmacist or doctor."
7. **Next step:** neutral guidance to contact the pharmacist or prescriber for any matched or possible recall. No dosing advice, no substitution recommendations.

Prohibited: any "safe", "clean", "verified", "green" or score/grade presentation; ranking labelers or
facilities; NTI "switching" warnings (Doc A A-11).

## 7. Result categories (evidence, not safety)

Renamed in Task 2 (former names in brackets). Rules: `docs/ARCHITECTURE.md` §5.3.

| Finding | Condition |
|---|---|
| `CONFIRMED_MATCH` [`MATCHED_RECALL`] | A recall record's own text names the confirmed product NDC, nothing in the text contradicts the product, and the recall's criteria apply: all lots, or the user's confirmed lot is listed. A product NDC match alone never confirms a lot-specific recall. |
| `POTENTIAL_MATCH` [`POSSIBLE_RECALL`] | Relevant evidence exists but applicability is uncertain: lot not provided or not found in the listing, product named only in structured fields, same ingredient/strength/form without product-level evidence, NDC list unreadable, or identity known only at ingredient level |
| `NO_MATCH_FOUND` [`NO_MATCHING_RECALL_FOUND`] | Every planned query completed (all pages), the positive control passed, every record was parsed and none applies. Always shown with sources, dates, coverage and limitations. |
| `UNRESOLVED` (new) | Evidence insufficient, incomplete or unavailable: a failed or incomplete query, failed control, or unreadable record, with no confirmed or potential match |
| plus `EXCLUDED`, `UNSUPPORTED`, `NEEDS_CLARIFICATION`, `INSUFFICIENT_DATA`, `SOURCE_UNAVAILABLE`, `RATE_LIMITED` | see §4 |

## 8. Success metrics (MVP study)

| Metric | Target |
|---|---|
| Scan-to-confirmed identity (pharmacy label with NDC) | ≥ 80% of attempts without manual typing; median ≤ 60 s |
| NDC cross-validation false acceptance (wrong NDC accepted) | 0 in the test corpus |
| Comprehension: participants correctly state that "no recall found" ≠ "safe" | ≥ 85% in usability sessions |
| Comprehension: distinguish excluded vs no data | ≥ 85% |
| Task completion for refill comparison | ≥ 80% |
| Willingness to use again / recommend (5-point scale) | Recorded as an interest signal; no target |
| Privacy: network requests carrying non-public data | 0 (automated audit) |
| Crash-free sessions in pilot | ≥ 99% (measured locally with user-exported diagnostics only; no telemetry) |

Interest and usability data is collected only through opt-in study sessions or questionnaires outside the app, not by in-app telemetry.

## 9. Acceptance criteria (MVP)

1. All 14 supported drugs can be identified from a real NDC to a product NDC and RxNorm clinical drug, preserving strength and form.
2. All 11 exclusion entries produce `EXCLUDED` (or `NEEDS_CLARIFICATION` for everolimus) before any recall lookup, with policy version shown.
3. A known recall fixture is never classified as `NO_MATCH_FOUND` under any injected failure (network, timeout, 5xx, 429, truncated JSON, schema change, misspelled field).
4. Every result screen shows sources, dataset dates, retrieval time and the standing disclaimer.
5. No network request includes images, OCR text, lot numbers, device or user identifiers (verified by an automated request audit).
6. All patient data can be deleted in-app; uninstall removes it; it is excluded from cloud backup.
7. The app works offline with cached evidence that is clearly labeled with its age.

## 10. Explicitly out of scope (v0.1)

- Any backend, account, sync, cloud backup of app data, or web version; iOS release.
- LLM/chatbot features; numerical safety, quality or manufacturer scores; labeler or facility rankings.
- **Manufacturer provenance** (removed in Task 2): manufacturing-facility identification, establishment mapping, inspection history, plant risk scoring and provenance inference.
- FDA inspection classifications, Form 483s, warning letters, import alerts, DUNS/FEI crosswalks (Doc A A-6, A-17, A-18).
- Pill-imprint identification and faceted pill picker (A-14); NTI switching warnings and "alternative product" suggestions (A-11).
- Drugs beyond the 14 listed; injectables, topicals, inhalers, compounded drugs, OTC products (excluded by policy, Task 3).
- Push notifications or background recall monitoring (requires decisions on battery and privacy; future extension).
- Dosing, interaction, adherence or substitution advice; pharmacy integrations; insurance data.
