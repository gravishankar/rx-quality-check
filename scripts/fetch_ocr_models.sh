#!/usr/bin/env bash
# Fetch and shrink the on-device OCR models (Task 4C, build 8). Not committed to the repository.
#  1. PaddleOCR PP-OCRv4 mobile detection + recognition models (Apache-2.0), ONNX format as packaged
#     in the RapidOCR 1.4.4 wheel on PyPI; wheel and models verified by SHA-256.
#  2. scripts/optimize_ocr_models.py (pinned onnx/numpy from PyPI): recognizer reduced to the 105
#     characters used on US labels; 8-bit weights (detector all large weights, recognizer 3 largest).
#     The outputs are deterministic and verified by SHA-256 below.
# History: builds 4-5 used PP-OCRv3 (RapidOCR 1.2.3); builds 6-7 the unmodified PP-OCRv4 models.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/mobile/android/app/src/main/assets/ocr"
WHEEL_URL="https://files.pythonhosted.org/packages/ba/12/1e5497183bdbe782dbb91bad1d0d2297dba4d2831b2652657f7517bfc6df/rapidocr_onnxruntime-1.4.4-py3-none-any.whl"
WHEEL_SHA="971d7d5f223a7a808662229df1ef69893809d8457d834e6373d3854bc1782cbf"
SRC_DET="ch_PP-OCRv4_det_infer.onnx"
SRC_REC="ch_PP-OCRv4_rec_infer.onnx"
SRC_DET_SHA="d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9"
SRC_REC_SHA="48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b"
DET="ppocrv4_det_w8.onnx"
REC="ppocrv4_rec_latin.onnx"
DET_SHA="71a98d03cc96e9fb1a8c22e17129c372b482cf4a43fdb5081494ede1ff224dc3"
REC_SHA="107285a70a6394395b4ca17d94d365a0d41b6455bbfc6a84e69c002ed8f4c9ee"
PY_PINS="onnx==1.23.2 numpy==2.5.4"

check() { echo "$2  $1" | sha256sum -c --quiet - ; }
# Remove superseded models so they are not packaged.
rm -f "$DEST/ch_PP-OCRv3_det_infer.onnx" "$DEST/ch_PP-OCRv3_rec_infer.onnx" "$DEST/$SRC_DET" "$DEST/$SRC_REC"
if [ -f "$DEST/$DET" ] && check "$DEST/$DET" "$DET_SHA" 2>/dev/null \
   && [ -f "$DEST/$REC" ] && check "$DEST/$REC" "$REC_SHA" 2>/dev/null; then
  echo "OCR models present and verified."
  exit 0
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/w.whl" "$WHEEL_URL"
check "$TMP/w.whl" "$WHEEL_SHA"
unzip -q -o -j "$TMP/w.whl" "rapidocr_onnxruntime/models/$SRC_DET" "rapidocr_onnxruntime/models/$SRC_REC" -d "$TMP"
check "$TMP/$SRC_DET" "$SRC_DET_SHA"
check "$TMP/$SRC_REC" "$SRC_REC_SHA"
python3 -m venv "$TMP/venv"
"$TMP/venv/bin/pip" -q install --only-binary=:all: $PY_PINS
mkdir -p "$DEST"
"$TMP/venv/bin/python" -I "$ROOT/scripts/optimize_ocr_models.py" "$TMP/$SRC_DET" "$TMP/$SRC_REC" "$DEST/$DET" "$DEST/$REC"
check "$DEST/$DET" "$DET_SHA"
check "$DEST/$REC" "$REC_SHA"
cat > "$DEST/NOTICE.txt" <<TXT
PaddleOCR PP-OCRv4 mobile models (Apache License 2.0), https://github.com/PaddlePaddle/PaddleOCR
ONNX conversion as distributed in rapidocr-onnxruntime 1.4.4 (Apache License 2.0).
Modified for this app: recognizer limited to 105 characters; weights stored in 8 bits
(scripts/optimize_ocr_models.py).
TXT
echo "OCR models installed in $DEST"
