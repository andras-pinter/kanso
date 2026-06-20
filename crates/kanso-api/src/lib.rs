//! HTTP transport for kanso.
//!
//! The same `Router` is built once in-process by `kanso-tauri` and will be the
//! single source consumed by the CLI extension and any future scripts. DTOs
//! live in [`dto`]; the Tauri command layer re-uses them verbatim.

pub mod dto;
pub mod error;
mod handlers;

use std::sync::Arc;

use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{header, StatusCode},
    middleware::{from_fn, from_fn_with_state, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use sqlx::SqlitePool;
use subtle::ConstantTimeEq;

pub use dto::*;
pub use error::ApiError;

/// Default cap on incoming request bodies (1 MiB). Lower than axum's 2 MiB default
/// — BlockSuite Yjs snapshots and every other DTO are kilobytes at worst. Card
/// body PUT overrides this to 8 MiB on its own route to tolerate pasted images.
const DEFAULT_BODY_LIMIT_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub token: Arc<str>,
}

pub fn router(state: AppState) -> Router {
    let protected = Router::new()
        .merge(handlers::board::routes())
        .merge(handlers::column::routes())
        .merge(handlers::card::routes())
        .merge(handlers::tag::routes())
        .layer(from_fn_with_state(state.clone(), require_bearer))
        .with_state(state);

    Router::new()
        .route("/healthz", get(healthz))
        .merge(protected)
        // Outer layers apply to every route including /healthz. Host guard runs
        // first so we never leak token-validity timing to misbehaving Hosts;
        // the body limit is harmless to evaluate after.
        .layer(DefaultBodyLimit::max(DEFAULT_BODY_LIMIT_BYTES))
        .layer(from_fn(require_loopback_host))
}

async fn healthz() -> &'static str {
    "ok"
}

async fn require_bearer(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let header_val = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok());

    let Some(provided) = header_val.and_then(|h| h.strip_prefix("Bearer ")) else {
        return unauthorized();
    };

    if provided.as_bytes().ct_eq(state.token.as_bytes()).into() {
        next.run(req).await
    } else {
        unauthorized()
    }
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({ "error": "unauthorized" })),
    )
        .into_response()
}

/// DNS-rebinding defense: only accept requests whose `Host` header names
/// the loopback interface. A page at `evil.com` that rebinds DNS to 127.0.0.1
/// would arrive here with `Host: evil.com`; reject it before any handler runs.
async fn require_loopback_host(req: Request, next: Next) -> Response {
    let Some(raw_host) = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
    else {
        return forbidden_host();
    };

    if is_loopback_host(raw_host) {
        next.run(req).await
    } else {
        forbidden_host()
    }
}

fn is_loopback_host(raw: &str) -> bool {
    // Strip the optional `:port` suffix. We accept any port the listener
    // happens to bind to, but the hostname must be one of the loopback aliases.
    let host = match raw.rsplit_once(':') {
        // IPv6 literals appear as `[::1]:port` — bail to the bracketed form below.
        Some((host, _)) if !host.contains(':') => host,
        _ => raw,
    };
    matches!(host, "127.0.0.1" | "localhost")
}

fn forbidden_host() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({ "error": "forbidden_host" })),
    )
        .into_response()
}
