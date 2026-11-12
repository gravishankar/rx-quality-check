# Application Behavior Review — Task 4A.2 (2026-11-12)

Method: the real React Native screens were rendered and driven through complete workflows with
`react-test-renderer` (`mobile/__tests__/flows.test.tsx`, 15 tests), using recorded real responses
from openFDA, RxNav and DailyMed; plus a review of each screen against
`docs/EVIDENCE_AND_CLAIMS_POLICY.md`. **No physical device was used** — layout, touch, fonts,
TalkBack and real network behavior still need the device test (`docs/FUNCTIONAL_TEST_PLAN.md`).

## Can a user tell the four outcomes apart?

Before: the box around the headline was labeled by *tone*, so "No match" and "Could not determine"
both showed the same word ("Result"), and users had to read the whole headline to tell them apart.

After (fixed): each outcome has its own label at the top of the result box, read by screen readers as
a heading, and its own headline:

| Outcome | Label | Tone (color is never the only signal) |
|---|---|---|
| Confirmed | Recall match found | dark red border |
| Possible | Possible recall match | dark amber border |
| No match | No match in the records checked | gray border |
| Unable | Could not determine | gray border |

The no-match headline always says "…in the sources successfully checked as of <date>. This does not
establish that the medication is free from recalls or other quality problems." No outcome uses green,
a check mark, or the word "safe" (tests: copy lint, UI flows, category-label tests).

## Defects found and fixed (each with a regression test)

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | High (looks frozen) | During lookups (seconds; longer with automatic retries) the app stayed on the previous screen with a disabled button and no feedback | Progress screen with spinner and text ("Looking up your medication…", "Searching FDA recall records… This can take up to a minute."), announced to screen readers | UI: network failure |
| 2 | Medium (data loss) | Typed values were lost after a problem screen or *Change details* (introduced while fixing #1, caught by the tests) | Entry values kept by the root screen | UI: missing fields, change details, Android Back |
| 3 | Medium (confusing) | A typed lot showed as "Lot number: Not entered" on the confirmation screen | Shows the typed lot as *Entered by you* with "Turn on the lot number item below to use it in the check." — still not "confirmed" until switched on | Unit: screen models; UI: confirmed recall |
| 4 | Medium (confusing, OD-23) | An NDC not in FDA's directory was silently set aside; the screen only said "Not identified" | Box **NDC not found**: "We could not find this NDC in FDA's directory. The details below are what you typed. They were not checked against FDA records." | Unit + UI: unknown NDC |
| 5 | Medium (distinguishability) | "No match" and "Could not determine" shared one label | Per-category labels (above) | UI + unit |
| 6 | Medium (navigation) | Android Back closed the app from any screen | Back returns to the entry screen (keeps typed values); from the entry screen Back leaves the app as usual | UI: Android Back |
| 7 | Low (privacy) | *Delete all data* left typed values in the entry form and left the user on About | Clears typed values and returns to the start | UI: delete all |
| 8 | High (packaging) | The size-optimized universal APK briefly contained React Native's 32-bit x86 libraries without the encrypted-database library; an x86 device would have installed an app that cannot start | Explicit CPU filter; x86 excluded (as in builds 1–2) | Architecture test |
| 9 | Low | Builds 1 and 2 had the same version and build number | `config/app_version.json`; build 3 is 0.1.2 (versionCode 3), shown in About | Unit: version |

No change was made to the recall engine, safety gates, evidence classification, presentation
downgrade rules, drug data or exclusion policy.

## Remaining issues and simplification opportunities (not changed)

| # | Observation | Suggestion | Needs |
|---|---|---|---|
| R-1 | The first-launch notice appears at every launch in development builds (nothing is saved) | Acceptable for testing; persist acknowledgements once encryption is verified (Task 4B) | OD-22 |
| R-2 | The result screen is long: headline, next steps, sources, limitations, medication details, then records | Consider collapsing "Other recall records we checked" and the medication details by default (OD-8) | Product decision; wording review |
| R-3 | Confirmation asks for several separate switches (identity, lot, release) | Keep separate (deliberate safety step); could group visually | Pharmacist/usability review |
| R-4 | Release-type question uses abbreviations (ER, XR, XL, SR, DR, EC) | Add a short example of where they appear on the label | Wording review |
| R-5 | "Check again" keeps the previous entry in the form | Fine for re-checks; offer a "Clear" button if testers find it confusing | Device feedback |
| R-6 | The app uses a light theme only | Add dark-theme colors after device review | Task 4B |
| R-7 | Recents/app-switcher shows the last screen | Decide on hiding it (OD-21) | Product decision |
| R-8 | No explicit "lot not listed" explanation in the headline area when a lot was entered but not found | Covered in the record text; could be a qualifier | Wording review |
| R-9 | R8 code shrinking would reduce size further (~5 MB of code) but could break native modules at run time | Try only with a device to verify | Device test |

## Wording guardrails checked on every screen in the UI tests

No "safe", "recall-free", "no recalls exist", "guaranteed", "FDA-verified", "all clear", "no issues",
"you can continue taking", "stop taking this". The reviewed negated disclaimer ("Not finding a recall
does not mean a medication is safe…") is the only place the word "safe" appears.
