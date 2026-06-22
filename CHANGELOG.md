# Changelog

All notable changes to **kanso** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-22

First tagged release. Feature-complete against the original phase plan.

### Added

#### Phase 0 — Foundation
- Cargo workspace (`kanso-core` / `kanso-api` / `kanso-tauri` / `kanso-cli-ext`).
- React + Vite + TypeScript UI scaffold.
- sqlx + SQLite with offline `.sqlx/` committed.
- AI-readiness baseline: `AGENTS.md`, `CONVENTIONS.md`, `.github/copilot-instructions.md`, `.github/copilot-setup-steps.yml`, `rustfmt.toml`, `clippy.toml`, `.editorconfig`, `.prettierrc`.

#### Phase 1 — Core Kanban
- Tauri 2 ↔ React bridge with shared sqlx pool.
- CRUD commands for boards / columns / cards.
- Real fractional indexing for card and column positions.
- dnd-kit drag/drop within and across columns.

#### Phase 2 — BlockSuite editor
- BlockSuite integration via lazy-loaded editor module.
- Card body persisted as Yjs binary snapshot.
- Drawer lifecycle hardened against data loss (flush on close + archive).

#### Phase 3 — Features
- Custom columns: add / rename / reorder / color.
- Multiple boards + board switcher + manage drawer.
- Tags with color, chips on cards, manage tags drawer.
- Due dates (UTC midnight) + overdue badge.
- FTS5 search palette (`Cmd/Ctrl+K`) with board + column context.
- Archive (soft delete) with archived view.

#### Phase 4 — Localhost HTTP API
- Axum server bound to `127.0.0.1` with random high port.
- Bearer token auth, port + token written to app data dir with tight perms.
- DNS-rebinding host guard, body size limit, pagination.
- Bulk card-tag link endpoint.
- `GET /boards/:id/_full` nested snapshot.
- `GET /boards/:id`, `GET /columns/:id` singular endpoints.

#### Phase 5 — Copilot CLI extension
- JavaScript-based `kanso-mcp` stdio MCP server.
- Shared `@kanso/client` lib for resource + IPC plumbing.
- Tools for list / add / move / done / search / open over the localhost API.

#### Phase 6 — Polish
- Tray-resident app (macOS `LSUIElement`); window opens on tray click.
- Connect Apps panel (macOS) for MCP host detection (Claude / Cursor / VS Code / Zed / Cline).
- Cross-platform host detection (Linux + Windows path lists, file-manager reveal helper).
- Card detail surface upgraded from drawer to centered modal with Esc + focus trap.
- Light / dark theme with system detection, manual segmented toggle, no-FOUC pre-paint script (~25 semantic tokens).
- Quick-add modal with `Cmd/Ctrl+Shift+K` global hotkey + tray menu item.
- Export / import JSON (schema v1, destructive replace with confirm).
- Launch backup via `VACUUM main INTO` with 7-day retention (failures non-fatal).
- Autostart-on-login toggle (default off) via `tauri-plugin-autostart`.

#### Phase 7 — Tech-debt + hardening
- Bundled CLI extension binary inside Tauri app with first-launch consent flow.
- MCP render hardening: bounded YText excerpt, board/column context in card snapshots, banner-on-truncation off-by-one fix.
- `justfile` recipes: `dev`, `run-app`, `build-app`.
- Custom ESLint rule `no-unstable-zustand-selector` flagging `?? []` / `?? {}` selector hazards.
- `docs/troubleshooting.md` for styling cache issues.

### Project state at 0.1.0
- 393 tests passing: cargo 152, ui 150, `@kanso/client` 52, `kanso-mcp` 39.
- BlockSuite editor chunk: **1417.6 KB gzipped** (69.2% of 2 MB budget).
- All quality gates clean: `cargo fmt`, `cargo clippy -D warnings`, `cargo check`, `tsc --noEmit`, `eslint`.
- Vite pinned at `^6.0.3` (BlockSuite compat range).

[0.1.0]: https://github.com/andras-pinter/kanso/releases/tag/v0.1.0
