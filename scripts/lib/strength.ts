/**
 * Strength normalization (feasibility only; Task 2 owns the production rule).
 * openFDA: ".175 mg/1", "40 mg/4mL", "10 mg/1"; RxNav: "0.175 MG", "10 MG/ML".
 */
export interface Strength {
  value: number;
  unit: string;
  per: string; // "1" for unit dose, otherwise the denominator unit (e.g., "ML")
}
export function normalizeStrength(s: string): Strength | null {
  const m = s.trim().match(/^([\d.]+)\s*([A-Za-z%]+)(?:\s*\/\s*([\d.]*)\s*([A-Za-z]*))?$/);
  if (!m) return null;
  let value = Number(m[1]);
  const unit = m[2]!.toUpperCase();
  const denomQty = m[3] ? Number(m[3]) : 1;
  const denomUnit = (m[4] ?? '').toUpperCase();
  if (!Number.isFinite(value) || !Number.isFinite(denomQty) || denomQty === 0) return null;
  if (denomUnit) value = value / denomQty; // per single denominator unit
  return { value: round(value), unit, per: denomUnit || '1' };
}
export function rxNavStrengths(concept: string): Strength[] {
  const out: Strength[] = [];
  for (const m of concept.matchAll(/([\d.]+)\s*(MG|MCG|G|UNT|MEQ|%)(?:\/(ML|ACTUAT|HR))?/gi)) {
    out.push({ value: round(Number(m[1])), unit: m[2]!.toUpperCase(), per: (m[3] ?? '1').toUpperCase() });
  }
  return out;
}
export function sameStrength(a: Strength, b: Strength): boolean {
  return a.unit === b.unit && a.per === b.per && Math.abs(a.value - b.value) < 1e-9;
}
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
