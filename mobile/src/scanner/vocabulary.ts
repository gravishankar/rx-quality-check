/**
 * Words the scanner may need to split from glued OCR text: catalog and policy ingredient names and
 * aliases, split into words of three or more letters (pure; reads the configuration JSON loosely and
 * never fails — a missing word only means less splitting).
 */
export function vocabularyFromConfig(...configs: unknown[]): string[] {
  const words = new Set<string>();
  const add = (s: unknown) => {
    if (typeof s !== 'string') return;
    for (const w of s.toUpperCase().split(/[^A-Z]+/)) if (w.length >= 3) words.add(w);
  };
  for (const c of configs) {
    const o = (c ?? {}) as { ingredients?: { name?: unknown; aliases?: unknown }[]; drugs?: { display_name?: unknown }[]; ingredient_rules?: { ingredient?: unknown }[]; rules?: { ingredient?: unknown }[] };
    for (const i of Array.isArray(o.ingredients) ? o.ingredients : []) {
      add(i?.name);
      if (Array.isArray(i?.aliases)) i.aliases.forEach(add);
    }
    for (const d of Array.isArray(o.drugs) ? o.drugs : []) add(d?.display_name);
    for (const r of [...(Array.isArray(o.ingredient_rules) ? o.ingredient_rules : []), ...(Array.isArray(o.rules) ? o.rules : [])]) add(r?.ingredient);
  }
  return [...words];
}
