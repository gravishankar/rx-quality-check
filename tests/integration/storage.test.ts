/**
 * Local storage on Node's built-in SQLite (the device uses SQLCipher via op-sqlite; encryption is
 * NOT exercised here — see docs/PRIVACY.md and the device test PV-4). Migrations, repositories,
 * refill history, immutable assessment records across policy versions, the public-data cache and
 * complete deletion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { openNodeSqlite } from '../../mobile/src/storage/drivers/nodeSqlite.ts';
import { MIGRATIONS, migrate, schemaVersion, type Migration } from '../../mobile/src/storage/migrations.ts';
import { createAssessmentStore, createRepositories, deleteAllData, isStale, openStorage, medicationKey } from '../../mobile/src/storage/repositories.ts';
import { keychainKeyStore, memoryKeyStore, newKey, type KeychainApi } from '../../mobile/src/storage/keys.ts';
import { evaluateRecallEvidence, planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import { RULESET_VERSION } from '../../mobile/src/rules/version.ts';
import { apiNdcRecord, bundle, control, enf, firstNdcRecord, productIdentity, realNoMatch } from '../helpers/fixtures.ts';

let clock = Date.parse('2026-11-12T12:00:00Z');
const deps = { now: () => new Date(clock).toISOString(), newId: () => randomUUID() };
const tick = (ms = 1000) => (clock += ms);

const sunEr = (lot: string | null = null) => productIdentity(firstNdcRecord('ndc_pkg_62756-142-02'), '62756-142-02', lot);
const aphenaIr = () => productIdentity(apiNdcRecord('ndc_metformin'), '43353-982-30');
const findingFor = (id: ReturnType<typeof sunEr>) =>
  evaluateRecallEvidence(id, bundle(planRecallQueries(id), { ingredient_text: [enf('enf_text_metformin')], product_ndc: id.productNdc === '62756-142' ? [enf('enf_pndc_62756-142')] : [realNoMatch()], control: [control()] }));
const V1 = { rulesetVersion: RULESET_VERSION, policyVersion: '0.2.0-draft', catalogVersion: '0.2.0' };

test('migrations: fresh database reaches the latest schema; re-running is a no-op', async () => {
  const db = openNodeSqlite();
  assert.equal(await schemaVersion(db), 0);
  assert.deepEqual(await migrate(db), [1]);
  assert.equal(await schemaVersion(db), MIGRATIONS.length);
  assert.deepEqual(await migrate(db), []);
  const tables = (await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)).map((r) => r.name);
  assert.deepEqual(tables, ['assessment', 'assessment_evidence', 'config_snapshot', 'fill', 'medication', 'schema_meta', 'source_cache']);
});

test('migrations: a failing migration is rolled back completely and the version is unchanged', async () => {
  const db = openNodeSqlite();
  await migrate(db);
  const bad: Migration = { version: 2, description: 'test', statements: ['CREATE TABLE extra (x TEXT)', 'THIS IS NOT SQL'] };
  await assert.rejects(migrate(db, [...MIGRATIONS, bad]));
  assert.equal(await schemaVersion(db), 1);
  assert.equal((await db.all(`SELECT name FROM sqlite_master WHERE name = 'extra'`)).length, 0);
  const good: Migration = { version: 2, description: 'test', statements: ['ALTER TABLE medication ADD COLUMN nickname TEXT'] };
  assert.deepEqual(await migrate(db, [...MIGRATIONS, good]), [2]);
});

test('migrations: a database from a newer app is refused, never downgraded', async () => {
  const db = openNodeSqlite();
  await migrate(db);
  await db.run(`UPDATE schema_meta SET value = '99' WHERE key = 'schema_version'`);
  await assert.rejects(migrate(db), /newer than this app/);
});

test('saving an assessment stores medication, fill and an immutable assessment stamped with versions', async () => {
  const { repos } = await openStorage(openNodeSqlite(), deps);
  const store = createAssessmentStore(repos, V1, () => ({ displayName: 'Metformin', catalogDrugId: 'metformin' }));
  const id = sunEr('JKU4639A');
  const finding = findingFor(id);
  assert.equal(finding.finding, 'CONFIRMED_MATCH');
  await store.save(id, finding);
  const meds = await repos.medications.list();
  assert.equal(meds.length, 1);
  const saved = await repos.assessments.latestForMedication(meds[0]!.id);
  assert.equal(saved?.finding.finding, 'CONFIRMED_MATCH');
  assert.deepEqual(saved?.versions, V1);
  assert.equal(saved?.finding.coverage.positiveControl.status, 'PASSED');
  const cached = await store.latestFor(id);
  assert.equal(cached?.finding.finding, 'CONFIRMED_MATCH');
  assert.equal(cached?.identity.lot, 'JKU4639A');
});

test('refill history: a second fill of the same ingredient is kept under one medication with a typed diff', async () => {
  const { repos } = await openStorage(openNodeSqlite(), deps);
  const store = createAssessmentStore(repos, V1, () => ({ displayName: 'Metformin', catalogDrugId: 'metformin' }));
  await store.save(sunEr(), findingFor(sunEr()));
  tick();
  await store.save(aphenaIr(), findingFor(aphenaIr()));
  const meds = await repos.medications.list();
  assert.equal(meds.length, 1);
  assert.equal(medicationKey(sunEr()), medicationKey(aphenaIr()));
  const history = await repos.fills.history(meds[0]!.id);
  assert.deepEqual(history.map((h) => h.identity.release), ['ER', 'IR']);
  const diff = store.lastRefill();
  assert.ok(diff?.changes.some((c) => c.kind === 'RELEASE_CHANGED' && c.checkWithPharmacist));
  // Offline reuse is per exact product: the ER product still finds its own assessment.
  assert.equal((await store.latestFor(sunEr()))?.identity.productNdc, '62756-142');
  assert.equal((await store.latestFor(aphenaIr()))?.identity.productNdc, '43353-982');
});

test('policy updates never rewrite history: old assessments keep their versions and are flagged stale', async () => {
  const { repos } = await openStorage(openNodeSqlite(), deps);
  const before = createAssessmentStore(repos, V1, () => ({ displayName: 'Metformin', catalogDrugId: 'metformin' }));
  await before.save(sunEr(), findingFor(sunEr()));
  tick();
  const V2 = { ...V1, policyVersion: '0.3.0-draft' };
  const after = createAssessmentStore(repos, V2, () => ({ displayName: 'Metformin', catalogDrugId: 'metformin' }));
  await after.save(sunEr(), findingFor(sunEr()));
  const old = await repos.assessments.listMadeUnder({ policyVersion: '0.2.0-draft' });
  const fresh = await repos.assessments.listMadeUnder({ policyVersion: '0.3.0-draft' });
  assert.equal(old.length, 1);
  assert.equal(fresh.length, 1);
  assert.equal(isStale(old[0]!, V2), true);
  assert.equal(isStale(fresh[0]!, V2), false);
  assert.deepEqual(old[0]!.finding, findingFor(sunEr()), 'the earlier record is unchanged');
  await repos.configSnapshots.record('POLICY', '0.2.0-draft', '{"policy_version":"0.2.0-draft"}');
  assert.equal(await repos.configSnapshots.get('POLICY', '0.2.0-draft'), '{"policy_version":"0.2.0-draft"}');
});

test('public cache: fresh entries are served, expired ones are not, and failures cannot be stored', async () => {
  const { repos, db } = await openStorage(openNodeSqlite(), deps);
  const now = deps.now();
  await repos.cache.put({ source: 'OPENFDA_ENFORCEMENT', queryKey: 'q', outcome: 'OK', bodyJson: '{"results":[]}', retrievedAt: now, expiresAt: '2026-11-13T12:00:00.000Z', sourceLastUpdated: '2026-11-04' });
  assert.equal((await repos.cache.getFresh('OPENFDA_ENFORCEMENT', 'q', now))?.sourceLastUpdated, '2026-11-04');
  assert.equal(await repos.cache.getFresh('OPENFDA_ENFORCEMENT', 'q', '2026-11-14T00:00:00.000Z'), null, 'expired is never presented as fresh');
  await assert.rejects(db.run(`INSERT INTO source_cache (source, query_key, outcome, retrieved_at, expires_at) VALUES ('X', 'y', 'SOURCE_UNAVAILABLE', ?, ?)`, [now, now]));
  assert.equal(await repos.cache.purgeExpired('2026-11-14T00:00:00.000Z'), 1);
});

test('the database holds no image data and no free-text label columns', async () => {
  const db = openNodeSqlite();
  await migrate(db);
  const tables = (await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) => r.name);
  const cols: string[] = [];
  for (const t of tables) cols.push(...(await db.all<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => `${t}.${c.name}`));
  for (const c of cols) assert.doesNotMatch(c, /image|photo|ocr|patient|prescriber|rx_number|pharmacy|directions|sig/i, c);
});

test('delete-all removes the database files and the encryption key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rxdb-'));
  const path = join(dir, 'rx.db');
  const keys = memoryKeyStore((n) => new Uint8Array(randomBytes(n)));
  await keys.getOrCreateKey();
  const { db, repos } = await openStorage(openNodeSqlite(path), deps);
  await createAssessmentStore(repos, V1, () => ({ displayName: 'Metformin', catalogDrugId: 'metformin' })).save(sunEr('JKU4639A'), findingFor(sunEr('JKU4639A')));
  assert.ok(existsSync(path));
  await deleteAllData(db, keys);
  assert.equal(existsSync(path), false);
  assert.equal(keys.current(), null);
  const reopened = await openStorage(openNodeSqlite(path), deps);
  assert.deepEqual(await reopened.repos.medications.list(), [], 'nothing remains');
});

test('keychain key store: 256-bit random key created once, reused, and deleted (fake keychain API)', async () => {
  const saved = new Map<string, { password: string; accessible?: string }>();
  const api: KeychainApi = {
    getGenericPassword: async ({ service }) => (saved.get(service) ? { password: saved.get(service)!.password } : false),
    setGenericPassword: async (_u, password, { service, accessible }) => saved.set(service, { password, accessible }),
    resetGenericPassword: async ({ service }) => saved.delete(service),
  };
  const ks = keychainKeyStore(api, (n) => new Uint8Array(randomBytes(n)));
  const k1 = await ks.getOrCreateKey();
  assert.match(k1, /^[0-9a-f]{64}$/);
  assert.equal(await ks.getOrCreateKey(), k1);
  assert.equal([...saved.values()][0]?.accessible, 'AccessibleAfterFirstUnlockThisDeviceOnly');
  await ks.deleteKey();
  assert.equal(saved.size, 0);
  assert.throws(() => newKey(() => new Uint8Array(16)));
});

test('deleting a medication cascades to its fills, assessments and evidence', async () => {
  const { repos, db } = await openStorage(openNodeSqlite(), deps);
  const store = createAssessmentStore(repos, V1, () => ({ displayName: 'Metformin', catalogDrugId: 'metformin' }));
  await store.save(sunEr(), findingFor(sunEr()));
  const [m] = await repos.medications.list();
  await repos.medications.delete(m!.id);
  for (const t of ['fill', 'assessment', 'assessment_evidence']) {
    assert.equal((await db.all(`SELECT 1 FROM ${t}`)).length, 0, t);
  }
});

test('repositories are independent of the driver (same API on any SqlDriver)', async () => {
  const db = openNodeSqlite();
  await migrate(db);
  const repos = createRepositories(db, deps);
  const id = await repos.medications.create({ displayName: 'X', catalogDrugId: null, identity: sunEr() });
  assert.equal((await repos.medications.findByIdentity(aphenaIr()))?.id, id, 'same ingredient set');
});

test('op-sqlite adapter: migrations, repositories and transactions work through its API shape (fake open; native module untested)', async () => {
  // FAKE op-sqlite `open` backed by node:sqlite, with the v19 `execute(sql, params) → { rows, rowsAffected }` shape.
  const { DatabaseSync } = await import('node:sqlite');
  const { openOpSqlite } = await import('../../mobile/src/storage/drivers/opSqlite.ts');
  let opened: { name: string; encryptionKey: string } | null = null;
  let deleted = false;
  const fakeOpen = (o: { name: string; encryptionKey: string }) => {
    opened = o;
    const db = new DatabaseSync(':memory:');
    return {
      async execute(sql: string, params: (string | number | null)[] = []) {
        const st = db.prepare(sql);
        if (/^\s*SELECT/i.test(sql)) return { rows: st.all(...params) as Record<string, string | number | null>[], rowsAffected: 0 };
        const r = st.run(...params);
        return { rows: [], rowsAffected: Number(r.changes) };
      },
      close() {},
      delete() {
        deleted = true;
      },
    };
  };
  const keys = memoryKeyStore((n) => new Uint8Array(randomBytes(n)));
  const driver = await openOpSqlite(fakeOpen, keys);
  assert.match(opened!.encryptionKey, /^[0-9a-f]{64}$/, 'the key from the key store is passed as encryptionKey');
  const { repos } = await openStorage(driver, deps);
  await createAssessmentStore(repos, V1, () => ({ displayName: 'Metformin', catalogDrugId: 'metformin' })).save(sunEr(), findingFor(sunEr()));
  assert.equal((await repos.medications.list()).length, 1);
  await assert.rejects(driver.transaction(async () => {
    await driver.run(`INSERT INTO schema_meta (key, value) VALUES ('t', '1')`);
    throw new Error('boom');
  }));
  assert.equal((await driver.all(`SELECT 1 FROM schema_meta WHERE key = 't'`)).length, 0, 'rolled back');
  await deleteAllData(driver, keys);
  assert.ok(deleted && keys.current() === null);
});
