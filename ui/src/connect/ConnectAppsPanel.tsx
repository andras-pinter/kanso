import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cliExtSetConsent,
  mcpHostDetect,
  mcpServerPath,
  revealInFinder,
  type HostInfo,
} from '../kanban/api/client';
import '../kanban/kanban.css';

type LoadState = 'loading' | 'ready' | 'error';

type SnippetKind = 'mcpServers' | 'vscode' | 'zed';

const snippetKind = (id: string): SnippetKind => {
  if (id === 'vscode') return 'vscode';
  if (id === 'zed') return 'zed';
  return 'mcpServers';
};

const snippetFor = (kind: SnippetKind, path: string): string => {
  const server = {
    command: 'node',
    args: [path],
  };

  const snippet =
    kind === 'vscode'
      ? {
          'github.copilot.chat.mcp.servers': {
            kanso: server,
          },
        }
      : kind === 'zed'
        ? {
            context_servers: {
              kanso: {
                command: {
                  path: 'node',
                  args: [path],
                  env: {},
                },
              },
            },
          }
        : {
            mcpServers: {
              kanso: server,
            },
          };

  return JSON.stringify(snippet, null, 2);
};

const instructionsFor = (host: HostInfo): string => {
  const file = host.config_file_hint ?? 'your host config file';
  if (host.id === 'vscode') {
    return `Add this to your ${file} and restart VS Code to load the server. VS Code MCP configuration is moving toward mcp.json; use this Copilot Chat settings shape if your build expects settings.json.`;
  }
  if (host.id === 'zed') {
    return `Merge this into your ${file} under context_servers. Restart Zed to load the server.`;
  }
  return `Add this to your ${file} under mcpServers. Restart ${host.name} to load the server.`;
};

const readOptions = async (): Promise<[string | null, HostInfo[]]> =>
  Promise.all([mcpServerPath(), mcpHostDetect()]);

interface HostCardProps {
  host: HostInfo;
  serverPath: string;
}

function HostCard({ host, serverPath }: HostCardProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snippet = useMemo(
    () => snippetFor(snippetKind(host.id), serverPath),
    [host.id, serverPath]
  );

  const copy = async () => {
    setError(null);
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const reveal = async () => {
    setError(null);
    try {
      await revealInFinder(host.config_dir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  return (
    <section className="kanso-connect-card">
      <div className="kanso-connect-card-header">
        <div>
          <h2>{host.name}</h2>
          <p>{instructionsFor(host)}</p>
        </div>
        <span className="kanso-detected-badge">detected</span>
      </div>
      <pre className="kanso-snippet">
        <code>{snippet}</code>
      </pre>
      {error && (
        <p className="kanso-connect-error" role="alert">
          {error}
        </p>
      )}
      <div className="kanso-connect-actions">
        <button type="button" className="kanso-btn kanso-btn--primary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
        <button type="button" className="kanso-btn" onClick={() => void reveal()}>
          Reveal config file
        </button>
      </div>
    </section>
  );
}

interface GenericCardProps {
  serverPath: string;
}

function GenericCard({ serverPath }: GenericCardProps) {
  const snippet = useMemo(() => snippetFor('mcpServers', serverPath), [serverPath]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section className="kanso-connect-card">
      <div className="kanso-connect-card-header">
        <div>
          <h2>Other MCP hosts</h2>
          <p>
            Most MCP hosts accept a server map like this. Merge it into your host's MCP config and
            check that host's docs for the exact file location and restart behavior.
          </p>
        </div>
      </div>
      <pre className="kanso-snippet">
        <code>{snippet}</code>
      </pre>
      <div className="kanso-connect-actions">
        <button type="button" className="kanso-btn kanso-btn--primary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </div>
    </section>
  );
}

export default function ConnectAppsPanel() {
  const [state, setState] = useState<LoadState>('loading');
  const [hosts, setHosts] = useState<HostInfo[]>([]);
  const [serverPath, setServerPath] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [path, detectedHosts] = await readOptions();
      setServerPath(path);
      setHosts(detectedHosts);
      setState('ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setState('error');
    }
  }, []);

  useEffect(() => {
    let alive = true;
    readOptions()
      .then(([path, detectedHosts]) => {
        if (!alive) return;
        setServerPath(path);
        setHosts(detectedHosts);
        setState('ready');
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setState('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  const detectedHosts = useMemo(() => hosts.filter((host) => host.detected), [hosts]);

  const install = async () => {
    setPendingInstall(true);
    setError(null);
    try {
      await cliExtSetConsent(true);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setPendingInstall(false);
    }
  };

  return (
    <main className="kanso-connect">
      <section className="kanso-connect-hero">
        <div>
          <p className="kanso-eyebrow">MCP</p>
          <h1>Connect Apps</h1>
          <p>
            Wire kanso into AI hosts by copying the snippet for each detected app. kanso never
            writes these host configs for you.
          </p>
        </div>
      </section>

      {state === 'loading' && <p className="kanso-board-state">Loading connection options…</p>}

      {state === 'error' && (
        <section className="kanso-connect-empty" role="alert">
          <h2>Connection options failed to load</h2>
          <p>{error}</p>
          <button type="button" className="kanso-btn" onClick={() => void load()}>
            Retry
          </button>
        </section>
      )}

      {state === 'ready' && serverPath === null && (
        <section className="kanso-connect-empty">
          <h2>Install the MCP server to connect kanso to your AI host</h2>
          <p>
            The bundled MCP server installs to ~/.kanso/mcp/bin/kanso-mcp.mjs after consent. Install
            it, then come back here to copy host snippets.
          </p>
          {error && (
            <p className="kanso-connect-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="kanso-btn kanso-btn--primary"
            disabled={pendingInstall}
            onClick={() => void install()}
          >
            {pendingInstall ? 'Installing…' : 'Install MCP server'}
          </button>
        </section>
      )}

      {state === 'ready' && serverPath !== null && (
        <div className="kanso-connect-grid">
          {detectedHosts.map((host) => (
            <HostCard key={host.id} host={host} serverPath={serverPath} />
          ))}
          <GenericCard serverPath={serverPath} />
        </div>
      )}
    </main>
  );
}
