/**
 * React Native implementation of PlatformServices (Android and iOS). The only module that imports
 * native libraries. Network behavior of each library: op-sqlite, react-native-keychain and
 * react-native-get-random-values make no network requests; fetch is used only through the guarded
 * transport (allowlisted public hosts).
 */
import { Linking, NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { open } from '@op-engineering/op-sqlite';
import * as Keychain from 'react-native-keychain';
import { fetchTransport } from '../../src/services/transport.ts';
import { openOpSqlite, type OpSqliteOpen } from '../../src/storage/drivers/opSqlite.ts';
import { keychainKeyStore, type KeychainApi } from '../../src/storage/keys.ts';
import { runEncryptionSelfTest } from '../../src/storage/encryptionSelfTest.ts';
import type { PlatformServices } from './types.ts';
import type { ScanOutput } from '../../src/scanner/readScan.ts';

/**
 * Android native module (mobile/android/.../scanner/RxScannerModule.java). Not present on iOS yet.
 * Looked up through the New Architecture interop registry first, then the legacy NativeModules
 * proxy; if neither has it, scanning is hidden and manual entry is used.
 */
type ScannerModule = { scanLabel(): Promise<ScanOutput | null> };
const RxScanner: ScannerModule | undefined = (() => {
  try {
    const t = (TurboModuleRegistry as unknown as { get(name: string): unknown }).get('RxScanner') as ScannerModule | null;
    if (t && typeof t.scanLabel === 'function') return t;
  } catch {
    // fall through to the legacy proxy
  }
  const legacy = (NativeModules as { RxScanner?: ScannerModule }).RxScanner;
  return legacy && typeof legacy.scanLabel === 'function' ? legacy : undefined;
})();

const randomBytes = (n: number): Uint8Array => {
  const b = new Uint8Array(n);
  // Provided by react-native-get-random-values (imported first in index.js); throws if missing.
  (globalThis as unknown as { crypto: { getRandomValues(x: Uint8Array): Uint8Array } }).crypto.getRandomValues(b);
  return b;
};

const keychain: KeychainApi = {
  getGenericPassword: (o) => Keychain.getGenericPassword({ service: o.service }),
  setGenericPassword: (u, p, o) =>
    Keychain.setGenericPassword(u, p, { service: o.service, accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  resetGenericPassword: (o) => Keychain.resetGenericPassword({ service: o.service }),
};

const opOpen: OpSqliteOpen = (o) => {
  const db = open({ name: o.name, encryptionKey: o.encryptionKey });
  return {
    async execute(sql, params) {
      const r = await db.execute(sql, params);
      return { rows: (r.rows ?? []) as Record<string, string | number | null>[], rowsAffected: r.rowsAffected ?? 0 };
    },
    close: () => db.close(),
    delete: () => db.delete(),
  };
};

const keyStore = keychainKeyStore(keychain, randomBytes);

export const nativePlatform: PlatformServices = {
  transport: fetchTransport((url, init) => fetch(url, init)),
  randomBytes,
  keyStore,
  openEncryptedDatabase: () => openOpSqlite(opOpen, keyStore),
  encryptionSelfTest: () => runEncryptionSelfTest(opOpen, randomBytes, () => new Date().toISOString()),
  openUrl: async (url) => {
    if (url.startsWith('https://www.fda.gov/') || url.startsWith('https://api.fda.gov/')) await Linking.openURL(url);
  },
  os: Platform.OS,
  ...(Platform.OS === 'android' && RxScanner ? { scanner: { scanLabel: () => RxScanner.scanLabel() } } : {}),
};
