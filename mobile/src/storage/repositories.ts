/**
 * Repositories over the local database. Pure data access: no network, no rules except the refill
 * comparison used when saving a new fill.
 *
 * Historical integrity: assessment rows are never updated. A re-check, or a re-assessment after a
 * catalog/policy/rule-set change, inserts a new row. `isStale` tells the UI which saved assessments
 * were made under configuration that differs from the running one; they are shown as-is with their
 * versions until the user re-checks.
 */
import type { RecallFinding } from '../models/evidence.ts';
import type { MedicationIdentity } from '../models/identity.ts';
import { productKeyOfProductNdc } from '../rules/ndc.ts';
import { diffFills, type RefillDiff } from '../rules/refill.ts';
import type { CachedResult } from '../state/machine.ts';
import type { CachedResponse, SourceCache, AssessmentStore } from '../services/ports.ts';
import type { KeyStore, SqlDriver } from './driver.ts';
import { migrate } from './migrations.ts';

export interface ConfigVersions {
  rulesetVersion: string;
  policyVersion: string;
  catalogVersion: string;
}

export interface SavedAssessment {
  id: string;
  fillId: string;
  medicationId: string;
  evaluatedAt: string;
  savedAt: string;
  finding: RecallFinding;
  versions: ConfigVersions;
}

/**
 * Key that groups fills into one saved medication: the ingredient set. A refill with a different
 * labeler, strength, form or release stays under the same medication, so diffFills can report the
 * change ("check with your pharmacist") instead of silently starting a new record.
 */
export function medicationKey(identity: MedicationIdentity): string {
  return identity.ingredients.map((i) => i.name).sort().join('+');
}

/** Exact identity for reusing a saved assessment offline: the product, else the full clinical drug. */
export function identityLookupKey(identity: MedicationIdentity): string {
  if (identity.productNdc !== null) return `product:${productKeyOfProductNdc(identity.productNdc)}`;
  const ings = identity.ingredients
    .map((i) => `${i.name}:${i.strength ? `${i.strength.value}${i.strength.unit}/${i.strength.per}` : '?'}`)
    .sort()
    .join('+');
  return `clinical:${ings}|${identity.doseForm}|${identity.release}`;
}

export interface Repositories {
  medications: {
    create(m: { displayName: string; catalogDrugId: string | null; identity: MedicationIdentity }): Promise<string>;
    findByIdentity(identity: MedicationIdentity): Promise<{ id: string; displayName: string } | null>;
    list(): Promise<{ id: string; displayName: string; catalogDrugId: string | null; createdAt: string }[]>;
    archive(id: string): Promise<void>;
    delete(id: string): Promise<void>;
  };
  fills: {
    add(medicationId: string, identity: MedicationIdentity, opts?: { fillDate?: string | null; containerType?: 'PHARMACY_VIAL' | 'ORIGINAL_PACKAGE' | 'UNKNOWN' }): Promise<{ id: string; refill: RefillDiff | null }>;
    history(medicationId: string): Promise<{ id: string; scannedAt: string; identity: MedicationIdentity }[]>;
  };
  assessments: {
    save(fillId: string, finding: RecallFinding, versions: ConfigVersions): Promise<string>;
    latestForMedication(medicationId: string): Promise<SavedAssessment | null>;
    listForMedication(medicationId: string): Promise<SavedAssessment[]>;
    listMadeUnder(filter: Partial<ConfigVersions>): Promise<SavedAssessment[]>;
  };
  cache: SourceCache & { purgeExpired(now: string): Promise<number> };
  configSnapshots: {
    record(kind: 'CATALOG' | 'POLICY', version: string, json: string): Promise<void>;
    get(kind: 'CATALOG' | 'POLICY', version: string): Promise<string | null>;
  };
}

export interface RepoDeps {
  now: () => string;
  newId: () => string;
}

export function isStale(a: SavedAssessment, current: ConfigVersions): boolean {
  return a.versions.policyVersion !== current.policyVersion || a.versions.catalogVersion !== current.catalogVersion || a.versions.rulesetVersion !== current.rulesetVersion;
}

export function createRepositories(db: SqlDriver, deps: RepoDeps): Repositories {
  const rowToAssessment = (r: Record<string, string | number | null>): SavedAssessment => ({
    id: String(r.id),
    fillId: String(r.fill_id),
    medicationId: String(r.medication_id),
    evaluatedAt: String(r.evaluated_at),
    savedAt: String(r.saved_at),
    finding: JSON.parse(String(r.finding_json)) as RecallFinding,
    versions: { rulesetVersion: String(r.ruleset_version), policyVersion: String(r.policy_version), catalogVersion: String(r.catalog_version) },
  });
  const ASSESSMENT_SELECT = `SELECT a.*, f.medication_id FROM assessment a JOIN fill f ON f.id = a.fill_id`;

  return {
    medications: {
      async create({ displayName, catalogDrugId, identity }) {
        const id = deps.newId();
        await db.run(`INSERT INTO medication (id, display_name, catalog_drug_id, identity_key, created_at) VALUES (?, ?, ?, ?, ?)`, [
          id, displayName, catalogDrugId, medicationKey(identity), deps.now(),
        ]);
        return id;
      },
      async findByIdentity(identity) {
        const rows = await db.all<{ id: string; display_name: string }>(
          `SELECT id, display_name FROM medication WHERE identity_key = ? AND archived_at IS NULL ORDER BY created_at LIMIT 1`,
          [medicationKey(identity)],
        );
        return rows[0] ? { id: rows[0].id, displayName: rows[0].display_name } : null;
      },
      async list() {
        const rows = await db.all<{ id: string; display_name: string; catalog_drug_id: string | null; created_at: string }>(
          `SELECT id, display_name, catalog_drug_id, created_at FROM medication WHERE archived_at IS NULL ORDER BY created_at`,
        );
        return rows.map((r) => ({ id: r.id, displayName: r.display_name, catalogDrugId: r.catalog_drug_id, createdAt: r.created_at }));
      },
      async archive(id) {
        await db.run(`UPDATE medication SET archived_at = ? WHERE id = ?`, [deps.now(), id]);
      },
      async delete(id) {
        await db.run(`DELETE FROM medication WHERE id = ?`, [id]);
      },
    },
    fills: {
      async add(medicationId, identity, opts = {}) {
        const prev = await db.all<{ identity_json: string }>(`SELECT identity_json FROM fill WHERE medication_id = ? ORDER BY scanned_at DESC, rowid DESC LIMIT 1`, [medicationId]);
        const refill = prev[0] ? diffFills(JSON.parse(prev[0].identity_json) as MedicationIdentity, identity) : null;
        const id = deps.newId();
        await db.run(
          `INSERT INTO fill (id, medication_id, scanned_at, fill_date, package_ndc, product_ndc, identity_level, identity_json, dose_form, release_mechanism, labeler_name, lot, container_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, medicationId, deps.now(), opts.fillDate ?? null, identity.packageNdc, identity.productNdc, identity.level, JSON.stringify(identity),
            identity.doseForm, identity.release, identity.labelerName, identity.lot, opts.containerType ?? 'UNKNOWN',
          ],
        );
        return { id, refill };
      },
      async history(medicationId) {
        const rows = await db.all<{ id: string; scanned_at: string; identity_json: string }>(
          `SELECT id, scanned_at, identity_json FROM fill WHERE medication_id = ? ORDER BY scanned_at, rowid`,
          [medicationId],
        );
        return rows.map((r) => ({ id: r.id, scannedAt: r.scanned_at, identity: JSON.parse(r.identity_json) as MedicationIdentity }));
      },
    },
    assessments: {
      async save(fillId, finding, versions) {
        const id = deps.newId();
        await db.transaction(async () => {
          await db.run(
            `INSERT INTO assessment (id, fill_id, evaluated_at, saved_at, finding, finding_json, ruleset_version, policy_version, catalog_version, dataset_last_updated, coverage_complete)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id, fillId, finding.evaluatedAt, deps.now(), finding.finding, JSON.stringify(finding), versions.rulesetVersion, versions.policyVersion,
              versions.catalogVersion, finding.coverage.datasetLastUpdated, finding.coverage.complete ? 1 : 0,
            ],
          );
          for (const r of [...finding.confirmed, ...finding.potential, ...finding.unresolved, ...finding.notApplicable]) {
            await db.run(
              `INSERT OR IGNORE INTO assessment_evidence (assessment_id, recall_number, relevance, classification, lot_result, reasons) VALUES (?, ?, ?, ?, ?, ?)`,
              [id, r.recallNumber, r.relevance, r.classification, r.lot, JSON.stringify(r.reasons)],
            );
          }
        });
        return id;
      },
      async latestForMedication(medicationId) {
        const rows = await db.all(`${ASSESSMENT_SELECT} WHERE f.medication_id = ? ORDER BY a.saved_at DESC, a.rowid DESC LIMIT 1`, [medicationId]);
        return rows[0] ? rowToAssessment(rows[0]) : null;
      },
      async listForMedication(medicationId) {
        return (await db.all(`${ASSESSMENT_SELECT} WHERE f.medication_id = ? ORDER BY a.saved_at, a.rowid`, [medicationId])).map(rowToAssessment);
      },
      async listMadeUnder(filter) {
        const where: string[] = [];
        const params: string[] = [];
        if (filter.policyVersion) (where.push('a.policy_version = ?'), params.push(filter.policyVersion));
        if (filter.catalogVersion) (where.push('a.catalog_version = ?'), params.push(filter.catalogVersion));
        if (filter.rulesetVersion) (where.push('a.ruleset_version = ?'), params.push(filter.rulesetVersion));
        const rows = await db.all(`${ASSESSMENT_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY a.saved_at`, params);
        return rows.map(rowToAssessment);
      },
    },
    cache: {
      async getFresh(source, queryKey, now): Promise<CachedResponse | null> {
        const rows = await db.all<{ outcome: string; body_json: string | null; retrieved_at: string; source_last_updated: string | null }>(
          `SELECT outcome, body_json, retrieved_at, source_last_updated FROM source_cache WHERE source = ? AND query_key = ? AND expires_at > ?`,
          [source, queryKey, now],
        );
        const r = rows[0];
        if (!r || (r.outcome !== 'OK' && r.outcome !== 'NO_MATCH')) return null;
        return { outcome: r.outcome, bodyJson: r.body_json, retrievedAt: r.retrieved_at, sourceLastUpdated: r.source_last_updated };
      },
      async put(e) {
        // Only OK / NO_MATCH reach here (the CHECK constraint also refuses anything else).
        await db.run(
          `INSERT INTO source_cache (source, query_key, outcome, body_json, source_last_updated, retrieved_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source, query_key) DO UPDATE SET outcome = excluded.outcome, body_json = excluded.body_json, source_last_updated = excluded.source_last_updated,
             retrieved_at = excluded.retrieved_at, expires_at = excluded.expires_at`,
          [e.source, e.queryKey, e.outcome, e.bodyJson, e.sourceLastUpdated, e.retrievedAt, e.expiresAt],
        );
      },
      async purgeExpired(now) {
        return (await db.run(`DELETE FROM source_cache WHERE expires_at <= ?`, [now])).changes;
      },
    },
    configSnapshots: {
      async record(kind, version, json) {
        await db.run(`INSERT OR IGNORE INTO config_snapshot (kind, version, json, installed_at) VALUES (?, ?, ?, ?)`, [kind, version, json, deps.now()]);
      },
      async get(kind, version) {
        const rows = await db.all<{ json: string }>(`SELECT json FROM config_snapshot WHERE kind = ? AND version = ?`, [kind, version]);
        return rows[0]?.json ?? null;
      },
    },
  };
}

/**
 * The runner's AssessmentStore: saving creates (or reuses) the medication, adds the fill (with the
 * refill comparison) and inserts an immutable assessment row stamped with the running versions.
 */
export function createAssessmentStore(repos: Repositories, versions: ConfigVersions, displayNameOf: (identity: MedicationIdentity) => { displayName: string; catalogDrugId: string | null }): AssessmentStore & {
  lastRefill(): RefillDiff | null;
} {
  let lastRefill: RefillDiff | null = null;
  return {
    lastRefill: () => lastRefill,
    async save(identity, finding) {
      const existing = await repos.medications.findByIdentity(identity);
      const medicationId = existing?.id ?? (await repos.medications.create({ ...displayNameOf(identity), identity }));
      const fill = await repos.fills.add(medicationId, identity);
      lastRefill = fill.refill;
      await repos.assessments.save(fill.id, finding, versions);
    },
    async latestFor(identity): Promise<CachedResult | null> {
      // Only an assessment of exactly this product (or clinical drug) is offered offline.
      const med = await repos.medications.findByIdentity(identity);
      if (!med) return null;
      const want = identityLookupKey(identity);
      const fills = new Map((await repos.fills.history(med.id)).map((f) => [f.id, f.identity]));
      const matching = (await repos.assessments.listForMedication(med.id)).filter((a) => {
        const fi = fills.get(a.fillId);
        return fi !== undefined && identityLookupKey(fi) === want;
      });
      const a = matching[matching.length - 1];
      const fi = a ? fills.get(a.fillId) : undefined;
      return a && fi ? { identity: fi, finding: a.finding, evaluatedAt: a.evaluatedAt } : null;
    },
  };
}

/** Open (and migrate) the local database. */
export async function openStorage(db: SqlDriver, deps: RepoDeps): Promise<{ db: SqlDriver; repos: Repositories; migrated: number[] }> {
  const migrated = await migrate(db);
  return { db, repos: createRepositories(db, deps), migrated };
}

/**
 * Delete all local data: the database file(s) and the encryption key. After this, nothing about the
 * user's medications remains in app storage. (Android also removes app data on uninstall; backup
 * is disabled — see docs/PRIVACY.md.)
 */
export async function deleteAllData(db: SqlDriver, keys: KeyStore | null): Promise<void> {
  await db.destroy();
  if (keys) await keys.deleteKey();
}
