//! HTTP transport for kanso.
//!
//! Wave 1 ships only `GET /healthz` as a placeholder. Phase 4 will flesh this
//! out with full CRUD over boards/columns/cards/tags, mounted in-process by
//! `kanso-tauri` so the desktop app and any future MCP/CLI clients share one
//! sqlx pool.

use axum::routing::get;
use axum::Router;
use sqlx::SqlitePool;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .with_state(state)
}

async fn healthz() -> &'static str {
    "ok"
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use kanso_core::db::{migrate, open_memory};
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn test_healthz_returns_ok() {
        let pool = open_memory().await.unwrap();
        migrate(&pool).await.unwrap();
        let app = router(AppState { pool });

        let res = app
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::OK);
        let body = res.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&body[..], b"ok");
    }
}
