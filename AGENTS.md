# AGENTS.md

Universal spec for any agent (human or LLM) working on **kanso**.

## Mission

kanso is a personal, local-first Kanban app for a single user. It runs as a tray-resident Tauri desktop app with rich-text card bodies, drag-and-drop columns, and an in-process HTTP API so the same data is reachable from the UI today and from a Copilot CLI extension (and other scripts) tomorrow. Inspiration: AFFiNE's editing feel, but scoped to Kanban.

## Stack

- **Tauri 2** — desktop shell, single window, tray icon
- **Rust** — `kanso-core` (domain + sqlx), `kanso-api` (axum routes), `kanso-tauri` (commands + tray). The Copilot CLI extension lives in `extensions/kanso/` as a JS extension talking to `kanso-api` over loopback.
- **axum** — in-process HTTP server (loopback) for the REST transport
- **sqlx** + SQLite — persistence; `.sqlx/` is committed for offline mode
- **React + Vite** — UI
- **Zustand** — client state
- **dnd-kit** — card drag (columns are fixed, no column drag)
- **BlockSuite** — rich-text editor for card bodies; eager-loaded, pinned to **Vite ^6.0.3**

## Product rules

- **Columns are fixed:** every board seeds four columns on create — **Incoming** (gray), **Todo** (blue), **In Progress** (amber), **Done** (green). Users cannot add, rename, reorder, or delete columns.
- **No archive.** Delete is a hard delete for boards, cards, and tags. There is no soft-delete / archived_at anywhere in the domain.

## Hard constraints

- **No `unwrap()` / `expect()`** outside `#[cfg(test)]`. Errors as values.
- **No panics in library code.** Return `Result<T, E>` with crate-typed errors via `thiserror`.
- **No `serde_json::Value` in Tauri command signatures.** Inputs and outputs must be explicit, typed structs.
- **Vite stays pinned at `^6.0.3`** (BlockSuite's compat range).
- **No circular crate deps.** `kanso-core` knows nothing of axum, Tauri, or React.
- **`.sqlx/` is committed.** `node_modules/`, `target/`, `dist/`, `gen/` are not.

## How to verify

Before declaring work done:

```sh
just check   # cargo check + clippy -D warnings + tsc --noEmit + eslint
just test    # cargo test --workspace + ui tests
```

Both must be clean. CI runs the same on every push and PR.

## Repo layout

```
crates/
  kanso-core/      domain types, sqlx, repository traits
  kanso-api/       axum router + handlers
  kanso-tauri/     Tauri commands, tray, window mgmt
ui/                Vite + React app
migrations/        sqlx migrations
docs/              architecture notes, ADRs
extensions/        Copilot CLI + MCP extensions (npm workspaces)
  _shared/kanso-client/  @kanso/client — shared port/fetch/handlers
  kanso/                 Copilot CLI extension
  kanso-mcp/             MCP stdio server
.github/           CI + Copilot config
```

See [CONVENTIONS.md](./CONVENTIONS.md) for commit / branch / code style rules.
