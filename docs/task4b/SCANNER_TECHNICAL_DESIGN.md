# Scanner Technical Design (Task 4B, revised priority — proposal only)

Goal: replace most typing with an on-device, privacy-preserving camera flow that feeds the
**existing** identification and recall engine (`LabelExtraction` → identity resolution with
cross-validation → exclusion → confirmation → recall evidence). Nothing here is implemented.

## 1. Requirements (from your Task 4B revision)

1. Pharmacy-label photo + OCR. 2. Barcodes (NDC-bearing UPC-A, GTIN-14 / GS1-128, GS1 DataMatrix).
3. Extract name, strength, form, manufacturer abbreviation, NDC, lot when present. 4. Validate against
FDA/DailyMed. 5. Confirmation distinguishing scanned text, verified data, unresolved fields. 6. Manual
correction/fallback. 7. No automatic upload, analytics or image retention. 8. Pixel now, iOS later.
Never treat Rx numbers as NDCs; never infer lot or facility.

## 2. Library comparison

Versions and facts from web research on 2026-11-12; items marked *measure* must be confirmed in the
4C.1 spike (none were installed in Task 4B).

### Camera

| Option | License | Maintenance | RN 0.88 / New Arch | Notes |
|---|---|---|---|---|
| **react-native-vision-camera v5** (5.2.4, Oct 2026) | MIT | Active (Margelo) | New Architecture only; Nitro Modules; 0.88 compatibility to confirm (*measure*) | Frame processors; barcode scanner split into `react-native-vision-camera-barcode-scanner` (ML Kit) ([npm](https://www.npmjs.com/package/react-native-vision-camera), [V5 notes](https://blog.margelo.com/whats-new-in-visioncamera-v5)) |
| expo-camera (bare RN via Expo modules) | MIT | Active | Requires Expo modules runtime | Barcode via ML Kit/AVFoundation; adds Expo dependency |
| Platform photo picker / system camera intent | OS | — | — | Lowest complexity; image passes through another app's camera; no live barcode feedback |

### Barcode decoding

| Engine | License | Privacy | Formats | Size | Notes |
|---|---|---|---|---|---|
| Google ML Kit barcode (bundled) | Google ML Kit terms (proprietary, free) | On-device processing; ML Kit **may send usage/diagnostic metrics** to Google; no supported opt-out reported ([ML Kit terms](https://developers.google.com/ml-kit/terms); third-party: [actua #1481](https://github.com/azimul-kabir/actua/issues/1481), [Recipedia #594](https://github.com/AntoC-dev/Recipedia/pull/594)) | UPC-A, EAN, Code128, DataMatrix, … | ~2.4 MB bundled (Google figure) ([docs](https://developers.google.com/ml-kit/vision/barcode-scanning/android)) | Easiest via VisionCamera plugin |
| **ZXing-cpp** via a small custom frame-processor plugin | Apache-2.0 | No network code | UPC-A, EAN, Code128, GS1 DataMatrix | ~1–2 MB per ABI (*measure*) | Maintained upstream; RN binding must be written (small native module) |
| iOS AVFoundation / VisionKit | OS framework | No third-party SDK | UPC/EAN, DataMatrix | 0 | For the iOS phase |

### OCR

| Engine | License | Privacy | Accuracy on pharmacy labels | Size | Notes |
|---|---|---|---|---|---|
| ML Kit Text Recognition v2 (Latin, bundled) | ML Kit terms | Same metrics concern as above | High (*measure*) | Several MB (*measure*) | Wrappers: `@react-native-ml-kit/text-recognition`, `react-native-text-recognition` (Vision on iOS) |
| **Apple Vision** (iOS) | OS | No third-party SDK | High | 0 | For the iOS phase |
| PaddleOCR (PP-OCR) via ONNX Runtime / ExecuTorch | Apache-2.0 / MIT | No network code (verify runtime telemetry flags) | High (*measure*) | ~8–25 MB models ([ExecuTorch OCR](https://docs.swmansion.com/react-native-executorch/docs/extensions/optical-character-recognition)) | More integration work; larger APK |
| Tesseract (tesseract4android) | Apache-2.0 | No network code | Moderate on curved, glossy labels | ~4–15 MB traineddata | Mature; weaker on phone photos |

Accessibility for all options comes from our own screens (live region announcements, haptics, large
controls, manual fallback); the engines themselves have no UI.

**Recommendation:** VisionCamera v5 for capture; **ZXing-cpp** for barcodes on Android (no
telemetry, GS1 support); **OCR engine decided by a measured bake-off (OD-27)** between ML Kit v2 and
PaddleOCR, with the project's default being **no third-party telemetry** (CLAUDE.md §2). If ML Kit is
chosen, it requires your explicit exception, a privacy-policy disclosure, and a traffic capture showing
what it sends. iOS later uses Apple Vision + AVFoundation behind the same `PlatformServices` interface.

## 3. Architecture

```
Camera screen (mobile/app)            platform adapter (native)          shared TS (mobile/src)
  live preview ──frames──> barcode decoder ──payload──┐
  "Take photo of label" ──image (memory)──> OCR ──lines+boxes──┐
                                                  ▼               ▼
                                  scanner/barcode.ts        scanner/labelText.ts      (pure, tested)
                                  GS1/UPC → NDC, lot, exp    lines → fields + privateText
                                                  └──────┬────────┘
                                                         ▼
                                     LabelExtraction { origin: 'BARCODE' | 'OCR', confidence }
                                                         ▼
                         existing engine: candidates → NDC Directory → cross-validation → exclusion
                                                         ▼
                              Confirmation screen: three evidence classes, correction, fallback
```

- `PlatformServices` gains `scanBarcode()` / `recognizeText(image)` (interface only in shared code).
- `scanner/` is pure TypeScript: unit-testable with text fixtures; no native imports.
- The existing privacy guard is armed with every OCR line not used for identity
  (`LabelExtraction.privateText`), so names, Rx numbers and addresses can never be sent.

## 4. Extraction rules (pure TS, test-first)

| Field | Accept | Reject / never |
|---|---|---|
| NDC (OCR) | 10-digit hyphenated 4-4-2 / 5-3-2 / 5-4-1, or 11 digits, **anchored** by "NDC" on the same/adjacent line, or the only well-formed hyphenated candidate | Numbers next to "Rx", "Rx#", "RX NO", "Refill", "Qty", "Store", phone/date/ZIP patterns; anything that fails directory lookup **or** cross-validation is discarded (existing A-9) |
| NDC (barcode) | UPC-A starting with 3; EAN-13 "03…"; GTIN-14 with "03" after the indicator and valid check digit; GS1 AI (01) | Code 128/39 on pharmacy labels (typically Rx/store numbers) unless GS1-formatted with AI (01) |
| Lot | GS1 AI (10); OCR text explicitly labeled "LOT"/"Lot:" on manufacturer packaging | Never inferred; never from pharmacy-label numbers; always shown as *Read from label — please confirm* and never sent |
| Expiry | GS1 AI (17); "EXP" labeled text | Not used for identity; kept local |
| Name / strength / form | Line(s) matching catalog ingredient names + strength units + form words | Patient name, prescriber, directions → `privateText` |
| Manufacturer abbreviation | "MFR:", "MFG:", "DIST BY:" labeled text, shown as *Read from label* | Not mapped to a labeler without a verified mapping (A-12 stays rejected); may only filter candidates the user then confirms |

## 5. Confirmation screen evidence classes

| Class | Meaning | Example label |
|---|---|---|
| **Read from your label** (`SCANNED_UNVERIFIED`) | Camera text, not checked | "Lot (read from label): JKU4639A — please check" |
| **Matched in FDA records** (`VERIFIED_SOURCE`) | Directory-confirmed and cross-validated | "Product (NDC) 62756-142-02 — From FDA records" |
| **Needs your input** (`UNAVAILABLE` / `CONFLICTING`) | Not found, unreadable or conflicting | "We could not read the strength. Please type it." |

Every field is editable; editing turns it into *Entered by you*. Confirmation still requires each
item (existing gates).

## 6. Privacy safeguards

- CAMERA permission requested only when the user taps Scan; denial → manual entry, never blocked.
- Frames and photos processed in memory, never written to disk, gallery or cache; no "save image".
- No network calls by scanner code; engine choice verified by traffic capture (spike gate).
- Recognized text not used for identity is kept only in memory for the privacy guard, then discarded.
- Consider `FLAG_SECURE` on the camera and confirmation screens (OD-21).
- No analytics, crash reporting or image upload of any kind.

## 7. MVP scope (Task 4C) and tests

- **In:** live barcode scan (Android, Pixel); one-photo OCR of a pharmacy label; extraction → existing
  engine; confirmation with three classes; manual fallback; GS1 lot/expiry.
- **Out:** imprint picker, mnemonic mapping, fine-print site capture, iOS build, batch scanning.
- **Tests:** extractor/barcode unit tests on synthetic label texts (labeled SYNTHETIC; real public NDCs,
  GTINs, lots from recall records); Rx-number traps; UI flow tests with a fake scanner; spike
  measurements (accuracy on ≥ 30 synthetic printed labels photographed on a Pixel, latency, APK delta,
  network capture); device checklist additions to `docs/FUNCTIONAL_TEST_PLAN.md`.
- **APK impact (estimate, *measure*):** ARM64 APK 15.2 MB today; + VisionCamera/Nitro (~1–3 MB) +
  ZXing-cpp (~1–2 MB) + OCR (ML Kit several MB, PaddleOCR ~8–25 MB).
