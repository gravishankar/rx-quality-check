/**
 * Review item 7: storage and session lifecycle — initialization, delete-all, recreation and
 * invalidation, with key, open, migration and deletion failures made visible. Uses the real SQLite
 * driver (node:sqlite) and real recorded FDA data; key-store and driver failures are SYNTHETIC.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openNodeSqlite } from '../../mobile/src/storage/drivers/nodeSqlite.ts';
import { createStorageLifecycle, type StorageState } from '../../mobile/src/storage/lifecycle.ts';
import { deleteAllData, openStorage } from '../../mobile/src/storage/repositories.ts';
import { MIGRATIONS } from '../../mobile/src/storage/migrations.ts';
import type { KeyStore, SqlDriver } from '../../mobile/src/storage/driver.ts';
import { evaluateRecallEvidence, planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import { RULESET_VERSION } from '../../mobile/src/rules/version.ts';
import { bundle, control, enf, firstNdcRecord, productIdentity } from '../helpers/fixtures.ts';

const deps = { now: () => '2026-11-12T12:00:00.000Z', newId: () => randomUUID() };
const V1 = { rulesetVersion: RULESET_VERSION, policyVersion: '0.2.0-draft', catalogVersion: '0.2.0' };
const id = () => productIdentity(firstNdcRecord('ndc_pkg_62756-142-02'), '62756-142-02', 'JKU4639A');
const finding = () => evaluateRecallEvidence(id(), bundle(planRecallQueries(id()), { ingredient_text: [enf('enf_text_metformin')], product_ndc: [enf('enf_pndc_62756-142')], control: [control()] }));
const keys = (over: Partial<KeyStore> = {}): KeyStore & { deleted: number } => {
  const k = { deleted: 0, getOrCreateKey: async () => 'k'.repeat(64), deleteKey: async () => void (k.deleted += 1), ...over };
  return k;
};
const ready = (s: StorageState) => {
  assert.equal(s.status, 'READY', JSON.stringify(s));
  return s as Extract<StorageState, { status: 'READY' }>;
};
const save = async (s: StorageState) => {
  const r = ready(s);
  await r.store(V1, () => ({ displayName: 'Metformin ER', catalogDrugId: 'metformin_er' })).save(id(), finding());
  return (await r.repos.medications.list()).length;
};

test('item 7 defect (current code): after delete-all the old repositories are dead, and nothing re-opens storage', async () => {
  const driver = openNodeSqlite();
  const { repos } = await openStorage(driver, deps);
  await deleteAllData(driver, keys());
  await assert.rejects(repos.medications.list(), 'the session would keep using this handle');
});

test('item 7: delete all, then scan, check and save again on freshly created storage', async () => {
  const k = keys();
  const lc = createStorageLifecycle({ enabled: true, open: async () => openNodeSqlite(), keyStore: k, deps });
  const first = ready(await lc.start());
  assert.equal(await save(first), 1);
  const after = await lc.deleteAll();
  assert.equal(k.deleted, 1);
  const second = ready(after);
  assert.notEqual(second.generation, first.generation);
  assert.equal((await second.repos.medications.list()).length, 0, 'nothing survives delete-all');
  assert.equal(await save(second), 1);
});

test('item 7: operations through a handle from before delete-all are refused, never applied to new storage', async () => {
  const lc = createStorageLifecycle({ enabled: true, open: async () => openNodeSqlite(), keyStore: keys(), deps });
  const old = ready(await lc.start());
  await lc.deleteAll();
  await assert.rejects(old.repos.medications.list(), /StorageInvalidated/);
  await assert.rejects(save(old), /StorageInvalidated/);
});

test('item 7: a failed deletion is reported, not shown as done; storage is not silently reused', async () => {
  const lc = createStorageLifecycle({ enabled: true, open: async () => openNodeSqlite(), keyStore: keys({ deleteKey: async () => { throw new Error('SYNTHETIC keystore failure'); } }), deps });
  await lc.start();
  const s = await lc.deleteAll();
  assert.equal(s.status, 'FAILED');
  assert.equal((s as Extract<StorageState, { status: 'FAILED' }>).reason, 'DELETE');
});

test('item 7: key, open and migration failures are visible states, never a silently disabled history', async () => {
  const keyFail = createStorageLifecycle({ enabled: true, open: async () => { throw Object.assign(new Error('SYNTHETIC'), { code: 'KEY_UNAVAILABLE' }); }, keyStore: keys(), deps });
  assert.deepEqual(await keyFail.start(), { status: 'FAILED', reason: 'KEY' });
  const openFail = createStorageLifecycle({ enabled: true, open: async () => { throw new Error('SYNTHETIC disk error'); }, keyStore: keys(), deps });
  assert.deepEqual(await openFail.start(), { status: 'FAILED', reason: 'OPEN' });
  const newer = async (): Promise<SqlDriver> => {
    const d = openNodeSqlite();
    await openStorage(d, deps);
    await d.run(`UPDATE schema_meta SET value = '${MIGRATIONS.length + 98}' WHERE key = 'schema_version'`); // SYNTHETIC newer schema
    return d;
  };
  const migFail = createStorageLifecycle({ enabled: true, open: newer, keyStore: keys(), deps });
  assert.deepEqual(await migFail.start(), { status: 'FAILED', reason: 'MIGRATION' });
});

test('item 7: disabled builds never open storage', async () => {
  let opened = 0;
  const lc = createStorageLifecycle({ enabled: false, open: async () => ((opened += 1), openNodeSqlite()), keyStore: keys(), deps });
  assert.deepEqual(await lc.start(), { status: 'OFF' });
  assert.equal(opened, 0);
});

test('item 7: a start that finishes after delete-all began is discarded (no stale async result)', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let n = 0;
  const lc = createStorageLifecycle({ enabled: true, open: async () => { n += 1; if (n === 1) await gate; return openNodeSqlite(); }, keyStore: keys(), deps });
  const slow = lc.start();
  const del = lc.deleteAll();
  release();
  const [a, b] = await Promise.all([slow, del]);
  assert.equal(lc.state().status, 'READY');
  const cur = ready(lc.state());
  assert.equal(ready(b).generation, cur.generation);
  if (a.status === 'READY') assert.notEqual(a.generation, cur.generation, 'the slow start must not become current');
});
