/**
 * Build-time configuration bundled into the app: the versioned catalog and policy (validated by the
 * repository's tests and loaded fail-closed by the engine) and the build profile written by the
 * build scripts. A pilot profile never accepts draft configuration (OD-18).
 */
import catalogJson from '../../data/drug_catalog.json';
import policyJson from '../../data/exclusion_policy.json';
import buildProfileJson from '../config/build_profile.json';
import { parseBuildProfile, profileFor, type BuildProfile } from '../src/app/buildProfile.ts';

const parsed = parseBuildProfile(buildProfileJson);
export const PROFILE: BuildProfile = profileFor(parsed.kind, parsed.encryptionVerifiedOnDevice);
export const CATALOG_JSON: unknown = catalogJson;
export const POLICY_JSON: unknown = policyJson;
