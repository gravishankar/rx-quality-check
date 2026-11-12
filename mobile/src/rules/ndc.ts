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

// ---------------------------------------------------------------------------------------------
// Task 2 additions: layout-independent comparison keys and conservative free-text extraction.
// ---------------------------------------------------------------------------------------------

/**
 * Layout-independent 9-digit product key (5-digit labeler + 4-digit product, zero-padded), i.e. the
 * first nine digits of the 11-digit 5-4-2 form. Two NDCs refer to the same product exactly when
 * their keys are equal, whatever layout each was printed in. Returns null for anything that is not
 * an unambiguous NDC (bare 10-digit strings are ambiguous and are rejected here on purpose).
 */
export function productKey(ndc: string): string | null {
  const n11 = ndc11Of(ndc);
  return n11 === null ? null : n11.slice(0, 9);
}

/** Layout-independent 11-digit package key, or null when the input is not an unambiguous NDC. */
export function packageKey(ndc: string): string | null {
  return ndc11Of(ndc);
}

function ndc11Of(ndc: string): string | null {
  const t = ndc.trim();
  const h = t.match(/^(\d+)-(\d+)-(\d+)$/);
  if (h) {
    const [, l, p, k] = h as unknown as [string, string, string, string];
    const layout = `${l.length}-${p.length}-${k.length}`;
    if (ALL_LAYOUTS.includes(layout as NdcLayout) || layout === '5-4-2') {
      return l.padStart(5, '0') + p.padStart(4, '0') + k.padStart(2, '0');
    }
    return null;
  }
  const hp = t.match(/^(\d+)-(\d+)$/);
  if (hp) {
    const [, l, p] = hp as unknown as [string, string, string];
    const ok = (l.length === 4 && p.length === 4) || (l.length === 5 && (p.length === 3 || p.length === 4));
    return ok ? l.padStart(5, '0') + p.padStart(4, '0') + '00' : null;
  }
  if (/^\d{11}$/.test(t)) return t;
  return null;
}

/** Product key of a hyphenated product NDC ("62756-142", "0591-0540", "00591-0540"). */
export function productKeyOfProductNdc(productNdc: string): string | null {
  const k = ndc11Of(productNdc);
  return k === null ? null : k.slice(0, 9);
}

export interface TextNdcExtraction {
  /** Each NDC found, as printed, with its layout-independent keys. */
  ndcs: { text: string; productKey: string; packageKey: string }[];
  /**
   * Number of "NDC" mentions that were not followed by a parseable NDC (e.g. "NDC 53746-0179-BULK",
   * truncated text). When > 0 the list above may be incomplete and must not be used to rule a
   * product out.
   */
  unparsedMentions: number;
}

/**
 * Extract NDCs from FDA free text. Accepts hyphenated 10-digit layouts, hyphenated 5-4-2 (11-digit)
 * forms such as "00591-0540-05", and unhyphenated 11-digit strings only when labeled "NDC".
 * When `requireLabel` is true (used for code_info, where lot numbers look like NDCs), only NDCs
 * introduced by the word "NDC" are accepted.
 */
export function extractNdcsWithKeys(text: string, opts: { requireLabel?: boolean } = {}): TextNdcExtraction {
  const out = new Map<string, { text: string; productKey: string; packageKey: string }>();
  const add = (raw: string): boolean => {
    const k = ndc11Of(raw);
    if (k === null) return false;
    if (!out.has(k)) out.set(k, { text: raw, productKey: k.slice(0, 9), packageKey: k });
    return true;
  };

  if (!opts.requireLabel) {
    const hyphenated = /(?<![\d-])(\d{4,5})-(\d{3,4})-(\d{1,2})(?![\d-])/g;
    for (const m of text.matchAll(hyphenated)) add(m[0]);
  }

  let unparsed = 0;
  // Every explicit "NDC" mention must be followed by something parseable.
  const mention = /\bNDC\b[\s#:.]*(?:No\.?|number)?[\s#:.]*([0-9][0-9A-Za-z-]*)?/gi;
  for (const m of text.matchAll(mention)) {
    const token = (m[1] ?? '').replace(/[-.]+$/, '');
    if (token === '') {
      // "NDC" followed by nothing usable, unless the NDC follows a lettered list marker such
      // as "NDC: a) ..." — treat as unparsed; conservative.
      unparsed += 1;
      continue;
    }
    if (/^\d{11}$/.test(token) || /^\d+-\d+-\d+$/.test(token)) {
      if (!add(token)) unparsed += 1;
    } else {
      unparsed += 1;
    }
  }
  return { ndcs: [...out.values()], unparsedMentions: unparsed };
}
