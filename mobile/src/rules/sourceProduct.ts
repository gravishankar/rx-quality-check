/** Source-product (repackager) uncertainty, shared by record classification and evidence aggregation. */
import type { MedicationIdentity } from '../models/identity.ts';

/**
 * True when a recall listed under the product this one was repackaged from might not be found:
 * the source was not established, could not be checked, was only partly resolved (C3), or was never
 * checked for a product not known to be its original packager.
 */
export function sourceProductUncertain(identity: MedicationIdentity): boolean {
  switch (identity.sourceProductStatus) {
    case 'NOT_ESTABLISHED':
    case 'UNAVAILABLE':
    case 'PARTIAL':
      return true;
    case 'NOT_CHECKED':
    case undefined:
      return identity.level === 'PRODUCT' && identity.productNdc !== null && identity.isOriginalPackager !== true;
    case 'VERIFIED':
    case 'NOT_APPLICABLE':
      return false;
    default: {
      const never: never = identity.sourceProductStatus;
      return never;
    }
  }
}

