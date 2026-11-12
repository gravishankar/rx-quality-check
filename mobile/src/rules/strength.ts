/**
 * Strength normalization and free-text strength extraction (R-ID-4).
 *
 * Canonical form: mass in milligrams (MG), per one unit of the denominator ("1" for a solid unit
 * dose, "ML" for liquids). mcg and g are converted to mg exactly; this is a unit conversion, not a
 * guess, so "175 mcg" equals ".175 mg/1". A value printed with the wrong unit ("175 mg" for a
 * 175 mcg product) therefore stays different and fails cross-validation (OCR-5).
 *
 * Units that cannot be converted to mass (grain, mEq, units, %) keep their own unit and only ever
 * equal the same unit.
 */

import type { Strength } from '../models/identity.ts';

export type { Strength } from '../models/identity.ts';

/**
 * A strength expression found in text. A single-ingredient expression has one component; a
 * combination expression such as "10 mg/325 mg" or "5/160/25 mg" has one component per ingredient,
 * in printed order.
 */
export interface StrengthExpression {
  components: Strength[];
  text: string;
}

const MASS_TO_MG: Record<string, number> = { MG: 1, MCG: 0.001, UG: 0.001, 'µG': 0.001, G: 1000, GM: 1000 };
const OTHER_UNITS = new Set(['MEQ', 'UNT', 'UNITS', '%', 'GRAIN', 'GR']);
const DENOMINATORS = new Set(['ML', 'G']);

function canonicalUnit(u: string): { unit: string; factor: number } | null {
  const U = u.toUpperCase();
  if (U in MASS_TO_MG) return { unit: 'MG', factor: MASS_TO_MG[U] as number };
  if (OTHER_UNITS.has(U)) return { unit: U === 'UNITS' ? 'UNT' : U === 'GR' ? 'GRAIN' : U, factor: 1 };
  return null;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function num(s: string): number {
  return Number(s.replace(/,/g, ''));
}

/**
 * Normalize a structured strength string as published by openFDA ("500 mg/1", ".175 mg/1",
 * "40 mg/4mL", "1 mg/g") or RxNav ("0.175 MG", "10 MG/ML"). Returns null when unparseable.
 */
export function normalizeStrength(s: string): Strength | null {
  const m = s.trim().match(/^(\d*\.?\d+)\s*([A-Za-zµ%]+)(?:\s*\/\s*(\d*\.?\d*)\s*([A-Za-z]*))?$/);
  if (!m) return null;
  const cu = canonicalUnit(m[2] as string);
  if (!cu) return null;
  let value = Number(m[1]) * cu.factor;
  const denomQty = m[3] ? Number(m[3]) : 1;
  const denomUnit = (m[4] ?? '').toUpperCase();
  if (!Number.isFinite(value) || !Number.isFinite(denomQty) || denomQty === 0) return null;
  if (denomUnit) value = value / denomQty;
  return { value: round(value), unit: cu.unit, per: denomUnit || '1' };
}

/** Strengths in an RxNav concept name, e.g. "acetaminophen 300 MG / hydrocodone bitartrate 10 MG Oral Tablet". */
export function rxNavStrengths(concept: string): Strength[] {
  const out: Strength[] = [];
  for (const m of concept.matchAll(/(\d*\.?\d+)\s*(MG|MCG|G|UNT|MEQ|%)(?:\/(ML|ACTUAT|HR))?/gi)) {
    const cu = canonicalUnit(m[2] as string);
    if (!cu) continue;
    out.push({ value: round(Number(m[1]) * cu.factor), unit: cu.unit, per: (m[3] ?? '1').toUpperCase() });
  }
  return out;
}

export function sameStrength(a: Strength, b: Strength): boolean {
  return a.unit === b.unit && a.per === b.per && Math.abs(a.value - b.value) < 1e-9;
}

/** Two multi-ingredient strength lists are equal as multisets (order-independent). */
export function sameStrengthSet(a: readonly Strength[], b: readonly Strength[]): boolean {
  if (a.length !== b.length) return false;
  const used = new Array<boolean>(b.length).fill(false);
  for (const x of a) {
    const i = b.findIndex((y, j) => !used[j] && sameStrength(x, y));
    if (i < 0) return false;
    used[i] = true;
  }
  return true;
}

export function formatStrength(s: Strength): string {
  return `${s.value} ${s.unit}${s.per === '1' ? '' : '/' + s.per}`;
}

// Number: 1,000 | 0.4 | .175 | 500
const N = String.raw`(\d{1,3}(?:,\d{3})+|\d*\.\d+|\d+)`;
const UNIT = String.raw`(mcg|µg|ug|mg|gm|g|meq|units?|unt|grains?|gr|%)`;
const VOL = String.raw`(?:(\d*\.?\d+)\s*)?(ml|g)`;

/**
 * Extract strength expressions from free text (FDA product descriptions, pharmacy labels).
 *
 * Recognized shapes:
 *   "500 mg", "0.4 mg", ".175 mg", "500MG", "175 mcg"
 *   "10 mg/325 mg", "10 mg/ 660 mg", "2.5 mg/10 mg", "150 mg/1,000 mg"   (combination)
 *   "5/325 mg", "5/160/25 mg", "12.5/1000 mg"                            (combination, shared unit)
 *   "10 mg/mL", "40 mg/4mL", "500 mg/5 mL", "500 mg per 5 mL", "7.5 mg/325 mg per 15 mL" (liquid)
 * Package counts ("500-count", "90 Tablets", "473 mL bottle") are not strengths and are ignored.
 */
export function extractStrengthExpressions(text: string): StrengthExpression[] {
  const out: StrengthExpression[] = [];
  // A run of numbers separated by "/" with at least one mass unit, optionally followed by a volume.
  const re = new RegExp(
    String.raw`(?<![\w.,/])` +
      N + String.raw`\s*` + UNIT + '?' +
      String.raw`((?:\s*\/\s*` + N + String.raw`\s*(?:` + UNIT + String.raw`|(?!\s*(?:ml|g)\b)))*)` +
      String.raw`(?:\s*(?:\/|per)\s*` + VOL + ')?' +
      String.raw`(?![A-Za-z0-9])`,
    'gi',
  );
  for (const m of text.matchAll(re)) {
    const whole = m[0];
    // Re-split the matched run into number/unit pairs.
    const volQty = m[m.length - 2];
    const volUnit = m[m.length - 1];
    const body = volUnit ? whole.replace(new RegExp(String.raw`\s*(?:\/|per)\s*` + VOL + '$', 'i'), '') : whole;
    const parts = body.split('/').map((p) => p.trim()).filter((p) => p !== '');
    const pairs: { n: string; u: string | undefined }[] = [];
    let bad = false;
    for (const p of parts) {
      const pm = p.match(new RegExp('^' + N + String.raw`\s*` + UNIT + '?$', 'i'));
      if (!pm) {
        bad = true;
        break;
      }
      pairs.push({ n: pm[1] as string, u: pm[2] });
    }
    if (bad || pairs.length === 0) continue;
    const lastUnit = [...pairs].reverse().find((p) => p.u !== undefined)?.u;
    if (lastUnit === undefined) continue; // bare numbers ("1/2") are not strengths
    // Every unit-less number before the last unit inherits it ("5/325 mg").
    const components: Strength[] = [];
    for (const p of pairs) {
      const cu = canonicalUnit(p.u ?? lastUnit);
      if (!cu) {
        bad = true;
        break;
      }
      let value = num(p.n) * cu.factor;
      let per = '1';
      if (volUnit && DENOMINATORS.has(volUnit.toUpperCase())) {
        const q = volQty ? Number(volQty) : 1;
        if (!Number.isFinite(q) || q === 0) {
          bad = true;
          break;
        }
        value = value / q;
        per = volUnit.toUpperCase();
      }
      components.push({ value: round(value), unit: cu.unit, per });
    }
    if (bad) continue;
    out.push({ components, text: whole.trim() });
  }
  return out;
}

/** Parse a single printed strength (label OCR or user entry) into its components. */
export function parsePrintedStrength(text: string): Strength[] | null {
  // Pharmacy labels abbreviate combination strengths with a hyphen ("10-325MG", "5-325 MG"). Only
  // on a printed label (never in FDA text, where hyphens join NDC segments and lot ranges).
  const normalized = text.replace(/(\d)\s*-\s*(?=\d[\d.]*\s*(?:mcg|mg|g)\b)/gi, '$1/');
  const exprs = extractStrengthExpressions(normalized);
  if (exprs.length !== 1) return null;
  return (exprs[0] as StrengthExpression).components;
}
