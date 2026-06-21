# Architecture

> Status: skeleton. Sections marked **TODO** are filled during Phase 1+.

## Overview

**TODO — fill in during Phase 1+.**

kanso is a single-user, local-first Kanban app. One Tauri window, one tray icon, one SQLite database. The same domain logic is exposed through three transports so the UI, scripts, and a future Copilot CLI extension all talk to the same core.

## Crate boundaries

**TODO — fill in during Phase 1+.**

- **`kanso-core`** — domain types (Board, Column, Card), repository traits, sqlx-backed implementations. Knows nothing about HTTP, Tauri, or React.
- **`kanso-api`** — axum router and handlers. Depends on `kanso-core`. Stateless; takes a repository handle.
- **`kanso-tauri`** — Tauri commands, tray menu, window lifecycle, axum bootstrap on loopback. Depends on `kanso-core` and `kanso-api`.
- **`extensions/kanso/`** — Copilot CLI extension (JS, ESM). Reads the loopback port + token from the app-data port file and calls `kanso-api`. Lives outside the Rust workspace because the Copilot CLI extension protocol is Node-only.

## Data model

**TODO — fill in during Phase 1+.**

- Fractional indexing for `position` (no full-list reorders on move).
- Soft delete via `archived_at: Option<DateTime<Utc>>`.

## Runtime model

**TODO — fill in during Phase 1+.**

Tray app, single window, axum in-process on loopback, SQLite file in the platform's app-data dir.

## Three transports

**TODO — fill in during Phase 1+.**

1. **Tauri commands** — primary path for the UI. Typed structs in / out.
2. **REST** (axum) — for scripts and external tools talking to the running app.
3. **Copilot CLI extension** — JS extension under `extensions/kanso/` that talks to `kanso-api` over loopback.

## Diagram

```mermaid
flowchart LR
    UI[React UI] -->|Tauri cmd| Tauri[kanso-tauri]
    Scripts[Scripts / curl] -->|HTTP loopback| API[kanso-api]
    CLI[Copilot CLI ext] -->|HTTP loopback| API
    Tauri --> Core[kanso-core]
    API --> Core
    Core --> DB[(SQLite)]
```
