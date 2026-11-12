/**
 * On-device encryption self-test (TEST_PLAN PV-4). Run from the About screen of a development
 * build on a physical phone; the tester records the result in docs/ANDROID_DEVICE_TEST_PLAN.md.
 * Passing it is one of the prerequisites for setting `encryption_verified_on_device` (it is not
 * sufficient alone: the checklist also requires inspecting the file pulled from the device).
 *
 * Checks, on a throw-away database (never the user's):
 *  1. SQLCipher is compiled in (`PRAGMA cipher_version` is not empty).
 *  2. A row written with key K is read back with key K.
 *  3. Opening the same file with a different key cannot read it.
 *  4. The throw-away database is deleted.
 * Platform-neutral: receives the op-sqlite `open` function and a CSPRNG by injection.
 */
import type { OpSqliteOpen } from './drivers/opSqlite.ts';
import { newKey } from './keys.ts';

export interface SelfTestStep {
  name: string;
  passed: boolean;
  detail: string;
}

export interface SelfTestResult {
  passed: boolean;
  steps: SelfTestStep[];
  ranAt: string;
}

export const SELF_TEST_DB = 'rx-recall-check-selftest.db';

export async function runEncryptionSelfTest(open: OpSqliteOpen, randomBytes: (n: number) => Uint8Array, now: () => string): Promise<SelfTestResult> {
  const steps: SelfTestStep[] = [];
  const step = (name: string, passed: boolean, detail: string) => steps.push({ name, passed, detail });
  const key = newKey(randomBytes);
  const wrong = newKey(randomBytes);
  const canary = `canary-${newKey(randomBytes).slice(0, 8)}`;
  try {
    const db = open({ name: SELF_TEST_DB, encryptionKey: key });
    const v = await db.execute('PRAGMA cipher_version');
    const version = v.rows[0] ? String(Object.values(v.rows[0])[0] ?? '') : '';
    step('SQLCipher compiled in', version !== '', version === '' ? 'cipher_version is empty: the database is NOT encrypted' : `cipher_version ${version}`);
    await db.execute('CREATE TABLE IF NOT EXISTS t (v TEXT)');
    await db.execute('DELETE FROM t');
    await db.execute('INSERT INTO t (v) VALUES (?)', [canary]);
    db.close();

    const again = open({ name: SELF_TEST_DB, encryptionKey: key });
    const back = await again.execute('SELECT v FROM t');
    step('Read back with the right key', back.rows[0]?.v === canary, `rows: ${back.rows.length}`);
    again.close();

    let wrongRead = false;
    let wrongDetail = '';
    try {
      const bad = open({ name: SELF_TEST_DB, encryptionKey: wrong });
      const r = await bad.execute('SELECT v FROM t');
      wrongRead = r.rows.some((x) => x.v === canary);
      wrongDetail = wrongRead ? 'data was readable with a different key' : 'no data returned';
      bad.close();
    } catch (e) {
      wrongDetail = `refused: ${e instanceof Error ? e.message : String(e)}`;
    }
    step('Unreadable with a different key', !wrongRead, wrongDetail);
  } catch (e) {
    step('Self-test ran', false, e instanceof Error ? e.message : String(e));
  } finally {
    try {
      open({ name: SELF_TEST_DB, encryptionKey: key }).delete();
      step('Test database deleted', true, SELF_TEST_DB);
    } catch (e) {
      step('Test database deleted', false, e instanceof Error ? e.message : String(e));
    }
  }
  return { passed: steps.length >= 4 && steps.every((s) => s.passed), steps, ranAt: now() };
}
