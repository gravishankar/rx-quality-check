# Proposed Data Architecture — Provenance Graph (Task 4B, proposal only)

Goal: link **Medication → Product NDC → Labeler → Source manufacturer → Candidate facilities →
Regulatory evidence**, where every edge carries its source and verification status, without changing
the existing recall engine, state machine, safety gates or presentation downgrade rules.

## 1. Principles

1. **Edges, not conclusions.** The graph stores what each source says. Presentation decides wording,
   and may only weaken (as today).
2. **Every edge has provenance:** source, source record ID, retrieval time, dataset date, and a
   verification status.
3. **Three evidence scopes, never merged:** PRODUCT (names the patient's product NDC / its declared
   source), FACILITY (concerns an establishment listed in the product's labeling), COMPANY (concerns a
   firm by name/corporate entity, not a listed establishment).
4. **Candidates stay candidates.** A multi-plant product has k candidate facilities; evidence for each
   is shown for each, with no selection, ranking, aggregation or "worst case".
5. **Unknown ≠ unavailable ≠ conflicting ≠ none.** Distinct statuses end to end.
6. **No backend.** On-device lookups use the allowed hosts; regulatory evidence comes from a versioned,
   reviewed **snapshot bundled with the app** (OD-25), shown with its snapshot date.

## 2. Graph

```
Medication (user-confirmed record)
  └─ IDENTIFIES ─> ProductNDC            [NDC Directory | DIRECTORY_CONFIRMED / USER_CONFIRMED / SCANNED_UNVERIFIED]
        ├─ LISTED_BY ─> Labeler          [NDC Directory labeler_name | AS_LISTED]
        ├─ HAS_LABEL ─> SplDocument      [NDC Directory openfda.spl_set_id → DailyMed | VERIFIED_EXACT_ID]
        ├─ REPACKAGED_FROM ─> ProductNDC [SPL asEquivalentEntity + NDC Directory | VERIFIED / AMBIGUOUS (k sources) / NOT_DECLARED]
        ├─ UNDER_APPLICATION ─> Application [NDC Directory application_number; Drugs@FDA sponsor | VERIFIED_EXACT_ID]
        └─ (via its own or source SplDocument)
             LISTS_ESTABLISHMENT ─> Establishment (DUNS)  [SPL performance | operation = MANUFACTURE / API_MANUFACTURE / PACK / LABEL / ANALYSIS / STERILIZE / REPACK / RELABEL]
                   └─ REGISTERED_AS ─> Facility (FEI)     [DECRS snapshot | VERIFIED_EXACT_ID / UNMATCHED / MULTIPLE]
                          └─ HAS_EVIDENCE ─> EvidenceItem [Data Dashboard snapshot | scope FACILITY]
Firm (name)  ─ HAS_EVIDENCE ─> EvidenceItem               [warning-letter index; recall recalling_firm | scope COMPANY]
ProductNDC   ─ HAS_EVIDENCE ─> RecallFinding              [existing recall engine | scope PRODUCT]
```

## 3. Types (TypeScript sketch for `mobile/src/models/provenance.ts`, not implemented)

```ts
type VerificationStatus =
  | 'VERIFIED_EXACT_ID'     // joined on an exact identifier (NDC, SPL set id, DUNS, FEI, application no.)
  | 'USER_CONFIRMED'        // the patient confirmed it (e.g., lot, imprint choice)
  | 'SCANNED_UNVERIFIED'    // read by camera, not yet matched
  | 'AS_LISTED'             // a source's own statement, not independently verified (labeler name)
  | 'AMBIGUOUS'             // several candidates; none chosen
  | 'CONFLICTING'           // sources disagree; none chosen
  | 'NOT_DECLARED'          // the source has no such information
  | 'UNAVAILABLE'           // lookup failed / source unreachable
  | 'STALE';                // older than the acceptance window

interface EdgeProvenance {
  source: 'NDC_DIRECTORY' | 'DAILYMED_SPL' | 'DRUGS_AT_FDA' | 'DECRS' | 'FDA_DATA_DASHBOARD' | 'FDA_WARNING_LETTERS' | 'OPENFDA_ENFORCEMENT' | 'RXNAV' | 'USER';
  sourceRecordId: string | null;   // e.g., SPL set id + version, FEI, recall number
  retrievedAt: string;             // device time (ISO) or snapshot build time
  datasetDate: string | null;      // meta.last_updated, SPL effectiveTime, snapshot source date
  status: VerificationStatus;
}

type EvidenceScope = 'PRODUCT' | 'FACILITY' | 'COMPANY';

interface EvidenceItem {
  kind: 'RECALL' | 'INSPECTION_CLASSIFICATION' | 'WARNING_LETTER' | 'SEIZURE' | 'INJUNCTION' | 'IMPORT_ALERT';
  scope: EvidenceScope;
  subject: { fei?: string; duns?: string; firmName: string; country?: string };
  date: string;                    // inspection end date / letter issue date / report date
  facts: Record<string, string>;   // classification, project area, subject, status — verbatim from source
  officialUrl: string | null;
  provenance: EdgeProvenance;
  relevanceNote: RelevanceNote;    // why it is shown and what it does NOT establish
}

type RelevanceNote =
  | 'NAMES_THIS_PRODUCT'
  | 'LISTED_FACILITY_NOT_PROVEN_SOURCE_OF_YOUR_SUPPLY'
  | 'COMPANY_LEVEL_NOT_THIS_FACILITY'
  | 'DIFFERENT_PRODUCT_SAME_FIRM'
  | 'PROJECT_AREA_MAY_NOT_COVER_THIS_PRODUCT';
```

## 4. Module placement (keeps Task 2–4A boundaries)

| Module | Responsibility |
|---|---|
| `rules/spl.ts` (new, pure) | Real XML parsing of establishments and operations (replaces the feasibility string scanner); fixture tests |
| `rules/provenance.ts` (new, pure) | Build the graph from records; classify scopes; never pick among candidates |
| `services/` | Existing clients + DailyMed SPL fetch (already present) |
| `data/regulatory_snapshot/` (new, versioned) | Snapshot files: DUNS→FEI subset, inspections, compliance actions for facilities reachable from catalog products; manifest with source dates and hashes; validated by tests |
| `scripts/build_regulatory_snapshot.ts` (new, offline) | Reproducible build from FDA downloads; human review step before commit |
| `presentation/evidence.ts` (new) | Evidence cards; wording from `copy/`; only weakens |
| Recall engine, state machine, gates | **Unchanged.** Provenance runs after identity confirmation as a separate, optional effect; it never changes a recall finding |

## 5. Snapshot (OD-25) — why and how

- The FDA Data Dashboard API needs a per-user credential (cannot be shipped in an app); DECRS and
  import alerts are on hosts outside the allowlist; import alerts are HTML. A server would violate the
  architecture.
- Proposal: an offline script downloads the public files, filters to facilities reachable from the
  catalog's products' SPL establishments, and writes a small, versioned JSON snapshot (expected
  kilobytes to low megabytes) with a manifest (source URLs, download dates, SHA-256). A person reviews
  the diff; the snapshot ships with an app release. The app shows "FDA inspection data as of <snapshot
  date>" and treats a snapshot older than N days (proposed 120) as STALE.
- Facilities in a scanned product that are **not** in the snapshot → "No inspection records are
  included for this facility in this version of the app" (UNAVAILABLE), never "no inspections".

## 6. What the graph will refuse to do

- Infer which facility made a lot; rank or score facilities or companies; aggregate across candidates;
  match firms by fuzzy name/address in v1; show an inspection without its date, project area and
  scope; turn missing data into absence of problems.
