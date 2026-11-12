/**
 * Acknowledgement of the first-launch notice and legal documents. Records which document versions
 * the user saw, on the phone only. Recording an acknowledgement does not by itself establish that
 * terms are enforceable (docs/LEGAL_REGULATORY_REVIEW.md).
 */
import { LEGAL_DOCUMENTS, type LegalDocumentId } from './documents.ts';

export type Acknowledgements = Partial<Record<LegalDocumentId, { version: string; at: string }>>;

export interface ConsentStore {
  load(): Promise<Acknowledgements>;
  save(a: Acknowledgements): Promise<void>;
  clear(): Promise<void>;
}

export function memoryConsentStore(): ConsentStore {
  let a: Acknowledgements = {};
  return {
    load: async () => ({ ...a }),
    save: async (x) => {
      a = { ...x };
    },
    clear: async () => {
      a = {};
    },
  };
}

/** Documents shown at first launch whose current version has not been acknowledged. */
export function documentsNeedingAcknowledgement(a: Acknowledgements): LegalDocumentId[] {
  return LEGAL_DOCUMENTS.filter((d) => d.showAtFirstLaunch && a[d.id]?.version !== d.version).map((d) => d.id);
}

export function acknowledge(a: Acknowledgements, now: string): Acknowledgements {
  const out: Acknowledgements = { ...a };
  for (const d of LEGAL_DOCUMENTS) if (d.showAtFirstLaunch) out[d.id] = { version: d.version, at: now };
  return out;
}
