#!/usr/bin/env python3
"""Extended drug list, step 4b: for drugs where the app's recall-search name differs from the RxNorm
ingredient name (an unrecognised salt word), count FDA recall records found by each. Writes
build/catalog/name_gaps.json, read by step 3 (a smaller count switches the drug off until fix F1).
  python3 -I scripts/catalog/step4b_search_gaps.py build/catalog"""
import json, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

def count(q):
    u = "https://api.fda.gov/drug/enforcement.json?search=" + urllib.parse.quote(q) + "&limit=1"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(u, timeout=60) as r:
                return json.load(r)["meta"]["results"]["total"]
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 0
            time.sleep(2 * (attempt + 1))
    return "ERROR"

def main(build):
    b = Path(build)
    a = json.loads((b / "app_check.json").read_text()); s1 = json.loads((b / "step1.json").read_text())
    inn = {r["cms_generic_name"]: [i["name"] for i in r.get("ingredients", [])] for r in s1["rows"]}
    rows = []
    for x in a:
        if x["expected"] not in ("PROPOSED_ACTIVE", "EXISTING", "PROPOSED_INACTIVE"):
            continue
        ins = sorted(n.lower() for n in inn[x["cms"][0]]); ids = sorted(n.lower() for n in x["identity_names"])
        if ids != ins:
            c = count(" AND ".join(f'product_description:"{n}"' for n in ins)); time.sleep(0.25)
            rows.append([x["rank"], x["cms"][0], ids, ins, x["recall_records"], c])
            print(x["rank"], x["cms"][0], "app:", ids, x["recall_records"], "| ingredient:", ins, c)
    (b / "name_gaps.json").write_text(json.dumps(rows))

if __name__ == "__main__":
    main(*sys.argv[1:])
