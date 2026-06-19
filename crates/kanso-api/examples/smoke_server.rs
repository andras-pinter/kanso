//! Standalone API server backed by a tempfile sqlite, for `scripts/phase1-smoke.sh`.
//!
//!     KANSO_SMOKE_PORT=53219 cargo run -p kanso-api --example smoke_server
//!
//! Then in another shell: `KANSO_PORT=53219 scripts/phase1-smoke.sh`.

#![allow(clippy::unwrap_used)]

use kanso_api::{router, AppState};
use kanso_core::db::{migrate, open};

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("KANSO_SMOKE_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let tmp = tempfile::tempdir().unwrap();
    let db = tmp.path().join("kanso.db");
    let pool = open(&db).await.unwrap();
    migrate(&pool).await.unwrap();
    let app = router(AppState { pool });
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap();
    let bound = listener.local_addr().unwrap();
    println!("listening on http://{bound}");
    axum::serve(listener, app).await.unwrap();
}
