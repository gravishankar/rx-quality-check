/**
 * Review round 2, issue 4 (reopens finding 7): a failed database destruction must keep its target so
 * a retry destroys it. Uses a FILE-BACKED SQLite database (persists across opens), not independent
 * in-memory databases. Destroy and key failures are SYNTHETIC injections; data is real recorded FDA
 * evidence for a real product.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openNodeSqlite } from '../../mobile/src/storage/drivers/nodeSqlite.ts';
import { createStorageLifecycle, type StorageState } from '../../mobile/src/storage/lifecycle.ts';
import type { KeyStore, SqlDriver } from '../../mobile/src/storage/driver.ts';
import { evaluateRecallEvidence, planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import { RULESET_VERSION } from '../../mobile/src/rules/version.ts';
import { bundle, control, enf, firstNdcRecord, productIdentity } from '../helpers/fixtures.ts';

const deps = { now: () => '2026-11-12T12:00:00.000Z', newId: () => randomUUID() };
const V = { rulesetVersion: RULESET_VERSION, policyVersion: '0.2.0-draft', catalogVersion: '0.2.0' };
const id = () => productIdentity(firstNdcRecord('ndc_pkg_62756-142-02'), '62756-142-02', 'JKU4639A');
const finding = () => evaluateRecallEvidence(id(), bundle(planRecallQueries(id()), { ingredient_text: [enf('enf_text_metformin')], product_ndc: [enf('enf_pndc_62756-142')], control: [control()] }));
const ready = (s: StorageState) => {
  assert.equal(s.status, 'READY', JSON.stringify(s));
  return s as Extract<StorageState, { status: 'READY' }>;
};

function fileDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rxqc-'));
  const path = join(dir, 'app.db');
  let failDestroys = 0;
  let destroyCalls = 0;
  const open = async (): Promise<SqlDriver> => {
    const d = openNodeSqlite(path);
    return {
      ...d,
      destroy: async () => {
        destroyCalls += 1;
        if (failDestroys > 0) {
          failDestroys -= 1;
          throw new Error('SYNTHETIC: file locked');
        }
        await d.destroy();
      },
    };
  };
  return { path, open, failNext: (n = 1) => (failDestroys = n), calls: () => destroyCalls, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const keys = (failDeletes = 0): KeyStore & { deleted: number } => {
  const k = { deleted: 0, getOrCreateKey: async () => 'k'.repeat(64), deleteKey: async () => {
    if (failDeletes > 0) {
      failDeletes -= 1;
      throw new Error('SYNTHETIC keystore failure');
    }
    k.deleted += 1;
  } };
  return k;
};
const saveOne = async (s: StorageState) => {
  const r = ready(s);
  await r.store(V, () => ({ displayName: 'Metformin ER', catalogDrugId: 'metformin_er' })).save(id(), finding());
};

test('R2-4 reproduced: destroy fails once → retry destroys the same database (persistent file), then storage is fresh', async () => {
  const f = fileDb();
  try {
    const k = keys();
    const lc = createStorageLifecycle({ enabled: true, open: f.open, keyStore: k, deps });
    await saveOne(await lc.start());
    f.failNext(1);
    const failed = await lc.deleteAll();
    assert.deepEqual(failed, { status: 'FAILED', reason: 'DELETE' });
    assert.ok(existsSync(f.path), 'the database is still on disk after the failed attempt');
    const retried = await lc.deleteAll();
    assert.equal(f.calls(), 2, 'the retry destroys the database again — the target was kept');
    assert.equal(k.deleted, 1);
    assert.equal((await ready(retried).repos.medications.list()).length, 0, 'nothing from before survives');
    // A completely new process opening the same file sees no data either.
    const again = createStorageLifecycle({ enabled: true, open: f.open, keyStore: keys(), deps });
    assert.equal((await ready(await again.start()).repos.medications.list()).length, 0);
  } finally {
    f.cleanup();
  }
});

test('R2-4: key deletion fails after the database was destroyed → retry deletes the key without reporting success early', async () => {
  const f = fileDb();
  try {
    const k = keys(1);
    const lc = createStorageLifecycle({ enabled: true, open: f.open, keyStore: k, deps });
    await saveOne(await lc.start());
    assert.equal((await lc.deleteAll()).status, 'FAILED');
    assert.equal(k.deleted, 0);
    const retried = await lc.deleteAll();
    assert.equal(retried.status, 'READY');
    assert.equal(k.deleted, 1);
    assert.equal(f.calls(), 1, 'the already destroyed database is not destroyed twice');
  } finally {
    f.cleanup();
  }
});

test('R2-4: handles from before a failed deletion stay refused (no writes into the database being deleted)', async () => {
  const f = fileDb();
  try {
    const lc = createStorageLifecycle({ enabled: true, open: f.open, keyStore: keys(), deps });
    const before = ready(await lc.start());
    f.failNext(1);
    await lc.deleteAll();
    await assert.rejects(before.repos.medications.list(), /StorageInvalidated/);
  } finally {
    f.cleanup();
  }
});
