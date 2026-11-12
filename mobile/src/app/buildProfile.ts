/**
 * Build profiles (OD-18, ADR-0001). The profile is fixed at bundle time
 * (mobile/config/build_profile.json, written by the build scripts) and cannot be changed in the app.
 *
 *  - development: owner testing only. Clearly labeled. Accepts draft configuration. Saved history
 *    is DISABLED (in-memory only) until SQLCipher encryption is verified on a device. Safety gates,
 *    the evidence policy and the presentation rules are identical to pilot.
 *  - pilot: external evaluation. Refuses draft configuration (fail closed). Built only when
 *    `npm run release:gate` reports no blockers.
 */
import { APP_VERSION, BUILD_NUMBER } from './version.ts';

export type BuildKind = 'development' | 'pilot';

export interface BuildProfile {
  kind: BuildKind;
  appVersion: string;
  /** Increases with every APK built (config/app_version.json). */
  buildNumber: number;
  /** Accept DRAFT/PROPOSED catalog and policy files. Never true for pilot. */
  allowUnapprovedConfig: boolean;
  /** Persist medications and results in the encrypted database. */
  persistHistory: boolean;
  /** Set only after native encryption at rest was verified on a physical device (PV-4). */
  encryptionVerifiedOnDevice: boolean;
  label: string;
}

export { APP_VERSION, BUILD_NUMBER };

export function profileFor(kind: BuildKind, encryptionVerifiedOnDevice: boolean): BuildProfile {
  if (kind === 'pilot') {
    return {
      kind,
      appVersion: APP_VERSION,
      buildNumber: BUILD_NUMBER,
      allowUnapprovedConfig: false,
      persistHistory: encryptionVerifiedOnDevice,
      encryptionVerifiedOnDevice,
      label: 'Evaluation prototype',
    };
  }
  return {
    kind,
    appVersion: APP_VERSION,
    buildNumber: BUILD_NUMBER,
    allowUnapprovedConfig: true,
    // OD-18 / Task 4A §10: no persistent medication history without verified encryption.
    persistHistory: false,
    encryptionVerifiedOnDevice,
    label: 'DEVELOPMENT BUILD',
  };
}

/** Parse mobile/config/build_profile.json; anything unexpected falls back to the safest profile. */
export function parseBuildProfile(json: unknown): BuildProfile {
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  const kind: BuildKind = o.profile === 'pilot' ? 'pilot' : 'development';
  return profileFor(kind, o.encryption_verified_on_device === true);
}

export interface ReleaseInputs {
  catalogStatus: string | null;
  policyStatus: string | null;
  legalDocuments: { id: string; status: string }[];
  signoffs: Record<string, { signed: boolean; by: string | null; date: string | null }>;
  encryptionVerifiedOnDevice: boolean;
  /** config/brand.json name_status; a pilot needs a name cleared by counsel (Task 4A.1). */
  brandNameStatus?: string | null;
}

export const REQUIRED_SIGNOFFS = [
  'regulatory_classification',
  'legal_review',
  'clinical_pharmacist_wording_review',
  'configuration_approval',
  'security_testing',
  'android_device_testing',
] as const;

/** Every reason a pilot (external) build must not be produced. Empty = no blockers. */
export function pilotBlockers(r: ReleaseInputs): string[] {
  const out: string[] = [];
  if (r.brandNameStatus !== undefined && r.brandNameStatus !== 'CLEARED_BY_COUNSEL') out.push(`product name is ${r.brandNameStatus ?? 'unset'}, not cleared by counsel (docs/BRAND_CLEARANCE.md)`);
  if (r.catalogStatus !== 'APPROVED') out.push(`drug catalog status is ${r.catalogStatus ?? 'invalid'}, not APPROVED (OD-2)`);
  if (r.policyStatus !== 'APPROVED') out.push(`exclusion policy status is ${r.policyStatus ?? 'invalid'}, not APPROVED (OD-2)`);
  for (const d of r.legalDocuments) if (d.status !== 'APPROVED') out.push(`legal document ${d.id} is ${d.status}`);
  for (const s of REQUIRED_SIGNOFFS) {
    const x = r.signoffs[s];
    if (!x || !x.signed || !x.by || !x.date) out.push(`sign-off missing: ${s}`);
  }
  if (!r.encryptionVerifiedOnDevice) out.push('SQLCipher encryption at rest not verified on a physical device (PV-4)');
  return out;
}
