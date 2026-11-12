/**
 * Medication identity types. Identity is the product a patient holds: ingredient set, strength per
 * ingredient, dose form, release mechanism, and — when established — the product NDC.
 *
 * Labeler names are kept only because they are part of product identity (the labeler code is the
 * first NDC segment) and appear in recall records. No manufacturing-site or facility information is
 * modeled: manufacturer provenance is out of scope for v0.1.
 */
/**
 * Canonical strength: mass in milligrams ('MG') per one unit of the denominator ('1' for a unit
 * dose, 'ML' for liquids). Non-mass units keep their own unit ('MEQ', 'UNT', '%', 'GRAIN').
 */
export interface Strength {
  value: number;
  unit: string;
  per: string;
}

export type ReleaseMechanism = 'IR' | 'ER' | 'DR' | 'UNSPECIFIED';

export type DoseFormFamily = 'TABLET' | 'CAPSULE' | 'SOLUTION' | 'SUSPENSION' | 'OTHER';

/** Where a field value came from. */
export type FieldOrigin = 'OCR' | 'BARCODE' | 'DIRECTORY' | 'USER';

/**
 * A single extracted or derived field. OCR values carry the recognizer confidence (0..1).
 * `confirmedByUser` is set only by an explicit user action in the CONFIRM step.
 */
export interface FieldValue<T> {
  value: T;
  origin: FieldOrigin;
  confidence: number | null;
  confirmedByUser: boolean;
}

export type ContainerType = 'PHARMACY_VIAL' | 'ORIGINAL_PACKAGE' | 'UNKNOWN';

/** What the scanner (or manual entry) produced. Raw text stays on the device. */
export interface LabelExtraction {
  /** Candidate NDC strings as read (any format); barcode payloads included. */
  ndcTexts: FieldValue<string>[];
  drugName: FieldValue<string> | null;
  strength: FieldValue<string> | null;
  doseForm: FieldValue<string> | null;
  /** Labeler/manufacturer string as printed; used only to compare against the directory labeler. */
  labelerText: FieldValue<string> | null;
  lot: FieldValue<string> | null;
  expiry: FieldValue<string> | null;
  containerType: ContainerType;
  /**
   * Other text read from the label that is NOT used for identity (patient name, Rx number, pharmacy,
   * prescriber, directions). Never sent anywhere; used only to arm the request privacy guard.
   */
  privateText?: string[];
}

export interface IdentityIngredient {
  /** Normalized base name, lower case ("metformin"). */
  name: string;
  /** Salt or ester as published ("hydrochloride"), lower case; null if none. */
  salt: string | null;
  /** RxNorm ingredient RxCUI when known (from RxNav); null otherwise. */
  rxcui: string | null;
  strength: Strength | null;
  /** Other names for this ingredient in label and recall text (from the catalog), lower case. */
  aliases?: string[];
}

/** A product as published in the FDA NDC Directory, reduced to identity fields. */
export interface DirectoryProduct {
  productNdc: string;
  packageNdcs: string[];
  labelerName: string;
  genericName: string;
  brandName: string | null;
  ingredients: IdentityIngredient[];
  doseForm: DoseFormFamily;
  release: ReleaseMechanism;
  dosageFormText: string;
  routes: string[];
  productType: string;
  pharmClassEpc: string[];
  finished: boolean | null;
  /** openFDA `openfda.is_original_packager` (false for repackagers/relabelers); null when absent. */
  isOriginalPackager?: boolean | null;
  /** SPL set id from openFDA, used to find repackager source products in DailyMed. */
  splSetId?: string | null;
  /**
   * Internal inconsistencies in the published record, e.g. generic_name "Metoprolol Succinate" with
   * active ingredient "METOPROLOL TARTRATE" (observed in openFDA, product 50090-6448). Conflicting
   * fields are set to unknown rather than trusted.
   */
  sourceConflicts: string[];
}

/**
 * Identity used for exclusion checks and recall evaluation.
 *
 * `level`:
 *  - PRODUCT: product NDC established (directory-confirmed and cross-validated, or chosen by user).
 *  - CLINICAL_DRUG: ingredient set + strength + form + release known, product unknown.
 */
export interface MedicationIdentity {
  level: 'PRODUCT' | 'CLINICAL_DRUG';
  productNdc: string | null;
  /** Package NDC when the label shows one (pharmacy vials print the stock bottle's NDC). */
  packageNdc: string | null;
  labelerName: string | null;
  ingredients: IdentityIngredient[];
  doseForm: DoseFormFamily;
  release: ReleaseMechanism;
  routes: string[];
  productType: string | null;
  pharmClassEpc: string[];
  /**
   * Product NDCs this product is known to be repackaged from (filled by repackager traversal in a
   * later task). Recalls naming these are surfaced as potential matches (RP-4).
   */
  relatedSourceProductNdcs: string[];
  /**
   * Whether the repackager → source-product relationship was checked (Task 3):
   * NOT_APPLICABLE (original packager), VERIFIED (source NDCs confirmed in the NDC Directory),
   * NOT_ESTABLISHED (repackaged, source unknown or unverifiable), UNAVAILABLE (lookup failed),
   * NOT_CHECKED (default). Only VERIFIED sources are listed above; nothing is inferred from names.
   */
  /** Internal inconsistencies found in the FDA record (see DirectoryProduct.sourceConflicts). */
  sourceConflicts?: string[];
  /** Carried from the NDC Directory record for source-product resolution. */
  isOriginalPackager?: boolean | null;
  splSetId?: string | null;
  sourceProductStatus?: 'NOT_APPLICABLE' | 'VERIFIED' | 'NOT_ESTABLISHED' | 'UNAVAILABLE' | 'NOT_CHECKED';
  /** User-confirmed lot, if any. Never transmitted. */
  lot: string | null;
}
