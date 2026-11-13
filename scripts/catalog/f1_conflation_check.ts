/**
 * F1 conflation check: read every RxNorm ingredient (IN) and salt form (PIN) name with the app's
 * ingredient-name reader before and after F1. An IN whose name the reader shortens is a conflation
 * risk (it would be read as a different, shorter ingredient). Writes build/f1/conflation.json.
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/catalog/f1_conflation_check.ts
 */
import { writeFileSync } from 'node:fs';
import { splitIngredientName as after } from '../../mobile/src/rules/ingredients.ts';
import { splitIngredientName as before } from '../../build/f1/ingredients_before.ts';

const get = async (tty: string) =>
  ((await (await fetch(`https://rxnav.nlm.nih.gov/REST/allconcepts.json?tty=${tty}`)).json()) as { minConceptGroup: { minConcept: { rxcui: string; name: string }[] } }).minConceptGroup.minConcept;
const ins = await get('IN');
const pins = await get('PIN');
const inNames = new Set(ins.map((c) => c.name.toLowerCase()));
// Ingredients the app checks (proposed catalog) or excludes (policy): the names that matter.
import { readFileSync } from 'node:fs';
const cat = JSON.parse(readFileSync('data/proposals/drug_catalog_0.3.0-proposed.json', 'utf8')) as { ingredients: { name: string; aliases: string[] }[] };
const pol = JSON.parse(readFileSync('data/exclusion_policy.json', 'utf8')) as { ingredient_rules: { ingredient: string; names: string[] }[] };
const appNames = new Set([...cat.ingredients.flatMap((i) => [i.name, ...i.aliases]), ...pol.ingredient_rules.flatMap((r) => [r.ingredient, ...r.names])].map((n) => n.toLowerCase()));
const changedIn = [];
for (const c of ins) {
  const b = before(c.name).name, a = after(c.name).name;
  if (a !== b) changedIn.push({ rxcui: c.rxcui, name: c.name, before: b, after: a, after_is_another_ingredient: inNames.has(a) && a !== c.name.toLowerCase(), after_is_app_ingredient: appNames.has(a) && a !== c.name.toLowerCase(), kept_whole_now: a === c.name.toLowerCase() });
}
const changedPin = [];
for (const c of pins) {
  const b = before(c.name).name, a = after(c.name).name;
  if (a !== b) changedPin.push({ rxcui: c.rxcui, name: c.name, before: b, after: a, after_is_an_ingredient: inNames.has(a) });
}
writeFileSync('build/f1/conflation.json', JSON.stringify({ ins: ins.length, pins: pins.length, changedIn, changedPin }, null, 1));
console.log(`RxNorm: ${ins.length} ingredients, ${pins.length} salt forms`);
console.log(`ingredients read differently after F1: ${changedIn.length}`);
console.log(`  now kept whole (were shortened before, e.g. "ferrous sulfate" -> "ferrous"): ${changedIn.filter((x) => x.kept_whole_now).length}`);
const shortened = changedIn.filter((x) => !x.kept_whole_now);
console.log(`  newly shortened: ${shortened.length}; of which now read as another RxNorm ingredient: ${shortened.filter((x) => x.after_is_another_ingredient).length}; read as an ingredient the app checks or excludes: ${shortened.filter((x) => x.after_is_app_ingredient).length}`);
for (const x of shortened) console.log(`    IN ${x.rxcui} "${x.name}" -> "${x.after}"${x.after_is_another_ingredient ? '  (another RxNorm ingredient)' : ''}${x.after_is_app_ingredient ? '  ** APP INGREDIENT **' : ''}`);
console.log(`salt forms read differently after F1: ${changedPin.length}; now read as their RxNorm ingredient name: ${changedPin.filter((x) => x.after_is_an_ingredient).length}`);
for (const x of changedPin.filter((x) => !x.after_is_an_ingredient)) console.log(`    PIN ${x.rxcui} "${x.name}": "${x.before}" -> "${x.after}" (not an RxNorm ingredient name)`);
