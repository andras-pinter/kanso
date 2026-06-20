//! HTTP transport for kanso.
//!
//! The same `Router` is built once in-process by `kanso-tauri` and will be the
//! single source consumed by the CLI extension and any future scripts. DTOs
//! live in [`dto`]; the Tauri command layer re-uses them verbatim.

pub mod dto;
pub mod error;
mod handlers;

use axum::{routing::get, Router};
use sqlx::SqlitePool;

pub use dto::*;
pub use error::ApiError;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .merge(handlers::board::routes())
        .merge(handlers::column::routes())
        .merge(handlers::card::routes())
        .with_state(state)
}

async fn healthz() -> &'static str {
    "ok"
}
