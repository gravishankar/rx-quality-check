/**
 * Dose form and release mechanism normalization (R-ID-3, RG-7).
 *
 * Release mechanism is preserved everywhere: IR, ER and DR products are distinct identities.
 * Structured sources (openFDA `dosage_form`) are authoritative: "TABLET" is IR, "TABLET, EXTENDED
 * RELEASE" is ER. In free text (labels, recall descriptions) the absence of a marker is
 * UNSPECIFIED, not IR, and contradictory markers are CONFLICTING.
 */
import type { DoseFormFamily, ReleaseMechanism } from '../models/identity.ts';

export type TextRelease = ReleaseMechanism | 'CONFLICTING';

/** Normalize an openFDA NDC Directory `dosage_form`. */
export function fromDirectoryDosageForm(dosageForm: string): { form: DoseFormFamily; release: ReleaseMechanism } {
  const d = dosageForm.toUpperCase();
  const release: ReleaseMechanism = /EXTENDED RELEASE|EXTENDED-RELEASE|\bER\b/.test(d)
    ? 'ER'
    : /DELAYED RELEASE|DELAYED-RELEASE/.test(d)
      ? 'DR'
      : 'IR';
  return { form: formFamilyOf(d) ?? 'OTHER', release };
}

function formFamilyOf(upper: string): DoseFormFamily | null {
  if (/\bTABLETS?\b|\bTABS?\b|\bTABLES\b/.test(upper)) return 'TABLET';
  if (/\bCAPSULES?\b|\bCAPS?\b/.test(upper)) return 'CAPSULE';
  if (/\bSUSPENSION\b/.test(upper)) return 'SUSPENSION';
  if (/\bSOLUTION\b|\bSOL\b|\bSYRUP\b|\bELIXIR\b/.test(upper)) return 'SOLUTION';
  return null;
}

export interface TextFormEvidence {
  /** Every form family mentioned. Empty when none is stated. */
  forms: DoseFormFamily[];
  release: TextRelease;
  /** Non-oral or non-finished-product signals found in the text. */
  nonOral: NonOralSignal[];
}

export type NonOralSignal =
  | 'INJECTION'
  | 'TOPICAL'
  | 'OPHTHALMIC'
  | 'INHALATION'
  | 'ACTIVE_PHARMACEUTICAL_INGREDIENT'
  | 'COMPOUNDING_KIT';

const ER_MARKERS = [
  /extended\s*-?\s*release/i,
  /\bE\/R\b/i,
  /\b(ER|XR|XL|SR|XT|CR)\b/,
  /\b24\s*-?\s*(hr|hour)\b/i,
  /controlled\s*-?\s*release/i,
  /sustained\s*-?\s*release/i,
];
const DR_MARKERS = [/delayed\s*-?\s*release/i, /\b(DR|EC)\b(?!\.)/, /enteric\s*-?\s*coated/i, /\bD\/R\b/i];
const IR_MARKERS = [/immediate\s*-?\s*release/i, /\(IR\)/, /\bIR\b/];

/**
 * Read form and release from free text. Matching is done on the product-name portion of a
 * description when the caller provides it; otherwise on the whole text.
 */
export function formEvidenceFromText(text: string): TextFormEvidence {
  const upper = text.toUpperCase();
  const forms = new Set<DoseFormFamily>();
  const tablet = /\bTABLETS?\b|\bTABS?\b|\bTABLES\b/.test(upper);
  const capsule = /\bCAPSULES?\b|\bCAPS\b/.test(upper);
  const suspension = /\bSUSPENSION\b/.test(upper);
  const solution = /\bSOLUTION\b|\bSOL\b|\bSYRUP\b|\bELIXIR\b/.test(upper);
  if (tablet) forms.add('TABLET');
  if (capsule) forms.add('CAPSULE');
  if (suspension) forms.add('SUSPENSION');
  if (solution) forms.add('SOLUTION');

  const nonOral: NonOralSignal[] = [];
  if (/\bINJECTIONS?\b|\bINJECTABLE\b|\bVIALS?\b|\bINTRAVENOUS\b|\bI\.?V\.?\b(?=\s)|\bMDV\b|\bSDV\b/.test(upper)) nonOral.push('INJECTION');
  // F2: infusion wording (diluent named after "in", infusion devices, parenteral nutrition). "Syringe"
  // alone is not a signal: oral syringes exist.
  if (/\bIN (?:NS|D5W|D5NS|D5LR|LR|SWFI|NACL|0\.9% (?:NACL|SODIUM CHLORIDE)|NORMAL SALINE|DEXTROSE)\b|\bHOMEPUMPS?\b|\bELASTOMERIC\b|\bINFUSIONS?\b|\bIVPB\b|\bPIGGYBACK\b|\bTPN\b|\bPARENTERAL\b/.test(upper) && !nonOral.includes('INJECTION')) nonOral.push('INJECTION');
  if (/\bCREAM\b|\bOINTMENT\b|\bGEL\b|\bLOTION\b|\bTOPICAL\b|\bPATCH\b/.test(upper)) nonOral.push('TOPICAL');
  if (/\bOPHTHALMIC\b|\bEYE DROPS?\b/.test(upper)) nonOral.push('OPHTHALMIC');
  if (/\bINHALATION\b|\bNEBULI[ZS]ER\b|\bSVN\b|\bINHALER\b/.test(upper)) nonOral.push('INHALATION');
  // Bulk finished tablets shipped in drums can still reach patients via repackagers, so "drum" alone
  // is not a signal; only an explicit active-ingredient (API) description is.
  if (/ACTIVE PHARMACEUTICAL INGREDIENT|\bAPI\b(?! MANUFACTUR)/.test(upper)) nonOral.push('ACTIVE_PHARMACEUTICAL_INGREDIENT');
  if (/COMPOUNDING KIT/.test(upper)) nonOral.push('COMPOUNDING_KIT');

  const er = ER_MARKERS.some((r) => r.test(text));
  const dr = DR_MARKERS.some((r) => r.test(text));
  const ir = IR_MARKERS.some((r) => r.test(text));
  const n = Number(er) + Number(dr) + Number(ir);
  const release: TextRelease = n === 0 ? 'UNSPECIFIED' : n > 1 ? 'CONFLICTING' : er ? 'ER' : dr ? 'DR' : 'IR';
  return { forms: [...forms], release, nonOral };
}

/**
 * Compare an identity's release mechanism with release evidence from text.
 *  - SAME: explicitly the same.
 *  - COMPATIBLE: text silent and the identity is IR (generic text without a marker usually means IR,
 *    but this is never treated as proof).
 *  - UNKNOWN: text silent or contradictory and the identity is ER/DR, or text contradictory.
 *  - DIFFERENT: text explicitly states a different mechanism.
 */
export function compareRelease(
  identity: ReleaseMechanism,
  text: TextRelease,
): 'SAME' | 'COMPATIBLE' | 'UNKNOWN' | 'DIFFERENT' {
  if (text === 'CONFLICTING') return 'UNKNOWN';
  if (identity === 'UNSPECIFIED') return text === 'UNSPECIFIED' ? 'UNKNOWN' : 'UNKNOWN';
  if (text === 'UNSPECIFIED') return identity === 'IR' ? 'COMPATIBLE' : 'UNKNOWN';
  return text === identity ? 'SAME' : 'DIFFERENT';
}

/**
 * The product-name part of an FDA recall description: the text before the first firm/address clause
 * ("Manufactured by", "Distributed by", ...). Form and release markers are read only from here so
 * that firm names ("Dr. Reddy's") and addresses do not produce false markers.
 */
export function productSegment(description: string): string {
  const m = description.search(/\b(manufactured|mfd\.?|mfg\.?|mfr\b|distributed|dist\.\s*by|marketed|repackaged|re-packaged|packaged\s+by|pkg\s+by|made\s+in)\b/i);
  return m > 0 ? description.slice(0, m) : description;
}
