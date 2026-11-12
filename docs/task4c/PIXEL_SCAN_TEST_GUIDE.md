# Pixel Scan Test Guide — development build 0.1.3 (build 4)

Owner-only. Goal: photograph a label on your Pixel, confirm what was read, and reach the recall-check
result **without typing the NDC**. Record what actually happens; nothing in this guide has been run
on a phone yet.

## 1. Install

Use the attached **`medluma-dev-v0.1.3-b4-arm64-v8a.apk`** (38.9 MB). Universal fallback:
`medluma-dev-v0.1.3-b4-universal.apk` (76.7 MB). Full steps (download, checksum, install, Play Protect
prompt): `docs/INSTALL_ON_ANDROID.md`.

| File | SHA-256 |
|---|---|
| medluma-dev-v0.1.3-b4-arm64-v8a.apk | `629a7035a63044f0611362ef764f283529084deffb9af8b62f03186c77d4d958` |
| medluma-dev-v0.1.3-b4-universal.apk | `a081b282dac61643c5d75d0ea65cec9042efd25b9b33d14e433cdeec3cb31d5f` |

On the Mac:

```bash
shasum -a 256 ~/Downloads/medluma-dev-v0.1.3-b4-arm64-v8a.apk
```

It installs over builds 1–3. Open **MedLuma (DEV)** → *About and privacy* should show
**version 0.1.3 (build 4)**.

## 2. Test labels

Open the attached **`scan-test-labels-SYNTHETIC.pdf`** on your Mac screen (zoom so one label fills
most of the screen) or print it. Every page is a synthetic label with real public drug codes and the
expected result. Turn down screen glare; hold the phone 15–25 cm away.

You may also try a real label of your own; everything stays on the phone. Do **not** send
screenshots of real labels to anyone.

## 3. Steps for each label

1. Home screen → **Scan medication label**. The Pixel camera opens.
2. Take the photo, tap the ✓ (accept) in the camera.
3. "Reading your label on this phone…" (first scan may take a few seconds while the model loads).
4. On *Is this your medication?* check the three groups:
   - **Matched in FDA records** — product (NDC), ingredient/strength, form, labeler.
   - **Read from your label — please check** — e.g., a lot number.
   - **Needs your input** — anything not found.
5. Switch on each item, answer the release question if shown, tap **Yes, these details match my label**.
6. Note the result label and headline.

At the bottom of the confirmation screen, a grey line "Scan details (development): … ms" shows the
on-phone timing — please write it down.

| # | Label (PDF page) | Expected (verified with live FDA data on 2026-11-12 using the same OCR code on a computer) |
|---|---|---|
| S1 | Pharmacy label, metformin ER, NDC printed | Product 62756-142-02 under *Matched in FDA records*; result **Possible recall match** (no lot on pharmacy labels) |
| S2 | Pharmacy label, rosuvastatin | Product 82009-018-10 matched; result **No match in the records checked** with the date (or a newer FDA result) |
| S3 | Pharmacy label, warfarin | **We don't check this medication** — no recall check |
| S4 | Pharmacy label without NDC, metformin ER | Fields under *Read from your label*; product "Not identified"; **Possible recall match** |
| S5 | Pharmacy label, sertraline | **Not covered by this version** |
| S6 | Manufacturer bottle, metformin ER, lot JKU4639A | Product matched; lot under *Read from your label*; switch on the lot → **Recall match found**, D-0325-2021 |
| S7 | Carton with 2D barcode | Product, lot and expiry from the barcode; → **Recall match found** |

## 4. Other checks

| # | Check | Expected |
|---|---|---|
| C1 | Cancel in the camera | Back on Scan with "No photo was taken." |
| C2 | Photo of a blank wall | "We couldn't read your label" with *Scan again* / *Type the details instead* |
| C3 | After S1, tap **Correct the details** | Form prefilled with the NDC, name and strength read |
| C4 | Open Google Photos after scanning | **No** scan photos appear |
| C5 | Airplane mode, then scan S2 | Text is read on the phone; then "We couldn't reach FDA's data. Nothing was checked." |
| C6 | Rotate the label ~10°, dim light | Note whether it still reads; record the timing |
| C7 | Back button on any result | Returns to the Scan screen |
| C8 | *Type the details instead* | Manual form still works (fallback) |

## 5. Record results

| # | Pass/Fail | What the screen said | Scan time (ms) | Notes |
|---|---|---|---|---|
| S1 | | | | |
| … | | | | |

Also note: Pixel model, Android version, which APK (ARM64/universal).

If the app closes by itself, with the phone connected to the Mac:

```bash
adb logcat -b crash -d > ~/Desktop/medluma-crash.txt
```

That file contains only crash traces (the app logs no label text). If **Scan medication label** is
missing and you only see the typed form with "Scanning is not available on this phone yet", the
native scanner module was not found at run time — report that; it is the main untested risk.
