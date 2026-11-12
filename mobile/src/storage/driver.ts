/**
 * Minimal async SQL driver interface. The app uses an encrypted SQLCipher database through
 * `drivers/opSqlite.ts`; tests and the command-line integration use Node's built-in SQLite
 * (`drivers/nodeSqlite.ts`, unencrypted — never used on a device). Repositories depend only on this
 * interface.
 */
export type SqlValue = string | number | null;

export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<{ changes: number }>;
  all<T extends Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Run `fn` atomically: commit on success, roll back on any thrown error. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** Close and delete the database file(s). Used by delete-all. */
  destroy(): Promise<void>;
}

/** Encryption-key storage backed by the OS (Android Keystore via a keychain library). */
export interface KeyStore {
  /** Return the database key, creating and storing a new random key on first use. */
  getOrCreateKey(): Promise<string>;
  deleteKey(): Promise<void>;
}
