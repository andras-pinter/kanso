import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import ConnectAppsPanel from './ConnectAppsPanel';
import { __setInvoker, type HostInfo, type InvokeFn } from '../kanban/api/client';

const serverPath = '/Users/piny/.kanso/mcp/bin/kanso-mcp.mjs';

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
});

function mockInvoke(path: string | null, hosts: HostInfo[]) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const invoker: InvokeFn = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === 'mcp_server_path') return path as never;
    if (cmd === 'mcp_host_detect') return hosts as never;
    if (cmd === 'cli_ext_set_consent') return {} as never;
    if (cmd === 'reveal_in_file_manager') return undefined as never;
    throw new Error(`unexpected command: ${cmd}`);
  };
  __setInvoker(invoker);
  return calls;
}
