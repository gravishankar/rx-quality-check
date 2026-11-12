/**
 * Platform-neutral services the screens need. Implemented once for React Native in native.ts using
 * cross-platform libraries (op-sqlite with SQLCipher, react-native-keychain, React Native fetch and
 * Linking), which have Android and iOS implementations. Shared code (mobile/src) never imports
 * these libraries; only this folder does. Tests use fakes.
 */
import type { KeyStore, SqlDriver } from '../../src/storage/driver.ts';
import type { HttpTransport } from '../../src/services/transport.ts';
import type { SelfTestResult } from '../../src/storage/encryptionSelfTest.ts';

export interface PlatformServices {
  /** HTTPS transport (React Native fetch). Wrapped by the guarded transport in the composition root. */
  transport: HttpTransport;
  /** CSPRNG bytes (crypto.getRandomValues). */
  randomBytes(n: number): Uint8Array;
  /** Database key storage: Android Keystore-backed / iOS Keychain (this device only). */
  keyStore: KeyStore;
  /** Open the encrypted (SQLCipher) app database. */
  openEncryptedDatabase(): Promise<SqlDriver>;
  /** PV-4 self-test on a throw-away database. */
  encryptionSelfTest(): Promise<SelfTestResult>;
  /** Open an official FDA page in the system browser. */
  openUrl(url: string): Promise<void>;
  /** "android" or "ios", for display only. */
  os: string;
}
