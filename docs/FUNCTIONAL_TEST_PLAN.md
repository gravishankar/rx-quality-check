# Functional Test Plan — development build 0.1.2 (build 3)

Purpose: check, on a real Android phone, that the app does what it should, and that its wording never
goes beyond the evidence. Install first: `docs/INSTALL_ON_ANDROID.md`.

**Status on a physical device: NOT RUN.** No phone or emulator is available in the build environment.
The "Automated" column shows what has been exercised automatically on the real screens
(`mobile/__tests__/flows.test.tsx`, recorded real FDA/NLM responses) or on the shared logic
(`npm test`). Automated tests do not replace the device test.

## Test data (public, non-personal)

Use only these. They are public product codes from FDA's NDC Directory; results come from FDA's live
data, so a later FDA update can change an expected result — note it and continue.

| ID | Medication (type exactly) | NDC | Strength | Form | Lot | Why |
|---|---|---|---|---|---|---|
| D1 | METFORMIN HCL ER | 62756-142-02 | 500 MG | TABLET | JKU4639A | Product with a known recall (D-0325-2021) whose lot list contains JKU4639A |
| D2 | METFORMIN HCL ER | 62756-142-02 | 500 MG | TABLET | *(blank)* | Same product, no lot → possible match |
| D3 | METFORMIN HCL ER | 62756-142-02 | 500 MG | TABLET | ZZZ0000 | Lot not in the recall list |
| D4 | ROSUVASTATIN CALCIUM | 82009-018-10 | 10 MG | TABLET | | No applicable recall in the data recorded 2026-11-12 |
| D5 | WARFARIN SODIUM | 67046-2072-3 | 1 MG | TABLET | | Excluded by policy (blood thinner) |
| D6 | METOPROLOL TARTRATE | *(blank)* | 25 MG | TABLET | | Not covered by this version |
| D7 | METFORMIN | 00000-0000-00 | 500 MG | TABLET | | NDC that does not exist |
| D8 | FUROSEMIDE | 68094-756-62 | 10 MG/ML | ORAL SOLUTION | | Repackaged product (source may not be established) |

Never type your own medication, your name or a prescription number.

## How to tell the four results apart

Every result has a label at the top of the result box, a headline, and next steps:

| Label | Headline starts with | Means | Never means |
|---|---|---|---|
| **Recall match found** | "Available recall information matches the medication details you provided." | A recall record names this product and its conditions (e.g. your lot) appear to apply | That FDA verified your supply |
| **Possible recall match** | "This medication may be affected by a reported recall…" | A recall might apply; something (often the lot) is unknown | That it does not apply |
| **No match in the records checked** | "No matching recall was identified in the sources successfully checked as of <date>. This does not establish…" | Every search completed and nothing matched *in those records* | That the medication is safe or recall-free |
| **Could not determine** | "We could not reliably determine whether this medication is affected by a recall." | Something failed, was incomplete, too old or inconsistent | A no-match |

No result is ever shown in green or with a check mark.

## Tests

Result column: write PASS / FAIL / NOTE for the device run.

| # | Area | Steps | Expected | Automated | Device |
|---|---|---|---|---|---|
| F-01 | Install & launch | Install build 3, open | "MedLuma (DEV)"; purple DEVELOPMENT BUILD / evaluation prototype banner; "Before you start" | UI: first launch | |
| F-02 | Legal documents | On "Before you start", open Terms, Privacy, Medical Disclaimer; Back | Each opens, marked draft; Back returns | UI: first launch | |
| F-03 | Version | About and privacy | "version 0.1.2 (build 3)" | Unit: version | |
| F-04 | Manual entry & identification | Enter D1, *Find this medication* | Spinner "Looking up your medication…", then *Is this your medication?* | UI: confirmed recall | |
| F-05 | Evidence labels | On the confirmation screen | Product, ingredient, form, release, labeler: *From FDA records*; NDC note "A listing is not FDA approval…"; labeler note; lot: *Entered by you…* with "Turn on the lot number item below…" | UI: confirmed recall | |
| F-06 | Confirmation required | Press *Yes, these details match my label* before switching every item on | Button stays disabled until every required item is on | UI: confirmed recall | |
| F-07 | Confirmed recall incl. lot | Switch all items on (including the lot), confirm | Spinner "Searching FDA recall records…"; label **Recall match found**; D-0325-2021 under *Recalls that match your product*; "Your lot number appears in this recall's list of lots."; next steps incl. pharmacist and "Do not stop, change or replace…" | UI: confirmed recall | |
| F-08 | Source attribution & time | On the F-07 result | *What we checked*: "Retrieved on this phone: <time>", "FDA recall data last updated: <date>", searches completed, search check passed, "not updated automatically", "this medication only" | UI: confirmed recall | |
| F-09 | Official record | Tap *Official FDA record* under D-0325-2021 | Browser opens api.fda.gov showing that recall | UI: confirmed recall | |
| F-10 | Possible match (no lot) | D2 (do not enter a lot) | **Possible recall match**; "You did not enter a lot number" qualifier | UI: possible recall | |
| F-11 | Lot not listed | D3, switch on the lot item | Not *Recall match found*; record text "Your lot number was not found in the listed lots. That does not mean your supply is unaffected." | Engine tests | |
| F-12 | No match | D4 | **No match in the records checked** with date and "This does not establish…"; *Other recall records we checked* listed; no "safe" anywhere | UI: no match found | |
| F-13 | Excluded | D5 | "We don't check this medication… No recall check was done."; rule EXCL-WARFARIN; "Not checking some medications does not mean other medications are safe." | UI: excluded | |
| F-14 | Unsupported | D6 | "This medication or form is not covered by this version of the app. No recall check was done." | UI: unsupported | |
| F-15 | Unknown NDC | D7 | Box **NDC not found**: "We could not find this NDC in FDA's directory…"; fields *Entered by you, not checked against FDA records*; release question shown | UI: unknown NDC | |
| F-16 | Missing fields | Only a name, *Find this medication* | "Please enter the drug name, strength and form."; typed name still there | UI: missing fields | |
| F-17 | Network failure | D4 up to the confirmation screen; turn on airplane mode; confirm | Spinner while it retries (up to ~10 s), then "We couldn't reach FDA's data. Nothing was checked." with *Try again*; never a no-match | UI: network failure | |
| F-18 | Recovery | Turn airplane mode off; *Try again* | A normal result | UI: network failure | |
| F-19 | Repackaged product | D8 | Either a result with the qualifier about the original product not being confirmed, or a result naming the verified source; never an unqualified no-match if the source is unknown | Engine/e2e tests | |
| F-20 | Back button | From any result press Android Back | Returns to the entry screen with typed values (does not close the app) | UI: Android Back | |
| F-21 | Change details | On confirmation, *Change details* | Entry screen with typed values kept | UI: change details | |
| F-22 | Encryption self-test | About and privacy → *Run encryption self-test* | Four lines, each PASS: SQLCipher compiled in (shows a version), read back with the right key, unreadable with a different key, test database deleted. **Copy the exact text into the results** | Logic: unit (fakes); UI: display | |
| F-23 | Delete all data | About → *Delete all data on this phone* → *Delete* | Notice "Before you start" shows again; after *I understand*, entry fields are empty | UI: delete all | |
| F-24 | History off | *Saved checks* | "Saving is turned off in this build because storage encryption has not been verified on a device." | UI: history | |
| F-25 | No personal data leaves | (optional, needs adb) `adb logcat -b crash -d` after the tests | Empty or crash lines only; no medication text | — | |
| F-26 | Large text | Settings → Display → Font size: largest; repeat F-04…F-07 | No text cut off; all buttons reachable by scrolling | — | |
| F-27 | TalkBack | Turn on TalkBack; repeat F-04…F-07 | Each field read with its name and source; result label read as a heading; progress announced | — | |
| F-28 | Dark mode | Turn on dark theme | Text readable (the app uses a light theme) | — | |
| F-29 | Rotation | Rotate during F-07 | No crash; result still shown | — | |
| F-30 | Uninstall | Uninstall the app | App and data removed | — | |

## Recording results

Copy this table into `docs/ANDROID_DEVICE_TEST_PLAN.md` → Results, with: phone model, Android
version, APK file name and SHA-256, date, and PASS/FAIL/NOTE per test. Report failures as described
in `docs/INSTALL_ON_ANDROID.md` ("Report it without personal data").
