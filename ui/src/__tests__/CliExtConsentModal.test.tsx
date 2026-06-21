import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setInvoker, type InvokeFn } from '../kanban/api/client';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import CliExtConsentModal from '../CliExtConsentModal';

describe('CliExtConsentModal', () => {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const status = {
    show_consent: false,
    bundled_version: '0.1.0',
    cli_installed_version: '0.1.0',
    consent: true,
    dismissed: false,
  };

  beforeEach(() => {
    calls.length = 0;
    const invoker: InvokeFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return status as never;
    };
    __setInvoker(invoker);
  });

  afterEach(() => {
    __setInvoker(realInvoke);
  });

  it('renders the first-launch consent choices', () => {
    render(<CliExtConsentModal onDone={() => undefined} />);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Install Copilot CLI extension')).toBeTruthy();
    expect(screen.getByText('Not now')).toBeTruthy();
  });

  it('persists install consent and closes', async () => {
    const onDone = vi.fn();
    render(<CliExtConsentModal onDone={onDone} />);

    fireEvent.click(screen.getByText('Install Copilot CLI extension'));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(calls).toEqual([{ cmd: 'cli_ext_set_consent', args: { install: true } }]);
  });

  it('persists dismissal and closes', async () => {
    const onDone = vi.fn();
    render(<CliExtConsentModal onDone={onDone} />);

    fireEvent.click(screen.getByText('Not now'));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(calls).toEqual([{ cmd: 'cli_ext_set_consent', args: { install: false } }]);
  });
});
