# kanso justfile — single source of truth for dev tasks.
# Steps no-op gracefully while scaffolding is incomplete.

set shell := ["bash", "-cu"]

default:
    @just --list

# Install toolchain bits and fetch deps. Idempotent.
bootstrap:
    @echo "==> bootstrap"
    @if command -v rustup >/dev/null 2>&1; then \
        rustup component add rustfmt clippy >/dev/null 2>&1 || true; \
        echo "rust: rustfmt + clippy ensured"; \
    else \
        echo "skip: rustup not installed"; \
    fi
    @if [ -f .nvmrc ] && command -v node >/dev/null 2>&1; then \
        want=$(cat .nvmrc); have=$(node --version | sed 's/^v//'); \
        echo "node: want $want, have $have"; \
    else \
        echo "skip: node check"; \
    fi
    @if [ -f ui/package.json ]; then \
        npm install --prefix ui; \
    else \
        echo "skip: ui/package.json not present yet"; \
    fi
    @if [ -f Cargo.toml ]; then \
        cargo fetch; \
    else \
        echo "skip: Cargo.toml not present yet"; \
    fi

# fmt + lint + typecheck. Each step skips if its tool isn't wired yet.
check:
    @echo "==> check"
    @if [ -f Cargo.toml ]; then \
        cargo check --workspace; \
    else \
        echo "skip: cargo check (no Cargo.toml)"; \
    fi
    @if [ -f Cargo.toml ]; then \
        cargo clippy --workspace --all-targets -- -D warnings; \
    else \
        echo "skip: cargo clippy (no Cargo.toml)"; \
    fi
    @if [ -f ui/package.json ]; then \
        cd ui && npx --no-install tsc --noEmit && npx --no-install eslint .; \
    else \
        echo "skip: ui checks (no ui/package.json)"; \
    fi

# Tests.
test:
    @echo "==> test"
    @if [ -f Cargo.toml ]; then \
        cargo test --workspace; \
    else \
        echo "skip: cargo test (no Cargo.toml)"; \
    fi
    @if [ -f ui/package.json ]; then \
        cd ui && npm test; \
    else \
        echo "skip: ui test (no ui/package.json)"; \
    fi
    @if [ -f extensions/package.json ]; then \
        cd extensions && npm test --workspaces --if-present; \
    else \
        echo "skip: kanso cli extension test"; \
    fi

# Format everything. Each step guarded.
fmt:
    @echo "==> fmt"
    @if [ -f Cargo.toml ] && command -v cargo >/dev/null 2>&1; then \
        cargo fmt --all; \
    else \
        echo "skip: cargo fmt"; \
    fi
    @if [ -f ui/package.json ]; then \
        cd ui && npx --no-install prettier --write . || echo "skip: prettier not installed in ui/"; \
    else \
        echo "skip: ui fmt (no ui/package.json)"; \
    fi

# Run the app. Wired later.
dev:
    @echo "TODO: wired in Phase 0 Wave 3 (Tauri bridge session)"

# CI entrypoint.
ci: check test

# Install the kanso Copilot CLI extension by symlinking the dev source.
# Idempotent if our symlink is already in place; refuses if a different
# symlink or real directory occupies the target.
install-ext:
    #!/usr/bin/env bash
    set -euo pipefail
    src="$PWD/extensions/kanso"
    dst="$HOME/.copilot/extensions/kanso"
    if [ ! -d "$src" ]; then
        echo "refusing: source $src not found"
        exit 1
    fi
    mkdir -p "$HOME/.copilot/extensions"
    if [ -L "$dst" ]; then
        existing=$(readlink "$dst")
        if [ "$existing" = "$src" ]; then
            echo "kanso CLI ext already installed (symlink → $src)"
            exit 0
        fi
        echo "refusing: $dst is a symlink to $existing, not $src"
        echo "unlink manually and re-run if you want to replace it"
        exit 1
    fi
    if [ -e "$dst" ]; then
        echo "refusing: $dst exists and is not a symlink"
        echo "this could be a previous non-dev install; back it up or remove it manually"
        exit 1
    fi
    ln -s "$src" "$dst"
    echo "installed kanso CLI ext: $dst → $src"

# Uninstall the dev symlink. Never deletes a real directory.
uninstall-ext:
    #!/usr/bin/env bash
    set -euo pipefail
    dst="$HOME/.copilot/extensions/kanso"
    if [ ! -e "$dst" ] && [ ! -L "$dst" ]; then
        echo "not installed (no $dst)"
        exit 0
    fi
    if [ ! -L "$dst" ]; then
        echo "refusing: $dst is not a symlink"
        echo "this looks like a non-dev install — remove it manually if intended"
        exit 1
    fi
    unlink "$dst"
    echo "uninstalled dev symlink: $dst"
