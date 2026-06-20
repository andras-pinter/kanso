import { useCallback, useEffect, useRef } from 'react';

export interface DebouncedSaver<T> {
  /** Schedule a save with the latest value; resets the debounce window. */
  schedule(value: T): void;
  /** Cancel any pending save without running it. */
  cancel(): void;
  /**
   * If a save is pending OR a prior save failed, run it now and await
   * completion. Rejects with the save's error so callers (e.g. drawer
   * close) can keep state on failure.
   */
  flush(): Promise<void>;
}

/**
 * Calls `save` at most once per `delayMs` after the last `schedule` call.
 *
 * Saves are strictly serialized: a new `save` never starts while a previous
 * one is in flight, so a slow earlier save cannot overwrite a later one. If
 * `save` rejects, the failed value is retained so the next `flush()` retries
 * it. On unmount any pending save is flushed best-effort.
 */
export function useDebouncedSave<T>(
  save: (value: T) => Promise<void>,
  delayMs: number,
): DebouncedSaver<T> {
  const saveRef = useRef(save);
  const pendingRef = useRef<{ value: T } | null>(null);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const runNowRef = useRef<() => Promise<void>>(async () => {});

  const runNow = useCallback(async (): Promise<void> => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Serialize: never start a new save while another is in flight. Swallow
    // the prior save's error here — its own caller has already seen it.
    if (inFlightRef.current) {
      try {
        await inFlightRef.current;
      } catch {
        /* prior caller handled */
      }
    }
    if (!pendingRef.current) return;
    const { value } = pendingRef.current;
    pendingRef.current = null;
    const p = saveRef.current(value)
      .catch((e: unknown) => {
        // Retain the value so flush() retries it; rethrow so this caller sees it.
        if (!pendingRef.current) pendingRef.current = { value };
        throw e;
      })
      .finally(() => {
        if (inFlightRef.current === p) inFlightRef.current = null;
      });
    inFlightRef.current = p;
    await p;
    // Drain any edits queued while we were saving. Skipped on failure
    // because the catch above rethrew before reaching this point. Indirect
    // via ref so the lint rule (and runtime TDZ) sees no self-reference.
    if (pendingRef.current) await runNowRef.current();
  }, []);

  useEffect(() => {
    runNowRef.current = runNow;
  }, [runNow]);

  const schedule = useCallback(
    (value: T): void => {
      pendingRef.current = { value };
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        // Errors here surface via the caller's `save` (which sets UI state);
        // swallow the rejection at the timer boundary to avoid unhandled
        // promise warnings.
        void runNow().catch(() => {});
      }, delayMs);
    },
    [delayMs, runNow],
  );

  const cancel = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  // Flush on unmount so a parent unmount doesn't drop edits. Best-effort:
  // if it rejects we can't keep the component mounted from here.
  useEffect(() => {
    return () => {
      void runNow().catch(() => {});
    };
  }, [runNow]);

  return { schedule, cancel, flush: runNow };
}
