# @kanso/client

Shared internal library powering kanso's Copilot CLI extension (and the upcoming MCP server). Not published — consumed via npm workspaces from `extensions/`.

## Modules

| File | Purpose |
| --- | --- |
| `port.mjs` | Resolves the per-OS port-file path, parses `port=` / `token=` lines, reads the file. |
| `client.mjs` | `fetch` wrapper with bearer auth, timeout, 401/`ECONNREFUSED` retry budget, body preflight, error mapping. |
| `tools.mjs` | Five pure async handler functions (`kansoList`, `kansoAdd`, `kansoMove`, `kansoDone`, `kansoSearch`) — `(client, args) => string`. |
| `index.mjs` | Barrel re-export. Consumers do `import { createClient, kansoList } from "@kanso/client"`. |

## Consumers

- `extensions/kanso/` — the Copilot CLI extension.
- `extensions/kanso-mcp/` — the MCP server (Wave C).

## Test

```sh
cd extensions/_shared/kanso-client && npm test
```

Or from the workspace root:

```sh
cd extensions && npm test --workspaces --if-present
```

33 vitest specs, all hermetic — no spawned CLI, no live API, fake `fetch` and port reader injected.
