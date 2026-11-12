/**
 * Validate the drug catalog and exclusion policy.
 *
 *   npm run catalog:validate                 catalog only
 *   npm run policy:validate                  policy only
 *   npm run config:validate                  both, plus cross-file checks
 *   npm run config:test                      both, plus the precedence self-test
 *
 * Options (after `--`):
 *   --catalog-file <path>   validate another catalog file (e.g. a proposed change)
 *   --policy-file <path>    validate another policy file
 *   --release               require APPROVED status (as release builds do; RG-8)
 *
 * Exit code 0 = valid; 1 = errors or precedence failures.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConfig, formatReport } from './lib/config_check.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? resolve(args[i + 1] as string) : undefined;
};
const which = args.includes('--catalog') ? 'catalog' : args.includes('--policy') ? 'policy' : 'all';
const report = checkConfig(ROOT, {
  which,
  catalogPath: opt('--catalog-file'),
  policyPath: opt('--policy-file'),
  precedence: args.includes('--test'),
  load: { allowUnapproved: !args.includes('--release') },
  expectationsPath: args.includes('--test') ? (opt('--expectations') ?? join(ROOT, 'data', 'config_expectations.json')) : undefined,
});
const { text, ok } = formatReport(report);
console.log(text);
process.exit(ok ? 0 : 1);
