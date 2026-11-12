/**
 * Ingredient name normalization and conservative ingredient-set reading from free text
 * (R-ID-3, ID-4, RC-4).
 *
 * Exact ingredient-set matching: a combination product never matches a single-ingredient identity,
 * and vice versa. Text is read conservatively: a partner ingredient is reported only when it is
 * joined to an identity ingredient by an explicit connector ("and", "&", "/", "+", "with", or a comma
 * inside parentheses). Anything the reader cannot interpret is reported as unknown, never as a
 * difference.
 */

/** Salt / ester / hydrate words that follow a base ingredient name. Lower case. */
const SALT_CANONICAL: Record<string, string> = {
  hydrochloride: 'hydrochloride',
  hcl: 'hydrochloride',
  besylate: 'besylate',
  calcium: 'calcium',
  sodium: 'sodium',
  potassium: 'potassium',
  magnesium: 'magnesium',
  bitartrate: 'bitartrate',
  succinate: 'succinate',
  succ: 'succinate',
  tartrate: 'tartrate',
  tart: 'tartrate',
  mesylate: 'mesylate',
  maleate: 'maleate',
  fumarate: 'fumarate',
  citrate: 'citrate',
  sulfate: 'sulfate',
  acetate: 'acetate',
  etexilate: 'etexilate',
  mofetil: 'mofetil',
  medoxomil: 'medoxomil',
};
const HYDRATE_WORDS = new Set(['trihydrate', 'monohydrate', 'dihydrate', 'sesquihydrate', 'hemihydrate', 'anhydrous', 'hydrate']);

/**
 * Name synonyms that refer to the same ingredient moiety. Sources: RxNorm (mycophenolic acid is
 * RxCUI 7145, listed under "mycophenolate" in data/exclusion_policy.json); "APAP" is the standard
 * pharmacy abbreviation for acetaminophen used on dispensing labels and in FDA recall text.
 */
const NAME_SYNONYMS: Record<string, string> = {
  'mycophenolic acid': 'mycophenolate',
  mycophenolic: 'mycophenolate',
  apap: 'acetaminophen',
};

export function canonicalSalt(word: string): string | null {
  return SALT_CANONICAL[word.toLowerCase()] ?? null;
}

export function isHydrateWord(word: string): boolean {
  return HYDRATE_WORDS.has(word.toLowerCase());
}

/**
 * Split a published ingredient name ("METFORMIN HYDROCHLORIDE", "ATORVASTATIN CALCIUM TRIHYDRATE",
 * "MYCOPHENOLIC ACID") into a normalized base name and salt.
 */
export function splitIngredientName(published: string): { name: string; salt: string | null } {
  const words = published.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  const joined = words.join(' ');
  if (NAME_SYNONYMS[joined]) return { name: NAME_SYNONYMS[joined] as string, salt: null };
  const base: string[] = [];
  let salt: string | null = null;
  for (const w of words) {
    const s = canonicalSalt(w);
    if (s !== null && base.length > 0) {
      salt ??= s;
      continue;
    }
    if (isHydrateWord(w)) continue;
    if (salt !== null) continue; // words after the salt (rare) are not part of the base name
    base.push(w);
  }
  const name = base.join(' ');
  return { name: NAME_SYNONYMS[name] ?? name, salt };
}

// ---------------------------------------------------------------------------------------------
// Free-text ingredient reading
// ---------------------------------------------------------------------------------------------

type Tok = { kind: 'word'; w: string } | { kind: 'num' } | { kind: 'conn'; c: string } | { kind: 'open' } | { kind: 'close' } | { kind: 'comma' } | { kind: 'other' };

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /([A-Za-z][A-Za-z'-]*[A-Za-z0-9]*|[A-Za-z])|(\d[\d.,]*)|(\/|&|\+)|(\()|(\))|(,)|(\S)/g;
  for (const m of text.matchAll(re)) {
    if (m[1]) {
      const w = m[1].toLowerCase();
      if (w === 'and' || w === 'with') out.push({ kind: 'conn', c: w });
      else out.push({ kind: 'word', w });
    } else if (m[2]) out.push({ kind: 'num' });
    else if (m[3]) out.push({ kind: 'conn', c: m[3] });
    else if (m[4]) out.push({ kind: 'open' });
    else if (m[5]) out.push({ kind: 'close' });
    else if (m[6]) out.push({ kind: 'comma' });
    else out.push({ kind: 'other' });
  }
  return out;
}

/**
 * Words that may follow (or precede) a connector without being an ingredient: dose forms,
 * release descriptors, compendial and packaging words. Lower case.
 */
const DESCRIPTOR_WORDS = new Set([
  'tablet', 'tablets', 'tab', 'tabs', 'tables', 'capsule', 'capsules', 'cap', 'caps', 'usp', 'nf', 'rx', 'only',
  'oral', 'solution', 'suspension', 'syrup', 'elixir', 'injection', 'extended-release', 'extended', 'release',
  'delayed-release', 'delayed', 'immediate', 'er', 'xr', 'xl', 'sr', 'dr', 'ir', 'ec', 'odt', 'film', 'coated',
  'film-coated', 'chewable', 'disintegrating', 'orally', 'for', 'the', 'a', 'b', 'c', 'd', 'e', 'packaged', 'bottle',
  'bottles', 'count', 'blister', 'blisters', 'carton', 'cartons', 'bulk', 'generic', 'sample', 'physician',
  'unit', 'dose', 'mg', 'mcg', 'ml', 'g', 'labeled', 'labelled', 'distributed', 'manufactured', 'marketed', 'by',
  'in', 'of', 'per', 'each', 'lot', 'lots', 'exp', 'cii', 'ciii', 'civ', 'c-ii', 'c-iii', 'hr', 'hour', 'kit',
  'pack', 'packs', 'vial', 'vials', 'tube', 'tubes', 'box', 'boxes', 'case', 'cases', 'other', 'strengths',
]);

export interface TextIngredientReading {
  /** Identity ingredients (base names) found in the text. */
  found: string[];
  /** Identity ingredients not found in the text. */
  missing: string[];
  /** Words joined to an identity ingredient by a connector that are not identity ingredients. */
  partners: string[];
  /** Salt printed directly after each found ingredient (canonical), when present. */
  salts: Record<string, string | null>;
}

/**
 * Read which of the identity's ingredients a recall/label text names, and whether it joins them
 * to any other ingredient.
 */
export function readIngredientsFromText(
  text: string,
  identityIngredientNames: readonly string[],
  /** Extra alias → ingredient-name mappings (from the catalog), lower case. */
  aliases: Readonly<Record<string, string>> = {},
): TextIngredientReading {
  const targets = new Set(identityIngredientNames.map((n) => n.toLowerCase()));
  const synonymOf = (w: string): string => aliases[w] ?? NAME_SYNONYMS[w] ?? w;
  const toks = tokenize(text);
  const found = new Set<string>();
  const partners = new Set<string>();
  const salts: Record<string, string | null> = {};

  // Parenthesis depth per token, for the "comma inside parentheses is a list separator" rule.
  const depth: number[] = [];
  let d = 0;
  for (const t of toks) {
    if (t.kind === 'open') d += 1;
    depth.push(d);
    if (t.kind === 'close') d = Math.max(0, d - 1);
  }

  const isTarget = (t: Tok | undefined): t is { kind: 'word'; w: string } =>
    t !== undefined && t.kind === 'word' && targets.has(synonymOf(t.w));
  const isConnector = (i: number): boolean => {
    const t = toks[i];
    if (!t) return false;
    if (t.kind === 'conn') return true;
    if (t.kind !== 'comma') return false;
    if ((depth[i] ?? 0) > 0) return true;
    // Outside parentheses a comma separates ingredients only in a list closed by "and"/"&"
    // ("Olmesartan, Amlodipine, and Hydrochlorothiazide"); otherwise it is ordinary punctuation
    // ("Preferred Pharmaceuticals Inc., Metformin HCl, Extended Release").
    for (let k = i + 1; k < Math.min(toks.length, i + 8); k++) {
      const u = toks[k] as Tok;
      if (u.kind === 'conn' && (u.c === 'and' || u.c === '&')) return true;
      if (u.kind === 'num' || u.kind === 'open' || u.kind === 'close') return false;
      if (u.kind === 'word' && DESCRIPTOR_WORDS.has(u.w)) return false;
    }
    return false;
  };
  // Classify the word at i as a partner, a target, or neither.
  const partnerAt = (i: number): string | null => {
    const t = toks[i];
    if (!t || t.kind !== 'word') return null;
    const w = synonymOf(t.w);
    if (targets.has(w)) return null;
    if (DESCRIPTOR_WORDS.has(w) || canonicalSalt(w) !== null || isHydrateWord(w)) return null;
    return w;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!isTarget(t)) continue;
    const name = synonymOf(t.w);
    found.add(name);

    // Salt directly after the name (skip hydrate words).
    let j = i + 1;
    let salt: string | null = null;
    while (toks[j]?.kind === 'word') {
      const w = (toks[j] as { w: string }).w;
      const s = canonicalSalt(w);
      if (s !== null) {
        salt ??= s;
        j += 1;
        continue;
      }
      if (isHydrateWord(w)) {
        j += 1;
        continue;
      }
      break;
    }
    if (!(name in salts) || salts[name] === null) salts[name] = salt;

    // Forward: connector then a non-target, non-descriptor word => partner ingredient.
    // ", and" / ", &" count as one connector.
    if (isConnector(j)) {
      const n = toks[j]?.kind === 'comma' && toks[j + 1]?.kind === 'conn' ? j + 2 : j + 1;
      const p = partnerAt(n);
      if (p !== null) partners.add(p);
    }
    // Backward: skip salt/hydrate words preceding? (a salt never precedes its base) — look at the
    // token immediately before the name.
    if (isConnector(i - 1)) {
      // Walk back over salts/hydrates of the preceding ingredient ("Amlodipine Besylate and Atorvastatin").
      let k = toks[i - 1]?.kind === 'conn' && isConnector(i - 2) ? i - 3 : i - 2;
      while (toks[k]?.kind === 'word' && (canonicalSalt((toks[k] as { w: string }).w) !== null || isHydrateWord((toks[k] as { w: string }).w))) {
        k -= 1;
      }
      const p = partnerAt(k);
      if (p !== null) partners.add(p);
    }
  }
  return {
    found: [...found],
    missing: [...targets].filter((n) => !found.has(n)),
    partners: [...partners],
    salts,
  };
}

/** Equality of two ingredient-name sets (normalized base names). */
export function sameIngredientSet(a: readonly string[], b: readonly string[]): boolean {
  const A = new Set(a.map((x) => x.toLowerCase()));
  const B = new Set(b.map((x) => x.toLowerCase()));
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}
