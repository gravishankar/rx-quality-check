# Android Device Test Plan — v0.1.0 (working name MedLuma)

Status at Task 4A: **not executed.** No physical device or emulator was available in the build
environment. Every item below is pending. Results are recorded in the table at the end, with device
model, Android version, build SHA-256 and date.

Owner step-by-step instructions: `docs/FIRST_DEVICE_TEST_RUNBOOK.md`. Install the development APK (`docs/ANDROID_BUILD_AND_INSTALL.md`). Use only public example NDCs;
do not enter real patient information.

## 1. Installation and launch

| ID | Step | Expected |
|---|---|---|
| D-1 | Install APK with `adb install` | Installs as "MedLuma (DEV)" (label from `config/brand.json`; ID unchanged `org.rxrecallcheck.app.dev`) |
| D-2 | Launch with no computer connected | App starts without Metro; purple banner "DEVELOPMENT BUILD — evaluation prototype … Not clinically validated…" |
| D-3 | First launch | "Before you start" notice; links open Terms, Privacy, Medical Disclaimer (marked draft) |
| D-4 | Permissions screen in system settings | No permissions requested at runtime; only network access listed |

## 2. Workflows (live network)

| ID | Input | Expected |
|---|---|---|
| D-10 | NDC 62756-142-02, METFORMIN HCL ER, 500 MG, TABLET, lot JKU4639A; confirm each item and the lot | Result "Available recall information matches…", ALERT tone, D-0325-2021 listed, pharmacist + official record next steps |
| D-11 | Same without lot | "may be affected…", lot qualifier |
| D-12 | NDC 82009-018-10 ROSUVASTATIN CALCIUM 10 MG TABLET | No-match headline with date and "does not establish…", sources and limitations visible on the same screen (or a newer FDA result) |
| D-13 | NDC 67046-2072-3 WARFARIN | "We don't check this medication… No recall check was done." |
| D-14 | Airplane mode, then any check | "We couldn't reach FDA's data. Nothing was checked." Never a no-match |
| D-15 | Confirm screen: try to continue without ticking each item | Button disabled |
| D-16 | Tap "Official FDA record" | Opens api.fda.gov record in browser |
| D-17 | About → Delete all data | Confirmation dialog; afterwards first-launch notice shown again |

## 3. Storage encryption (PV-4)

| ID | Step | Expected |
|---|---|---|
| D-20 | About → Run encryption self-test | All four steps PASS (cipher_version non-empty; wrong key cannot read) |
| D-21 | (debuggable build or root) pull the self-test DB before deletion, or the app DB in a persisted build, and run `sqlite3 file .tables` | "file is not a database"; `head -c 16` is not "SQLite format 3" |
| D-22 | Reinstall app | Previous key and data gone |

## 4. Privacy and security

| ID | Step | Expected |
|---|---|---|
| D-30 | `adb logcat` during D-10 | No NDC, lot, drug name or result text in release-build logs |
| D-31 | Proxy capture (e.g., mitmproxy with device trust — debug only) | Hosts only api.fda.gov, rxnav.nlm.nih.gov, dailymed.nlm.nih.gov; no lot, no name |
| D-32 | `adb shell bmgr backupnow org.rxrecallcheck.app.dev` | No app data backed up |
| D-33 | Recents screen | (Observe) whether medication details are visible in the app switcher; record for Task 4B decision |

## 5. Accessibility

| ID | Step | Expected |
|---|---|---|
| D-40 | TalkBack through entry → confirm → result | Every field read with its label and evidence level; headline read as a heading |
| D-41 | Largest system font | No clipped text; all buttons reachable |
| D-42 | Color-blind simulation | Result tone also stated in words |

## 6. Devices

At least two physical devices: one Android 10–12, one Android 14–16, at least one arm64 and (if
available) one 32-bit ARM device.

## Results

| ID | Device / Android | Build SHA-256 | Date | Result | Notes |
|---|---|---|---|---|---|
| — | — | — | — | Not run | No device available in Task 4A |
