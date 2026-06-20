import { useCallback, useEffect, useRef } from 'react';

export interface DebouncedSaver<T> {
  /** Schedule a save with the latest value; resets the debounce window. */
  schedule(value: T): void;
  /** Cancel any pending save without running it. */
  cancel(): void;
  /** If a save is pending, run it now and await completion. */
  flush(): Promise<void>;
}

/**
 * Calls `save` at most once per `delayMs` after the last `schedule` call.
 * Stable across renders; `save` is read via ref so changing the closure
 * does not reset the timer. On unmount any pending save is flushed.
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

  const runNow = useCallback(async (): Promise<void> => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!pendingRef.current) {
      if (inFlightRef.current) await inFlightRef.current;
      return;
    }
    const { value } = pendingRef.current;
    pendingRef.current = null;
    const p = saveRef.current(value).finally(() => {
      if (inFlightRef.current === p) inFlightRef.current = null;
    });
    inFlightRef.current = p;
    await p;
  }, []);

  const schedule = useCallback(
    (value: T): void => {
      pendingRef.current = { value };
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        void runNow();
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

  // Flush on unmount so closing the drawer mid-debounce doesn't drop edits.
  useEffect(() => {
    return () => {
      void runNow();
    };
  }, [runNow]);

  return { schedule, cancel, flush: runNow };
}
