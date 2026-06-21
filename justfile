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
    @if [ -f .github/extensions/package.json ]; then \
        cd .github/extensions && npm test --workspaces --if-present; \
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
