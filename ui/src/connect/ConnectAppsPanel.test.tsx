import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import ConnectAppsPanel from './ConnectAppsPanel';
import { __setInvoker, type HostInfo, type InvokeFn } from '../kanban/api/client';
import type { SnapshotEnvelopeDto } from '../kanban/types';

const dialog = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
}));
const autostart = vi.hoisted(() => ({
  disable: vi.fn(),
  enable: vi.fn(),
  isEnabled: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => dialog);
vi.mock('@tauri-apps/plugin-autostart', () => autostart);

const serverPath = '/Users/piny/.kanso/mcp/bin/kanso-mcp.mjs';
const snapshot: SnapshotEnvelopeDto = {
  schema_version: 1,
  exported_at: '2026-06-22T08:00:00Z',
  data: {
    boards: [],
    columns: [],
    cards: [],
    tags: [],
    card_tags: [],
  },
};

const host = (patch: Partial<HostInfo> & Pick<HostInfo, 'id' | 'name'>): HostInfo => ({
  detected: true,
  config_dir: `/tmp/${patch.id}`,
  config_file_hint: 'settings.json',
  ...patch,
});

describe('ConnectAppsPanel', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    dialog.open.mockResolvedValue(null);
    dialog.save.mockResolvedValue(null);
    autostart.disable.mockResolvedValue(undefined);
    autostart.enable.mockResolvedValue(undefined);
    autostart.isEnabled.mockResolvedValue(false);
  });

  afterEach(() => {
    __setInvoker(realInvoke);
    vi.restoreAllMocks();
  });

  it('renders detected hosts only and always includes the generic card', async () => {
    const hosts = [
      host({
        id: 'claude',
        name: 'Claude Desktop',
        config_file_hint: 'claude_desktop_config.json',
      }),
      host({ id: 'cursor', name: 'Cursor', detected: false }),
      host({ id: 'zed', name: 'Zed' }),
    ];
    mockInvoke(serverPath, hosts);

    render(<ConnectAppsPanel />);

    expect(await screen.findByText('Claude Desktop')).toBeTruthy();
    expect(screen.getByText('Zed')).toBeTruthy();
    expect(screen.queryByText('Cursor')).toBeNull();
    expect(screen.getByText('Other MCP hosts')).toBeTruthy();
  });

  it('shows the generic card even when no hosts are detected', async () => {
    mockInvoke(serverPath, [
      host({ id: 'claude', name: 'Claude Desktop', detected: false }),
      host({ id: 'zed', name: 'Zed', detected: false }),
    ]);

    render(<ConnectAppsPanel />);

    expect(await screen.findByText('Other MCP hosts')).toBeTruthy();
    expect(screen.queryByText('Claude Desktop')).toBeNull();
    expect(screen.queryByText('Zed')).toBeNull();
  });

  it('shows the install empty state when the MCP server is missing', async () => {
    const calls = mockInvoke(null, []);

    render(<ConnectAppsPanel />);

    expect(
      await screen.findByText('Install the MCP server to connect kanso to your AI host')
    ).toBeTruthy();

    fireEvent.click(screen.getByText('Install MCP server'));

    await waitFor(() =>
      expect(calls).toContainEqual({ cmd: 'cli_ext_set_consent', args: { install: true } })
    );
  });

  it('copies the selected host JSON snippet', async () => {
    mockInvoke(serverPath, [
      host({
        id: 'claude',
        name: 'Claude Desktop',
        config_file_hint: 'claude_desktop_config.json',
      }),
    ]);

    render(<ConnectAppsPanel />);
    await screen.findByText('Claude Desktop');
    fireEvent.click(screen.getAllByText('Copy JSON')[0]);

    const expected = JSON.stringify(
      {
        mcpServers: {
          kanso: {
            command: 'node',
            args: [serverPath],
          },
        },
      },
      null,
      2
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
  });

  it('exports a JSON snapshot to the selected path', async () => {
    const calls = mockInvoke(serverPath, []);
    dialog.save.mockResolvedValue('/tmp/kanso-export.json');

    render(<ConnectAppsPanel />);
    await screen.findByText('Data and startup');
    fireEvent.click(screen.getByText('Export JSON'));

    await waitFor(() =>
      expect(calls).toContainEqual({
        cmd: 'write_export_file',
        args: {
          path: '/tmp/kanso-export.json',
          jsonString: `${JSON.stringify(snapshot, null, 2)}\n`,
        },
      })
    );
    expect(calls).toContainEqual({ cmd: 'export_data', args: undefined });
  });

  it('confirms before importing and sends the picked JSON to IPC', async () => {
    const calls = mockInvoke(serverPath, []);
    dialog.open.mockResolvedValue('/tmp/kanso-import.json');

    render(<ConnectAppsPanel />);
    await screen.findByText('Data and startup');
    fireEvent.click(screen.getByText('Import JSON'));

    // Confirm the destructive import dialog.
    const replaceBtn = await screen.findByRole('button', { name: 'Replace' });
    fireEvent.click(replaceBtn);

    await waitFor(() =>
      expect(calls).toContainEqual({
        cmd: 'import_data',
        args: { jsonString: '{"schema_version":1}' },
      })
    );
    expect(calls).toContainEqual({
      cmd: 'read_import_file',
      args: { path: '/tmp/kanso-import.json' },
    });
  });

  it('toggles autostart from the settings card', async () => {
    autostart.isEnabled.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockInvoke(serverPath, []);

    render(<ConnectAppsPanel />);
    await screen.findByText('Start at login: off');
    fireEvent.click(screen.getByText('Start at login: off'));

    await waitFor(() => expect(autostart.enable).toHaveBeenCalled());
    expect(await screen.findByText('Start at login: on')).toBeTruthy();
  });
});

function mockInvoke(path: string | null, hosts: HostInfo[]) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const invoker: InvokeFn = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === 'mcp_server_path') return path as never;
    if (cmd === 'mcp_host_detect') return hosts as never;
    if (cmd === 'cli_ext_set_consent') return {} as never;
    if (cmd === 'reveal_in_file_manager') return undefined as never;
    if (cmd === 'export_data') return snapshot as never;
    if (cmd === 'write_export_file') return undefined as never;
    if (cmd === 'read_import_file') return '{"schema_version":1}' as never;
    if (cmd === 'import_data') return undefined as never;
    throw new Error(`unexpected command: ${cmd}`);
  };
  __setInvoker(invoker);
  return calls;
}
