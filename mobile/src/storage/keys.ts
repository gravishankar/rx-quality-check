/**
 * Database encryption keys. On Android the key lives in the OS secure storage via
 * react-native-keychain (selected 2026-11-12: v11.0.0, MIT, released 2026-11-06), which stores it
 * encrypted with an Android Keystore key. The library is added with the app in Task 4; this module
 * receives its API by injection.
 */
import type { KeyStore } from './driver.ts';

/** The react-native-keychain API subset used here. */
export interface KeychainApi {
  getGenericPassword(opts: { service: string }): Promise<false | { password: string }>;
  setGenericPassword(username: string, password: string, opts: { service: string; accessible?: string }): Promise<unknown>;
  resetGenericPassword(opts: { service: string }): Promise<unknown>;
}

export const KEY_SERVICE = 'rx-recall-check.db-key';

/** 256-bit random key as hex. `randomBytes` must be a CSPRNG (crypto.getRandomValues). */
export function newKey(randomBytes: (n: number) => Uint8Array): string {
  const b = randomBytes(32);
  if (b.length !== 32) throw new Error('random source returned the wrong length');
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function keychainKeyStore(api: KeychainApi, randomBytes: (n: number) => Uint8Array): KeyStore {
  return {
    async getOrCreateKey() {
      const existing = await api.getGenericPassword({ service: KEY_SERVICE });
      if (existing && /^[0-9a-f]{64}$/.test(existing.password)) return existing.password;
      const key = newKey(randomBytes);
      // AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: never migrated to another device or backup.
      await api.setGenericPassword('db', key, { service: KEY_SERVICE, accessible: 'AccessibleAfterFirstUnlockThisDeviceOnly' });
      return key;
    },
    async deleteKey() {
      await api.resetGenericPassword({ service: KEY_SERVICE });
    },
  };
}

/** In-memory key store for tests and the command-line integration (no OS secure storage). */
export function memoryKeyStore(randomBytes: (n: number) => Uint8Array): KeyStore & { current(): string | null } {
  let key: string | null = null;
  return {
    current: () => key,
    async getOrCreateKey() {
      key ??= newKey(randomBytes);
      return key;
    },
    async deleteKey() {
      key = null;
    },
  };
}
