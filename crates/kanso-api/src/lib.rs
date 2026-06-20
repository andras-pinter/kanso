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
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::{from_fn_with_state, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use sqlx::SqlitePool;
use subtle::ConstantTimeEq;

pub use dto::*;
pub use error::ApiError;

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
