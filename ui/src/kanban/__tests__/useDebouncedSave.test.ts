import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedSave } from '../hooks/useDebouncedSave';

// Tiny helper: wait N microtask ticks. Each `await Promise.resolve()` drains
// one microtask; the save hook chains several promises internally so we need
// to spin a handful of times to let the chain settle.
async function flushMicrotasks(n = 8): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await Promise.resolve();
  }
}

describe('useDebouncedSave', () => {
  it('serializes overlapping saves so the later value wins', async () => {
    const calls: string[] = [];
    let resolveA: (() => void) | null = null;
    let resolveB: (() => void) | null = null;

    const save = vi.fn(async (v: string) => {
      calls.push(v);
      if (v === 'A') {
        await new Promise<void>((r) => {
          resolveA = r;
        });
      } else {
        await new Promise<void>((r) => {
          resolveB = r;
        });
      }
    });

    const { result } = renderHook(() => useDebouncedSave<string>(save, 1));

    // Kick off A immediately via flush().
    act(() => {
      result.current.schedule('A');
    });
    const flushA = result.current.flush();
    await flushMicrotasks();
    expect(calls).toEqual(['A']);

    // While A is still in flight, schedule B and flush. The hook MUST NOT
    // start save(B) until save(A) settles.
    act(() => {
      result.current.schedule('B');
    });
    const flushB = result.current.flush();
    await flushMicrotasks();
    expect(calls).toEqual(['A']);

    // Resolve A — B should start next. flushA only returns after B drains,
    // so we have to also resolve B before awaiting it. Spin microtasks to
    // let the drain kick off save(B) and populate resolveB.
    expect(resolveA).not.toBeNull();
    (resolveA as unknown as () => void)();
    await flushMicrotasks(20);
    expect(calls).toEqual(['A', 'B']);

    expect(resolveB).not.toBeNull();
    (resolveB as unknown as () => void)();
    await flushA;
    await flushB;
  });

  it('flush() rejects when the underlying save rejects', async () => {
    const err = new Error('boom');
    const save = vi.fn(async () => {
      throw err;
    });

    const { result } = renderHook(() => useDebouncedSave<string>(save, 1));
    act(() => {
      result.current.schedule('x');
    });
    await expect(result.current.flush()).rejects.toBe(err);
  });

  it('retains the failed value so a subsequent flush retries it', async () => {
    let attempt = 0;
    const save = vi.fn(async (_v: string) => {
      attempt += 1;
      if (attempt === 1) throw new Error('first attempt fails');
    });

    const { result } = renderHook(() => useDebouncedSave<string>(save, 1));
    act(() => {
      result.current.schedule('val');
    });
    await expect(result.current.flush()).rejects.toThrow('first attempt fails');
    expect(save).toHaveBeenCalledTimes(1);

    // The value should still be queued; flush again succeeds.
    await result.current.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0]).toBe('val');
    expect(save.mock.calls[1][0]).toBe('val');
  });
});
