#!/usr/bin/env python3
"""
Extended drug list, step 1: rank CMS Part D 2023 generic names by total claims and map each to
RxNorm ingredients, verified exactly on RxNav. Writes build/catalog/step1.json.

Inputs (pinned): CMS "Medicare Part D Prescribers - by Geography and Drug", data year 2023
(MUP_DPR_RY25_P04_V10_DY23_Geo.csv, SHA-256 below), National rows only.
  python3 -I scripts/catalog/step1_rank_and_map.py <geo23.csv> <cache_dir> <out.json> [top_n]
"""
import csv, collections, hashlib, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

CMS_SHA = "876ff262c8a3eb0b8fca312f2004f14d42a8bfd01829e0695d64e34b5191f4f8"
RXNAV = "https://rxnav.nlm.nih.gov/REST"

# CMS truncates long generic names and abbreviates salts. Each override maps a CMS name to the
# RxNorm ingredient names it denotes; every one is still verified exactly on RxNav below.
OVERRIDES = {
    "Amoxicillin/Potassium Clav": ["amoxicillin", "clavulanate"],
    "Fluticasone/Umeclidin/Vilanter": ["fluticasone", "umeclidinium", "vilanterol"],
    "Fluticasone Propion/Salmeterol": ["fluticasone", "salmeterol"],
    "Dorzolamide Hcl/Timolol Maleat": ["dorzolamide", "timolol"],
    "Triamterene/Hydrochlorothiazid": ["triamterene", "hydrochlorothiazide"],
    "Bictegrav/Emtricit/Tenofov Ala": ["bictegravir", "emtricitabine", "tenofovir alafenamide"],
    "Budesonide/Glycopyr/Formoterol": ["budesonide", "glycopyrronium", "formoterol"],
    "Umeclidinium Brm/Vilanterol Tr": ["umeclidinium", "vilanterol"],
    "Tiotropium Br/Olodaterol Hcl": ["tiotropium", "olodaterol"],
    "Neomycin/Polymyxin B/Dexametha": ["neomycin", "polymyxin B", "dexamethasone"],
    "Clotrimazole/Betamethasone Dip": ["clotrimazole", "betamethasone"],
    "Butalb/Acetaminophen/Caffeine": ["butalbital", "acetaminophen", "caffeine"],
    "Peg3350/Sod Sulf,bicarb,cl/Kcl": ["polyethylene glycol 3350", "sodium sulfate", "sodium bicarbonate", "sodium chloride", "potassium chloride"],
    "Sodium, Potassium,mag Sulfates": ["sodium sulfate", "potassium sulfate", "magnesium sulfate"],
    "Insulin Glargine,hum.Rec.Anlog": ["insulin glargine"],
    "Insulin Nph Hum/Reg Insulin Hm": ["insulin isophane, human", "insulin, regular, human"],
    "Insulin Nph Human Isophane": ["insulin isophane, human"],
    "Insulin Regular, Human": ["insulin, regular, human"],
    "Varicella-Zoster Ge/As01b/Pf": None, "Rsvpref3 Antigen/As01e/Pf": None,
    "Rsv Vacc, Pref A And Pref B/Pf": None, "Diphth,pertuss(Acell),tet Vac": None,
    "Pen Needle, Diabetic": None, "Alcohol Antiseptic Pads": None, "Syringe And Needle,insulin,1ml": None,
    "Lipase/Protease/Amylase": ["pancrelipase"],
    "Acetaminophen With Codeine": ["acetaminophen", "codeine"],
    "Ergocalciferol (Vitamin D2)": ["ergocalciferol"],
    "Estrogens, Conjugated": ["estrogens, conjugated (USP)"],
    "Omega-3 Acid Ethyl Esters": ["omega-3 acid ethyl esters (USP)"],
    "Fenofibrate Nanocrystallized": ["fenofibrate"],
    "Nitrofurantoin Monohyd/M-Cryst": ["nitrofurantoin"],
    "Nitrofurantoin Macrocrystal": ["nitrofurantoin"],
    "Dextroamphetamine/Amphetamine": ["dextroamphetamine", "amphetamine"],
    "Phenytoin Sodium Extended": ["phenytoin"],
    "Buprenorphine Hcl/Naloxone Hcl": ["buprenorphine", "naloxone"],
    "Amlodipine Besylate/Benazepril": ["amlodipine", "benazepril"],
    "Sitagliptin Phos/Metformin Hcl": ["sitagliptin", "metformin"],
    "Diphenoxylate Hcl/Atropine": ["diphenoxylate", "atropine"],
    "Pramipexole Di-Hcl": ["pramipexole"],
    "Ipratropium/Albuterol Sulfate": ["ipratropium", "albuterol"],
    "Brimonidine Tartrate/Timolol": ["brimonidine", "timolol"],
    "Dabigatran Etexilate Mesylate": ["dabigatran etexilate"],
    "Nirmatrelvir/Ritonavir": ["nirmatrelvir", "ritonavir"],
    "Sacubitril/Valsartan": ["sacubitril", "valsartan"],
}
SALT_WORDS = r"\b(hcl|hydrochloride|di-hcl|dihydrochloride|hydrobromide|hbr|sodium|potassium|calcium|magnesium|besylate|maleate|mesylate|succinate|tartrate|fumarate|citrate|sulfate|bisulfate|phosphate|acetate|acetonide|propionate|furoate|dipropionate|oxalate|bromide|chloride|monohydrate|hyclate|gluconate|tromethamine|medoxomil|axetil|pamoate|carbonate|propanediol|hippurate|benzoate|ethyl|extended|di|ala|nanocrystallized)\b"

def get(url, cache):
    key = hashlib.sha256(url.encode()).hexdigest()[:24]
    f = cache / f"{key}.json"
    if f.exists():
        return json.loads(f.read_text())["body"]
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                body = json.loads(r.read().decode())
            break
        except Exception:
            time.sleep(2 * (attempt + 1))
    else:
        raise SystemExit(f"failed: {url}")
    f.write_text(json.dumps({"url": url, "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "body": body}))
    time.sleep(0.05)
    return body

def exact_in(name, cache):
    """RxNorm concept for an exact name: returns (rxcui, name, tty) of the IN (following PIN -> IN)."""
    b = get(f"{RXNAV}/rxcui.json?name={urllib.parse.quote(name)}&search=0", cache)
    ids = (b.get("idGroup") or {}).get("rxnormId") or []
    for rx in ids:
        p = get(f"{RXNAV}/rxcui/{rx}/properties.json", cache).get("properties") or {}
        if p.get("tty") in ("IN", "MIN"):
            return rx, p["name"], p["tty"]
        if p.get("tty") == "PIN":
            rel = get(f"{RXNAV}/rxcui/{rx}/related.json?tty=IN", cache)
            for g in rel["relatedGroup"].get("conceptGroup", []):
                for c in g.get("conceptProperties", []) or []:
                    return c["rxcui"], c["name"], "IN"
    return None

def pins(rx, cache):
    rel = get(f"{RXNAV}/rxcui/{rx}/related.json?tty=PIN", cache)
    out = []
    for g in rel["relatedGroup"].get("conceptGroup", []):
        for c in g.get("conceptProperties", []) or []:
            out.append({"rxcui": c["rxcui"], "name": c["name"]})
    return sorted(out, key=lambda x: x["name"])

def candidates(cms):
    """Ingredient-name candidates for a CMS generic name: the name as written, then without salts."""
    parts = [p.strip() for p in cms.split("/")]
    out = []
    for p in parts:
        full = re.sub(r"\bHcl\b", "hydrochloride", p, flags=re.I).lower()
        bare = re.sub(r"\s+", " ", re.sub(SALT_WORDS, " ", p.lower())).strip()
        out.append([full, bare])
    return out

def main(csv_path, cache_dir, out, top_n=200):
    data = Path(csv_path).read_bytes()
    assert hashlib.sha256(data).hexdigest() == CMS_SHA, "CMS file checksum differs"
    cache = Path(cache_dir); cache.mkdir(parents=True, exist_ok=True)
    clm, fills, benes, brands = collections.Counter(), collections.Counter(), collections.Counter(), collections.defaultdict(set)
    for r in csv.DictReader(data.decode("utf-8", "replace").splitlines()):
        if r["Prscrbr_Geo_Lvl"] != "National":
            continue
        g = r["Gnrc_Name"].strip()
        clm[g] += int(float(r["Tot_Clms"] or 0)); fills[g] += float(r["Tot_30day_Fills"] or 0)
        brands[g].add(r["Brnd_Name"].strip())
    total = sum(clm.values())
    ranked = sorted(clm, key=lambda g: (-clm[g], g))[: int(top_n)]
    rows = []
    for rank, g in enumerate(ranked, 1):
        row = {"cms_rank": rank, "cms_generic_name": g, "claims_2023": clm[g], "fills_30day_2023": round(fills[g]),
               "share_of_all_claims": clm[g] / total, "cms_brand_names": sorted(brands[g])}
        if g in OVERRIDES and OVERRIDES[g] is None:
            row["mapping"] = "NOT_A_DRUG_INGREDIENT"; rows.append(row); continue
        names = [[n] for n in OVERRIDES[g]] if g in OVERRIDES else candidates(g)
        ings, failed = [], []
        for cand in names:
            hit = None
            for n in cand:
                hit = exact_in(n, cache)
                if hit: break
            (ings if hit else failed).append(hit if hit else cand)
        row["ingredients"] = [{"rxcui": h[0], "name": h[1], "tty": h[2], "precise_ingredients": pins(h[0], cache) if h[2] == "IN" else []} for h in ings]
        row["mapping"] = "VERIFIED" if not failed else "UNRESOLVED"
        row["unresolved_names"] = failed
        rows.append(row)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps({"source": {"dataset": "CMS Medicare Part D Prescribers - by Geography and Drug, data year 2023 (National rows)",
        "file": "MUP_DPR_RY25_P04_V10_DY23_Geo.csv", "sha256": CMS_SHA, "url": "https://data.cms.gov/sites/default/files/2025-04/9fe6b8a6-0cb9-4b7c-9760-87800da010a8/MUP_DPR_RY25_P04_V10_DY23_Geo.csv",
        "metric": "Tot_Clms summed over brand names per Gnrc_Name", "total_claims_all_drugs": total}, "rows": rows}, indent=1))
    bad = [r for r in rows if r["mapping"] == "UNRESOLVED"]
    print(f"{len(rows)} ranked; verified {sum(r['mapping']=='VERIFIED' for r in rows)}; not drugs {sum(r['mapping']=='NOT_A_DRUG_INGREDIENT' for r in rows)}; unresolved {len(bad)}")
    for r in bad: print("  UNRESOLVED", r["cms_rank"], r["cms_generic_name"], r["unresolved_names"])

if __name__ == "__main__":
    main(*sys.argv[1:])
