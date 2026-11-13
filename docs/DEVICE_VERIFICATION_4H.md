# Device verification — Task 4H build 10 (controlled, synthetic data only)

**Status: device checks NOT RUN.** No Android device is reachable from the cloud environment that
prepared this build (no device or computer is connected to it, and it cannot run an emulator). Every
device check below is **UNTESTED** until someone runs it on the Pixel and fills in the observed result
and evidence. Only the static APK checks in §3 were run.

## 1. Build under test

| | |
|---|---|
| App | MedLuma (DEV), package `org.rxrecallcheck.app.dev`, version 0.1.9, build 10 |
| Source | branch `task-4h/correctness-findings`, commit `94c0eacdad3e51b7aec765063c77fc6e0677303f` (reviewed head `0405eb6` + build-number record). Local only, not pushed or merged |
| Profile | development: persistence (saved history) **off**, catalog unchanged (no activation), draft configuration allowed, DEV banner |
| Variant | `devRelease`: release-mode, **not debuggable**, signed with the development key (same key as build 9, so it installs over build 9) |
| APK files | see §3 (file names, sizes, SHA-256) |
| Use | the team's own test device only; not for distribution |

Record for every session: device model, Android version and security patch level (Settings → About
phone), camera app name and version, date, tester.

## 2. Test data

Synthetic only: `scan-test-labels-SYNTHETIC.pdf` (pages S1–S7) and typed test records (TEST_ON_COMPUTER.md
§4). No real patient labels, names or medication lists. Isolated databases: the encryption self-test uses
its own test database (`SELF_TEST_DB`), never the app's database; normal medication persistence stays off.

## 3. Static checks on the APK (run in the build environment)

Filled in from `aapt2` and `apksigner` on the built files (results in §6).

## 4. Inspection access — a decision is needed before some checks can be done

This build is **not debuggable**, so the app's private storage (`/data/data/org.rxrecallcheck.app.dev/`:
the photo cache `cache/scans/` and database files) cannot be listed or read on a normal, unrooted Pixel
(`adb shell run-as` is refused). Checks V1–V4 (photo files) and V6b (database file on disk) therefore
cannot be verified *independently* with build 10; only the app's own report is observable.

Options (decision for the team; not implemented):
- **A. Debuggable verification variant** of the development flavor (`run-as` allowed). Lets the tester
  list the photo cache and copy the self-test database file. The development build holds no patient data
  (persistence off). Pilot builds stay non-debuggable (release gate).
- **B. Development-only diagnostics in the app**: show the number of files in the photo cache, and keep
  the self-test database until a button deletes it, so its first bytes can be shown. No adb needed;
  adds code to the reviewed build.
- **C. Rooted test phone** (not the team's everyday Pixel).

Recommendation: A, as a separate build 11 used only for verification.

## 5. Checks

Tools: the Pixel, a Mac with Android platform-tools (`adb`) and a USB cable, USB debugging on. Commands
use `PKG=org.rxrecallcheck.app.dev`. Keep every screenshot and command output as evidence, named by check ID.

| ID | Check | Procedure | Expected | Access | Observed | Evidence | Status |
|---|---|---|---|---|---|---|---|
| V0 | Build identity | Install the ARM64 APK (`adb install -r <apk>`). About screen: version and build. `adb shell dumpsys package $PKG \| grep -E "versionName\|versionCode\|flags="` | 0.1.9, build 10; flags without DEBUGGABLE and without ALLOW_BACKUP | adb | | | UNTESTED |
| V1 | Photo cleanup after a successful scan | Scan page S6. `adb shell run-as $PKG ls -la cache/scans` | Directory empty; no cleanup warning on screen | **needs option A** (else: only "no warning shown" is observable) | | | UNTESTED |
| V2 | …after cancel | Scan, then back out of the camera without taking a photo. Same listing | Empty; "No photo was taken." and no cleanup warning | needs A | | | UNTESTED |
| V3 | …after errors | (a) scan a blank page (nothing readable); (b) disable the camera app (Settings → Apps → Camera → Disable) and tap Scan → "No camera app"; re-enable after | Empty after each; app shows the problem, never a result | needs A | | | UNTESTED |
| V4 | …after process termination and restart | Tap Scan, take the photo, and **before accepting** run `adb shell am kill $PKG` (or swipe the app away). Then list `cache/scans` (a leftover may exist), start the app, tap Scan, list again | After restart the leftover is removed at the next scan start; if it cannot be removed, the warning "Label photo still on this phone" appears on every screen | needs A | | | UNTESTED |
| V5 | External camera behavior | Scan with the default camera (Pixel Camera). Afterwards open Google Photos and Files → Images → Camera | No label photo in Photos/DCIM. Record the camera app and version; repeat with any other installed camera app | device only | | | UNTESTED |
| V6a | SQLCipher present; right key reads | About → Encryption self-test (development builds) | Steps "SQLCipher compiled in" (cipher version shown), "Read back with the right key", "Test database deleted" all pass | device only | | | UNTESTED |
| V6b | Database file encrypted on disk | During the self-test, copy the test database file and read its first 16 bytes | Not `SQLite format 3` | needs A or B | | | UNTESTED |
| V7 | Wrong-key rejection | Same self-test, step "Unreadable with a different key" | Pass (refused or no data) | device only | | | UNTESTED |
| V8 | Deletion and key-reset recovery | About → Delete all data → confirm; then scan S6 and check again; then the self-test again | Delete reports success (or a visible failure); the first-launch notice returns; the next check works; the self-test passes afterwards. Real-database delete/retry is **not exercisable** while persistence is off; the lifecycle is covered by tests against a file-backed SQLite database (not SQLCipher on a device) | device only | | | UNTESTED |
| V9 | Backup exclusion | `adb shell dumpsys package $PKG \| grep flags=` (no ALLOW_BACKUP). `adb shell bmgr backupnow $PKG` | Backup refused or zero app data; no ALLOW_BACKUP flag | adb | | | UNTESTED |
| V10 | Release logs | `adb logcat -c`; run S1, S3, S6 and a typed check; `adb logcat -d > v10.txt`; search it for the NDCs, drug names and lot numbers used (e.g. `grep -iE "62756\|JKU4639A\|metformin\|warfarin" v10.txt`) | No label text, NDC, lot or medication name from the app process | adb | | | UNTESTED |
| V11 | Native networking | Mac proxy (e.g. mitmproxy, no CA installed on the phone) set as the Wi-Fi proxy; scan S6 and check. Record the CONNECT hosts. Then turn the proxy off | Only `api.fda.gov`, `rxnav.nlm.nih.gov`, `dailymed.nlm.nih.gov` contacted; nothing during OCR (photo → "Is this your medication?") before confirmation lookups; with the proxy's own CA the app refuses the connection (user CAs not trusted) and shows "We couldn't reach FDA's data". Cookie and redirect handling cannot be observed without decrypting traffic: **UNTESTED by design** unless the team approves a debug-only trust configuration | proxy | | | UNTESTED |
| V12 | Recents-screen exposure | Show a result for S1, press Overview (recents) | Recorded as observed. FLAG_SECURE is not set (OD-21 open), so the result is expected to be **visible** in the thumbnail — a known gap, not a pass | device only | | | UNTESTED |

## 6. Results

### Static APK checks (build environment)

Filled in below after the build.

### Device checks

| Passed | Failed | Untested |
|---|---|---|
| — | — | V0–V12 (no device available to the preparing session) |

Any failure is reported to the team before further activation is proposed.
