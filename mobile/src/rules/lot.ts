/**
 * Lot scope of a recall (from free-text `code_info`) and comparison with a user-confirmed lot
 * (R-EV-6, LOT-1…4).
 *
 * Lots exist only in free text with many formats. Comparison is exact after normalizing case,
 * whitespace and a leading "Lot"/"#" label. There is no fuzzy matching. A lot that is not found in
 * the listing is reported as "not found in the listed lots" — never as "not affected" — because the
 * listing may use ranges, patterns or formats this parser does not read.
 */
import type { LotComparison, LotScope } from '../models/evidence.ts';

/** Normalize a user-entered lot: upper case, no whitespace, no leading "LOT", "NO.", "#", ":". */
export function normalizeLot(raw: string): string {
  let s = raw.toUpperCase().replace(/\s+/g, '');
  s = s.replace(/^(LOT|BATCH)(NUMBER|NO\.?)?[#:.]*/, '');
  s = s.replace(/^[#:.\-]+/, '');
  return s;
}

function tokens(codeInfo: string): string[] {
  return codeInfo
    .toUpperCase()
    .split(/[^A-Z0-9-]+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 0);
}

const LOTISH = /^(?=.*\d)[A-Z0-9][A-Z0-9-]{2,}$/;
const DATE_LIKE = /^(\d{1,2}|\d{4})$/;

export function parseLotScope(codeInfo: string): LotScope {
  const text = codeInfo.trim();
  if (text === '') return { kind: 'UNKNOWN' };
  if (/\ball\s+lots\b/i.test(text)) {
    if (/\b(between|from|distributed|shipped|manufactured|dated|repackaged|prior to|before|after|beginning|starting|that)\b/i.test(text)) {
      return { kind: 'ALL_LOTS_CONDITIONAL', text };
    }
    return { kind: 'ALL_LOTS' };
  }
  const hasPatterns = /\b(begin|begins|beginning|start|starts|starting|end|ends|ending)\s+(with|in)\b|\bprefix\b|\bsuffix\b/i.test(text);
  const hasRanges = /\b(through|thru)\b/i.test(text) || /[A-Z0-9]{3,}\s+(?:-|to)\s+[A-Z0-9]{3,}/i.test(text);
  const lots = tokens(text).filter((t) => LOTISH.test(t) && !DATE_LIKE.test(t));
  if (lots.length === 0 && !hasPatterns && !hasRanges) return { kind: 'UNKNOWN' };
  return { kind: 'LOT_SPECIFIC', lots: [...new Set(lots)], hasRanges, hasPatterns };
}

/** Compare a user-confirmed lot with a recall's code_info. */
export function compareLot(userLot: string | null, codeInfo: string): LotComparison {
  if (userLot === null) return 'LOT_UNKNOWN';
  const lot = normalizeLot(userLot);
  if (lot.length === 0) return 'LOT_UNKNOWN';
  const toks = tokens(codeInfo);
  if (toks.includes(lot)) return 'LOT_LISTED';
  const dehyph = (s: string) => s.replace(/-/g, '');
  const d = dehyph(lot);
  if (toks.some((t) => dehyph(t) === d)) return 'LOT_POSSIBLY_LISTED';
  // The user's lot is part of a longer listed code ("J0668398" vs "J0668398-121422") or a listed
  // code is part of the user's lot: plausible, but not an exact match.
  if (lot.length >= 4 && toks.some((t) => t.length >= 5 && /\d/.test(t) && (t.includes(lot) || lot.includes(t)))) {
    return 'LOT_POSSIBLY_LISTED';
  }
  return 'LOT_NOT_FOUND_IN_LISTING';
}
