/**
 * Refill comparison (ARCHITECTURE §5.4, J5, RG-7). Differences are reported neutrally; no labeler is
 * ranked above another. Changes in ingredients, strength, dose form or release mechanism are flagged
 * for the pharmacist. Any difference requires the recall evidence to be re-evaluated for the new fill.
 */
import type { MedicationIdentity } from '../models/identity.ts';
import { productKeyOfProductNdc } from './ndc.ts';
import { sameStrength } from './strength.ts';
import type { Strength } from '../models/identity.ts';

export type RefillChangeKind =
  | 'PRODUCT_NDC_CHANGED'
  | 'LABELER_CHANGED'
  | 'INGREDIENTS_CHANGED'
  | 'STRENGTH_CHANGED'
  | 'SALT_CHANGED'
  | 'DOSE_FORM_CHANGED'
  | 'RELEASE_CHANGED'
  | 'PRODUCT_NOW_UNKNOWN'
  | 'PRODUCT_NOW_KNOWN';

export interface RefillChange {
  kind: RefillChangeKind;
  previous: string | null;
  current: string | null;
  checkWithPharmacist: boolean;
}

export interface RefillDiff {
  changes: RefillChange[];
  /** True when any change exists: evidence must be re-evaluated for the current fill. */
  reevaluate: boolean;
  checkWithPharmacist: boolean;
}

const fmtStrengths = (i: MedicationIdentity) =>
  i.ingredients.map((x) => (x.strength ? `${x.name} ${x.strength.value} ${x.strength.unit}${x.strength.per === '1' ? '' : '/' + x.strength.per}` : `${x.name} ?`)).join(' + ');

export function diffFills(previous: MedicationIdentity, current: MedicationIdentity): RefillDiff {
  const changes: RefillChange[] = [];
  const add = (kind: RefillChangeKind, prev: string | null, cur: string | null, flag: boolean) =>
    changes.push({ kind, previous: prev, current: cur, checkWithPharmacist: flag });

  const pk = (n: string | null) => (n === null ? null : productKeyOfProductNdc(n));
  if (previous.productNdc !== null && current.productNdc === null) add('PRODUCT_NOW_UNKNOWN', previous.productNdc, null, false);
  else if (previous.productNdc === null && current.productNdc !== null) add('PRODUCT_NOW_KNOWN', null, current.productNdc, false);
  else if (pk(previous.productNdc) !== pk(current.productNdc)) add('PRODUCT_NDC_CHANGED', previous.productNdc, current.productNdc, false);

  const lab = (s: string | null) => (s === null ? null : s.trim().toLowerCase());
  if (lab(previous.labelerName) !== null && lab(current.labelerName) !== null && lab(previous.labelerName) !== lab(current.labelerName)) {
    add('LABELER_CHANGED', previous.labelerName, current.labelerName, false);
  }

  const names = (i: MedicationIdentity) => i.ingredients.map((x) => x.name).sort().join('+');
  if (names(previous) !== names(current)) add('INGREDIENTS_CHANGED', names(previous), names(current), true);
  else {
    // C1: compare each ingredient with the same ingredient, never as an unordered set of strengths.
    const byName = (i: MedicationIdentity) => new Map(i.ingredients.map((x) => [x.name, x]));
    const pm = byName(previous), cm = byName(current);
    const dup = (i: MedicationIdentity) => new Set(i.ingredients.map((x) => x.name)).size !== i.ingredients.length;
    let strengthChanged = dup(previous) || dup(current);
    const saltChanges: string[] = [];
    for (const [n, p] of pm) {
      const c = cm.get(n)!;
      if (p.strength === null || c.strength === null || !sameStrength(p.strength, c.strength)) strengthChanged = true;
      if (p.salt !== null && c.salt !== null && p.salt !== c.salt) saltChanges.push(`${n}: ${p.salt} -> ${c.salt}`);
    }
    if (strengthChanged) add('STRENGTH_CHANGED', fmtStrengths(previous), fmtStrengths(current), true);
    if (saltChanges.length > 0) {
      const salts = (i: MedicationIdentity) => i.ingredients.map((x) => `${x.name} ${x.salt ?? '?'}`).join(' + ');
      add('SALT_CHANGED', salts(previous), salts(current), true);
    }
  }
  if (previous.doseForm !== current.doseForm) add('DOSE_FORM_CHANGED', previous.doseForm, current.doseForm, true);
  if (previous.release !== current.release) add('RELEASE_CHANGED', previous.release, current.release, true);

  return {
    changes,
    reevaluate: changes.length > 0,
    checkWithPharmacist: changes.some((c) => c.checkWithPharmacist),
  };
}
