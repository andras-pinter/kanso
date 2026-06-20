import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import ErrorBoundary from '../ErrorBoundary';

function Boom({ when }: { when: boolean }): ReactElement {
  if (when) throw new Error('boom!');
  return <p>safe</p>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <p>hello</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('renders fallback when child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom when={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/boom!/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    spy.mockRestore();
  });

  it('reload button calls window.location.reload', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    render(
      <ErrorBoundary>
        <Boom when={true} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();
    Object.defineProperty(window, 'location', { configurable: true, value: original });
    spy.mockRestore();
  });

  it('dismiss resets boundary and fires onReset', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onReset = vi.fn();

    function Wrapper(): ReactElement {
      const [armed, setArmed] = useState(true);
      return (
        <ErrorBoundary
          onReset={() => {
            onReset();
            setArmed(false);
          }}
        >
          <Boom when={armed} />
        </ErrorBoundary>
      );
    }

    render(<Wrapper />);
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onReset).toHaveBeenCalledOnce();
    expect(screen.getByText('safe')).toBeTruthy();
    spy.mockRestore();
  });
});
