# Copilot CLI instructions for kanso

## What you're working on

**kanso** is a personal, local-first Kanban app: a tray-resident Tauri 2 desktop app with rich-text card bodies and an in-process HTTP API. Single user, single window, AFFiNE-inspired editing.

## Stack

- **Tauri 2** shell with tray
- **Rust** workspace: `kanso-core` (domain + sqlx), `kanso-api` (axum), `kanso-tauri` (commands/tray), `kanso-cli-ext` (future MCP)
- **axum** in-process on loopback
- **sqlx** + SQLite, `.sqlx/` committed for offline build
- **React + Vite + Zustand + dnd-kit**
- **BlockSuite** for card editor — **lazy-loaded**, **Vite pinned to `^6.0.3`**

## Hard rules

- No `unwrap()` / `expect()` outside `#[cfg(test)]`.
- No panics in library code — return `Result<T, E>` with `thiserror`-typed errors.
- No `serde_json::Value` in Tauri command signatures — use explicit typed structs.
- Don't bump Vite past BlockSuite's `^6.0.3` range.
- Don't introduce circular crate deps. `kanso-core` stays app-agnostic.
- Don't commit `node_modules/`, `target/`, `dist/`, Tauri `gen/`. **Do** commit `.sqlx/`.

## Style

- Concise, Rust-idiomatic. Pattern matching > verbose control flow.
- Short clear names. No filler comments. Docstrings only on public APIs.
- TS: `const`, arrow functions, no `any`.
- Small modules, flat hierarchies, composition over inheritance.
- Conventional Commits (`feat(scope): ...`), subject ≤ ~50 chars.

## How to verify changes

Always run before declaring done:

```sh
just check   # cargo check + clippy -D warnings + tsc --noEmit + eslint
just test    # cargo test --workspace + ui tests
```

CI runs the same. If `just check` and `just test` are clean, you're good.

## Workflow

- Never work on `master`. Create a branch (`feat/...`, `fix/...`, etc.).
- Never open a PR without explicit user consent.
- Plan briefly before non-trivial changes.
- Small verifiable steps. Run `cargo check` / `cargo clippy` after Rust edits, `tsc --noEmit` after TS edits.
