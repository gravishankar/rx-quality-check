# Correctness findings — reproduced and fixed (review against `b9c5989`)

Each finding was reproduced with a failing regression test **before** the fix (`tests/regression/`),
then fixed in a separate commit on branch `task-4h/correctness-findings`. Nothing here activates drugs,
merges into `main` or builds for distribution. Status: Stage 1 activation stays on hold until these are
reviewed.

| ID | Finding | Reproduced | Patient-visible consequence | Regression test | Fix |
|---|---|---|---|---|---|
| C1a | Typed/scanned combination with an abbreviation ("APAP/CODEINE 300-30MG") paired strengths with the wrong ingredient | Yes | The confirmation screen shows "acetaminophen 30 mg + codeine 300 mg"; catalog strength rules and refill checks then judge the wrong values | `c1_ingredient_association.test.ts` (identification) | `orderByAppearance` finds an ingredient at the position of its alias |
| C1b | Recall comparison treated a combination's strengths as an unordered set | Yes (SYNTHETIC text) | A recall of amlodipine 20 mg / atorvastatin 10 mg would be read as the same strength as amlodipine 10 mg / atorvastatin 20 mg, keeping a possible/confirmed match that should be ruled out | same file (recall comparison) | Per-ingredient comparison when the text names every ingredient; otherwise the previous set comparison (never claims a difference it cannot see) |
| C1c | Refill comparison: unordered strengths, and salt changes not reported | Yes | Doxycycline hyclate 100 mg → monohydrate 100 mg showed no change; swapped combination strengths showed no change | same file (refill) | Per-ingredient strength comparison; new `SALT_CHANGED` (check with pharmacist, re-evaluate) |
