/**
 * Node built-in SQLite driver (node:sqlite, Node ≥ 22.13). For tests and the command-line
 * integration ONLY. It is NOT encrypted and is never bundled into the app (Metro would not resolve
 * `node:sqlite`). The app uses drivers/opSqlite.ts with SQLCipher.
 */
import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import type { SqlDriver, SqlValue } from '../driver.ts';

export function openNodeSqlite(path: string = ':memory:'): SqlDriver {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  let depth = 0;
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      const r = db.prepare(sql).run(...(params as SqlValue[]));
      return { changes: Number(r.changes) };
    },
    async all<T extends Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).all(...(params as SqlValue[])) as T[];
    },
    async transaction(fn) {
      const sp = `sp${depth++}`;
      db.exec(`SAVEPOINT ${sp}`);
      try {
        const out = await fn();
        db.exec(`RELEASE ${sp}`);
        return out;
      } catch (e) {
        db.exec(`ROLLBACK TO ${sp}`);
        db.exec(`RELEASE ${sp}`);
        throw e;
      } finally {
        depth--;
      }
    },
    async close() {
      db.close();
    },
    async destroy() {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      if (path !== ':memory:') for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });
    },
  };
}
