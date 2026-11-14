#!/usr/bin/env python3
"""Extended drug list, step 8: assign each proposed drug to an activation stage by objective criteria
(steps 4-7 outputs). Writes data/proposals/activation_stages.json and prints the plan.
  python3 -I scripts/catalog/step8_stages.py build/catalog data/proposals"""
import json, sys
from pathlib import Path

CLINICAL_REVIEW = {"methotrexate": "immunosuppressant used outside transplant; not covered by the transplant criterion (team review)"}

def main(build, out):
    b = Path(build)
    review = {r["drug_id"]: r for r in json.loads((b / "review.json").read_text()) if r.get("drug_id")}
    prod = {r["drug_id"]: r for r in json.loads((b / "product_review.json").read_text())}
    cov = {r["drug_id"]: r for r in json.loads((b / "coverage.json").read_text())}
    rows = json.loads((b / "products_by_row.json").read_text())
    total = json.loads((b / "step1.json").read_text())["source"]["total_claims_all_drugs"]
    cat = json.loads(Path("data/proposals/drug_catalog_0.3.0-proposed.json").read_text())
    drugs = {d["id"]: d for d in cat["drugs"]}
    plan = []
    for did, rv in sorted(review.items(), key=lambda x: x[1]["rank"]):
        if rv["decision"] == "EXISTING":
            continue
        d = drugs[did]; p = prod[did]; c = cov[did]
        # DEA schedule from products with exactly this ingredient set only (not combinations).
        sched = sorted(k for k in p.get("dea_schedule", {}) if k != "none")
        combo = len(d["ingredients"]) > 1
        releases = sorted(k for k, v in p["release"].items() if v and k != "UNSPECIFIED")
        liquid = (p["forms"].get("SOLUTION", 0) + p["forms"].get("SUSPENSION", 0)) > p["products"] / 2
        other_form = p["forms"].get("OTHER", 0) > p["products"] / 2
        exceptions = sum(p["needs_clarification"].values()) + sum(p["unsupported"].values()) + sum(p["excluded"].values())
        mostly_oral = c["oral_share"] >= 0.5
        reasons = []
        if d["status"] == "INACTIVE":
            stage = 4; reasons.append(d["notes"].split("INACTIVE: ")[-1].rstrip("."))
        else:
            if sched: reasons.append(f"controlled substance ({', '.join(sched)})")
            if did in CLINICAL_REVIEW: reasons.append(CLINICAL_REVIEW[did])
            if not mostly_oral: reasons.append(f"most FDA prescription products are not oral-only ({100*c['oral_share']:.0f}% oral)")
            if other_form: reasons.append("mostly a dose form the app reads as 'other' (e.g. tongue spray)")
            if reasons:
                stage = 3
            else:
                if combo: reasons.append("combination product")
                if len(releases) > 1: reasons.append(f"release types {'/'.join(releases)} (app asks when the label does not say)")
                if liquid: reasons.append("mostly liquids")
                if exceptions: reasons.append(f"{exceptions} FDA products get a cautious answer (needs clarification / not covered)")
                stage = 2 if reasons else 1
                if stage == 1: reasons.append("single ingredient, oral tablets/capsules, one release type, every FDA product matched")
        plan.append({"stage": stage, "rank": rv["rank"], "drug_id": did, "claims": rv["claims_2023"], "oral_share": c["oral_share"], "reasons": reasons})
    Path(out, "activation_stages.json").write_text(json.dumps(plan, indent=1))
    for s in (1, 2, 3, 4):
        ps = [x for x in plan if x["stage"] == s]
        up = sum(x["claims"] for x in ps) / total * 100; w = sum(x["claims"] * x["oral_share"] for x in ps) / total * 100
        print(f"Stage {s}: {len(ps)} drugs; +{up:.1f}% of all Part D claims (oral-weighted +{w:.1f}%)")
    return plan

if __name__ == "__main__":
    main(*sys.argv[1:])
