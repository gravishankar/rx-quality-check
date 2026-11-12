# Drug Catalog Guide

How to add, change, disable and validate supported drugs in `data/drug_catalog.json`, without
changing application code.

| Item | Location |
|---|---|
| Catalog (schema 2) | `data/drug_catalog.json` |
| JSON Schema | `data/schemas/drug_catalog.schema.json` |
| Runtime validation (authority) | `mobile/src/rules/catalog.ts` |
| Eligibility evaluation | `mobile/src/rules/exclusion.ts` (policy first, then catalog) |
| Worked example: a 15th drug | `data/examples/add_sertraline.catalog-fragment.json` |
| Exclusions (always win) | `data/exclusion_policy.json`, see `docs/EXCLUSION_POLICY_GUIDE.md` |

## 1. Structure

The catalog has two layers.

- **`ingredients`**: what an ingredient *is*:
  - a stable `id` and a normalized `name`;
  - the verified RxNorm ingredient RxCUI (`rxcui`, `null` if none is verified);
  - `aliases`;
  - the verified **precise ingredients** (salt forms, RxNorm PIN), and provenance.
- **`drugs`**: what the app *assesses*:
  - an exact set of ingredient ids (two or more for a combination product);
  - `status` (`ACTIVE` or `INACTIVE`);
  - prescription scope (`rx_scope`);
  - optional `restrictions` on routes, dose forms, release types, strengths and precise ingredients.

One RxCUI never stands for every salt, formulation or combination. Salt forms are listed as precise
ingredients. Formulation eligibility lives on the drug. A combination product is its own drug entry.

Matching an identity to the catalog:
1. Each identity ingredient is mapped to a catalog ingredient. The match is by RxCUI (IN or PIN) when the identity has one (filled from RxNav for directory-confirmed products). Otherwise it is by RxNorm name, alias or precise-ingredient name.
2. Drugs whose ingredient set equals the identity's set *exactly* are candidates.
3. Each `ACTIVE` candidate's restrictions are checked. Exactly one passing candidate means `ELIGIBLE`. More than one means `NEEDS_CLARIFICATION` (`CATALOG_AMBIGUOUS`).
4. All of this happens **after** the exclusion policy (`EXCLUSION_POLICY_GUIDE.md` §3). A catalog entry can never override an exclusion.

## 2. Rules for identifiers

- **Never rename or reuse a drug `id` or ingredient `id`.** Saved medications store `catalog_drug_id`. To retire an entry, set it `INACTIVE` (§6).
- **Only verified identifiers.** Each RxCUI must come from RxNav (`/REST/rxcui/{id}/properties.json` and `/related.json?tty=PIN`). Record the source and `verified_on` date. If no identifier can be verified, use `"rxcui": null`; the ingredient is then matched by name only.
- **Bump `catalog_version` and add a `change_log` entry** for every change. Saved assessments record the version they were made under.

## 3. Add a supported drug (example: sertraline as the 15th drug)

1. Verify identifiers on RxNav. For sertraline (2026-11-12, RxNorm 02-Nov-2026) these are IN `36437 sertraline` and PIN `155137 sertraline hydrochloride`:

```bash
curl -s https://rxnav.nlm.nih.gov/REST/rxcui/36437/properties.json
```

```bash
curl -s "https://rxnav.nlm.nih.gov/REST/rxcui/36437/related.json?tty=PIN"
```

2. Add the ingredient to `ingredients`:

```json
{
  "id": "sertraline",
  "name": "sertraline",
  "rxcui": "36437",
  "tty": "IN",
  "aliases": [],
  "precise_ingredients": [{ "rxcui": "155137", "name": "sertraline hydrochloride" }],
  "provenance": { "source": "RxNav /REST/rxcui/36437/properties.json and /related.json?tty=PIN", "verified_on": "2026-11-12" }
}
```

3. Add the drug to `drugs`. Restrictions are optional; here: tablets only, hydrochloride salt only.

```json
{
  "id": "sertraline",
  "display_name": "Sertraline",
  "status": "ACTIVE",
  "ingredients": ["sertraline"],
  "aliases": [],
  "rx_scope": "PRESCRIPTION_ONLY",
  "restrictions": { "dose_forms": ["TABLET"], "precise_ingredients": { "sertraline": { "allow": ["155137"] } } },
  "provenance": { "source": "RxNav 02-Nov-2026", "verified_on": "2026-11-12" }
}
```

4. Set `"catalog_version": "0.3.0"` and append to `change_log`:

```json
{ "date": "2026-11-12", "version": "0.3.0", "change": "Add sertraline (oral tablets, hydrochloride salt).", "source": "RxNav 02-Nov-2026" }
```

5. Validate (§9). Nothing else changes: the state machine, the recall engine and the screens read the catalog as data.

This exact change is exercised end to end, with no code change, by the `new-catalog-entry` scenario (`npm run e2e`):
- A Lupin sertraline 100 mg label (NDC `68180-353-09`, lot `QB00865`) becomes `ELIGIBLE`.
- Its recall D-0227-2026 is then `CONFIRMED_MATCH`.
- The baseline scenario shows the same label is `UNSUPPORTED` with the shipped 14-drug catalog.

## 4. Add an alias

Add the alias (lower case) to the ingredient's `aliases`. The validator rejects an alias that already names another ingredient. Aliases are used to read labels and recall text, for example `"apap"` for acetaminophen:

```json
{ "id": "acetaminophen", "name": "acetaminophen", "rxcui": "161", "aliases": ["apap"], "...": "..." }
```

Record why the alias is valid in `alias_provenance`. Drug-level `aliases` (brand or trade names) are kept for display and search; they are not used for regulatory matching.

## 5. Add a combination drug

Define each ingredient once in `ingredients`, then add one drug whose `ingredients` lists all of them:

```json
{ "id": "hydrocodone_acetaminophen", "display_name": "Hydrocodone/acetaminophen", "status": "ACTIVE",
  "ingredients": ["hydrocodone", "acetaminophen"], "rx_scope": "PRESCRIPTION_ONLY", "restrictions": {},
  "provenance": { "source": "...", "verified_on": "2026-11-12" } }
```

Matching is exact. This combination is not matched by a single-ingredient hydrocodone product, and a single-ingredient entry is not matched by a combination containing it. Combinations that contain an **excluded** ingredient are excluded by the policy regardless (`include_combinations`).

## 6. Disable a supported drug

Set `"status": "INACTIVE"`, then bump the version and add a change-log entry. The record, its id and saved medications that reference it are kept. New assessments return `UNSUPPORTED` (`DRUG_DISABLED`), and no recall query is sent. Re-enable by setting `ACTIVE` again.

## 7. Restrict dose form, release type, strength, route or salt

All restrictions are optional and combinable:

```json
"restrictions": {
  "routes": ["ORAL"],
  "dose_forms": ["TABLET", "CAPSULE"],
  "release_types": ["ER"],
  "strengths": { "metformin": ["500 mg", "750 mg"] },
  "precise_ingredients": { "metformin": { "allow": ["235743"], "deny": [] } }
}
```

| Restriction | Outside the restriction | Value unknown on the identity |
|---|---|---|
| `routes` | `UNSUPPORTED ROUTE_OUT_OF_SCOPE` | liquid with unknown route → `NEEDS_CLARIFICATION ROUTE_UNKNOWN` |
| `dose_forms` | `UNSUPPORTED DOSE_FORM_NOT_IN_SCOPE` | — |
| `release_types` | `UNSUPPORTED RELEASE_NOT_IN_SCOPE` | `NEEDS_CLARIFICATION RELEASE_UNKNOWN` |
| `strengths` | `UNSUPPORTED STRENGTH_NOT_IN_SCOPE` | `NEEDS_CLARIFICATION STRENGTH_UNKNOWN` |
| `precise_ingredients.allow` | `UNSUPPORTED SALT_NOT_IN_SCOPE` | `NEEDS_CLARIFICATION SALT_UNKNOWN` |
| `precise_ingredients.deny` | `UNSUPPORTED PRECISE_INGREDIENT_NOT_IN_SCOPE` | — |

Examples in the shipped catalog:
- `metoprolol_succinate` allows only PIN `221124` (metoprolol succinate), so tartrate is unsupported.
- `gabapentin` denies PIN `1101333` (gabapentin enacarbil, which RxNorm lists as a gabapentin precise ingredient).

To assess IR and ER as separate entries, give them disjoint `release_types`. The validator rejects two `ACTIVE` drugs with the same ingredient set and overlapping formulations.

Prescription scope (`rx_scope`) is `PRESCRIPTION_ONLY`, `OTC_ONLY` or `PRESCRIPTION_AND_OTC`. OTC products are also excluded by policy rule `OTC-MVP` in v0.1, and the policy is checked first.

## 8. Roll back a catalog version

The catalog ships inside the app (no remote configuration in v0.1). To roll back, restore the earlier content from git, give it a **new** version number, and record the rollback:

```bash
git show <commit>:data/drug_catalog.json > data/drug_catalog.json
```

Then set `catalog_version` to a new value (for example `0.3.1`). Append `{ "change": "Rollback to the content of 0.2.0", ... }` to `change_log`, then validate (§9). Never reuse a version number: assessments are identified by the version they were made under, and the device keeps a snapshot of each installed version (`config_snapshot` table).

## 9. Validate a change

```bash
npm run catalog:validate
```

```bash
npm run config:test
```

To validate a proposed file before replacing the shipped one:

```bash
npm run config:validate -- --catalog-file path/to/proposed_catalog.json
```

To check as a release build would (requires `APPROVED` status):

```bash
npm run config:validate -- --release
```

`config:validate` checks JSON syntax, the JSON Schema, identifier formats, duplicates, references (ingredient ids, precise-ingredient RxCUIs), provenance, approval status, rule-set compatibility and catalog × policy overlaps. `config:test` also runs the precedence self-test: every active drug must be reachable, every inactive drug unassessed, and every exclusion and product-type rule must win, plus the cases in `data/config_expectations.json`.

Errors give the JSON path and a hint. For example:

```
ERROR   [catalog] $.drugs[0].ingredients: unknown ingredient id "atorvastatinn"
        hint: Define it in $.ingredients first.
```

The app enforces the same rules at runtime. An invalid, unapproved (in release builds) or incompatible catalog fails closed: every medication becomes `UNSUPPORTED` (`CATALOG_INVALID` or `CONFIG_INCOMPATIBLE`), and no recall assessment runs.

## 10. Identify assessments made under an earlier catalog

Every saved assessment row stores `catalog_version`, `policy_version` and `ruleset_version`. On the device, use `repos.assessments.listMadeUnder({ catalogVersion: '0.2.0' })`. `isStale(assessment, currentVersions)` tells the UI to show the stored result with its version and offer a re-check. Saved rows are never rewritten; a re-check inserts a new row.

## 11. When a change needs an application update

| Change | Code change? | New app build? |
|---|---|---|
| Add, disable or re-enable a drug; add an alias; add a combination; add or change restrictions of existing kinds | No | Yes (configuration is bundled; no remote configuration in v0.1) |
| A new restriction kind, a new `rx_scope` value, a new dose-form family or a new reason code | Yes | Yes |
| `schema_version` change, or a `compatibility.min_ruleset_version` above the app's `RULESET_VERSION` | Yes | Yes. An older app refuses the file (`CONFIG_INCOMPATIBLE`) and fails closed. |

## 12. Display name

The patient-facing name is configured in `config/app_config.json` (`"display_name": "Rx Recall Check"`). The repository and package names are unchanged.
