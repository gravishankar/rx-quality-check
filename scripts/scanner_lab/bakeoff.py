#!/usr/bin/env python3
"""
Task 4C scanner lab: desktop bake-off of on-device-capable OCR engines on the synthetic label set.

Engines (same models/libraries that would run on the phone):
  - Tesseract 5 (Apache-2.0) via its command-line tool (LSTM, eng)
  - PaddleOCR PP-OCRv3 (Apache-2.0) via ONNX Runtime (RapidOCR packaging, models as shipped)
  - ZXing-cpp (Apache-2.0) for barcodes
Google ML Kit cannot run off-device; it is assessed separately (docs/task4c/OCR_EVALUATION.md).

Desktop timings are NOT phone timings. Accuracy is measured on raw OCR text (before field extraction);
the TypeScript extractor's end-to-end accuracy is measured by tests on the saved OCR outputs.

  python3 scripts/scanner_lab/bakeoff.py <images_dir> <out_json>
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import zxingcpp
from PIL import Image
from rapidocr_onnxruntime import RapidOCR


def norm(s):
    return re.sub(r"\s+", " ", s.upper()).strip()


def digits(s):
    return re.sub(r"\D", "", s)


def field_hits(text, t):
    T = norm(text)
    flat = T.replace(" ", "")
    hits = {
        "name": t["name"] in T,
        "strength": t["strength"].replace(" ", "") in flat,
        "ndc": None,
        "lot": None,
        "mfr": None,
    }
    if t.get("ndc_printed"):
        want = digits(t["ndc_printed"])
        hits["ndc"] = any(want in digits(line) for line in text.splitlines())
    if t.get("lot") and not t.get("lot_is_synthetic"):
        hits["lot"] = t["lot"] in flat
    if t.get("mfr"):
        hits["mfr"] = t["mfr"].replace(" ", "") in flat
    return hits


def run_tesseract(path):
    t0 = time.perf_counter()
    out = subprocess.run(["tesseract", str(path), "stdout", "--psm", "11", "-l", "eng"], capture_output=True, text=True).stdout
    # psm 11 returns sparse words line by line; also run psm 3 (auto layout) and keep the better one later.
    out3 = subprocess.run(["tesseract", str(path), "stdout", "--psm", "3", "-l", "eng"], capture_output=True, text=True).stdout
    dt = (time.perf_counter() - t0) * 1000 / 2
    return {"psm11": out, "psm3": out3}, dt


def main(images_dir, out_json):
    images = Path(images_dir)
    truth = json.loads((images / "ground_truth.json").read_text())
    rapid = RapidOCR()
    rapid(str(images / truth[0]["file"]))  # warm-up (model load)
    rows = []
    for t in truth:
        p = images / t["file"]
        # PaddleOCR (PP-OCRv3 via ONNX Runtime)
        t0 = time.perf_counter()
        res, _ = rapid(str(p))
        p_ms = (time.perf_counter() - t0) * 1000
        p_lines = [dict(text=r[1], score=float(r[2]), box=[[float(x), float(y)] for x, y in r[0]]) for r in (res or [])]
        p_text = "\n".join(l["text"] for l in p_lines)
        # Tesseract
        tess, t_ms = run_tesseract(p)
        # Barcodes
        t0 = time.perf_counter()
        bcs = zxingcpp.read_barcodes(Image.open(p))
        b_ms = (time.perf_counter() - t0) * 1000
        found = [dict(format=str(b.format).split(".")[-1], text=b.text, content_type=str(b.content_type).split(".")[-1], symbology=b.symbology_identifier) for b in bcs]
        want = t["barcodes"]
        # ZXing reports UPC-A as EAN-13 with a leading "0"; GS1 group separators may be omitted.
        clean = lambda x: x.replace("\x1d", "").replace("<GS>", "").lstrip("0")
        b_ok = all(any(clean(f["text"]) == clean(w["content"]) for f in found) for w in want)
        th3, th11 = field_hits(tess["psm3"], t), field_hits(tess["psm11"], t)
        best_t = th3 if sum(bool(v) for v in th3.values()) >= sum(bool(v) for v in th11.values()) else th11
        rows.append(dict(file=t["file"], kind=t["kind"], quality=t["quality"],
                         paddle=dict(ms=round(p_ms), hits=field_hits(p_text, t), lines=p_lines),
                         tesseract=dict(ms=round(t_ms), hits=best_t, text_psm3=tess["psm3"], text_psm11=tess["psm11"]),
                         zxing=dict(ms=round(b_ms), found=found, expected_ok=b_ok)))
        print(f"{t['file']:48s} paddle {round(p_ms):5d}ms {field_hits(p_text, t)}  tess {round(t_ms):5d}ms {best_t}  zxing {b_ok}")
    Path(out_json).write_text(json.dumps(dict(images=str(images), truth=truth, results=rows), indent=1) + "\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
