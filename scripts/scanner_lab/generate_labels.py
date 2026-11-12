#!/usr/bin/env python3
"""
Task 4C scanner lab: generate REPRESENTATIVE SYNTHETIC medication labels for OCR/barcode evaluation.

- Drug facts (NDC, labeler, ingredient, strength, form) are REAL public values from the recorded
  openFDA responses (tests/fixtures/task3/cassette.json). Lot JKU4639A is the real lot listed in
  recall D-0325-2021.
- Everything about a patient, pharmacy, prescriber, Rx number, phone, address and date is SYNTHETIC.
- Images are NOT committed (CLAUDE.md §7). They are written to the output directory given on the
  command line; the ground truth is written next to them and a copy is committed as
  tests/fixtures/scanner/ground_truth.json.

Deterministic: the same seed produces the same images.

  python3 scripts/scanner_lab/generate_labels.py <out_dir>
"""
import json
import math
import random
import sys
from pathlib import Path

import zxingcpp
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTS = {
    "mono": "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "monob": "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "sans": "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "sansb": "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "free": "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    "freeb": "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
}

# REAL drug facts (openFDA NDC Directory, recorded 2026-11-12).
DRUGS = [
    dict(id="metformin_er", ndc10="62756-142-02", ndc11="62756-0142-02", line="METFORMIN HCL ER 500 MG TAB", name="METFORMIN", strength="500 MG", form="TABLET",
         mfr="SUN PHARMA", labeler="Sun Pharmaceutical Industries, Inc.", stock_title="Metformin Hydrochloride Extended-Release Tablets, USP", stock_strength="500 mg", lot="JKU4639A", exp="08/2027"),
    dict(id="rosuvastatin", ndc10="82009-018-10", ndc11="82009-0018-10", line="ROSUVASTATIN CALCIUM 10 MG TAB", name="ROSUVASTATIN", strength="10 MG", form="TABLET",
         mfr="QUALLENT", labeler="Quallent Pharmaceuticals Health LLC", stock_title="Rosuvastatin Calcium Tablets", stock_strength="10 mg", lot=None, exp=None),
    dict(id="warfarin", ndc10="67046-2072-3", ndc11="67046-2072-03", line="WARFARIN SODIUM 1 MG TAB", name="WARFARIN", strength="1 MG", form="TABLET",
         mfr="COUPLER", labeler="Coupler LLC", stock_title="Warfarin Sodium Tablets, USP", stock_strength="1 mg", lot=None, exp=None),
    dict(id="furosemide_sol", ndc10="68094-756-62", ndc11="68094-0756-62", line="FUROSEMIDE 10 MG/ML ORAL SOLN", name="FUROSEMIDE", strength="10 MG/ML", form="ORAL SOLUTION",
         mfr="PRECISION DOSE", labeler="Precision Dose Inc.", stock_title="Furosemide Oral Solution", stock_strength="40 mg/4 mL", lot=None, exp=None),
    dict(id="levothyroxine", ndc10="68788-8793-3", ndc11="68788-8793-03", line="LEVOTHYROXINE SOD 175 MCG TAB", name="LEVOTHYROXINE", strength="175 MCG", form="TABLET",
         mfr="PREFERRED PHARM", labeler="Preferred Pharmaceuticals Inc.", stock_title="Levothyroxine Sodium Tablets, USP", stock_strength="175 mcg", lot=None, exp=None),
    dict(id="sertraline", ndc10="68180-353-09", ndc11="68180-0353-09", line="SERTRALINE HCL 100 MG TAB", name="SERTRALINE", strength="100 MG", form="TABLET",
         mfr="LUPIN", labeler="Lupin Pharmaceuticals, Inc.", stock_title="Sertraline Hydrochloride Tablets, USP", stock_strength="100 mg", lot=None, exp=None),
]

# SYNTHETIC patient/pharmacy details (fictional 555 numbers, placeholder ZIP).
PATIENTS = ["JANE SYNTHETIC-PATIENT", "JOHN Q EXAMPLE", "ALEX TESTPERSON", "SAM SAMPLE", "PAT PLACEHOLDER", "RIVER DEMO"]
DIRECTIONS = [
    "TAKE 1 TABLET BY MOUTH DAILY WITH EVENING MEAL",
    "TAKE ONE TABLET BY MOUTH AT BEDTIME",
    "TAKE 1 TABLET BY MOUTH ONCE DAILY AS DIRECTED",
    "TAKE 4 ML BY MOUTH TWICE DAILY",
    "TAKE 1 TABLET EVERY MORNING ON AN EMPTY STOMACH",
    "TAKE 1 TABLET BY MOUTH DAILY",
]


def font(key, size):
    return ImageFont.truetype(FONTS[key], size)


def upc_for_ndc(ndc10):
    """UPC-A for an NDC: '3' + 10-digit NDC + check digit (GS1 mod-10)."""
    d = "3" + ndc10.replace("-", "")
    s = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(d))
    return d + str((10 - s % 10) % 10)


def gtin14_for_ndc(ndc10):
    body = "0" + "03" + ndc10.replace("-", "")
    s = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(body))
    return body + str((10 - s % 10) % 10)


def barcode_img(fmt, content, scale=3):
    bc = zxingcpp.create_barcode(content, fmt)
    img = zxingcpp.write_barcode_to_image(bc, scale=scale, add_hrt=False, add_quiet_zones=True)
    return Image.fromarray(img).convert("RGB")


def pharmacy_label(d, rnd, ndc_style, include_ndc=True, include_mfr=True):
    W, H = 1500, 760
    im = Image.new("RGB", (W, H), "white")
    g = ImageDraw.Draw(im)
    fk = rnd.choice(["mono", "sans", "free"])
    fb = {"mono": "monob", "sans": "sansb", "free": "freeb"}[fk]
    rx = f"{rnd.randint(6000000, 7999999)}"
    store = rnd.randint(1000, 9999)
    patient = rnd.choice(PATIENTS)
    y = 24
    g.text((30, y), f"SYNTHETIC PHARMACY #{store}", font=font(fb, 40), fill="black"); y += 52
    g.text((30, y), f"100 EXAMPLE ST, SPRINGFIELD  (555) 01{rnd.randint(0,9)}-{rnd.randint(1000,9999)}", font=font(fk, 28), fill="black"); y += 46
    g.text((30, y), f"Rx# {rx}    DATE: 10/{rnd.randint(10,28)}/2026", font=font(fb, 36), fill="black"); y += 54
    g.text((30, y), patient, font=font(fb, 40), fill="black"); y += 56
    g.text((30, y), d_dir(d, rnd), font=font(fk, 30), fill="black"); y += 56
    g.text((30, y), d["line"], font=font(fb, 44), fill="black"); y += 60
    ndc_text = {"11h": f"NDC {d['ndc11']}", "10h": f"NDC: {d['ndc10']}", "11u": f"NDC#{d['ndc11'].replace('-', '')}"}[ndc_style]
    parts = []
    if include_mfr:
        parts.append(f"MFG: {d['mfr']}")
    if include_ndc:
        parts.append(ndc_text)
    if parts:
        g.text((30, y), "   ".join(parts), font=font(fk, 34), fill="black"); y += 52
    g.text((30, y), f"QTY: {rnd.choice([30, 60, 90])}   REFILLS: {rnd.randint(0, 5)}   DR. A. EXAMPLE", font=font(fk, 30), fill="black"); y += 46
    g.text((30, y), "DISCARD AFTER: 10/14/2027", font=font(fk, 28), fill="black")
    bc = barcode_img(zxingcpp.BarcodeFormat.Code128, rx, scale=3).resize((420, 110))
    im.paste(bc, (W - 470, 40))
    truth = dict(kind="pharmacy_label", drug_id=d["id"], name=d["name"], strength=d["strength"], form=d["form"],
                 ndc_printed=ndc_text if include_ndc else None, ndc10=d["ndc10"] if include_ndc else None,
                 mfr=d["mfr"] if include_mfr else None, lot=None, rx_number=rx, patient=patient,
                 barcodes=[dict(format="Code128", content=rx, is_ndc=False)])
    return im, truth


def d_dir(d, rnd):
    return "TAKE 4 ML BY MOUTH TWICE DAILY" if d["form"] == "ORAL SOLUTION" else rnd.choice([x for x in DIRECTIONS if "ML" not in x])


def stock_label(d, rnd):
    W, H = 1400, 700
    im = Image.new("RGB", (W, H), "white")
    g = ImageDraw.Draw(im)
    fk = rnd.choice(["sans", "free"])
    fb = {"sans": "sansb", "free": "freeb"}[fk]
    y = 30
    g.text((40, y), f"NDC {d['ndc10']}", font=font(fb, 46), fill="black"); y += 70
    g.text((40, y), d["stock_title"], font=font(fb, 40), fill="black"); y += 60
    g.text((40, y), d["stock_strength"], font=font(fb, 64), fill="black"); y += 90
    g.text((40, y), "Rx only        100 Tablets" if d["form"] != "ORAL SOLUTION" else "Rx only        500 mL", font=font(fk, 34), fill="black"); y += 60
    if d["lot"]:
        g.text((40, y), f"Lot: {d['lot']}     Exp: {d['exp']}", font=font(fk, 34), fill="black"); y += 56
    g.text((40, y), f"Manufactured for: {d['labeler']}", font=font(fk, 28), fill="black")
    upc = upc_for_ndc(d["ndc10"])
    bc = barcode_img(zxingcpp.BarcodeFormat.UPCA, upc, scale=4).resize((440, 200))
    im.paste(bc, (W - 490, 40))
    truth = dict(kind="stock_bottle", drug_id=d["id"], name=d["name"], strength=d["strength"], form=d["form"],
                 ndc_printed=f"NDC {d['ndc10']}", ndc10=d["ndc10"], mfr=None, lot=d["lot"], rx_number=None, patient=None,
                 barcodes=[dict(format="UPCA", content=upc, is_ndc=True)])
    return im, truth


def carton(d, rnd):
    W, H = 1400, 640
    im = Image.new("RGB", (W, H), (245, 245, 240))
    g = ImageDraw.Draw(im)
    g.text((40, 40), d["stock_title"], font=font("sansb", 42), fill="black")
    g.text((40, 110), d["stock_strength"], font=font("sansb", 60), fill="black")
    g.text((40, 200), f"NDC {d['ndc10']}", font=font("sans", 38), fill="black")
    gtin = gtin14_for_ndc(d["ndc10"])
    serial = f"SYN{rnd.randint(100000, 999999)}"
    lot = d["lot"] or f"SYNLOT{rnd.randint(10, 99)}"
    exp = "270831"
    hri = [f"GTIN: {gtin}", f"EXP: {exp[2:4]}/20{exp[:2]}", f"LOT: {lot}", f"SN: {serial}"]
    for i, t in enumerate(hri):
        g.text((40, 300 + i * 50), t, font=font("mono", 34), fill="black")
    content = f"01{gtin}17{exp}10{lot}\x1d21{serial}"
    bc = barcode_img(zxingcpp.BarcodeFormat.DataMatrix, content, scale=10).resize((300, 300), Image.NEAREST)
    im.paste(bc, (W - 360, 260))
    truth = dict(kind="carton", drug_id=d["id"], name=d["name"], strength=d["strength"], form=d["form"],
                 ndc_printed=f"NDC {d['ndc10']}", ndc10=d["ndc10"], mfr=None, lot=lot, lot_is_synthetic=d["lot"] is None,
                 rx_number=None, patient=None, barcodes=[dict(format="DataMatrix", content=content, is_ndc=True, gtin=gtin, serial_synthetic=serial)])
    return im, truth


def degrade(im, level, rnd, amber):
    """Simulate a phone photo: label on a container, rotation, perspective, blur, light gradient, JPEG."""
    W, H = im.size
    bg = (190, 120, 40) if amber else (120, 120, 120)
    canvas = Image.new("RGB", (int(W * 1.3), int(H * 1.5)), bg)
    canvas.paste(im, ((canvas.width - W) // 2, (canvas.height - H) // 2))
    im = canvas
    if level == 0:
        return im.resize((im.width * 3 // 4, im.height * 3 // 4)), "clean"
    angle = rnd.uniform(-3, 3) if level == 1 else rnd.uniform(-8, 8)
    im = im.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=bg)
    if level >= 2 and amber:
        im = cylinder(im, strength=0.18)
    w, h = im.size
    k = 0.03 if level == 1 else 0.08
    quad = [rnd.uniform(0, k) * w, rnd.uniform(0, k) * h, rnd.uniform(0, k) * w, h - rnd.uniform(0, k) * h,
            w - rnd.uniform(0, k) * w, h - rnd.uniform(0, k) * h, w - rnd.uniform(0, k) * w, rnd.uniform(0, k) * h]
    im = im.transform((w, h), Image.QUAD, quad, resample=Image.BICUBIC, fillcolor=bg)
    im = im.filter(ImageFilter.GaussianBlur(0.8 if level == 1 else 1.6))
    grad = Image.linear_gradient("L").resize((w, h)).rotate(rnd.choice([0, 90, 180, 270]))
    light = Image.new("RGB", (w, h), (255, 255, 255))
    im = Image.composite(light, im, grad.point(lambda v: int(v * (0.18 if level == 1 else 0.35))))
    scale = 0.7 if level == 1 else 0.55
    im = im.resize((int(w * scale), int(h * scale)), Image.BILINEAR)
    return im, "mild" if level == 1 else "hard"


def cylinder(im, strength):
    """Horizontal compression toward the edges, like a label wrapped around a vial."""
    w, h = im.size
    out = Image.new("RGB", (w, h), im.getpixel((0, 0)))
    strips = 60
    for i in range(strips):
        x0, x1 = i * w // strips, (i + 1) * w // strips
        t0, t1 = (x0 / w) * 2 - 1, (x1 / w) * 2 - 1
        m0 = (math.asin(t0 * (1 - strength)) / math.asin(1 - strength) + 1) / 2 * w
        m1 = (math.asin(t1 * (1 - strength)) / math.asin(1 - strength) + 1) / 2 * w
        if int(m1) <= int(m0):
            continue
        out.paste(im.crop((x0, 0, x1, h)).resize((int(m1) - int(m0), h)), (int(m0), 0))
    return out


def main(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rnd = random.Random(20261112)
    truth = []
    n = 0

    def save(im, t, level, amber):
        nonlocal n
        img, lvl = degrade(im, level, rnd, amber)
        n += 1
        name = f"{n:02d}_{t['kind']}_{t['drug_id']}_{lvl}.jpg"
        img.save(out / name, quality=72 if lvl == "hard" else 85)
        t = dict(t, file=name, quality=lvl, synthetic_note="SYNTHETIC label; real public drug codes")
        truth.append(t)

    styles = ["11h", "10h", "11u"]
    for i, d in enumerate(DRUGS):
        for level in (0, 1, 2):
            im, t = pharmacy_label(d, rnd, styles[(i + level) % 3])
            save(im, t, level, amber=True)
    for d in DRUGS[:2]:
        for level in (1, 2):
            im, t = pharmacy_label(d, rnd, "10h", include_ndc=False)
            save(im, t, level, amber=True)
    for d in (DRUGS[0], DRUGS[1], DRUGS[4]):
        for level in (1, 2):
            im, t = stock_label(d, rnd)
            save(im, t, level, amber=False)
    for d in (DRUGS[0], DRUGS[5]):
        for level in (1, 2):
            im, t = carton(d, rnd)
            save(im, t, level, amber=False)
    (out / "ground_truth.json").write_text(json.dumps(truth, indent=1) + "\n")
    print(f"{n} images -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "scanner-lab-images")
