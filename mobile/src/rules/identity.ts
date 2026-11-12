/**
 * Identity rules (ARCHITECTURE §5.1): directory confirmation of NDC candidates (R-ID-2),
 * cross-validation of a confirmed NDC against the printed label (R-ID-3), confirmation of uncertain
 * OCR fields, and construction of the identity used for exclusion and recall evaluation.
 */
import type {
  DirectoryProduct,
  DoseFormFamily,
  FieldValue,
  IdentityIngredient,
  LabelExtraction,
  MedicationIdentity,
  ReleaseMechanism,
  Strength,
} from '../models/identity.ts';
import type { LookupOutcome } from '../models/lookup.ts';
import type { OpenFdaEnvelope, OpenFdaNdcProduct } from '../models/openfda.ts';
import { compareRelease, formEvidenceFromText, fromDirectoryDosageForm } from './doseForm.ts';
import { readIngredientsFromText, splitIngredientName } from './ingredients.ts';
import { packageKey, type NdcParseResult } from './ndc.ts';
import { normalizeStrength, parsePrintedStrength, sameStrengthSet } from './strength.ts';

// ---------------------------------------------------------------------------------------------
// Directory products
// ---------------------------------------------------------------------------------------------

export function directoryProductFrom(rec: OpenFdaNdcProduct): DirectoryProduct {
  const { form, release } = fromDirectoryDosageForm(rec.dosage_form);
  const sourceConflicts: string[] = [];
  const generic = readIngredientsFromText(rec.generic_name, rec.active_ingredients.map((a) => splitIngredientName(a.name).name));
  const ingredients: IdentityIngredient[] = rec.active_ingredients.map((a) => {
    const { name, salt } = splitIngredientName(a.name);
    // The generic name and the active-ingredient list must agree on the salt; if they do not, the
    // salt is unknown (it can decide catalog scope, e.g. metoprolol succinate vs tartrate).
    const genericSalt = generic.salts[name];
    if (salt !== null && genericSalt !== undefined && genericSalt !== null && genericSalt !== salt) {
      sourceConflicts.push(`SALT_CONFLICT:${name}:${salt}/${genericSalt}`);
      return { name, salt: null, rxcui: null, strength: normalizeStrength(a.strength) };
    }
    return { name, salt, rxcui: null, strength: normalizeStrength(a.strength) };
  });
  return {
    productNdc: rec.product_ndc,
    packageNdcs: (rec.packaging ?? []).map((p) => p.package_ndc),
    labelerName: rec.labeler_name,
    genericName: rec.generic_name,
    brandName: (rec as { brand_name?: string }).brand_name ?? null,
    ingredients,
    doseForm: form,
    release,
    dosageFormText: rec.dosage_form,
    routes: (rec.route ?? []).map((r) => r.toUpperCase()),
    productType: (rec as { product_type?: string }).product_type ?? '',
    pharmClassEpc: (rec.pharm_class ?? []).filter((p) => p.endsWith('[EPC]')),
    finished: rec.finished ?? null,
    isOriginalPackager: firstOf<boolean>(rec.openfda?.is_original_packager),
    splSetId: firstOf<string>(rec.openfda?.spl_set_id),
    sourceConflicts,
  };
}

export type NdcDirectoryOutcome = LookupOutcome<OpenFdaEnvelope<OpenFdaNdcProduct>>;

export type CandidateConfirmation =
  | { kind: 'INVALID'; error: string }
  | { kind: 'RESOLVED'; product: DirectoryProduct; packageNdc: string }
  | { kind: 'AMBIGUOUS'; options: { product: DirectoryProduct; packageNdc: string }[] }
  | { kind: 'REJECTED' }
  | { kind: 'UNAVAILABLE'; detail: string }
  | { kind: 'RATE_LIMITED'; retryAfterSeconds: number | null };

/**
 * R-ID-2. `outcomes` maps each candidate package NDC to the NDC Directory answer for
 * `packaging.package_ndc:"<candidate>"`. A candidate is confirmed only when an OK answer lists that
 * exact package. Uniqueness is only claimed when every candidate was answered: if one candidate is
 * confirmed but another could not be looked up, the result is UNAVAILABLE (never a silent pick,
 * Doc A A-20).
 */
export function confirmNdcCandidates(parse: NdcParseResult, outcomes: ReadonlyMap<string, NdcDirectoryOutcome>): CandidateConfirmation {
  if (parse.kind === 'INVALID' || parse.candidates.length === 0) {
    return { kind: 'INVALID', error: parse.error ?? 'not an NDC' };
  }
  const confirmed: { product: DirectoryProduct; packageNdc: string }[] = [];
  let rateLimited: number | null | undefined;
  const unavailable: string[] = [];
  for (const c of parse.candidates) {
    const o = outcomes.get(c.packageNdc);
    if (o === undefined) {
      unavailable.push(`${c.packageNdc}: not looked up`);
      continue;
    }
    switch (o.kind) {
      case 'OK': {
        const want = packageKey(c.packageNdc);
        for (const rec of o.data.results) {
          if ((rec.packaging ?? []).some((p) => packageKey(p.package_ndc) === want)) {
            confirmed.push({ product: directoryProductFrom(rec), packageNdc: c.packageNdc });
          }
        }
        break;
      }
      case 'NO_MATCH':
        break;
      case 'RATE_LIMITED':
        rateLimited = o.retryAfterSeconds;
        break;
      case 'SOURCE_UNAVAILABLE':
        unavailable.push(`${c.packageNdc}: ${o.reason}`);
        break;
    }
  }
  const pending = unavailable.length > 0 || rateLimited !== undefined;
  if (pending) {
    if (rateLimited !== undefined) return { kind: 'RATE_LIMITED', retryAfterSeconds: rateLimited };
    return { kind: 'UNAVAILABLE', detail: unavailable.join('; ') };
  }
  if (confirmed.length === 1) return { kind: 'RESOLVED', ...(confirmed[0] as { product: DirectoryProduct; packageNdc: string }) };
  if (confirmed.length > 1) return { kind: 'AMBIGUOUS', options: confirmed };
  return { kind: 'REJECTED' };
}

// ---------------------------------------------------------------------------------------------
// Cross-validation (R-ID-3, OCR-1…5)
// ---------------------------------------------------------------------------------------------

export interface PrintedFields {
  drugName: string | null;
  strength: string | null;
  doseForm: string | null;
}

export type CrossValidationIssue =
  | 'INGREDIENT_MISMATCH'
  | 'COMBINATION_MISMATCH'
  | 'STRENGTH_MISMATCH'
  | 'RELEASE_MISMATCH'
  | 'DOSE_FORM_MISMATCH'
  | 'DRUG_NAME_NOT_PRINTED'
  | 'STRENGTH_NOT_PRINTED'
  | 'RELEASE_NOT_PRINTED'
  | 'RELEASE_CONFLICTING';

export interface CrossValidation {
  status: 'PASS' | 'MISMATCH' | 'NEEDS_CONFIRMATION';
  mismatches: CrossValidationIssue[];
  confirmations: CrossValidationIssue[];
}

/**
 * The confirmed NDC's ingredient set, strength, dose form and release mechanism must agree with
 * what is printed. Any explicit disagreement discards the NDC (the OCR may have read a valid but
 * different product). Missing printed values do not discard it but require user confirmation.
 */
export function crossValidate(
  printed: PrintedFields,
  product: Pick<DirectoryProduct, 'ingredients' | 'doseForm' | 'release'>,
): CrossValidation {
  const mismatches: CrossValidationIssue[] = [];
  const confirmations: CrossValidationIssue[] = [];
  const nameText = printed.drugName ?? '';
  const allText = [printed.drugName, printed.strength, printed.doseForm].filter(Boolean).join(' ');

  if (nameText.trim() === '') {
    confirmations.push('DRUG_NAME_NOT_PRINTED');
  } else {
    const r = readIngredientsFromText(nameText, product.ingredients.map((i) => i.name));
    if (r.found.length === 0) mismatches.push('INGREDIENT_MISMATCH');
    else if (r.missing.length > 0 || r.partners.length > 0) mismatches.push('COMBINATION_MISMATCH');
  }

  const printedStrength = printed.strength !== null ? parsePrintedStrength(printed.strength) : parsePrintedStrength(nameText);
  const productStrengths = product.ingredients.map((i) => i.strength);
  if (printedStrength === null) {
    confirmations.push('STRENGTH_NOT_PRINTED');
  } else if (productStrengths.some((s) => s === null) || !sameStrengthSet(printedStrength, productStrengths as Strength[])) {
    mismatches.push('STRENGTH_MISMATCH');
  }

  const fe = formEvidenceFromText(allText);
  if (fe.forms.length > 0 && !fe.forms.includes(product.doseForm)) mismatches.push('DOSE_FORM_MISMATCH');
  if (fe.release === 'CONFLICTING') {
    confirmations.push('RELEASE_CONFLICTING');
  } else {
    const rel = compareRelease(product.release, fe.release);
    if (rel === 'DIFFERENT') mismatches.push('RELEASE_MISMATCH');
    else if (rel === 'UNKNOWN') confirmations.push('RELEASE_NOT_PRINTED');
  }

  return {
    status: mismatches.length > 0 ? 'MISMATCH' : confirmations.length > 0 ? 'NEEDS_CONFIRMATION' : 'PASS',
    mismatches,
    confirmations,
  };
}

// ---------------------------------------------------------------------------------------------
// User confirmation of uncertain fields
// ---------------------------------------------------------------------------------------------

/** OCR values below this confidence must be confirmed by the user before use. */
export const OCR_CONFIDENCE_THRESHOLD = 0.9;

export type ConfirmableField = 'ndc' | 'drugName' | 'strength' | 'doseForm' | 'lot';

/**
 * Fields the user must confirm before evidence is fetched. Any OCR value without a confidence or
 * below the threshold needs confirmation; a lot always needs confirmation (it decides whether a
 * lot-specific recall is confirmed); an OCR-read NDC needs confirmation unless a barcode or the
 * directory cross-validation corroborated it.
 */
export function fieldsNeedingConfirmation(x: LabelExtraction, opts: { ndcCrossValidated: boolean }): ConfirmableField[] {
  const out: ConfirmableField[] = [];
  const uncertain = (f: FieldValue<string> | null): boolean =>
    f !== null && !f.confirmedByUser && f.origin === 'OCR' && (f.confidence === null || f.confidence < OCR_CONFIDENCE_THRESHOLD);
  const ocrNdc = x.ndcTexts.find((n) => n.origin === 'OCR' && !n.confirmedByUser);
  if (ocrNdc && (!opts.ndcCrossValidated || uncertain(ocrNdc))) out.push('ndc');
  if (uncertain(x.drugName)) out.push('drugName');
  if (uncertain(x.strength)) out.push('strength');
  if (uncertain(x.doseForm)) out.push('doseForm');
  if (x.lot !== null && !x.lot.confirmedByUser) out.push('lot');
  return out;
}

/** The lot may be used for recall matching only after the user confirmed it. */
export function confirmedLot(x: LabelExtraction): string | null {
  return x.lot !== null && x.lot.confirmedByUser && x.lot.value.trim() !== '' ? x.lot.value : null;
}

// ---------------------------------------------------------------------------------------------
// Identity construction
// ---------------------------------------------------------------------------------------------

export function identityFromProduct(product: DirectoryProduct, packageNdc: string | null, lot: string | null): MedicationIdentity {
  return {
    level: 'PRODUCT',
    productNdc: product.productNdc,
    packageNdc,
    labelerName: product.labelerName,
    ingredients: product.ingredients.map((i) => ({ ...i })),
    doseForm: product.doseForm,
    release: product.release,
    routes: [...product.routes],
    productType: product.productType || null,
    pharmClassEpc: [...product.pharmClassEpc],
    relatedSourceProductNdcs: [],
    isOriginalPackager: product.isOriginalPackager ?? null,
    splSetId: product.splSetId ?? null,
    sourceProductStatus: 'NOT_CHECKED',
    lot,
  };
}

function firstOf<T>(v: unknown): T | null {
  return Array.isArray(v) && v.length > 0 ? (v[0] as T) : null;
}

export type ClinicalIdentityResult =
  | { ok: true; identity: MedicationIdentity }
  | { ok: false; missing: ('drugName' | 'strength' | 'doseForm')[]; detail: string };

/**
 * Name-only path (J2): build an ingredient + strength + form + release identity from printed fields.
 * `knownIngredientNames` is the lexicon of catalog and policy ingredient names. The result is
 * CLINICAL_DRUG level: it can never produce a product-level recall match.
 */
export function identityFromPrintedFields(
  printed: PrintedFields,
  knownIngredientNames: readonly string[],
  lot: string | null,
  /** Alias → ingredient-name map from the catalog (e.g. "apap" → "acetaminophen"). */
  aliases: Readonly<Record<string, string>> = {},
): ClinicalIdentityResult {
  const missing: ('drugName' | 'strength' | 'doseForm')[] = [];
  const name = printed.drugName ?? '';
  const reading = readIngredientsFromText(name, knownIngredientNames, aliases);
  if (reading.found.length === 0) missing.push('drugName');
  const strengths = printed.strength !== null ? parsePrintedStrength(printed.strength) : parsePrintedStrength(name);
  const all = [printed.drugName, printed.strength, printed.doseForm].filter(Boolean).join(' ');
  const fe = formEvidenceFromText(all);
  if (fe.forms.length !== 1) missing.push('doseForm');
  const ingredientNames = [...reading.found, ...reading.partners];
  if (strengths === null || strengths.length !== ingredientNames.length) missing.push('strength');
  if (missing.length > 0) {
    return { ok: false, missing: [...new Set(missing)], detail: 'printed fields do not establish ingredient, strength and form' };
  }
  // Ingredient order in the strength follows printed order; pair them in the order found in text.
  const ordered = orderByAppearance(name, ingredientNames);
  const ingredients: IdentityIngredient[] = ordered.map((n, i) => ({
    name: n,
    salt: reading.salts[n] ?? null,
    rxcui: null,
    strength: (strengths as Strength[])[i] ?? null,
  }));
  const release: ReleaseMechanism = fe.release === 'CONFLICTING' ? 'UNSPECIFIED' : fe.release;
  const form = fe.forms[0] as DoseFormFamily;
  return {
    ok: true,
    identity: {
      level: 'CLINICAL_DRUG',
      productNdc: null,
      packageNdc: null,
      labelerName: null,
      ingredients,
      doseForm: form,
      release,
      routes: [],
      productType: null,
      pharmClassEpc: [],
      relatedSourceProductNdcs: [],
      lot,
    },
  };
}

function orderByAppearance(text: string, names: string[]): string[] {
  const lower = text.toLowerCase();
  const pos = (n: string) => {
    const i = lower.indexOf(n);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...names].sort((a, b) => pos(a) - pos(b));
}

/**
 * Release is part of identity for products sold in more than one mechanism (metformin IR/ER,
 * gabapentin IR/ER). A clinical-drug identity whose release is UNSPECIFIED must be confirmed by the
 * user before evaluation.
 */
export function releaseNeedsConfirmation(identity: MedicationIdentity): boolean {
  return identity.release === 'UNSPECIFIED';
}

/**
 * Attach catalog aliases to an identity's ingredients so label and recall text that uses an alias
 * (e.g. "APAP") is read as that ingredient. Data-driven: adding an alias needs no code change.
 */
export function withCatalogAliases(identity: MedicationIdentity, ingredients: readonly { name: string; aliases: string[] }[]): MedicationIdentity {
  return {
    ...identity,
    ingredients: identity.ingredients.map((i) => {
      const def = ingredients.find((d) => d.name === i.name);
      return def && def.aliases.length > 0 ? { ...i, aliases: [...def.aliases] } : i;
    }),
  };
}

/** Alias → ingredient-name map for every catalog ingredient. */
export function aliasMap(ingredients: readonly { name: string; aliases: string[] }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of ingredients) for (const a of d.aliases) out[a] = d.name;
  return out;
}
