# kanso-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) stdio server that
exposes your local **kanso** desktop app to MCP-aware hosts. Sibling peer of the
Copilot CLI extension at `.github/extensions/kanso/` — both consume the shared
`@kanso/client` workspace lib and talk to `kanso-api` over loopback.

## What it is

- **5 tools** the model can call: `kanso_list`, `kanso_add`, `kanso_move`,
  `kanso_done`, `kanso_search` — identical to the CLI extension.
- **3 resource shapes** the user can `@`-mention as read-only context:
  - `kanso://boards` — markdown index of all boards (id, name, column count, card count)
  - `kanso://boards/{id}` — full snapshot of one board (columns, cards, tags, due dates, body excerpts)
  - `kanso://cards/{id}` — single card with metadata, tags, and body excerpt

Confirmed compatible with:

- **Claude Desktop** (macOS, Windows)
- **Cursor**
- **VS Code Copilot Chat** (MCP servers)
- **Zed** (`assistant.mcp_servers`)
- Anything else speaking MCP over stdio

## Prereqs

1. The **kanso desktop app must be running**. The server discovers `kanso-api`'s
   loopback port by reading the same port file the CLI extension uses
   (`~/Library/Application Support/com.kanso.app/kanso-api.port` on macOS;
   see `@kanso/client/port.mjs` for the full lookup order).
2. **Node.js 20+** on PATH. No build step — this is plain ESM.
3. The repository is checked out somewhere — manual install snippets reference
   absolute paths.

If kanso isn't running when the host tries to use the server, every tool / resource
call exits with a friendly `KANSO_PORT_MISSING` error on stderr.

## Manual install

The server is launched by the host as `node /absolute/path/to/bin/kanso-mcp.mjs`.
Replace `/absolute/path/to` below with your actual checkout.

### Generic JSON (works in most hosts)

```json
{
  "command": "node",
  "args": ["/absolute/path/to/.github/extensions/kanso-mcp/bin/kanso-mcp.mjs"]
}
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "kanso": {
      "command": "node",
      "args": ["/absolute/path/to/.github/extensions/kanso-mcp/bin/kanso-mcp.mjs"]
    }
  }
}
```

Restart Claude Desktop. The 5 tools appear in the tool list; `@kanso://boards`
autocompletes in the prompt input.

### Cursor

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in your workspace root:

```json
{
  "mcpServers": {
    "kanso": {
      "command": "node",
      "args": ["/absolute/path/to/.github/extensions/kanso-mcp/bin/kanso-mcp.mjs"]
    }
  }
}
```

Reload Cursor's MCP servers from the settings panel.

### VS Code Copilot Chat

Create `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "kanso": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/.github/extensions/kanso-mcp/bin/kanso-mcp.mjs"]
    }
  }
}
```

The MCP panel in Copilot Chat picks it up automatically. Use `#kanso` in the
chat to scope to its tools, or attach resources via the resource picker.

### Zed

Edit your Zed settings (`~/.config/zed/settings.json`):

```json
{
  "assistant": {
    "mcp_servers": {
      "kanso": {
        "command": "node",
        "args": [
          "/absolute/path/to/.github/extensions/kanso-mcp/bin/kanso-mcp.mjs"
        ]
      }
    }
  }
}
```

## Tools reference

| Tool | Inputs | Returns |
| --- | --- | --- |
| `kanso_list` | `board_id?`, `column_id?`, `include_archived?` | Boards / columns / cards as text |
| `kanso_add` | `column_id`, `title`, `body?` | `kanso: created card {id} "{title}"` |
| `kanso_move` | `card_id`, `target_column_id` | `kanso: moved card {id} to column {col}` |
| `kanso_done` | `card_id` | `kanso: archived card {id}` |
| `kanso_search` | `q`, `limit?` (default 20, max 50) | FTS5 hits, one per line, with board/column context |

## Resources reference

| URI | Listed? | Source endpoint |
| --- | --- | --- |
| `kanso://boards` | yes (single) | `GET /boards` + per-board column/card counts |
| `kanso://boards/{id}` | yes (enumerated from `/boards`) | `GET /boards/{id}/_full?include_archived=false` |
| `kanso://cards/{id}` | template only, not enumerated | `GET /cards/{id}` + `GET /cards/{id}/tags` |

Resources are read-only markdown. The model never invokes them — the user
attaches them as context.

### Resource error rendering

- 404 on `boards/{id}` → `_Board {id} not found._`
- 409 on `boards/{id}` (>1000 cards) → `_Board too large to render as a snapshot..._`
- 404 on `cards/{id}` → `_Card {id} not found._`
- 500 / connection error → re-thrown to the host as a protocol error

## Troubleshooting

**Tools error with `KANSO_PORT_MISSING`** — Start the kanso desktop app. The
server expects to find the port file written by `kanso-api` at the platform
config directory. If the app is running but the file is still missing, check
the kanso logs.

**Host can't see the server** — Make sure `node` is on the host's PATH (some
GUI apps inherit a minimal PATH). If not, replace `"node"` with the absolute
path to your node binary (`which node`).

**Resources don't autocomplete** — The host must support `resources/list`.
Claude Desktop and Cursor do; some others only support templates. Manually
type `kanso://boards/<board-id>` if your host doesn't enumerate.

**Body excerpts look truncated** — They're capped at 500 characters with an
ellipsis. The full body is in the desktop app.

**`tsc` / `eslint` complain** — They don't run on `.mjs`. This package has no
build step.

## What's not here (yet)

- `resources/subscribe` for live updates — requires server-push
- Using resource URIs as tool inputs (e.g. `kanso_move` accepting `kanso://cards/{id}`)
- A `kanso_open` tool to focus the app on a card — needs Tauri IPC
- An automated installer for the host config files — see Phase 7
