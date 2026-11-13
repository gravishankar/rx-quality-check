#!/usr/bin/env python3
"""Extended drug list, step 7: reconcile counts and coverage. For each covered drug, the share of its
prescription products in FDA's NDC Directory that are oral (exact ingredient set, any route), used to
bound how much of a generic name's Part D claims the app can actually check. Writes
build/catalog/coverage.json and prints the reconciliation.
  python3 -I scripts/catalog/step7_coverage.py build/catalog <cache_dir>"""
import hashlib, json, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from step2_fda_scope import ing_of, get  # same matching rules and cache as step 2

def main(build, cache_dir):
    b = Path(build); cache = Path(cache_dir)
    s1 = json.loads((b / "step1.json").read_text()); total = s1["source"]["total_claims_all_drugs"]
    review = json.loads((b / "review.json").read_text())
    rows = {r["cms_generic_name"]: r for r in s1["rows"]}
    non_drug = sum(r["claims_2023"] for r in s1["rows"] if r["mapping"] == "NOT_A_DRUG_INGREDIENT")
    out = []
    for rv in review:
        if not rv.get("drug_id"):
            continue
        ings = []
        for n in rv["cms_names"]:
            for i in rows[n].get("ingredients", []):
                if i["rxcui"] not in {x["rxcui"] for x in ings}: ings.append(i)
        def alt(i):
            names = [i["name"]] + [p["name"] for p in i["precise_ingredients"]]
            return "(" + " OR ".join(f'active_ingredients.name:"{n.upper()}"' for n in names) + ")"
        q = " AND ".join(alt(i) for i in ings) + ' AND product_type:"HUMAN PRESCRIPTION DRUG"'
        body = get("https://api.fda.gov/drug/ndc.json?search=" + urllib.parse.quote(q, safe="") + "&limit=1000", cache)
        exact = [p for p in body.get("results", []) if (lambda got: None not in got and got == {i["rxcui"] for i in ings})({ing_of(a.get("name", ""), ings) for a in p.get("active_ingredients", [])})]
        oral = [p for p in exact if p.get("route") == ["ORAL"]]
        share = len(oral) / len(exact) if exact else 0.0
        capped = body.get("meta", {}).get("results", {}).get("total", 0) > 1000
        out.append({"rank": rv["rank"], "drug_id": rv["drug_id"], "decision": rv["decision"], "claims": rv["claims_2023"],
                    "rx_products_exact_any_route": len(exact), "oral_only_products": len(oral), "oral_share": round(share, 3), "sample_capped_at_1000": capped})
    (b / "coverage.json").write_text(json.dumps(out, indent=1))
    def cov(decisions, mode):
        rs = [x for x in out if x["decision"] in decisions]
        if mode == "upper": return sum(x["claims"] for x in rs)
        if mode == "weighted": return sum(x["claims"] * x["oral_share"] for x in rs)
        if mode == "mostly_oral": return sum(x["claims"] for x in rs if x["oral_share"] >= 0.5)
    print(f"denominator: all Part D claims {total:,}; of which vaccines/devices/supplies in the top 200: {non_drug:,}")
    for label, dec in (("current 14", {"EXISTING"}), ("+130 proposed active", {"EXISTING", "PROPOSED_ACTIVE"}), ("+17 switched off", {"EXISTING", "PROPOSED_ACTIVE", "PROPOSED_INACTIVE"})):
        print(f"{label:22} upper {100*cov(dec,'upper')/total:5.1f}% | oral-weighted estimate {100*cov(dec,'weighted')/total:5.1f}% | mostly-oral drugs only {100*cov(dec,'mostly_oral')/total:5.1f}%")
    low = sorted([x for x in out if x["decision"] in ("EXISTING", "PROPOSED_ACTIVE") and x["oral_share"] < 0.5], key=lambda x: -x["claims"])
    print("covered drugs whose FDA prescription products are mostly NOT oral-only:")
    for x in low: print(f"  {x['rank']} {x['drug_id']}: oral-only {x['oral_only_products']}/{x['rx_products_exact_any_route']} ({100*x['oral_share']:.0f}%), claims {x['claims']:,}")

if __name__ == "__main__":
    main(*sys.argv[1:])
