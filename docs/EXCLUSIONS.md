# Exclusion Policy

| Field | Value |
|---|---|
| Policy version | `0.1.0-draft` |
| Status | **Proposed — pending owner approval (OD-2)** |
| Machine-readable policy | `data/exclusion_policy.json` |
| Source | Document B, `docs/references/Drugs Exclusion List.md` |
| Last reviewed | 2026-11-12 |
| Next review due | 2027-05-12 (six months) |

## 1. Purpose

Some medications are recognized by the app but **deliberately not assessed**, because a small error in
identification, dose or quality interpretation could have serious consequences and clinicians already
monitor them closely. Excluding them is a scope decision; it is **not** a finding about those
medications, and it does **not** imply that any other medication is safe. The app states this on
every result.

## 2. Class-based exclusions

Exclusions are set by drug class against a published criterion, not by drug-by-drug judgment
(Document B), so each entry can be checked against FDA labeling.

| Class | Criterion | Rationale (Document B) |
|---|---|---|
| `ANTICOAGULANT` | Anticoagulant class | A small error in dose or quality can cause serious bleeding or clotting. Warfarin and the newer anticoagulants carry boxed warnings for these risks, per FDA labels (**not yet checked against current versions** — must be verified before approval). |
| `TRANSPLANT_IMMUNOSUPPRESSANT` | Transplant immunosuppressant | Levels that drop too low risk organ rejection, and levels that run too high risk toxicity. Clinicians monitor these drugs with blood tests. |

## 3. Entries

Matching uses normalized RxNorm ingredient identifiers (RxCUIs retrieved from RxNav, RxNorm release
02-Nov-2026), not free-text names.

| Ingredient | RxCUI(s) | Class | Decision | Notes |
|---|---|---|---|---|
| Warfarin | 11289 | Anticoagulant | `EXCLUDED` | Also narrow therapeutic index; excluded under the anticoagulant rule |
| Apixaban | 1364430 | Anticoagulant | `EXCLUDED` | Part D 2023 rank 13; removed from MVP scope |
| Rivaroxaban | 1114195 | Anticoagulant | `EXCLUDED` | |
| Dabigatran | 1546356, 1037042 | Anticoagulant | `EXCLUDED` | 1037042 = dabigatran etexilate |
| Edoxaban | 1599538 | Anticoagulant | `EXCLUDED` | |
| Tacrolimus | 42316 | Transplant immunosuppressant | `EXCLUDED` | Non-oral (topical) products → administration rule (§5) |
| Cyclosporine | 3008 | Transplant immunosuppressant | `EXCLUDED` | Ophthalmic/topical products → §5 |
| Sirolimus | 35302 | Transplant immunosuppressant | `EXCLUDED` | Topical products → §5 |
| Everolimus (transplant) | 141704 | Transplant immunosuppressant | `NEEDS_CLARIFICATION` | Indication cannot be established from a label (§4) |
| Mycophenolate | 265323, 7145, 408142 | Transplant immunosuppressant | `EXCLUDED` | Mycophenolate (IN), mycophenolic acid (IN), mycophenolate sodium (PIN); mofetil mapping to verify in Task 2 |
| Azathioprine | 1256 | Transplant immunosuppressant | `EXCLUDED` | Flagged for review (§4) |

FDA Established Pharmacologic Class strings observed in openFDA (2026-11-12) are recorded in the
policy file as **class signals**, e.g. "Vitamin K Antagonist [EPC]", "Factor Xa Inhibitor [EPC]",
"Direct Thrombin Inhibitor [EPC]", "Calcineurin Inhibitor Immunosuppressant [EPC]",
"mTOR Inhibitor Immunosuppressant [EPC]", "Antimetabolite Immunosuppressant [EPC]".
Azathioprine's observed EPC is "Purine Antimetabolite [EPC]", so it is matched by ingredient only.

## 4. Drug-specific exceptions and ambiguity

- **Indication is never assumed.** If a decision depends on a clinical indication the app cannot establish, the result is `NEEDS_CLARIFICATION`.
- **Everolimus:** Document B scopes the exclusion to transplant use. Oral everolimus also has non-transplant indications. The app cannot tell which from a label, so the result is `NEEDS_CLARIFICATION`. Everolimus is outside MVP scope, so it is never assessed either way. The message explains that the app does not cover this medication.
- **Azathioprine and mycophenolate** are listed under "transplant immunosuppressant" but are also used for other conditions. They are excluded by ingredient as listed in Document B, which requires no indication. Flagged for the first six-month review: confirm whether the criterion should be ingredient-based or indication-based.
- **Unlisted ingredient with a matching class signal** (e.g., another oral anticoagulant): `NEEDS_CLARIFICATION` with reason `POLICY_CLASS_MATCH_UNLISTED`. The list is not extended automatically; any addition goes through review (§6).
- **Combination products** containing an excluded ingredient: `EXCLUDED` (any listed ingredient triggers exclusion).

## 5. Administration-based rule — OPEN DECISION (OD-1)

Document B: "injectable and hospital-administered anticoagulants and immunosuppressants … fall under
the administration rule once that rule is decided." **The rule has not been decided and is not
invented here.**

Interim behavior: non-oral products (injectables, topicals, ophthalmics) are outside MVP formulation
scope and resolve to `UNSUPPORTED` with reason `ADMINISTRATION_RULE_PENDING`. No recall lookup is
performed. When OD-1 is decided, the policy version increments and this section is replaced.

## 6. Versioning and review

- Semantic version in `policy_version`. Increment minor for list changes and patch for wording or metadata.
- Every change appends to `change_log` with date, version, change, source and approver.
- **Review every six months** (`next_review_due` ≤ `last_reviewed` + 6 months, enforced by `tests/unit/data_files.test.ts`): re-check each entry and rationale against current FDA labels and log the result even if nothing changes.
- An overdue review produces a build warning in Task 6 release checks. The app keeps applying the last approved policy; it never drops exclusions because a review is late.
- Each addition must pass the same published-criterion test as the original entries (Document B: "The list will grow under pressure").
- The app records the `policy_version` with every saved assessment.

## 7. Excluded vs. unsupported vs. no data

| State | When | Message intent |
|---|---|---|
| `EXCLUDED` | Recognized ingredient on this policy | "We don't assess this medication by design. This is not a judgment about it." Shows class and rationale. |
| `UNSUPPORTED` | Not one of the 14 MVP drugs, wrong formulation or route, combination not listed | "This version of the app doesn't cover this medication or form." |
| `NEEDS_CLARIFICATION` | Eligibility depends on unknown information | Explains what is unknown; offers to stop or correct identity |
| `INSUFFICIENT_DATA` | Supported drug, but product identity is too incomplete to assess | "We couldn't identify your exact product." |

Document B risk addressed: users may read "excluded" as "no data". The two states use different
titles, icons and copy, and are tested separately in usability sessions (PRD §8).

## 8. What the exclusion does not do

It does not say that any other medication is safe. Every result screen includes:

> "Excluding some medications from this app does not mean other medications are safe."
