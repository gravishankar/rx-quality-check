# Scanner Engine Evaluation (Task 4C)

Date: 2026-11-12. **All measurements below are automated/simulated on a desktop computer (Linux,
4 CPU cores). No physical device or emulator was available; Pixel accuracy and latency are not yet
measured** — see `PIXEL_SCAN_TEST_GUIDE.md`.

## 1. Test set

32 **synthetic** label photos generated reproducibly by `scripts/scanner_lab/generate_labels.py`
(seed 20261112): 22 pharmacy-vial labels (6 drugs; with 11-digit, 10-digit and unhyphenated NDC
styles; 4 without NDC; each with a Code 128 Rx-number barcode as a trap), 6 manufacturer stock-bottle
labels with UPC-A, 4 cartons with GS1 DataMatrix. Quality levels: clean, mild (rotation ±3°, blur,
perspective, glare), hard (±8°, cylindrical curvature, stronger blur, JPEG q72). Drug codes and lot
JKU4639A are real public values; every person, pharmacy and number is synthetic. Images are not
committed; OCR outputs are (`tests/fixtures/scanner/ocr_lab.json`).

Limitation: synthetic labels are cleaner than many real photos (real glare, small fonts, thermal
printing, crumpled labels). The Pixel test is the real check.

## 2. OCR engines — raw text field recall (before extraction)

| Field | PaddleOCR PP-OCRv3 (ONNX) | Tesseract 5.3.4 (LSTM, eng) | Google ML Kit v2 |
|---|---|---|---|
| NDC (28 labels print one) | **28/28** | 24/28 | not measurable off-device |
| Drug name | **32/32** | 28/32 | — |
| Strength | 27/32 raw → **31/32 after extraction** (O/0 fixes) | 30/32 | — |
| Manufacturer abbreviation | **22/22** | 20/22 | — |
| Lot (where printed) | **4/4** | 3/4 | — |
| NDC on "hard" photos | **11/11** | 7/11 | — |
| Median time per image (desktop) | 378 ms (Python) / **233 ms (app's Java core)** | 211 ms | — |
| License | Apache-2.0 (models), MIT (ONNX Runtime) | Apache-2.0 | Proprietary terms |
| Network / telemetry | None in ONNX Runtime **1.28.0** (see §4) | None | **Sends usage logs** (see §3) |
| Size (ARM64, compressed in APK) | ~12.9 MB runtime + ~11.8 MB models | ~3 MB lib + 4–15 MB data | several MB |
| iOS | Same models via ONNX Runtime iOS, or Apple Vision | Possible | Yes |

The app uses the **PaddleOCR pipeline implemented in pure Java** (`PpOcr.java`), so the identical
code was run on the desktop (`scripts/scanner_lab/DesktopLab.java`): identical OCR text on 32/32
images with ONNX Runtime 1.31.1 and 1.28.0.

## 3. Google ML Kit — why it is not used (OD-27)

Static analysis of the published packages (Google Maven, 2026-11-12):
`com.google.mlkit:text-recognition:16.0.1` depends on `com.google.mlkit:common:18.11.0`, which depends
on `com.google.android.datatransport:transport-runtime` and `transport-backend-cct` (Google's
Clearcut logging backend, which posts over `HttpURLConnection`) and registers
`TransportBackendDiscovery` with `backend:…CctBackendFactory`; its classes reference the log source
`FIREBASE_ML_SDK`. Google's ML Kit terms say images and text stay on the device but that developers
must disclose Google's processing of ML Kit **metrics** data. Third-party reports describe no
supported opt-out. Under the project rule "no third-party telemetry without explicit approval", ML
Kit is excluded. It would likely be the most accurate and easiest engine; using it requires your
explicit decision (OD-27) plus a disclosure.

## 4. ONNX Runtime telemetry finding

`onnxruntime-android` **1.29.0 and later** add Microsoft 1DS telemetry: an auto-starting
`ai.onnxruntime.TelemetryInitializer` content provider, `ai/onnxruntime/telemetry/HttpClient`, and
INTERNET + ACCESS_NETWORK_STATE permissions (found when the first scanner build was inspected).
Versions 1.22.0–1.28.0 contain none of this (no provider, no telemetry/HTTP classes, no socket
symbols). The app pins **1.28.0**, removes the provider and permission in its manifest as a second
barrier, and `scripts/android_build.sh` now **fails the build** if the APK contains any permission
other than INTERNET or any telemetry class or manifest component (ONNX Runtime, Google data
transport, Firebase, Microsoft 1DS).

## 5. Barcodes

| Engine | Decoded (32 photos) | Notes |
|---|---|---|
| **ZXing-cpp** 2.x/3.1.1 (Apache-2.0) | **29/32** (all 4 DataMatrix; 4/6 UPC; 21/22 Code 128) | Misses only on "hard" photos; used in the app (Android wrapper 3.1.1, ~1.7 MB ARM64) |
| ZXing Java 3.5.4 | 18/32 (0/4 DataMatrix on rotated photos) | Rejected |

Interpretation rules (`mobile/src/scanner/barcode.ts`): only UPC-A/EAN-13 drug codes and GS1 data
with AI (01) GTIN-14 carrying "03" become NDC candidates; Code 128 pharmacy barcodes (Rx/store
numbers) never do; serial numbers (AI 21) are discarded.

## 6. End-to-end (automated, recorded real FDA/NLM data)

`tests/integration/scanner_flow.test.ts` and `scripts/scanner_lab/scan_flow.ts`: all 32 labels ×
(text only, text + barcodes) through the production engine:

| Labels | Outcome |
|---|---|
| Metformin ER pharmacy labels (NDC legible) | NDC matched in FDA records, no typing → "Possible recall match" (lot not printed) |
| Metformin stock bottle / carton (lot JKU4639A) | Lot read, confirmed by user → "Recall match found" (D-0325-2021) |
| Rosuvastatin with NDC | → "No match in the records checked" |
| Rosuvastatin without NDC | Fields "read from your label" → "Possible recall match" (ingredient level) |
| Warfarin | Excluded; no recall request |
| Sertraline | Not covered |
| Levothyroxine (repackager) | → "Possible recall match" |
| Furosemide solution, hard photo ("10OMG" ambiguous) | Stops at "needs clarification" — never a result for a wrong strength |

Privacy: no Rx number, patient-name part or lot appears in any request (test).
The 7-label printable test sheet was additionally verified against **live** FDA data (all 7 as
expected; `PIXEL_SCAN_TEST_GUIDE.md`).

## 7. APK size

| Build | ARM64 | Universal |
|---|---|---|
| 3 (no scanner) | 15.2 MB | 29.6 MB |
| 4 (scanner) | **38.9 MB** | **76.7 MB** |

Breakdown of the increase (ARM64, compressed): ONNX Runtime 1.28.0 ~11 MB, recognition model
~9.6 MB, detection model ~2.2 MB, ZXing-cpp ~0.7 MB. Safe future reductions (not done): ONNX Runtime
minimal build with only the operators these two models use; an English-only recognition model
(smaller dictionary); int8 quantization (accuracy must be re-measured); R8 (device test first).

## 8. React Native 0.88.1 compatibility

The scanner is a plain Android native module (Java) registered through `BaseReactPackage`, looked up
via `TurboModuleRegistry` with a `NativeModules` fallback; it builds with RN 0.88.1 / New
Architecture. Whether the interop lookup returns the module at run time can only be confirmed on a
device; if it does not, the app shows manual entry instead of failing (fallback tested in UI tests).
No third-party camera library is used: the photo comes from the phone's camera app
(`ACTION_IMAGE_CAPTURE`) into a private file, so the app needs no CAMERA permission.

## 9. Decision requested (OD-27)

Recommendation: keep the open-source, no-telemetry pipeline (PaddleOCR + ONNX Runtime 1.28.0 +
ZXing-cpp) for the Pixel test. Decide on ML Kit only if the Pixel test shows the open-source
pipeline is not accurate enough on your real labels.
