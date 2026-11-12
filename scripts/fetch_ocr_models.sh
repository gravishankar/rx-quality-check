#!/usr/bin/env bash
# Fetch the on-device OCR models (PaddleOCR PP-OCRv3 detection + recognition, Apache-2.0, ONNX
# format as packaged by RapidOCR 1.2.3) into the Android assets. The models are not committed to the
# repository; every file is verified by SHA-256.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/mobile/android/app/src/main/assets/ocr"
WHEEL_URL="https://files.pythonhosted.org/packages/b7/ef/0df9a58310895ab357f85df67935af6a8fb98f0965c7476cee6fcb966a7e/rapidocr_onnxruntime-1.2.3-py3-none-any.whl"
WHEEL_SHA="c707d3a6eb72d13119afe9602d3cc36d8b2a4a4d74e9575cf1b0e67ed6a27819"
DET_SHA="3439588c030faea393a54515f51e983d8e155b19a2e8aba7891934c1cf0de526"
REC_SHA="897a3ededb38fee0dae2c1ccee38241f37df202c9509e3abca02e9217c5ee615"

check() { echo "$2  $1" | sha256sum -c --quiet - ; }
if [ -f "$DEST/ch_PP-OCRv3_det_infer.onnx" ] && check "$DEST/ch_PP-OCRv3_det_infer.onnx" "$DET_SHA" 2>/dev/null \
   && [ -f "$DEST/ch_PP-OCRv3_rec_infer.onnx" ] && check "$DEST/ch_PP-OCRv3_rec_infer.onnx" "$REC_SHA" 2>/dev/null; then
  echo "OCR models present and verified."
  exit 0
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/w.whl" "$WHEEL_URL"
check "$TMP/w.whl" "$WHEEL_SHA"
mkdir -p "$DEST"
unzip -q -o -j "$TMP/w.whl" "rapidocr_onnxruntime/models/ch_PP-OCRv3_det_infer.onnx" "rapidocr_onnxruntime/models/ch_PP-OCRv3_rec_infer.onnx" -d "$DEST"
check "$DEST/ch_PP-OCRv3_det_infer.onnx" "$DET_SHA"
check "$DEST/ch_PP-OCRv3_rec_infer.onnx" "$REC_SHA"
cat > "$DEST/NOTICE.txt" <<TXT
PaddleOCR PP-OCRv3 models (Apache License 2.0), https://github.com/PaddlePaddle/PaddleOCR
ONNX conversion as distributed in rapidocr-onnxruntime 1.2.3 (Apache License 2.0).
TXT
echo "OCR models installed in $DEST"
