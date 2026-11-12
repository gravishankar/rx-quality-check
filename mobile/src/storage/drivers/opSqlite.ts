/**
 * Adapter for @op-engineering/op-sqlite (selected 2026-11-12: v19.0.5, MIT, released 2026-11-05,
 * maintained; supports SQLCipher). The library is NOT yet installed: it is a native module added
 * with the React Native app in Task 4. This adapter is written against the subset of its API we use
 * and receives `open` by injection, so this package compiles and is testable without the native
 * module. Encryption requires `"op-sqlite": { "sqlcipher": true }` in the app's package.json and an
 * `encryptionKey` from the OS key store.
 *
 * NOT VERIFIED ON A DEVICE: the adapter's behavior against the real native module, and that the
 * file on disk is encrypted, must be tested on a physical Android device (TEST_PLAN PV-4, Task 6).
 */
import type { KeyStore, SqlDriver, SqlValue } from '../driver.ts';

/** The op-sqlite API subset used here (v19). */
export interface OpSqliteDb {
  execute(sql: string, params?: SqlValue[]): Promise<{ rows: Record<string, SqlValue>[]; rowsAffected: number }>;
  close(): void;
  delete(): void;
}
export type OpSqliteOpen = (opts: { name: string; encryptionKey: string; location?: string }) => OpSqliteDb;

export async function openOpSqlite(open: OpSqliteOpen, keys: KeyStore, name = 'rx-recall-check.db'): Promise<SqlDriver> {
  const encryptionKey = await keys.getOrCreateKey();
  const db = open({ name, encryptionKey });
  await db.execute('PRAGMA foreign_keys = ON');
  let depth = 0;
  return {
    async exec(sql) {
      for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await db.execute(stmt);
    },
    async run(sql, params = []) {
      const r = await db.execute(sql, [...params]);
      return { changes: r.rowsAffected };
    },
    async all<T extends Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []) {
      return (await db.execute(sql, [...params])).rows as T[];
    },
    async transaction(fn) {
      const sp = `sp${depth++}`;
      await db.execute(`SAVEPOINT ${sp}`);
      try {
        const out = await fn();
        await db.execute(`RELEASE ${sp}`);
        return out;
      } catch (e) {
        await db.execute(`ROLLBACK TO ${sp}`);
        await db.execute(`RELEASE ${sp}`);
        throw e;
      } finally {
        depth--;
      }
    },
    async close() {
      db.close();
    },
    async destroy() {
      db.delete();
    },
  };
}
