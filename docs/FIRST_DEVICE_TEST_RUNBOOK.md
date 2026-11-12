# First Device Test Runbook — owner only

For the owner's first test of the **development** APK on their own Android phone. Do not give this
APK to anyone else: it accepts draft configuration, is signed with a development key, and has had no
legal, clinical or security review. Record every result in `docs/ANDROID_DEVICE_TEST_PLAN.md`.

**Use public test inputs only.** The NDCs below are real public product codes. Do not type your own
or anyone else's medication details, name or prescription number during this test.

## 0. Which APK

| Build | File name to save as | App name on phone | SHA-256 |
|---|---|---|---|
| Task 4A.1 (current, MedLuma working name) | `medluma-dev-0.1.0-task4a1.apk` | MedLuma (DEV) | `0718180fb5a107c0fb99bf6cc2ffde256c1b9a81a35b9380f44fe97bec2b3907` |
| Task 4A (preserved, earlier name) | `app-dev-release.apk` | Rx Recall Check (DEV) | `648e9c07b4598ea570d22cefd11c5b9ff983bc56392cfb16f6ad9748fa00de11` |

Both have the same application ID (`org.rxrecallcheck.app.dev`) and signing key, so installing one
replaces the other. Use the current build unless told otherwise.

## 1. Get the APK

**From Claude Code (cloud session).** The APK is attached to the session as a file card. In the
Claude app or claude.ai, open the card and download it to your computer (or directly to the phone if
you use the Claude app on Android). The cloud container is temporary; download it promptly.

**From GitHub.** APK files are **not** stored in the repository (build output is never committed).
To get it from GitHub, build it yourself from the branch:

```bash
git clone https://github.com/gravishankar/rx-quality-check.git
```

```bash
cd rx-quality-check && git checkout task-4a1/medluma-brand
```

Then follow `docs/ANDROID_BUILD_AND_INSTALL.md` ("Build the development APK"). A self-built APK is
signed with *your* development key, so its checksum differs from the one in this runbook, and it
cannot replace an APK signed with the cloud key (uninstall the old one first).

## 2. Verify the checksum

Compare with the SHA-256 in §0. They must match exactly.

macOS:

```bash
shasum -a 256 medluma-dev-0.1.0-task4a1.apk
```

Windows (PowerShell):

```bash
Get-FileHash .\medluma-dev-0.1.0-task4a1.apk -Algorithm SHA256
```

Linux:

```bash
sha256sum medluma-dev-0.1.0-task4a1.apk
```

If it does not match, do not install it.

## 3. Transfer to the phone

Choose one:
- **USB with adb (recommended):** install Android platform-tools on the computer; on the phone,
  Settings → About phone → tap *Build number* 7 times → Settings → System → Developer options →
  turn on *USB debugging*. Connect by USB and allow the computer.
- **USB file transfer:** connect the phone, choose *File transfer*, copy the APK into *Download*.
- **Directly on the phone:** download the file card from the Claude app on the phone.

## 4. Install

With adb:

```bash
adb install -r medluma-dev-0.1.0-task4a1.apk
```

If adb reports `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (an APK signed with a different key is
installed), remove the old app first:

```bash
adb uninstall org.rxrecallcheck.app.dev
```

Without a computer: open *Files* → *Download* → tap the APK → allow *Install unknown apps* for that
app when asked → *Install*. Google Play Protect may warn about an unknown developer: this is expected
for an unpublished development build; choose to install anyway only because you verified the
checksum. Turn *Install unknown apps* back off afterwards.

## 5. Launch

Open **MedLuma (DEV)** from the app drawer. Expected:
- a purple banner on every screen: "DEVELOPMENT BUILD — evaluation prototype for owner testing only.
  Not clinically validated. Saved history is turned off.";
- the first-launch notice ("Before you start") with links to Terms, Privacy and Medical Disclaimer,
  each marked as a draft. Open each link once, go back, then tap *I understand*.
  (The notice reappears on every launch in this build because nothing is saved — OD-22.)

No computer or Metro server is needed. The app needs internet for lookups.

## 6. Test checklist

Tick each line; note anything unexpected (screenshots are fine — they will only show public test
data). Stop and report if the app crashes.

| # | Step | Input | Expected |
|---|---|---|---|
| T1 | Manual entry | NDC `62756-142-02`, name `METFORMIN HCL ER`, strength `500 MG`, form `TABLET`, lot `JKU4639A` → *Find this medication* | Progress text, then *Is this your medication?* |
| T2 | Confirm identity | Read each field: product/NDC, ingredient, form, labeler should say *From FDA records*; lot says *Entered and confirmed by you*. Try the confirm button before switching every item on | Button stays disabled until each item is switched on (and the release question answered, if shown) |
| T3 | Live recall lookup | Switch on every item including the lot → confirm | *Searching FDA recall records…*, then the result |
| T4 | Evidence and limitations | Read the result | Headline "Available recall information matches the medication details you provided."; tone label *Recall information found*; next steps (pharmacist, official record, "Do not stop, change or replace…"); *What we checked* with retrieval time and FDA data date; *What we could not determine*; recall **D-0325-2021** under *Recalls that match your product*; tap *Official FDA record* → opens api.fda.gov in the browser |
| T5 | Unknown lot | Same as T1 without a lot | "This medication may be affected by a reported recall…", lot qualifier |
| T6 | No match shown honestly | NDC `82009-018-10`, `ROSUVASTATIN CALCIUM`, `10 MG`, `TABLET` | Either "No matching recall was identified in the sources successfully checked as of … This does not establish…", or a newer FDA result. Never "safe" or green |
| T7 | NDC not in FDA's directory | NDC `00000-0000-00`, `METFORMIN`, `500 MG`, `TABLET` | The NDC is set aside, not trusted: on *Is this your medication?* the Product (NDC) says *Could not be determined* and the other fields say *Entered by you, not checked against FDA records*. If you continue, any result carries "The medication details were entered by you and were not matched to an FDA product listing." (There is no explicit "NDC not found" message yet — OD-23.) |
| T8 | Missing fields | Only a drug name | "Please enter the drug name, strength and form." |
| T9 | Excluded drug | NDC `67046-2072-3`, `WARFARIN SODIUM`, `1 MG`, `TABLET` | "We don't check this medication… No recall check was done." Policy rule `EXCL-WARFARIN` shown |
| T10 | Network failure | Turn on airplane mode, repeat T1 | "We couldn't reach FDA's data. Nothing was checked." with *Try again*. Never a no-match. Turn airplane mode off and *Try again* |
| T11 | Encryption self-test | *About and privacy* → *Run encryption self-test* | Four lines all **PASS**: SQLCipher compiled in (shows a cipher version), read back with the right key, unreadable with a different key, test database deleted. Record the exact text |
| T12 | Delete all data | *About and privacy* → *Delete all data on this phone* → *Delete* | Confirmation, then the first-launch notice returns |
| T13 | Accessibility (optional) | Settings → Accessibility → largest font; TalkBack on for T1–T4 | Text not cut off; fields read with their labels and source |
| T14 | Uninstall | `adb uninstall org.rxrecallcheck.app.dev` or long-press → Uninstall | App and its data removed |

## 7. Diagnostics without personal data

Collect only these, and only from a session that used the public test inputs above:

1. Phone model and Android version: Settings → About phone.
2. App version and build: *About and privacy* screen (screenshot), or:

```bash
adb shell dumpsys package org.rxrecallcheck.app.dev | grep -E "versionName|versionCode|lastUpdateTime"
```

3. Crash information only (no app content is logged by design):

```bash
adb logcat -b crash -d > medluma-crash.txt
```

4. The encryption self-test lines (T11), copied by hand or as a screenshot.
5. Which checklist step failed and what the screen said.

Do **not** send: full `adb logcat` without the `-b crash` filter (it can contain other apps' data),
bug reports (`adb bugreport` contains personal device data), screenshots showing real medications,
or the APK's data directory.

## 8. After the test

- Fill in the results table in `docs/ANDROID_DEVICE_TEST_PLAN.md` (device, Android version, APK
  SHA-256, date, pass/fail per item).
- If T11 passes, PV-4 still also needs the file-level check (D-21) before
  `encryption_verified_on_device` may be set; that is a security sign-off decision, not automatic.
- Uninstall the development build when finished.
