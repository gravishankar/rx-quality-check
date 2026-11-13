# Extended drug list — how to rebuild

Reproducible pipeline behind `data/proposals/` (method in `data/proposals/EXTENDED_DRUG_LIST.md`).
Network: data.cms.gov, rxnav.nlm.nih.gov, api.fda.gov. FDA and NIH data change daily, so a re-run on a
later date can differ; every output records its date.

```bash
curl -o /tmp/geo23.csv "https://data.cms.gov/sites/default/files/2025-04/9fe6b8a6-0cb9-4b7c-9760-87800da010a8/MUP_DPR_RY25_P04_V10_DY23_Geo.csv"
```

```bash
python3 -I scripts/catalog/step1_rank_and_map.py /tmp/geo23.csv build/catalog/rxcache build/catalog/step1.json 200
```

```bash
python3 -I scripts/catalog/step2_fda_scope.py build/catalog/step1.json build/catalog/fdacache build/catalog/step2.json
```

```bash
python3 -I scripts/catalog/step3_build_catalog.py build/catalog/step2.json data/proposals/ingredient_aliases.json data/proposals/drug_catalog_0.3.0-proposed.json build/catalog/review.json
```

```bash
NODE_USE_ENV_PROXY=1 npx tsx scripts/catalog/step4_app_check.ts build/catalog/step2.json data/proposals/drug_catalog_0.3.0-proposed.json build/catalog/review.json
```

```bash
python3 -I scripts/catalog/step4b_search_gaps.py build/catalog
```

Re-run step 3 (it reads `build/catalog/name_gaps.json` and switches off drugs whose recall search
would find fewer records than the ingredient name), then step 4 again to confirm, then:

```bash
python3 -I scripts/catalog/step5_report.py build/catalog data/proposals
```

```bash
npm run config:validate -- --catalog-file data/proposals/drug_catalog_0.3.0-proposed.json
```
