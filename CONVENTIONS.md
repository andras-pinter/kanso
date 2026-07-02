# Conventions

## Commits

Conventional Commits. Subject ≤ ~50 chars. Body explains *why*, not *what*.

```
feat(parser): support nested card metadata
fix(auth): reject expired tokens in refresh path
refactor(core): extract fractional-index helper
chore: bump sqlx to 0.8
docs: add architecture overview
test(api): cover fixed-column seeding
```

Allowed types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`.

## Branches

`<type>/<short-kebab-description>`

```
feat/quick-add-modal
fix/dnd-drop-target
chore/ci-cache
refactor/error-types
docs/architecture-overview
test/repo-fixtures
```

Never commit to `master`. PRs only.

## Do

- Errors as `Result<T, E>` with crate-typed errors via `thiserror`.
- Fractional indexing for card positions (no full reorders on move).
- Hard delete only — there is no `archived_at` in the domain.
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

## Extension DTO contract

`extensions/_shared/kanso-client/dto-contract.generated.mjs` is generated from
`crates/kanso-api/src/dto.rs` by `cargo run -p dto-contract-gen`. It's what
the CLI + MCP schema-contract tests diff each tool's advertised fields
against, so if the JS mirror drifts from the Rust DTOs, agents silently ship
tools that file 400/422s.

After editing any request DTO in `dto.rs`, rerun the generator and commit
the result. `just check` (and CI) runs the generator and fails on drift via
`git diff --exit-code`. New request DTOs also need an allowlist entry in
`crates/dto-contract-gen/src/main.rs`.
