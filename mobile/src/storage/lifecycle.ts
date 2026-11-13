/**
 * Storage and session lifecycle (review item 7). One place decides whether the on-phone database is
 * off, opening, ready, failed or being deleted, so screens and the recall session never hold a
 * database handle that was destroyed.
 *
 *  - start():     OFF (disabled build) · READY (new generation) · FAILED (KEY | OPEN | MIGRATION)
 *  - deleteAll(): destroys the database and its key, then opens fresh storage (new generation);
 *                 a failure is FAILED (DELETE), never reported as done
 *  - Every READY state carries a generation. Repositories from an older generation refuse every
 *    operation with StorageInvalidated, so a callback that finishes after delete-all cannot write
 *    into (or read from) the new database.
 *  - A start() that completes after a later start() or deleteAll() began is discarded.
 *
 * Platform-independent: the native database opener and key store are injected.
 */
import type { KeyStore, SqlDriver } from './driver.ts';
import { createAssessmentStore, createRepositories, type ConfigVersions, type RepoDeps, type Repositories } from './repositories.ts';
import { migrate } from './migrations.ts';
import type { MedicationIdentity } from '../models/identity.ts';

export type StorageFailure = 'KEY' | 'OPEN' | 'MIGRATION' | 'DELETE';

export type StorageState =
  | { status: 'OFF' }
  | { status: 'OPENING' }
  | { status: 'DELETING' }
  | { status: 'FAILED'; reason: StorageFailure }
  | {
      status: 'READY';
      generation: number;
      repos: Repositories;
      store(versions: ConfigVersions, displayNameOf: (identity: MedicationIdentity) => { displayName: string; catalogDrugId: string | null }): ReturnType<typeof createAssessmentStore>;
    };

export class StorageInvalidated extends Error {
  constructor() {
    super('StorageInvalidated: this storage was deleted or replaced');
    this.name = 'StorageInvalidated';
  }
}

export interface StorageLifecycleOptions {
  enabled: boolean;
  /** Open the encrypted database (gets or creates the key). Errors with code KEY_UNAVAILABLE are key failures. */
  open: () => Promise<SqlDriver>;
  keyStore: KeyStore | null;
  deps: RepoDeps;
  onChange?: (s: StorageState) => void;
}

export interface StorageLifecycle {
  state(): StorageState;
  start(): Promise<StorageState>;
  deleteAll(): Promise<StorageState>;
}

/** A driver that refuses every call once its generation is no longer current. */
function guarded(driver: SqlDriver, live: () => boolean): SqlDriver {
  const check = () => {
    if (!live()) throw new StorageInvalidated();
  };
  return {
    exec: async (sql) => (check(), driver.exec(sql)),
    run: async (sql, p) => (check(), driver.run(sql, p)),
    all: async (sql, p) => (check(), driver.all(sql, p)),
    transaction: async (fn) => (check(), driver.transaction(fn)),
    close: async () => driver.close(),
    destroy: async () => driver.destroy(),
  };
}

const isKeyError = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'KEY_UNAVAILABLE';

export function createStorageLifecycle(o: StorageLifecycleOptions): StorageLifecycle {
  let current: StorageState = { status: o.enabled ? 'OPENING' : 'OFF' };
  let generation = 0;
  let driver: SqlDriver | null = null;
  let ticket = 0; // the latest start/delete request; older ones are discarded when they finish

  const set = (s: StorageState) => {
    current = s;
    o.onChange?.(s);
    return s;
  };

  async function openFresh(myTicket: number): Promise<StorageState> {
    let d: SqlDriver;
    try {
      d = await o.open();
    } catch (e) {
      return myTicket === ticket ? set({ status: 'FAILED', reason: isKeyError(e) ? 'KEY' : 'OPEN' }) : current;
    }
    try {
      await migrate(d);
    } catch {
      await d.close().catch(() => undefined);
      return myTicket === ticket ? set({ status: 'FAILED', reason: 'MIGRATION' }) : current;
    }
    if (myTicket !== ticket) {
      // Superseded while opening (e.g. delete-all began): never becomes current.
      await d.close().catch(() => undefined);
      return { status: 'READY', generation: -1, repos: createRepositories(guarded(d, () => false), o.deps), store: () => { throw new StorageInvalidated(); } };
    }
    generation += 1;
    const g = generation;
    driver = d;
    const live = () => current.status === 'READY' && current.generation === g;
    const repos = createRepositories(guarded(d, live), o.deps);
    return set({ status: 'READY', generation: g, repos, store: (v, name) => createAssessmentStore(repos, v, name) });
  }

  return {
    state: () => current,
    async start() {
      if (!o.enabled) return set({ status: 'OFF' });
      const my = ++ticket;
      set({ status: 'OPENING' });
      return openFresh(my);
    },
    async deleteAll() {
      const my = ++ticket;
      const old = driver;
      driver = null;
      set({ status: 'DELETING' }); // invalidates every handle of the previous generation
      try {
        if (old) await old.destroy();
        if (o.keyStore) await o.keyStore.deleteKey();
      } catch {
        return set({ status: 'FAILED', reason: 'DELETE' });
      }
      if (!o.enabled) return set({ status: 'OFF' });
      return openFresh(my);
    },
  };
}
