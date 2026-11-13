#!/usr/bin/env python3
"""
Extended drug list, step 2: for each RxNorm-mapped candidate from step 1, check FDA's NDC Directory
(openFDA) for oral prescription products with exactly that ingredient set, record their dosage
forms and FDA pharmacologic classes, keep one real product as an exemplar, and count recall records
the app's ingredient-name search finds (openFDA enforcement). Writes build/catalog/step2.json.
  python3 -I scripts/catalog/step2_fda_scope.py <step1.json> <cache_dir> <out.json>
"""
import hashlib, json, sys, time, urllib.parse, urllib.request, urllib.error
from pathlib import Path

FDA = "https://api.fda.gov/drug"

def get(url, cache):
    key = hashlib.sha256(url.encode()).hexdigest()[:24]
    f = cache / f"{key}.json"
    if f.exists():
        return json.loads(f.read_text())["body"]
    body = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                body = json.loads(r.read().decode()); break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                body = {"meta": {"results": {"total": 0}}, "results": []}; break  # openFDA "no matches"
            time.sleep(3 * (attempt + 1))
        except Exception:
            time.sleep(3 * (attempt + 1))
    if body is None:
        raise SystemExit(f"failed: {url}")
    f.write_text(json.dumps({"url": url, "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "body": body}))
    time.sleep(0.3)
    return body

def q(s):
    return urllib.parse.quote(s, safe="")

# Salt and hydrate words that may follow an ingredient name in FDA records without changing the drug.
SALT_WORDS = {"hydrochloride", "hcl", "dihydrochloride", "hydrobromide", "sodium", "potassium", "calcium", "magnesium",
    "besylate", "maleate", "mesylate", "succinate", "tartrate", "bitartrate", "fumarate", "citrate", "sulfate", "bisulfate",
    "phosphate", "acetate", "propionate", "oxalate", "bromide", "chloride", "hyclate", "gluconate", "tromethamine",
    "medoxomil", "axetil", "pamoate", "carbonate", "propanediol", "hippurate", "benzoate", "anhydrous", "monohydrate",
    "dihydrate", "trihydrate", "hemihydrate", "sesquihydrate", "disodium", "dipotassium", "trihydrate,", "usp"}

def ing_of(active_name, ings):
    """Which candidate ingredient (IN) an openFDA active-ingredient name denotes, else None.
    Exact IN or salt (PIN) name, or the IN name followed only by salt/hydrate words: so
    "ISOSORBIDE DINITRATE" is NOT read as the ingredient "isosorbide"."""
    a = " ".join(active_name.upper().replace(",", " ").split())
    for i in ings:
        names = [i["name"].upper()] + [p["name"].upper() for p in i["precise_ingredients"]]
        if a in names:
            return i["rxcui"]
        n = i["name"].upper()
        if a.startswith(n + " ") and all(w.lower() in SALT_WORDS for w in a[len(n) + 1:].split()):
            return i["rxcui"]
    return None

def main(step1, cache_dir, out):
    d = json.loads(Path(step1).read_text()); cache = Path(cache_dir); cache.mkdir(parents=True, exist_ok=True)
    for row in d["rows"]:
        if row["mapping"] != "VERIFIED":
            continue
        ings = row["ingredients"]
        # Each ingredient may appear in FDA records under its RxNorm name or any salt (PIN) name.
        def alt(i):
            names = [i["name"]] + [p["name"] for p in i["precise_ingredients"]]
            return "(" + " OR ".join(f'active_ingredients.name:"{n.upper()}"' for n in names) + ")"
        terms = " AND ".join(alt(i) for i in ings)
        base = f'{terms} AND product_type:"HUMAN PRESCRIPTION DRUG"'
        oral = get(f"{FDA}/ndc.json?search={q(base + ' AND route:\"ORAL\"')}&limit=1000", cache)
        anyroute = get(f"{FDA}/ndc.json?search={q(base)}&limit=1", cache)
        exact = []
        for p in oral.get("results", []):
            got = {ing_of(a.get("name", ""), ings) for a in p.get("active_ingredients", [])}
            if None not in got and got == {i["rxcui"] for i in ings}:
                exact.append(p)
        forms, epc, salts = {}, set(), set()
        for p in exact:
            forms[p.get("dosage_form", "")] = forms.get(p.get("dosage_form", ""), 0) + 1
            epc.update(c for c in p.get("pharm_class", []) if c.endswith("[EPC]"))
            salts.update(a["name"] for a in p.get("active_ingredients", []))
        # Exemplar: prefer a product whose ingredient names carry the salt CMS names (e.g. "Metoprolol
        # Succinate" must not be checked with a tartrate product).
        words = {w for w in row["cms_generic_name"].upper().replace("/", " ").split() if len(w) > 3}
        def salt_fit(p):
            names = " ".join(a.get("name", "") for a in p.get("active_ingredients", [])).upper()
            return -sum(w in names for w in words)
        ex = sorted(exact, key=lambda p: (salt_fit(p), p.get("marketing_category") != "ANDA", p["product_ndc"]))
        row["fda"] = {
            "oral_rx_products_any_set": oral.get("meta", {}).get("results", {}).get("total", 0),
            "oral_rx_products_exact_set_in_sample": len(exact),
            "sample_size": len(oral.get("results", [])),
            "rx_products_any_route": anyroute.get("meta", {}).get("results", {}).get("total", 0),
            "dosage_forms": dict(sorted(forms.items(), key=lambda x: -x[1])),
            "pharm_class_epc": sorted(epc),
            "active_ingredient_names_seen": sorted(salts),
            "exemplar": None if not ex else {k: ex[0].get(k) for k in ("product_ndc", "generic_name", "brand_name", "labeler_name", "dosage_form", "route", "marketing_category", "active_ingredients", "pharm_class", "packaging")},
        }
        # Recall search path: the app searches recall text by ingredient name.
        rterms = " AND ".join(f'product_description:"{i["name"]}"' for i in ings)
        rec = get(f"{FDA}/enforcement.json?search={q(rterms)}&limit=1&sort=report_date:desc", cache)
        row["fda"]["recall_records_by_name"] = rec.get("meta", {}).get("results", {}).get("total", 0)
        row["fda"]["latest_recall_report_date"] = (rec.get("results") or [{}])[0].get("report_date")
        print(row["cms_rank"], row["cms_generic_name"], "exact oral Rx:", len(exact), "/", row["fda"]["oral_rx_products_any_set"], "recalls:", row["fda"]["recall_records_by_name"], flush=True)
    Path(out).write_text(json.dumps(d, indent=1))

if __name__ == "__main__":
    main(*sys.argv[1:])
