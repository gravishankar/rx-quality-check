/**
 * Pilot release gate. Lists every blocker for an external pilot build (exit 1 if any).
 *
 *   npm run release:gate
 *
 * Checks: catalog and policy APPROVED and valid in release mode; legal documents APPROVED; every
 * required sign-off present with a name and date; native encryption verified on a device.
 * `npm run android:pilot` runs this first and stops on any blocker.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pilotBlockers } from '../mobile/src/app/buildProfile.ts';
import { LEGAL_DOCUMENTS } from '../mobile/src/legal/documents.ts';
import { checkConfig } from './lib/config_check.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function releaseGate(root = ROOT, signoffsPath = join(root, 'config', 'release_signoffs.json')): string[] {
  const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8')) as Record<string, unknown>;
  const s = JSON.parse(readFileSync(signoffsPath, 'utf8')) as { encryption_verified_on_device: boolean; signoffs: Record<string, { signed: boolean; by: string | null; date: string | null }> };
  const strict = checkConfig(root, { load: { allowUnapproved: false } });
  const configErrors = strict.problems.filter((p) => p.severity === 'error' && !/is not APPROVED/.test(p.message)).map((p) => `config: ${p.path}: ${p.message}`);
  return [
    ...configErrors,
    ...pilotBlockers({
      catalogStatus: String(read('data/drug_catalog.json').status ?? null),
      policyStatus: String(read('data/exclusion_policy.json').status ?? null),
      legalDocuments: LEGAL_DOCUMENTS.map((d) => ({ id: d.id, status: d.status })),
      signoffs: s.signoffs,
      encryptionVerifiedOnDevice: s.encryption_verified_on_device === true,
    }),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const blockers = releaseGate();
  if (blockers.length === 0) {
    console.log('Release gate: no blockers.');
    process.exit(0);
  }
  console.log(`Release gate: ${blockers.length} blocker(s) — a pilot build must not be produced:`);
  for (const b of blockers) console.log(`  - ${b}`);
  process.exit(1);
}
