# Conventions

## Commits

Conventional Commits. Subject ≤ ~50 chars. Body explains *why*, not *what*.

```
feat(parser): support nested card metadata
fix(auth): reject expired tokens in refresh path
refactor(core): extract fractional-index helper
chore: bump sqlx to 0.8
docs: add architecture overview
test(api): cover archive idempotency
```

Allowed types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`.

## Branches

`<type>/<short-kebab-description>`

```
feat/card-archive
fix/dnd-drop-target
chore/ci-cache
refactor/error-types
docs/architecture-overview
test/repo-fixtures
```

Never commit to `master`. PRs only.

## Do

- Errors as `Result<T, E>` with crate-typed errors via `thiserror`.
- Fractional indexing for column / card positions (no full reorders on move).
- Soft delete via `archived_at: Option<DateTime<Utc>>`, never hard delete from UI flows.
- Explicit, typed input/output structs on every Tauri command.
- Small modules, flat hierarchies, composition over inheritance.
- Colocate Rust tests in `#[cfg(test)] mod tests`. Colocate UI tests next to the component.

## Don't

- `unwrap()` or `expect()` outside `#[cfg(test)]`.
- Panic in library code.
- `serde_json::Value` (or any untyped blob) in Tauri command signatures.
- Circular crate dependencies. `kanso-core` depends on nothing app-specific.
- Commit `node_modules/`, `target/`, `dist/`, Tauri `gen/`, or `.env*`.
- Add a dependency without a clear reason.
