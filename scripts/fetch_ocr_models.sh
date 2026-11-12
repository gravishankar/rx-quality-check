#!/usr/bin/env bash
# Fetch the on-device OCR models (PaddleOCR PP-OCRv4 mobile detection + recognition, Apache-2.0, ONNX
# format as packaged by RapidOCR 1.4.4) into the Android assets. The models are not committed to the
# repository; every file is verified by SHA-256. (Builds 4-5 used PP-OCRv3 from RapidOCR 1.2.3; v4
# reads the owner's real pharmacy-vial photo better with equal synthetic accuracy, Task 4C build 6.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/mobile/android/app/src/main/assets/ocr"
WHEEL_URL="https://files.pythonhosted.org/packages/ba/12/1e5497183bdbe782dbb91bad1d0d2297dba4d2831b2652657f7517bfc6df/rapidocr_onnxruntime-1.4.4-py3-none-any.whl"
WHEEL_SHA="971d7d5f223a7a808662229df1ef69893809d8457d834e6373d3854bc1782cbf"
DET="ch_PP-OCRv4_det_infer.onnx"
REC="ch_PP-OCRv4_rec_infer.onnx"
DET_SHA="d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9"
REC_SHA="48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b"

check() { echo "$2  $1" | sha256sum -c --quiet - ; }
# Remove superseded models so they are not packaged.
rm -f "$DEST/ch_PP-OCRv3_det_infer.onnx" "$DEST/ch_PP-OCRv3_rec_infer.onnx"
if [ -f "$DEST/$DET" ] && check "$DEST/$DET" "$DET_SHA" 2>/dev/null \
   && [ -f "$DEST/$REC" ] && check "$DEST/$REC" "$REC_SHA" 2>/dev/null; then
  echo "OCR models present and verified."
  exit 0
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/w.whl" "$WHEEL_URL"
check "$TMP/w.whl" "$WHEEL_SHA"
mkdir -p "$DEST"
unzip -q -o -j "$TMP/w.whl" "rapidocr_onnxruntime/models/$DET" "rapidocr_onnxruntime/models/$REC" -d "$DEST"
check "$DEST/$DET" "$DET_SHA"
check "$DEST/$REC" "$REC_SHA"
cat > "$DEST/NOTICE.txt" <<TXT
PaddleOCR PP-OCRv4 mobile models (Apache License 2.0), https://github.com/PaddlePaddle/PaddleOCR
ONNX conversion as distributed in rapidocr-onnxruntime 1.4.4 (Apache License 2.0).
TXT
echo "OCR models installed in $DEST"
