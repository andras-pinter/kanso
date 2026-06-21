# kanso — Copilot CLI extension

JS extension that exposes the running kanso desktop app to the Copilot CLI. It
talks to the in-process `kanso-api` over loopback using the bearer token written
by the Tauri app to its app-data port file.

## Layout

```
.github/extensions/
  package.json             npm workspace root
  _shared/kanso-client/    @kanso/client — port + fetch wrapper + tool handlers (+ vitest)
  kanso/
    extension.mjs          entry — registers tools with @github/copilot-sdk
    package.json           deps on @kanso/client (workspace)
```

Logic and tests live in `@kanso/client` so the upcoming MCP server can share them.

## Install

The extension is auto-discovered when running `copilot` from this repo root.
No build step — ESM only. Node 18+ is required (uses global `fetch`).

The workspace symlinks `@kanso/client` into `kanso/node_modules` on install:

```sh
npm install --prefix .github/extensions
```

## Tools

| Tool | Description |
| --- | --- |
| `kanso_list` | List boards (no args), columns (`board_id`), or cards (`column_id`). Optional `include_archived`. |
| `kanso_add` | Create a card in a column. Required `column_id`, `title`. Optional `body` (sets `body_text`). |
| `kanso_move` | Move a card to another column. Appends to the end. Required `card_id`, `target_column_id`. |
| `kanso_done` | Archive a card (soft delete). Required `card_id`. |
| `kanso_search` | FTS5 search across cards. Required `q`. Optional `limit` (default 20, max 50). |

## Port file

The Tauri app writes a 0600-mode file at:

- **macOS:** `~/Library/Application Support/dev.kanso.desktop/port`
- **Linux:** `$XDG_DATA_HOME/dev.kanso.desktop/port` (or `~/.local/share/...`)
- **Windows:** `%APPDATA%/dev.kanso.desktop/port`

Contents:

```
port=54321
token=<32-byte hex>
```

The token rotates on every app restart. The extension caches the parsed values
and re-reads once on any `401` or `ECONNREFUSED` before giving up.

## Verify (smoke recipe)

1. Start the kanso desktop app (`just dev`, or run the built bundle).
2. From this repo root, run `copilot`.
3. Try:
   - "list my kanso boards"
   - "list cards in column `<col-id>`"
   - "add a card titled 'try it out' to column `<col-id>`"
   - "search kanso for 'meeting'"
   - "move card `<id>` to column `<id>`"
   - "archive card `<id>`"

## Test

```sh
cd .github/extensions && npm install && npm test --workspaces --if-present
```

The 33 vitest specs live in `@kanso/client`. They are pure: they import the
handlers and inject a fake `fetch` / port reader. They do **not** spawn the
Copilot CLI or the kanso API.

## Troubleshooting

- **`kanso desktop app is not running (port file not found ...)`** — the Tauri
  app hasn't been launched yet (or hasn't finished startup).
- **`kanso: auth failed, restart kanso app`** — the cached token is stale and
  re-reading the port file didn't help. Usually means the app was force-killed
  before it could rewrite the file; restart it.
- **`kanso: payload too large (1 MiB API limit)`** — you tried to send a body
  bigger than the API's outer limit. The card-body PUT route is 8 MiB, but
  these CLI tools only hit JSON endpoints capped at 1 MiB.
