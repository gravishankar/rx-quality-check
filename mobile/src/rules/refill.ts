/**
 * Refill comparison (ARCHITECTURE §5.4, J5, RG-7). Differences are reported neutrally; no labeler is
 * ranked above another. Changes in ingredients, strength, dose form or release mechanism are flagged
 * for the pharmacist. Any difference requires the recall evidence to be re-evaluated for the new fill.
 */
import type { MedicationIdentity } from '../models/identity.ts';
import { productKeyOfProductNdc } from './ndc.ts';
import { sameStrengthSet } from './strength.ts';
import type { Strength } from '../models/identity.ts';

export type RefillChangeKind =
  | 'PRODUCT_NDC_CHANGED'
  | 'LABELER_CHANGED'
  | 'INGREDIENTS_CHANGED'
  | 'STRENGTH_CHANGED'
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
    const ps = previous.ingredients.map((x) => x.strength);
    const cs = current.ingredients.map((x) => x.strength);
    const comparable = ps.every((s) => s !== null) && cs.every((s) => s !== null);
    if (!comparable || !sameStrengthSet(ps as Strength[], cs as Strength[])) {
      add('STRENGTH_CHANGED', fmtStrengths(previous), fmtStrengths(current), true);
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
