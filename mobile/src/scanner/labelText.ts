/**
 * Read medication fields from OCR lines of a pharmacy label, stock bottle or carton (pure).
 *
 * Conservative by design (Task 4C):
 *   - An NDC is read only from an NDC-shaped string that is labeled "NDC" (same line), or from a
 *     hyphenated FDA layout on a line that is not an Rx/refill/quantity/phone/date/store line.
 *     It is then still only a *candidate*: the engine must find it in FDA's NDC Directory and it must
 *     match the printed name and strength (existing cross-validation), or it is discarded.
 *   - Rx numbers, phone numbers, dates and store numbers are never NDCs.
 *   - A lot is read only from text explicitly labeled "LOT"; it is never inferred.
 *   - Letter/digit confusions (O↔0, I/l↔1) are corrected only inside numeric tokens.
 *   - Everything not used for identity (patient, prescriber, pharmacy, directions, Rx number) is
 *     returned as `privateText` so the request guard can refuse to transmit any of it.
 */
import type { FieldValue, LabelExtraction } from '../models/identity.ts';
import { parseNdcInput } from '../rules/ndc.ts';

export interface OcrLine {
  text: string;
  /** Recognizer confidence 0..1. */
  score: number;
}

export interface TextReading {
  ndc: { value: string; score: number; anchored: boolean } | null;
  /** All NDC-shaped strings found, including rejected ones, for diagnostics. */
  ndcCandidates: { value: string; accepted: boolean; reason: string }[];
  drugName: { value: string; score: number } | null;
  strength: { value: string; score: number } | null;
  doseForm: { value: string; score: number } | null;
  manufacturer: { value: string; score: number } | null;
  lot: { value: string; score: number } | null;
  expiry: { value: string; score: number } | null;
  privateText: string[];
}

/** Words that may appear glued together in OCR output of drug lines (catalog names are added). */
export const BUILTIN_VOCABULARY = [
  'HYDROCHLORIDE', 'HCL', 'SODIUM', 'SOD', 'CALCIUM', 'CALC', 'POTASSIUM', 'POT', 'BESYLATE', 'SUCCINATE', 'TARTRATE', 'MALEATE',
  'MESYLATE', 'MAGNESIUM', 'ACETATE', 'CITRATE', 'EXTENDED', 'DELAYED', 'RELEASE', 'FILM', 'COATED', 'ORAL', 'SOLUTION', 'SOLN', 'SOL',
  'SUSPENSION', 'SUSP', 'TABLETS', 'TABLET', 'TABS', 'TAB', 'CAPSULES', 'CAPSULE', 'CAPS', 'CAP', 'USP', 'ER', 'XR', 'XL', 'SR', 'DR', 'EC',
  'HCTZ', 'AND', 'WITH',
];

const UNIT = '(?:MCG|MG|G|ML|MEQ|UNITS?|%)';
const RX_LINE = /\bR\s*X\s*(?:#|NO\.?|NUMBER|:)|\bREFILLS?\b|\bQTY\b|\bQUANTITY\b|\bDATE\b|\bDISCARD\b|\bSTORE\b|\bPHONE\b|\bTEL\b|\bDR\.?\s|\bPRESCRIBER\b|\(\d{3}\)|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\d{1,2}\/\d{1,2}\/\d{2,4}/i;
/** Dosing directions are never the drug line ("TAKE 4 ML BY MOUTH…"). */
const DIRECTIONS_LINE = /^(?:TAKE|USE|APPLY|GIVE|INHALE|INSTILL|INSERT|PLACE|DISSOLVE|CHEW|SHAKE|MIX|SPRAY|INJECT)\b|\bBY MOUTH\b|\bDAILY\b|\bTIMES A DAY\b|\bEVERY \d+ HOURS\b/;
const FORM_WORDS: [RegExp, string][] = [
  [/\b(?:ORAL\s+)?(?:SOLUTION|SOLN|SOL)\b/, 'ORAL SOLUTION'],
  [/\b(?:SUSPENSION|SUSP)\b/, 'ORAL SUSPENSION'],
  [/\b(?:CAPSULES?|CAPS?)\b/, 'CAPSULE'],
  [/\b(?:TABLETS?|TABS?)\b/, 'TABLET'],
];

/** Unicode compatibility normalization (full-width punctuation), upper case, single spaces. */
export function normalizeLine(s: string): string {
  return s.normalize('NFKC').toUpperCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * Fix O/0 and I/l/1 confusions in number runs that are immediately followed by a unit
 * ("1OMG" → "10MG", "50OMG" → "500MG", "1O0 MG" → "100 MG"). Letters elsewhere (lot codes, words)
 * are untouched. An ambiguous run ("10OMG" may be "10 MG" or "100 MG") is corrected to the more
 * common reading; a wrong strength is caught by cross-validation against the FDA record.
 */
export function fixDigitConfusions(s: string): string {
  return s.replace(/(\d[0-9OIL]*)(?=\s*(?:MCG|MG|ML|MEQ|%|G(?![A-Z])))/g, (run) => run.replace(/O/g, '0').replace(/[IL]/g, '1'));
}

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * "S" (optionally with a stray apostrophe) read for "5" between a known drug name and MG/MCG:
 * "AMLODIPINESMGT" → "AMLODIPINE 5MGT". Only directly after a known drug name of 5+ letters, so
 * ordinary words ending in S are untouched. The value is still shown as read from the label.
 */
export function fixStrengthAfterName(s: string, vocabulary: readonly string[]): string {
  let t = s;
  for (const v of vocabulary.map((x) => x.toUpperCase()).filter((x) => x.length >= 5)) {
    t = t.replace(new RegExp(`(${escapeRe(v)})\\s*'?S'?\\s*(?=MCG|MG)`, 'g'), '$1 5');
  }
  return t;
}

/**
 * Re-insert spaces in glued OCR text: between letters and digits, around units, and between
 * known words (greedy longest match). Unknown letter runs are left as they are.
 */
export function segmentWords(s: string, vocabulary: readonly string[]): string {
  const vocab = [...new Set([...vocabulary.map((v) => v.toUpperCase()), ...BUILTIN_VOCABULARY])].filter((v) => v.length >= 2).sort((a, b) => b.length - a.length);
  let t = s.replace(/([A-Z])(\d)/g, '$1 $2').replace(/(\d)((?!MCG|MG|ML|MEQ)[A-Z]{3,})/g, '$1 $2').replace(new RegExp(`(\\d)(${UNIT})(?=[A-Z/]|\\b)`, 'g'), '$1 $2').replace(new RegExp(`\\b(${UNIT})(?=[A-Z]{2,})`, 'g'), '$1 ');
  t = t.replace(/[A-Z]{6,}/g, (run) => {
    const parts: string[] = [];
    let i = 0;
    let unknown = '';
    while (i < run.length) {
      const w = vocab.find((v) => run.startsWith(v, i) && (v.length >= 3 || i + v.length === run.length || parts.length > 0));
      if (w) {
        if (unknown) parts.push(unknown);
        unknown = '';
        parts.push(w);
        i += w.length;
      } else {
        unknown += run[i];
        i += 1;
      }
    }
    if (unknown) parts.push(unknown);
    // Only accept the segmentation if at least one known word was found.
    return parts.length > 1 && parts.some((p) => vocab.includes(p)) ? parts.join(' ') : run;
  });
  return t.replace(/\s+/g, ' ').trim();
}

/** NDC-shaped strings in a line, with digit-confusion fixes applied to the numeric run only. */
function ndcShapes(line: string): { raw: string; value: string; anchored: boolean }[] {
  const out: { raw: string; value: string; anchored: boolean }[] = [];
  const re = /(N\s*D\s*C\s*[#:.]?\s*)?([0-9OIL]{4,5}\s?-\s?[0-9OIL]{3,4}\s?-\s?[0-9OIL]{1,2}|[0-9OIL]{11})(?![0-9A-Z-])/g;
  for (const m of line.matchAll(re)) {
    const raw = m[2] as string;
    if (!/\d{3}/.test(raw)) continue;
    const value = raw.replace(/\s/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    out.push({ raw, value, anchored: m[1] !== undefined });
  }
  return out;
}

export function readLabelText(lines: readonly OcrLine[], vocabulary: readonly string[]): TextReading {
  const norm = lines.map((l) => ({ ...l, n: normalizeLine(l.text) }));
  const used = new Set<number>();
  const r: TextReading = { ndc: null, ndcCandidates: [], drugName: null, strength: null, doseForm: null, manufacturer: null, lot: null, expiry: null, privateText: [] };

  // NDC
  norm.forEach((l, i) => {
    for (const c of ndcShapes(l.n)) {
      const rxLine = RX_LINE.test(l.n) && !/\bNDC\b/.test(l.n);
      const parsed = parseNdcInput(c.value);
      let reason = 'accepted';
      let ok = parsed.kind !== 'INVALID';
      if (!ok) reason = parsed.error ?? 'invalid';
      else if (rxLine) {
        ok = false;
        reason = 'on an Rx/refill/date/phone line';
      } else if (!c.anchored && !c.value.includes('-')) {
        ok = false;
        reason = 'unlabeled digit run (could be an Rx or other number)';
      }
      r.ndcCandidates.push({ value: c.value, accepted: ok, reason });
      if (ok && (r.ndc === null || (c.anchored && !r.ndc.anchored))) {
        r.ndc = { value: c.value, score: l.score, anchored: c.anchored };
        used.add(i);
      }
    }
  });

  // Drug line: a line with a strength expression and a known or long alphabetic word, not an Rx line.
  for (let i = 0; i < norm.length && r.strength === null; i++) {
    const l = norm[i] as (typeof norm)[number];
    if (RX_LINE.test(l.n) || DIRECTIONS_LINE.test(segmentWords(l.n, vocabulary)) || /\bNDC\b|\bLOT\b|\bEXP/.test(l.n)) continue;
    const fixed = segmentWords(fixDigitConfusions(fixStrengthAfterName(l.n, vocabulary)), vocabulary);
    const m = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT})(?:\\s*/\\s*(\\d*(?:\\.\\d+)?)\\s*(ML))?`).exec(fixed);
    if (!m) continue;
    const before = fixed.slice(0, m.index).trim();
    const known = vocabulary.some((v) => new RegExp(`\\b${v.toUpperCase()}\\b`).test(fixed));
    const nameLine = before.length >= 4 && /[A-Z]{4,}/.test(before) ? before : null;
    let name = nameLine;
    // The name may be on the line above (stock bottles), or OCR may have split one line in two
    // ("METFORMINHCL" / "ER500MGTAB"): join a short prefix (e.g. "ER") to the line above.
    if (!name && i > 0) {
      const prev0 = segmentWords((norm[i - 1] as (typeof norm)[number]).n, vocabulary);
      if (before.length > 0 && /[A-Z]{4,}/.test(prev0) && !RX_LINE.test(prev0) && !DIRECTIONS_LINE.test(prev0)) {
        name = `${prev0} ${before}`;
        used.add(i - 1);
      }
    }
    if (!name && i > 0) {
      const prev = segmentWords((norm[i - 1] as (typeof norm)[number]).n, vocabulary);
      if (/[A-Z]{4,}/.test(prev) && !RX_LINE.test(prev) && !DIRECTIONS_LINE.test(prev)) {
        name = prev;
        used.add(i - 1);
      }
    }
    if (!name && !known) continue;
    const strength = `${m[1]} ${m[2]}${m[3] !== undefined ? `/${m[3] || ''}${m[4] ?? ''}` : ''}`.replace(/\/ML$/, '/ML');
    r.strength = { value: strength.replace(/\/$/, ''), score: l.score };
    if (name) r.drugName = { value: name.replace(/[,;:]+$/, ''), score: l.score };
    const formText = `${fixed} ${name ?? ''}`;
    for (const [re, form] of FORM_WORDS) {
      if (re.test(formText)) {
        r.doseForm = { value: form, score: l.score };
        break;
      }
    }
    used.add(i);
  }
  // A known drug name whose strength could not be read (e.g. "AMLODIPINEMGTA" from a curved vial):
  // keep the name only; the strength is left for the user and is never guessed.
  if (r.drugName === null) {
    const known = vocabulary.map((v) => v.toUpperCase()).filter((v) => v.length >= 5).sort((a, b) => b.length - a.length);
    for (let i = 0; i < norm.length && r.drugName === null; i++) {
      const l = norm[i] as (typeof norm)[number];
      const seg = segmentWords(l.n, vocabulary);
      if (RX_LINE.test(l.n) || DIRECTIONS_LINE.test(seg) || /\bNDC\b|\bLOT\b|\bEXP/.test(l.n)) continue;
      const w = known.find((v) => new RegExp(`(^|[^A-Z])${escapeRe(v)}(?![A-Z]{2})`).test(seg));
      if (w) {
        r.drugName = { value: w, score: l.score };
        used.add(i);
      }
    }
  }
  // Form on another line (stock bottles: "100 Tablets").
  if (r.doseForm === null) {
    for (const l of norm)
      for (const [re, form] of FORM_WORDS)
        if (r.doseForm === null && re.test(segmentWords(l.n, vocabulary))) r.doseForm = { value: form, score: l.score };
  }

  // Manufacturer / distributor abbreviation as printed.
  norm.forEach((l, i) => {
    // OCR often glues the next field ("MFG:SUNPHARMANDC#…"): stop at "NDC" with or without a space.
    const m = /\b(?:MFG|MFR|MFD|MANUFACTURER|MANUFACTURED\s+(?:BY|FOR)|DIST(?:RIBUTED)?\s+BY|DIST)\s*[:.]?\s*([A-Z][A-Z0-9 .,&'-]{1,40}?)(?=\s*N\s?D\s?C\s*[#:.]?\s*\d|\s{2,}|$)/.exec(l.n);
    if (m && r.manufacturer === null) {
      // Inside a word, a zero between letters is the letter O ("PRECISI0N D0SE").
      r.manufacturer = { value: (m[1] as string).trim().replace(/(?<=[A-Z])0(?=[A-Z])|(?<=[A-Z])0\b/g, 'O'), score: l.score };
      used.add(i);
    }
  });

  // Lot and expiry: only when explicitly labeled.
  norm.forEach((l, i) => {
    const lot = /\bLOT\s*(?:NO\.?|#|:)?\s*([A-Z0-9][A-Z0-9-]{2,19})\b/.exec(l.n);
    if (lot && r.lot === null) {
      r.lot = { value: lot[1] as string, score: l.score };
      used.add(i);
    }
    const exp = /\bEXP(?:IRY|IRATION)?\.?\s*(?:DATE)?\s*[:.]?\s*(\d{1,2}\s*\/\s*\d{2,4}|\d{4}-\d{2}(?:-\d{2})?)/.exec(l.n);
    if (exp && r.expiry === null) r.expiry = { value: (exp[1] as string).replace(/\s/g, ''), score: l.score };
  });

  r.privateText = norm.filter((_, i) => !used.has(i)).map((l) => l.n).filter((t) => t.length >= 3);
  return r;
}

/** Build the engine's input. OCR values carry their confidence; nothing is marked confirmed. */
export function toExtraction(text: TextReading, barcodeNdc: { code: string; lot: string | null; expiry: string | null } | null): LabelExtraction {
  const ocr = (v: { value: string; score: number } | null): FieldValue<string> | null => (v ? { value: v.value, origin: 'OCR', confidence: v.score, confirmedByUser: false } : null);
  const ndcTexts: FieldValue<string>[] = [];
  if (barcodeNdc) ndcTexts.push({ value: barcodeNdc.code, origin: 'BARCODE', confidence: 1, confirmedByUser: false });
  if (text.ndc) ndcTexts.push({ value: text.ndc.value, origin: 'OCR', confidence: text.ndc.score, confirmedByUser: false });
  const lot = barcodeNdc?.lot ? { value: barcodeNdc.lot, origin: 'BARCODE' as const, confidence: 1, confirmedByUser: false } : ocr(text.lot);
  const expiry = barcodeNdc?.expiry ? { value: barcodeNdc.expiry, origin: 'BARCODE' as const, confidence: 1, confirmedByUser: false } : ocr(text.expiry);
  return {
    ndcTexts,
    drugName: ocr(text.drugName),
    strength: ocr(text.strength),
    doseForm: ocr(text.doseForm),
    labelerText: ocr(text.manufacturer),
    lot,
    expiry,
    containerType: text.privateText.some((t) => /\bR\s*X\s*(?:#|NO)|PHARMACY|REFILL/.test(t)) ? 'PHARMACY_VIAL' : 'UNKNOWN',
    privateText: text.privateText,
  };
}
