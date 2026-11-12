# Exclusion Policy Guide

How to exclude medications, restrict exclusions to formulations or routes, and validate, version
and roll back `data/exclusion_policy.json`, without changing application code.

| Item | Location |
|---|---|
| Policy (schema 2), version `0.2.0-draft` | `data/exclusion_policy.json` |
| JSON Schema | `data/schemas/exclusion_policy.schema.json` |
| Precedence (authority) | `mobile/src/rules/exclusion.ts` |
| Rationale and history | `docs/EXCLUSIONS.md` |
| Worked example: a new exclusion rule | `data/examples/exclude_levothyroxine.policy-fragment.json` (illustrative, not a policy decision) |

## 1. Current decisions (policy 0.2.0-draft, pending approval OD-2)

| Decision | Encoded as |
|---|---|
| Anticoagulants listed in Document B are excluded | `ingredient_rules` EXCL-WARFARIN, -APIXABAN, -RIVAROXABAN, -DABIGATRAN, -EDOXABAN (class `ANTICOAGULANT`) |
| Listed transplant immunosuppressants are excluded | EXCL-TACROLIMUS, -CYCLOSPORINE, -SIROLIMUS (class `TRANSPLANT_IMMUNOSUPPRESSANT`) |
| Everolimus: indication cannot be established | EXCL-EVEROLIMUS, decision `NEEDS_CLARIFICATION` |
| Azathioprine and mycophenolate are excluded by ingredient, regardless of indication | EXCL-AZATHIOPRINE, EXCL-MYCOPHENOLATE (also matches mycophenolic acid, mycophenolate sodium and mofetil) |
| Administration-based exclusion is unresolved (OD-1) | `route_rules` ADMIN-NON-ORAL, status `OPEN_DECISION`. Interim: a listed ingredient by a non-oral route is `UNSUPPORTED` (`ADMINISTRATION_RULE_PENDING`). |
| OTC products are excluded from MVP v0.1 (closes OD-3) | `product_type_rules` OTC-MVP |
| A class label alone excludes nothing | each class's `unlisted_signal_behavior` is `NEEDS_CLARIFICATION` |

## 2. Rule kinds

- **`ingredient_rules`** apply to listed ingredients. Each rule has:
  - `rxcuis` (IN and PIN, verified on RxNav) and `names` (other RxNorm names of the same moiety);
  - `decision` (`EXCLUDED` or `NEEDS_CLARIFICATION`);
  - an optional formulation scope, `applies_to` (`routes`, `dose_forms`, `release_types`);
  - `include_combinations`, plus `explanation`, `source` and `verified_on`.

  A rule without `source` and `verified_on` is rejected: unverified data fails closed.
- **`classes`** group rules and hold the patient-facing `explanation`. `fda_epc_signals` are FDA Established Pharmacologic Class strings. A signal on an ingredient that no rule lists follows `unlisted_signal_behavior`: `NEEDS_CLARIFICATION` (default), `EXCLUDED` (must be set explicitly) or `IGNORE`.
- **`route_rules`** are administration-based rules. `OPEN_DECISION` rules apply only their `interim_decision`; `APPROVED` rules apply their `decision`. `scope` is `LISTED_INGREDIENTS` or `ALL`.
- **`product_type_rules`** match openFDA `product_type`, for example `HUMAN OTC DRUG`.

## 3. Precedence and conflict resolution (exact)

Evaluated in this order by `evaluateExclusion`. The first step that decides wins.

| # | Step | Result |
|---|---|---|
| 0 | Catalog or policy missing, malformed, unverified, unapproved (release builds) or needing a newer rule set | `UNSUPPORTED` (`POLICY_INVALID`, `CATALOG_INVALID` or `CONFIG_INCOMPATIBLE`). Fail closed; no assessment. |
| 1 | Identity has no ingredient | `UNSUPPORTED` (`NO_INGREDIENTS`) |
| 2 | Ingredient rules that match **any** ingredient: by RxCUI, RxNorm name or salt form. The formulation scope must apply (an unknown route, form or release counts as applicable), and `include_combinations` must allow a combination. | Any `EXCLUDED` match: `EXCLUDED`; the first such rule in file order is reported. Otherwise any `NEEDS_CLARIFICATION` match: `NEEDS_CLARIFICATION`. |
| 3 | A listed ingredient whose rule does not apply only because of the route | Route rule: `APPROVED` gives its decision; `OPEN_DECISION` gives its interim decision |
| 4 | `APPROVED` route rules with scope `ALL` | their decision |
| 5 | Product-type rules (OTC) | their decision |
| 6 | Class signal on an unlisted ingredient | `unlisted_signal_behavior` |
| 7 | Catalog: exact ingredient set, `ACTIVE`, restrictions (`DRUG_CATALOG_GUIDE.md` §1, §7) | `ELIGIBLE` if exactly one drug passes. Ambiguity gives `NEEDS_CLARIFICATION`; otherwise `UNSUPPORTED`. |

Consequences, all tested (`tests/unit/config_validation.test.ts`, `npm run config:test`):
1. **An applicable exclusion overrides catalog inclusion.** Adding warfarin to the catalog still yields `EXCLUDED`, and the validator warns about the overlap.
2. **A supported drug must also satisfy its formulation and prescription-scope restrictions.**
3. **Ambiguity or conflict is never eligible.**
   - When conflicting policy matches occur, the most restrictive decision wins (`EXCLUDED` over `NEEDS_CLARIFICATION`).
   - Several catalog drugs passing at once is `CATALOG_AMBIGUOUS`.
   - Ambiguous product identity stops in `AMBIGUOUS_IDENTITY` before this evaluation.
   - Conflicting FDA data (for example, two salts named for one product) leaves the salt unknown, which gives `NEEDS_CLARIFICATION`.
4. **Bad configuration fails closed** (step 0). The state machine's safety gates also refuse any recall fetch without an `ELIGIBLE` decision for the current identity.
5. **No retroactive changes.** Saved assessments keep the policy version they were made under (`assessment.policy_version`); a new policy only affects new assessments.

## 4. Exclude a drug

Add an ingredient rule with verified identifiers. The following is the worked example (illustrative only):

```json
{
  "id": "EXCL-LEVOTHYROXINE-EXAMPLE",
  "ingredient": "levothyroxine",
  "rxcuis": ["10582", "40144"],
  "names": ["levothyroxine sodium"],
  "class": "NARROW_THERAPEUTIC_INDEX_EXAMPLE",
  "decision": "EXCLUDED",
  "applies_to": { "routes": ["ORAL"] },
  "include_combinations": true,
  "source": "...",
  "verified_on": "2026-11-12"
}
```

The class must exist in `classes`. Bump `policy_version`, add a `change_log` entry, and validate (§8). The `new-exclusion-rule` scenario (`npm run e2e`) shows that a levothyroxine label (NDC `68788-8793-3`), which is in the catalog, becomes `EXCLUDED` with no state-machine change and no recall request.

## 5. Exclude a class

A class label alone never excludes. To exclude a class:

1. **List its ingredients.** Add one `ingredient_rules` entry per ingredient. This is preferred: every member is named and verified.
2. **Or opt in to excluding unlisted members explicitly.** Set the class's `unlisted_signal_behavior` to `"EXCLUDED"` and list the FDA EPC strings in `fda_epc_signals`. This also excludes products that carry the signal but whose ingredient is unlisted. Record the reason in the change log.

## 6. Restrict an exclusion to a formulation or route

Use `applies_to`. For example, excluding only oral solutions of an ingredient:

```json
"applies_to": { "dose_forms": ["SOLUTION"], "routes": ["ORAL"] }
```

Tablets of the same ingredient are then not excluded by this rule (tested). For administration-based exclusions, change the `route_rules` entry from `OPEN_DECISION` to `APPROVED` with a `decision` once OD-1 is decided:

```json
{ "id": "ADMIN-NON-ORAL", "status": "APPROVED", "routes": "NON_ORAL", "scope": "LISTED_INGREDIENTS", "decision": "EXCLUDED" }
```

## 7. Explanations shown to patients

Each class has an `explanation`; a rule may override it with its own `explanation`. Both are returned with the decision (`ExclusionDecision.explanation`, plus `ruleId`) for the result screen (Task 4). The text must say this is a policy choice, not a finding about the medication, and must never imply other medications are safe (`CLAUDE.md` §3).

## 8. Validate a change

```bash
npm run policy:validate
```

```bash
npm run config:test
```

To validate a proposed file:

```bash
npm run config:validate -- --policy-file path/to/proposed_policy.json
```

To check as a release build would:

```bash
npm run config:validate -- --release
```

The validator checks:
- the schema, rule ids (unique) and class references;
- that each RxCUI is governed by exactly one rule;
- the decision values, and provenance on every rule;
- the six-month review window and the change log;
- approval status and rule-set compatibility;
- precedence: every rule must win over the catalog, alone and in combinations.

## 9. Roll back a policy version

Restore the earlier content and issue it under a **new** version:

```bash
git show <commit>:data/exclusion_policy.json > data/exclusion_policy.json
```

Set `policy_version` to a new value. Add a change-log entry `"Rollback to the content of 0.2.0-draft"` with the date and approver, then validate.

## 10. Find assessments made under an earlier policy

Use `repos.assessments.listMadeUnder({ policyVersion: '0.2.0-draft' })`. `isStale(assessment, current)` flags saved results made under a different policy, catalog or rule set; they are shown with their version and a re-check option. The device also stores the installed policy JSON per version (`config_snapshot`), so an old decision can be explained later.

## 11. When a policy change needs an application update

| Change | Code change? | New app build? |
|---|---|---|
| Add or remove an ingredient rule; change a decision; change `applies_to`, `include_combinations` or explanations; approve a route rule; add a product-type rule; change a class's `unlisted_signal_behavior` | No | Yes (bundled configuration) |
| A new rule kind, a new scope dimension, a new decision value or reason code | Yes | Yes |
| `schema_version` change or a higher `compatibility.min_ruleset_version` | Yes | Yes. Older apps refuse the file and fail closed. |
