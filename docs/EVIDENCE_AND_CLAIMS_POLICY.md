# Evidence and Claims Policy — Rx Recall Check

Status: engineering policy, Task 4A (2026-11-12). Wording requires pharmacist/clinical review and
legal review before any pilot (`docs/RELEASE_READINESS_CHECKLIST.md`).

**Rule zero.** The app never presents an assertion, conclusion, reassurance or recommendation that
is stronger than the verified underlying evidence. A disclaimer never justifies unsafe behavior: if
the evidence does not support a statement, the statement is not shown, whatever disclaimer follows.

Implementation: internal classifications (`mobile/src/rules/recallEvidence.ts`) are unchanged.
Everything a patient reads passes through one presentation layer
(`mobile/src/presentation/present.ts`) and one copy file (`mobile/src/copy/en.ts`). The
presentation layer may only **weaken** a classification.

## 1. Evidence levels

Every identity field shown to the user carries one of these labels (`EvidenceLevel`):

| Level | Shown as | Meaning |
|---|---|---|
| `VERIFIED_SOURCE` | "From FDA records" | Read from an FDA record (NDC Directory) for the NDC the user entered. Means "FDA's listing says this", not "FDA verified your medication". |
| `USER_CONFIRMED` | "Entered and confirmed by you" | Typed by the user and explicitly confirmed (e.g. lot). Never presented as FDA-verified. |
| `SCANNED` (Task 4C) | "Read from your label, not checked against FDA records" | Read by the camera (OCR or barcode) and not (yet) matched to an FDA record or confirmed by the user. Never presented as typed, confirmed or verified. |
| `USER_ENTERED` | "Entered by you, not checked against FDA records" | Typed, not matched to a listing (name-only entry). |
| `INFERRED` | "Matched by name only" | Derived from names, e.g. catalog match without an RxCUI. |
| `CONFLICTING` | "FDA records disagree" | The FDA record is internally inconsistent; the app does not choose a side. |
| `UNVERIFIED` | "Not checked" | Not checked in this version (e.g. repackager source when the product is not a repackager is `NOT_APPLICABLE` and is not shown). |
| `UNAVAILABLE` | "Could not be determined" | A lookup failed or the value is unknown. |

Conflicts are preserved: a conflicting field stays `CONFLICTING` and leads to `NEEDS_CLARIFICATION`
or an unresolved/possible result, never to a chosen value.

## 2. Claim-to-evidence matrix

| # | Claim area | What the app may say | Evidence required | What it must never say | Enforced by |
|---|---|---|---|---|---|
| C1 | Product identity | "Product (NDC) … From FDA records. A listing is not FDA approval of this product." | NDC Directory record for the entered NDC, cross-validated with printed name/strength/form, then confirmed by the user item by item | "FDA verified your medication"; "approved product" | `identityFields`; Confirm screen; `claims_and_copy`: *directory-confirmed identity*, *prohibited wording* |
| C2 | Ingredient, strength, dose form | Values with their evidence level | Directory record, or user entry labeled as such | A user-typed value labeled as FDA-sourced | *name-only identity: every field is user-entered* |
| C3 | Release mechanism (IR/ER/DR) | "Regular / Extended / Delayed release" | Directory dosage-form text, or the user's explicit answer | Assumed release | `requiredConfirmations` adds `release` when unknown; Confirm screen question |
| C4 | NDC | The NDC and that it is listed | Directory listing | Listing = approval | `COPY.fields.ndcListingNote`; test asserts "not FDA approval" |
| C5 | Labeler / manufacturer terminology | "Labeler (as listed by FDA)… may not be the company that made the medication"; recall firm "Recalling firm (as published)" | The listing / the recall record text | "Manufacturer: X", "made by", plant or facility names | *misleading manufacturer attribution* test |
| C6 | Repackaging | "Repackaged from …" only when declared in the repackager's SPL **and** found in the NDC Directory; otherwise "We could not confirm which product this was repackaged from" + qualifier | SPL `asEquivalentEntity` + NDC Directory | A source inferred from names or labelers | Task 3 enrichment tests; *unknown repackager source (OD-17)* |
| C7 | Recall applicability — confirmed | "Available recall information matches the medication details you provided." | `CONFIRMED_MATCH` **and** product-level identity **and** user-confirmed lot listed (or all-lots recall) | "Your medication is recalled" without these; any treatment instruction | `confirmedIsSupported`; *confirmed without the evidence … is downgraded* |
| C8 | Recall applicability — potential | "This medication may be affected by a reported recall. More information is needed…" | Any record that might apply | Dismissing a possible record | engine tests; *unknown lot* |
| C9 | Lot | "Your lot number appears in this recall's list" / "was not found in the listed lots. That does not mean your supply is unaffected." | User-confirmed lot compared with free text | "Your lot is not affected"; lot presented as FDA-verified | Copy; *directory-confirmed identity: lot is user-confirmed* |
| C10 | Completeness | "x of n searches completed fully"; "Search check passed / did not pass" | Coverage record from the engine | "100% coverage", "all recalls" | `noMatchIsSupported`; *false reassurance blocked* tests |
| C11 | Freshness | "Retrieved on this phone: …"; "FDA recall data last updated: …"; "not updated automatically" | Device retrieval time, openFDA `meta.last_updated` | A no-match older than 24 h or on FDA data older than 45 days | `FRESHNESS`; *stale result*, *stale source data* |
| C12 | Recall status and classification | Status and class **as published by FDA**, with the 21 CFR 7.3(m) plain-language explanation; "Terminated means FDA considers the recall completed; it does not describe your supply." | Recall record | Interpreting status for the patient's supply | `COPY.result.record` |
| C13 | Exclusions | "We don't check this medication. This is a policy choice, not a finding about the medication. No recall check was done." + "Not checking some medications does not mean other medications are safe." | Policy rule (ID and version shown) | Any wording that the medication passed, cleared or was checked | *excluded / unsupported / … never presented as passing* |
| C14 | Unsupported / clarification / invalid config | "not covered by this version" / "need more information" / "Recall checks are turned off in this build" — each says no check was done | Decision from the evaluator | A no-match | same; *invalid configuration is shown as "recall checks are turned off"* |
| C15 | No match | "No matching recall was identified in the sources successfully checked as of <date>. This does not establish that the medication is free from recalls or other quality problems." | Complete coverage, control PASSED, all queries COMPLETE, no potential/confirmed/unresolved record, fresh result and dataset; plus qualifiers for user-entered identity, unknown source, missing lot | "No recalls exist", "recall-free", "safe", "no issues", "all clear" | `noMatchIsSupported`; 2,000-case property test |
| C16 | Unable | "We could not reliably determine whether this medication is affected by a recall." + reason | Any failure, incompleteness, staleness or inconsistency | A no-match | *network failure / incomplete pagination…*, *missing FDA records* |
| C17 | Next steps | Confirmed/potential: contact pharmacist or healthcare professional; read the official recall record. Always: "Do not stop, change or replace a prescribed medication because of this app alone." | — | "Stop taking", "You can continue taking", "Switch to another medication" | *every result keeps … "do not change medication"*; prohibited list |
| C18 | The app itself | "Evaluation prototype. Not clinically validated."; "Neither FDA nor NLM endorses this app." | — | "FDA approved this app", "clinically validated", "guaranteed accurate", "HIPAA compliant", "legally compliant" | prohibited list; legal-document lint |

## 3. Presentation categories and downgrades

| Engine finding | Shown as | Only if | Otherwise shown as |
|---|---|---|---|
| `CONFIRMED_MATCH` | CONFIRMED (tone ALERT) | C7 evidence | POTENTIAL, flagged for investigation |
| `POTENTIAL_MATCH` | POTENTIAL (tone CAUTION) | — | — |
| `NO_MATCH_FOUND` | NO_MATCH (tone NEUTRAL) | C15 evidence | UNABLE (flagged when inconsistent; not flagged when merely stale) |
| `UNRESOLVED` | UNABLE (tone NEUTRAL) | — | — |

Each category has its own label on the result (Task 4A.2): "Recall match found", "Possible recall
match", "No match in the records checked", "Could not determine" (`COPY.result.categoryLabel`).

Downgrades never go toward reassurance. There is no "success" tone, no green, no check mark and no
celebratory icon anywhere in the app (`mobile/app/ui/kit.tsx`). Each tone is also stated in words.

## 4. Prohibited claims

Never shown anywhere (copy, screens, legal drafts), enforced by `tests/unit/claims_and_copy.test.ts`:

"Your medication is safe." · "No recalls exist." · "This medication is recall-free." · "FDA verified
your medication." · "FDA approved this app." · "Manufacturer verified." · "Guaranteed accurate." ·
"100% recall coverage." · "You can continue taking this medication." · "Stop taking this
medication." · "Switch to another medication." · plus "all clear", "no issues", "clean result",
"good news", check-mark and celebration glyphs.

The word "safe" may appear only in the two reviewed negated sentences
(`REVIEWED_NEGATED_STATEMENTS`): "Not finding a recall does not mean a medication is safe…" and "Not
checking some medications does not mean other medications are safe."

No individualized treatment advice is given. For confirmed and potential results the app directs the
user to their pharmacist or healthcare professional and to the official FDA record.

## 5. Disclosures and where they appear

| Disclosure | Where |
|---|---|
| What the app does / does not do, public data, consult HCP, links to Terms/Privacy/Medical Disclaimer; versions recorded locally | First-launch notice |
| Verified vs user-entered for each field | Confirm screen, Result screen ("The medication we checked") |
| Sources, retrieval date, dataset date, searches completed, control check, not auto-refreshed, per-medication only | Result screen, directly under the headline and next steps |
| Limitations and standing disclaimer | Result screen, same screen as the headline |
| Legal documents, data sources, privacy, version, delete all | About and privacy (reachable from Entry, Result and Not-assessed screens) |
| Evaluation prototype / development build label | Banner on every screen |

## 6. Test matrix (claim → evidence → tests)

| Claim | Tests (file → test name, abbreviated) |
|---|---|
| C1, C2, C4 | `claims_and_copy` → *directory-confirmed identity…*, *name-only identity…* ; `app_screens` → *confirmation: each item must be ticked* |
| C5 | `claims_and_copy` → *misleading manufacturer attribution* |
| C6 | `claims_and_copy` → *unknown repackager source (OD-17)*; Task 3 `workflow`/`e2e` repackaged-product scenario |
| C7 | `claims_and_copy` → *confirmed: only with…*, *confirmed without the evidence … downgraded* |
| C8, C9 | `claims_and_copy` → *unknown lot*; engine lot tests (Task 2) |
| C10, C15 | `claims_and_copy` → *no match: only with…*, *false reassurance blocked* (×2), *property: across 2,000 random mutations* |
| C11 | `claims_and_copy` → *stale result*, *stale source data* |
| C13, C14 | `claims_and_copy` → *excluded / unsupported…*; `app_screens` → *invalid configuration…*, per-scenario screen models; OD-19 no-enrichment assertions |
| C16 | `claims_and_copy` → *network failure / incomplete pagination*, *missing FDA records*; `app_screens` network-failure scenario |
| C17, C18 | `claims_and_copy` → *prohibited wording* (copy, screens, presented results, legal documents), *every result keeps sources…*, *no success tone exists* |
| User-entered vs verified | `claims_and_copy` → *user-entered identity: a no-match is qualified* |
| Conflicting FDA records | `claims_and_copy` → *conflicting FDA records are shown as a conflict* |
| Unapproved configuration | `app_screens` → *invalid configuration…*; `claims_and_copy` → *build profiles*, *release gate* |
| Terms/policy versions | `claims_and_copy` → *consent: acknowledgement records versions*, *legal documents: bundled text is identical* |
| No unauthorized transmission | Task 3 privacy audit (`e2e_scenarios`); `app_screens` → lot never transmitted |
| Secure local deletion | Task 3 `storage` delete-all tests; `encryption_self_test` (logic only) |

Tests prove that the code enforces these rules. They are not clinical or legal validation.
