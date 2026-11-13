# Pixel Scan Test Guide — development build 0.1.7 (build 8)

> **Build 8** is build 7 with smaller text-reading models (APK 41.4 → 33.3 MB). Screens and results
> are unchanged. Please check that scanning still reads labels as well as build 7 did, and note the
> scan time shown in the development detail line.

> **Device result for build 6 (owner's Pixel, 2026-11-12):** a label was scanned and the recall check
> completed (no matching recall), but the result listed every FDA record checked in full. **Build 7**
> keeps the scanner unchanged and redesigns the result screen to put a summary first (section 4a below).

> **Device result for build 4 (owner's Pixel, 2026-11-12):** every scan ended with "We couldn't read
> your label — The photo could not be read." Cause: the barcode library's `read()` was called with a
> null crop rectangle, which its Kotlin API rejects, so every analysis threw. Fixed in build 5; text and
> barcodes now fail independently, and development builds show a "Technical detail" line on this
> screen. Please use build 5.

> **Device result for build 5 (owner's Pixel, 2026-11-12):** no crash, but every photo — the test
> labels and a real pharmacy vial — ended with "We could not find any text or barcode… Technical
> detail (development): 0 text lines, 1 barcodes". The barcode reader worked; the text reader returned
> nothing. Cause (reproduced on a computer): the app took the OCR character list from ONNX Runtime's
> metadata API, which does not return the 6,623 entries the recognition model needs (on a computer it
> returns 6,621 and garbles one character; on the phone evidently nothing usable), so every text line
> decoded as empty and was silently dropped. **Build 6** reads the list directly from the model file,
> checks its size against the model (a mismatch now shows a TEXT_FAILED technical detail instead of
> "0 text lines"), and also:
> - uses the newer PaddleOCR PP-OCRv4 mobile models;
> - reads text from a 3200-pixel copy of the photo (was 1600), because on the real vial photo the
>   print was only ~15 pixels tall;
> - keeps a known drug name even when the strength is unreadable (the form then asks you for the
>   strength — it is never guessed), and corrects "S" read for "5" right after a drug name;
> - shows OCR counts in the development detail line: "text regions N (empty E, unclear U); dictionary 6623".
>
> On a computer, the same code on the owner's real vial photo now reads "AMLODIPINE" and "5 MG"
> (the photo is not stored in the repository). This is **not** a phone result; please re-test.

Owner-only. Goal: photograph a label on your Pixel, confirm what was read, and reach the recall-check
result **without typing the NDC**. Record what actually happens; nothing in this guide has been run
on a phone yet.

## 1. Install

Use the attached **`medluma-dev-v0.1.7-b8-arm64-v8a.apk`** (33.3 MB). Universal fallback:
`medluma-dev-v0.1.7-b8-universal.apk` (71.2 MB). Full steps (download, checksum, install, Play Protect
prompt): `docs/INSTALL_ON_ANDROID.md`.

| File | SHA-256 |
|---|---|
| medluma-dev-v0.1.7-b8-arm64-v8a.apk | `9bbf1f6c59c1b8ed2cdbfa74effbc83f31eb54ecbb62d4d48d894c0016e5ab0b` |
| medluma-dev-v0.1.7-b8-universal.apk | `d3fd7596dced8fb6b797e97f67538717a888bc8747a35c4a1f7f966cb280331a` |

On the Mac:

```bash
shasum -a 256 ~/Downloads/medluma-dev-v0.1.7-b8-arm64-v8a.apk
```

It installs over builds 1–7. Open **MedLuma (DEV)** → *About and privacy* should show
**version 0.1.7 (build 8)**.

If a scan still fails, the error screen now shows a grey **Technical detail (development)** line —
please send a screenshot of it (test labels only); it contains no label content.

## 2. Test labels

Open the attached **`scan-test-labels-SYNTHETIC.pdf`** on your Mac screen (zoom so one label fills
most of the screen) or print it. Every page is a synthetic label with real public drug codes and the
expected result. Turn down screen glare; hold the phone 15–25 cm away.

You may also try a real label of your own; everything stays on the phone. For a round pharmacy vial:
fill the frame with the label (about 10–15 cm away), keep the drug-name line flat toward the camera,
and avoid glare across the text. If only some details are read, the form opens prefilled with them
and a note "We read some details from your photo…" — fill in the rest. Do **not** send
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
| C9 | Real vial of your own (optional) | Note which details were read (no screenshot needed); if "couldn't read", note the *Technical detail* line — it contains only counts |
| C7 | Back button on any result | Returns to the Scan screen |
| C8 | *Type the details instead* | Manual form still works (fallback) |

## 4a. Result screen (build 7)

Use S1 (possible match), S2 (no match) and S6 (recall match found) from the test sheet, or the typed
test medications in `docs/FUNCTIONAL_TEST_PLAN.md` (D1, D2, D4).

| # | Check | Expected |
|---|---|---|
| R1 | Top of any result | Label, headline, then one sentence "We checked N FDA recall records for …: …" counting each group |
| R2 | Directly below the result box | **Important limits of this result** with the limits and the standing disclaimer |
| R3 | S6 / D1 (recall match found) | **Recalls that match your product** shows D-0325-2021 as a card: recall started, recalling firm, reason, FDA class in plain words, status in plain words, closing date, recall number, *Official FDA record* |
| R4 | S1 / D2 (possible match) | **Recalls that might match**: three cards, then "Show N more records that might match" opens the rest in the same section; "You did not enter a lot number" in the result box |
| R5 | S2 / D4 (no match) | Label **No matching recall found in the FDA records checked**; the words "active recall" appear nowhere |
| R6 | **Records for a different product** | Counts by reason that add up to the number in the summary; no records listed until *Show these N records*; each opened card starts with "Why it does not apply…" |
| R7 | *More about this record* on any card | Product text and lot codes as published by FDA |
| R8 | Status note | Each record section starts with "…A completed or terminated recall does not mean the product is safe…" |
| R9 | Airplane mode, then a check | "We couldn't reach FDA's data. Nothing was checked." — no summary, no counts |
| R10 | Largest font size | All of the above readable; buttons reachable by scrolling |

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
