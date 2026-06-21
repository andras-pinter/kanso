# kanso

A personal Kanban app — local-first, keyboard-driven, AFFiNE-inspired. Built as a tray-resident desktop app with rich-text card bodies and an in-process API so the same data is reachable from the UI, scripts, and (eventually) a Copilot CLI extension.

## Stack

- **Shell:** Tauri 2
- **Backend:** Rust (axum in-process, sqlx + SQLite, `thiserror` for error types)
- **Frontend:** React + Vite, Zustand, dnd-kit
- **Editor:** BlockSuite (lazy-loaded; pinned to Vite ^6.0.3)

## Repo layout

```
crates/          Rust workspace (kanso-core, kanso-api, kanso-tauri)
ui/              Vite + React app
migrations/      sqlx migrations
docs/            Architecture notes and ADRs
.github/         CI + Copilot agent config + Copilot CLI extension
```

## Quickstart

```sh
just bootstrap   # install toolchain bits, fetch deps
just dev         # run the app (wired in Phase 0 Wave 3)
just check       # fmt + clippy + tsc + eslint
just test        # cargo + ui tests
```

## Desktop install behavior

The macOS bundle is a tray-only app (`LSUIElement=true`), so it does not show a
Dock icon. Closing the window hides it; use the tray menu to show kanso again or
quit.

The app bundles the Copilot CLI extension and MCP server source as Tauri
resources and stamps them with the workspace package version
(`.kanso-ext-version`). On first launch, kanso asks before installing them to
`~/.copilot/extensions/kanso/` and `~/.kanso/mcp/`. Node.js 20+ must be on
`PATH`; install Node from https://nodejs.org/ and rerun install from the tray if
the prerequisite check fails.

## Agent guidance

- [`AGENTS.md`](./AGENTS.md) — universal agent spec (stack, constraints, verification)
- [`CONVENTIONS.md`](./CONVENTIONS.md) — commit format, branch naming, do/don't
- [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) — Copilot CLI-specific notes
