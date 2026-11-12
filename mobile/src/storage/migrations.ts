/**
 * Schema migrations. Each migration runs once, in order, inside a transaction, and records its
 * version in `schema_meta`. Never edit a released migration; add a new one.
 *
 * Patient data (medications, fills, lots, assessments) is protected by whole-database encryption
 * (SQLCipher via op-sqlite) on the device. `source_cache` holds only public regulatory responses.
 */
import type { SqlDriver } from './driver.ts';

export interface Migration {
  version: number;
  description: string;
  statements: string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'Initial schema: medications, fills, assessments, evidence, public cache, config snapshots',
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      `CREATE TABLE medication (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        catalog_drug_id TEXT,
        identity_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        archived_at TEXT
      )`,
      `CREATE TABLE fill (
        id TEXT PRIMARY KEY,
        medication_id TEXT NOT NULL REFERENCES medication(id) ON DELETE CASCADE,
        scanned_at TEXT NOT NULL,
        fill_date TEXT,
        package_ndc TEXT,
        product_ndc TEXT,
        identity_level TEXT NOT NULL CHECK (identity_level IN ('PRODUCT','CLINICAL_DRUG')),
        identity_json TEXT NOT NULL,
        dose_form TEXT NOT NULL,
        release_mechanism TEXT NOT NULL CHECK (release_mechanism IN ('IR','ER','DR','UNSPECIFIED')),
        labeler_name TEXT,
        lot TEXT,
        container_type TEXT CHECK (container_type IN ('PHARMACY_VIAL','ORIGINAL_PACKAGE','UNKNOWN'))
      )`,
      `CREATE TABLE assessment (
        id TEXT PRIMARY KEY,
        fill_id TEXT NOT NULL REFERENCES fill(id) ON DELETE CASCADE,
        evaluated_at TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        finding TEXT NOT NULL CHECK (finding IN ('CONFIRMED_MATCH','POTENTIAL_MATCH','NO_MATCH_FOUND','UNRESOLVED')),
        finding_json TEXT NOT NULL,
        ruleset_version TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        catalog_version TEXT NOT NULL,
        dataset_last_updated TEXT,
        coverage_complete INTEGER NOT NULL CHECK (coverage_complete IN (0,1))
      )`,
      `CREATE TABLE assessment_evidence (
        assessment_id TEXT NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
        recall_number TEXT NOT NULL,
        relevance TEXT NOT NULL CHECK (relevance IN ('PRODUCT_MATCH','POSSIBLE_MATCH','OTHER_PRODUCT','UNPARSEABLE')),
        classification TEXT NOT NULL CHECK (classification IN ('CONFIRMED_MATCH','POTENTIAL_MATCH','NOT_APPLICABLE','UNRESOLVED')),
        lot_result TEXT NOT NULL,
        reasons TEXT NOT NULL,
        PRIMARY KEY (assessment_id, recall_number)
      )`,
      `CREATE TABLE source_cache (
        source TEXT NOT NULL,
        query_key TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('OK','NO_MATCH')),
        body_json TEXT,
        source_last_updated TEXT,
        retrieved_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (source, query_key)
      )`,
      `CREATE TABLE config_snapshot (
        kind TEXT NOT NULL CHECK (kind IN ('CATALOG','POLICY')),
        version TEXT NOT NULL,
        json TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        PRIMARY KEY (kind, version)
      )`,
      `CREATE INDEX idx_fill_med ON fill(medication_id, scanned_at)`,
      `CREATE INDEX idx_assessment_fill ON assessment(fill_id, saved_at)`,
      `CREATE INDEX idx_assessment_policy ON assessment(policy_version)`,
      `CREATE INDEX idx_cache_exp ON source_cache(expires_at)`,
    ],
  },
];

export async function schemaVersion(db: SqlDriver): Promise<number> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const rows = await db.all<{ value: string }>(`SELECT value FROM schema_meta WHERE key = 'schema_version'`);
  return rows[0] ? Number(rows[0].value) : 0;
}

/** Apply pending migrations. Returns the versions applied. A failing migration is rolled back whole. */
export async function migrate(db: SqlDriver, migrations: readonly Migration[] = MIGRATIONS): Promise<number[]> {
  const applied: number[] = [];
  let current = await schemaVersion(db);
  const known = Math.max(0, ...migrations.map((m) => m.version));
  if (current > known) throw new Error(`database schema ${current} is newer than this app (${known}); update the app`);
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue;
    if (m.version !== current + 1) throw new Error(`missing migration ${current + 1}`);
    await db.transaction(async () => {
      for (const s of m.statements) await db.exec(s);
      await db.run(`INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(m.version)]);
    });
    current = m.version;
    applied.push(m.version);
  }
  return applied;
}
