/**
 * NDC normalization (deterministic, no network).
 *
 * Background (FDA / HIPAA conventions, see docs/DATA_SOURCES.md and Document A §1.3):
 *  - FDA labels NDCs as 10 digits in three hyphenated segments: 4-4-2, 5-3-2 or 5-4-1
 *    (labeler-product-package).
 *  - Pharmacies, claims and many barcodes use an unhyphenated 11-digit 5-4-2 form, produced by
 *    left-padding exactly one segment with a zero.
 *  - An unhyphenated 10-digit string is ambiguous: it may be split 4-4-2, 5-3-2 or 5-4-1.
 *  - A UPC-A barcode for a drug is "3" + 10-digit NDC + check digit (12 digits). The same code
 *    also appears in 13-digit EAN form with a leading "0" (observed in openFDA openfda.upc).
 *  - A GTIN-14 for a drug is indicator digit + "03" + 10-digit NDC + check digit (14 digits).
 *
 * This module never decides which candidate is correct. It only enumerates every candidate the
 * input permits. Resolution requires confirmation against the FDA NDC Directory (or RxNav), and a
 * candidate set with more than one surviving entry is an ambiguity that must be surfaced, never
 * silently collapsed.
 */

export type NdcLayout = '4-4-2' | '5-3-2' | '5-4-1';

export interface NdcCandidate {
  /** Hyphenated 10-digit package NDC as FDA publishes it, e.g. "62756-142-02". */
  packageNdc: string;
  /** Hyphenated labeler-product code, e.g. "62756-142". */
  productNdc: string;
  /** Unhyphenated 11-digit 5-4-2 form, e.g. "62756014202". */
  ndc11: string;
  layout: NdcLayout;
}

export type NdcInputKind =
  | 'HYPHENATED_10'
  | 'HYPHENATED_11'
  | 'DIGITS_11'
  | 'DIGITS_10'
  | 'UPC_A'
  | 'EAN_13'
  | 'GTIN_14'
  | 'INVALID';

export interface NdcParseResult {
  input: string;
  kind: NdcInputKind;
  candidates: NdcCandidate[];
  /** True when more than one candidate exists and directory confirmation is mandatory. */
  ambiguous: boolean;
  /** Human-readable reason when kind is INVALID or a check digit failed. */
  error?: string;
}

const LAYOUT_LENGTHS: Record<NdcLayout, [number, number, number]> = {
  '4-4-2': [4, 4, 2],
  '5-3-2': [5, 3, 2],
  '5-4-1': [5, 4, 1],
};

const ALL_LAYOUTS: NdcLayout[] = ['4-4-2', '5-3-2', '5-4-1'];

function splitByLayout(digits10: string, layout: NdcLayout): [string, string, string] {
  const [a, b] = LAYOUT_LENGTHS[layout];
  return [digits10.slice(0, a), digits10.slice(a, a + b), digits10.slice(a + b)];
}

function makeCandidate(labeler: string, product: string, pkg: string): NdcCandidate {
  const layout = `${labeler.length}-${product.length}-${pkg.length}` as NdcLayout;
  if (!ALL_LAYOUTS.includes(layout)) {
    throw new Error(`Invalid NDC layout ${layout}`);
  }
  return {
    packageNdc: `${labeler}-${product}-${pkg}`,
    productNdc: `${labeler}-${product}`,
    ndc11: labeler.padStart(5, '0') + product.padStart(4, '0') + pkg.padStart(2, '0'),
    layout,
  };
}

/** Convert a hyphenated 10-digit NDC (any FDA layout) to the 11-digit 5-4-2 form. */
export function toNdc11(hyphenated10: string): string {
  const parts = hyphenated10.trim().split('-');
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`Not a hyphenated NDC: ${hyphenated10}`);
  }
  const [l, p, k] = parts as [string, string, string];
  return makeCandidate(l, p, k).ndc11;
}

/**
 * Enumerate 10-digit candidates for an 11-digit 5-4-2 string.
 * A candidate exists for each segment whose padding position holds a zero.
 */
export function candidatesFromNdc11(digits11: string): NdcCandidate[] {
  if (!/^\d{11}$/.test(digits11)) return [];
  const l = digits11.slice(0, 5);
  const p = digits11.slice(5, 9);
  const k = digits11.slice(9, 11);
  const out: NdcCandidate[] = [];
  if (l.startsWith('0')) out.push(makeCandidate(l.slice(1), p, k)); // 4-4-2
  if (p.startsWith('0')) out.push(makeCandidate(l, p.slice(1), k)); // 5-3-2
  if (k.startsWith('0')) out.push(makeCandidate(l, p, k.slice(1))); // 5-4-1
  return out;
}

function candidatesFromDigits10(digits10: string): NdcCandidate[] {
  return ALL_LAYOUTS.map((layout) => {
    const [a, b, c] = splitByLayout(digits10, layout);
    return makeCandidate(a, b, c);
  });
}

/** GS1 mod-10 check digit over all digits except the last. */
export function gs1CheckDigitValid(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  let sum = 0;
  // Weights alternate 3,1,3,1... starting from the rightmost body digit.
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += Number(body[i]) * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

export function parseNdcInput(raw: string): NdcParseResult {
  const input = raw;
  const trimmed = raw.trim().replace(/^NDC[:#\s]*/i, '');
  const invalid = (error: string): NdcParseResult => ({
    input,
    kind: 'INVALID',
    candidates: [],
    ambiguous: false,
    error,
  });

  if (/^\d+-\d+-\d+$/.test(trimmed)) {
    const [l, p, k] = trimmed.split('-') as [string, string, string];
    const layout = `${l.length}-${p.length}-${k.length}`;
    if (ALL_LAYOUTS.includes(layout as NdcLayout)) {
      return { input, kind: 'HYPHENATED_10', candidates: [makeCandidate(l, p, k)], ambiguous: false };
    }
    if (layout === '5-4-2') {
      const c = candidatesFromNdc11(l + p + k);
      if (c.length === 0) return invalid('11-digit NDC has no zero-padded segment');
      return { input, kind: 'HYPHENATED_11', candidates: c, ambiguous: c.length > 1 };
    }
    return invalid(`Unrecognized hyphenated layout ${layout}`);
  }

  const digits = trimmed.replace(/\s+/g, '');
  if (!/^\d+$/.test(digits)) return invalid('Input contains non-digit characters');

  switch (digits.length) {
    case 10: {
      const c = candidatesFromDigits10(digits);
      return { input, kind: 'DIGITS_10', candidates: c, ambiguous: true };
    }
    case 11: {
      const c = candidatesFromNdc11(digits);
      if (c.length === 0) return invalid('11-digit NDC has no zero-padded segment');
      return { input, kind: 'DIGITS_11', candidates: c, ambiguous: c.length > 1 };
    }
    case 12: {
      if (!digits.startsWith('3')) return invalid('UPC-A drug codes start with 3');
      if (!gs1CheckDigitValid(digits)) return invalid('UPC-A check digit mismatch');
      const c = candidatesFromDigits10(digits.slice(1, 11));
      return { input, kind: 'UPC_A', candidates: c, ambiguous: true };
    }
    case 13: {
      if (!digits.startsWith('03')) return invalid('EAN-13 drug codes start with 03');
      if (!gs1CheckDigitValid(digits)) return invalid('EAN-13 check digit mismatch');
      const c = candidatesFromDigits10(digits.slice(2, 12));
      return { input, kind: 'EAN_13', candidates: c, ambiguous: true };
    }
    case 14: {
      if (digits.slice(1, 3) !== '03') return invalid('GTIN-14 does not carry an NDC (expected "03" after indicator)');
      if (!gs1CheckDigitValid(digits)) return invalid('GTIN-14 check digit mismatch');
      const c = candidatesFromDigits10(digits.slice(3, 13));
      return { input, kind: 'GTIN_14', candidates: c, ambiguous: true };
    }
    default:
      return invalid(`Unsupported length ${digits.length}`);
  }
}

/**
 * Extract NDC-shaped strings from free text (e.g., an FDA enforcement report's product_description).
 * Only hyphenated 10-digit FDA layouts and explicit "NDC" + 11 digits are accepted, because bare
 * digit runs in free text are too easily confused with lot numbers, phone numbers or ZIP codes.
 */
export function extractNdcsFromText(text: string): string[] {
  const found = new Set<string>();
  const hyphenated = /(?<![\d-])(\d{4,5})-(\d{3,4})-(\d{1,2})(?![\d-])/g;
  for (const m of text.matchAll(hyphenated)) {
    const [, l, p, k] = m as unknown as [string, string, string, string];
    const layout = `${l.length}-${p.length}-${k.length}`;
    if (ALL_LAYOUTS.includes(layout as NdcLayout)) found.add(`${l}-${p}-${k}`);
  }
  const labeled11 = /NDC[#:\s]*(\d{11})(?!\d)/gi;
  for (const m of text.matchAll(labeled11)) found.add(m[1] as string);
  return [...found];
}

/** Product NDC (labeler-product) from a hyphenated package NDC. */
export function productNdcOf(packageNdc: string): string {
  const parts = packageNdc.split('-');
  if (parts.length < 2) throw new Error(`Not a hyphenated NDC: ${packageNdc}`);
  return `${parts[0]}-${parts[1]}`;
}
