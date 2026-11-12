/**
 * Holds one recall check session for the screens. All decisions are made by the shared engine
 * (createRecallCheck → state machine → safety gates → recall engine); this hook only forwards events
 * and exposes the current state. Storage is attached only when the build profile allows persistent
 * history (pilot build with encryption verified on a device); otherwise nothing is written.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { createRecallCheck, type RecallCheck } from '../src/app/recallCheck.ts';
import type { ManualEntry } from '../src/app/screens.ts';
import { manualExtraction } from '../src/app/screens.ts';
import { initialState } from '../src/engine/runner.ts';
import type { WorkflowEvent, WorkflowState } from '../src/state/machine.ts';
import type { LabelExtraction } from '../src/models/identity.ts';
import type { Repositories } from '../src/storage/repositories.ts';
import { CATALOG_JSON, POLICY_JSON, PROFILE } from './config.ts';
import type { PlatformServices } from './platform/types.ts';

export interface RecallSession {
  state: WorkflowState;
  busy: boolean;
  error: string | null;
  start(entry: ManualEntry): Promise<void>;
  /** Start from a scanned label (Task 4C). */
  startExtraction(x: LabelExtraction): Promise<void>;
  send(event: WorkflowEvent): Promise<void>;
  reset(): void;
}

export function useRecallSession(platform: PlatformServices, repos: Repositories | null): RecallSession {
  const app = useRef<RecallCheck | null>(null);
  const [state, setState] = useState<WorkflowState>(initialState());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getApp = useCallback(() => {
    app.current ??= createRecallCheck({
      transport: platform.transport,
      now: () => new Date().toISOString(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      catalogJson: CATALOG_JSON,
      policyJson: POLICY_JSON,
      load: { allowUnapproved: PROFILE.allowUnapprovedConfig },
      ...(repos && PROFILE.persistHistory ? { repos } : {}),
    });
    return app.current;
  }, [platform, repos]);

  const run = useCallback(async (fn: () => Promise<{ state: WorkflowState }>) => {
    setBusy(true);
    setError(null);
    try {
      setState((await fn()).state);
    } catch (e) {
      // Unexpected failures never become a result: the screen shows "nothing was checked".
      setError(e instanceof Error ? e.name : 'Error');
    } finally {
      setBusy(false);
    }
  }, []);

  return useMemo(
    () => ({
      state,
      busy,
      error,
      start: (entry) => run(() => getApp().scan(manualExtraction(entry))),
      startExtraction: (x) => run(() => getApp().scan(x)),
      send: (event) => run(() => getApp().send(state, event)),
      reset: () => {
        setState(initialState());
        setError(null);
      },
    }),
    [state, busy, error, run, getApp],
  );
}
